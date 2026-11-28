// @ts-check
/**
 * node-postgres pool settings shared by the three places that open a connection
 * to the configured Postgres database: `src/lib/db.ts` (app queries),
 * `src/lib/auth/server.ts` (Better Auth sessions) and `scripts/migrate.mjs`
 * (deploy-time migrations).
 *
 * The database is a standard Postgres, so the same settings work for Supabase,
 * Neon or a local server; the Supabase-specific part is TLS.
 *
 * Supabase refuses plaintext connections, and a connection string copied from
 * its dashboard often omits `sslmode`. This module therefore defaults Supabase
 * connections to `verify-full` — encryption **and** server identity
 * verification — rather than the old `no-verify` shortcut, which made a
 * man-in-the-middle attack against the database connection possible.
 *
 * Supabase's pooler certificate is signed by Supabase's own root CA, so
 * verification needs that CA. Put the PEM certificate in
 * `SUPABASE_CA_CERT` (or `PG_SSL_CA_CERT`) and it is passed to node-postgres
 * without putting a file path in the connection string; Vercel has no durable
 * filesystem for a downloaded certificate. An operator who explicitly sets
 * `sslmode=no-verify` (or legacy `require`/`prefer`) gets strict verification
 * too, unless they deliberately opt out with `PG_ALLOW_INSECURE_TLS=true`.
 */

const SSL_QUERY_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey"];

function canUseInsecureTls() {
  return process.env.PG_ALLOW_INSECURE_TLS === "true";
}

/**
 * @param {string} connectionString
 * @param {string} mode
 * @returns {string}
 */
function replaceSslMode(connectionString, mode) {
  return connectionString.replace(/([?&]sslmode=)([^&]*)/i, `$1${mode}`);
}

/**
 * Remove TLS options from a connection string so they do not overwrite an
 * explicit `ssl` object. `pg-connection-string` replaces the whole `ssl`
 * option when the URL contains any of these parameters.
 * @param {string} connectionString
 * @returns {string}
 */
export function withoutSslParams(connectionString) {
  try {
    const url = new URL(connectionString);
    for (const key of SSL_QUERY_PARAMS) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return connectionString;
  }
}

/**
 * Is this connection string pointing at Supabase?
 *
 * Covers the direct endpoint (`db.<ref>.supabase.co`), the pooler
 * (`<region>.pooler.supabase.com`) and custom Supabase domains
 * (`<something>.supabase.com`).
 * @param {string} connectionString
 * @returns {boolean}
 */
export function isSupabaseHost(connectionString) {
  let host;
  try {
    host = new URL(connectionString).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "supabase.co" ||
    host.endsWith(".supabase.co") ||
    host.endsWith(".supabase.com")
  );
}

/**
 * The connection string with a verified Supabase SSL mode.
 *
 * Missing -> `sslmode=verify-full`. Legacy `require`/`prefer` and explicit
 * `no-verify` are also rewritten to `verify-full`: those modes encrypt without
 * proving the server's identity. Set `PG_ALLOW_INSECURE_TLS=true` only for a
 * deliberately non-production/diagnostic connection. Explicit `verify-full`,
 * `verify-ca` and `disable` are preserved.
 * @param {string} connectionString
 * @returns {string}
 */
export function withSslMode(connectionString) {
  if (!isSupabaseHost(connectionString)) return connectionString;
  const match = /[?&]sslmode=([^&]*)/i.exec(connectionString);
  if (!match) {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=verify-full`;
  }
  const mode = match[1].toLowerCase();
  if (mode === "require" || mode === "prefer" || mode === "no-verify") {
    return replaceSslMode(
      connectionString,
      canUseInsecureTls() ? "no-verify" : "verify-full",
    );
  }
  return connectionString;
}

/**
 * The configured Postgres connection string, or undefined when none is set.
 *
 * `SUPABASE_DB_URL` wins over `DATABASE_URL` because a deployed app is also
 * handed a platform-provisioned `DATABASE_URL`; naming Supabase explicitly
 * keeps the app on Supabase there. A workspace that only sets `DATABASE_URL`
 * (or nothing) behaves exactly as before.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function databaseUrlFromEnv(env = process.env) {
  const raw = env.SUPABASE_DB_URL ?? env.DATABASE_URL;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Pool options for a hosted Postgres.
 *
 * `max` stays small because serverless deployments run many short-lived
 * instances against one shared connection budget (Supabase's pooler included);
 * `PGPOOL_MAX` overrides it for a long-lived server. The short idle timeout
 * returns connections promptly, and the connect timeout turns a wrong host or
 * password into a clear error instead of a request that hangs.
 *
 * `statement_timeout` / `query_timeout` keep one slow query from holding a
 * scarce pool slot indefinitely. `PG_STATEMENT_TIMEOUT_MS` can raise or lower
 * the 15-second default for a deliberately long maintenance query.
 *
 * If `SUPABASE_CA_CERT` / `PG_SSL_CA_CERT` is set, it is passed as the trusted
 * CA in an `ssl` object and TLS parameters are removed from the URL (otherwise
 * the URL's TLS options would replace the object). `\n` escapes in the env var
 * are accepted so a one-line secret can hold a multiple-line PEM.
 *
 * @param {string} connectionString
 * @param {{ max?: number }} [options]
 * @returns {{
 *   connectionString: string,
 *   max: number,
 *   idleTimeoutMillis: number,
 *   connectionTimeoutMillis: number,
 *   statement_timeout: number,
 *   query_timeout: number,
 *   ssl?: { ca: string, rejectUnauthorized: boolean },
 * }}
 */
export function pgPoolOptions(connectionString, options = {}) {
  const requested = Number(process.env.PGPOOL_MAX ?? options.max ?? 2);
  const max = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 2;
  const requestedTimeout = Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15_000);
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout >= 1000
    ? Math.floor(requestedTimeout)
    : 15_000;
  const ca = (process.env.SUPABASE_CA_CERT ?? process.env.PG_SSL_CA_CERT)?.trim();
  const common = {
    connectionString: ca
      ? withoutSslParams(withSslMode(connectionString))
      : withSslMode(connectionString),
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    statement_timeout: timeout,
    query_timeout: timeout,
  };
  if (!ca) return common;
  return {
    ...common,
    ssl: {
      ca: ca.replace(/\\n/g, "\n"),
      rejectUnauthorized: !canUseInsecureTls(),
    },
  };
}
