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
 * its dashboard often omits `sslmode` — which surfaces as the confusing
 * "no pg_hba.conf entry ... no encryption" error. But plain `sslmode=require`
 * is not the fix either: Supabase's pooler presents a certificate chained to
 * Supabase's own CA, which Node does not trust, and pg 8 maps `require` to
 * full verification (`SELF_SIGNED_CERT_IN_CHAIN`). `sslmode=no-verify` keeps
 * the connection encrypted while skipping that verification — the same trade
 * Supabase documents for node-postgres. An operator who supplies Supabase's CA
 * can still choose `verify-full` and it is left untouched.
 */

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
 * The connection string with a Supabase-compatible SSL mode.
 *
 * Missing -> `sslmode=no-verify` (TLS, no CA verification). `require`/`prefer`
 * are rewritten to `no-verify` for the same reason: pg 8 treats them as
 * `verify-full`, which fails against Supabase's CA without extra setup. Other
 * explicit choices (`disable`, `verify-full`, `verify-ca`) are preserved — and
 * so is a `uselibpqcompat=true` string, where `require` already means no
 * verification.
 * @param {string} connectionString
 * @returns {string}
 */
export function withSslMode(connectionString) {
  if (!isSupabaseHost(connectionString)) return connectionString;
  const libpqCompat = /[?&]uselibpqcompat=true(?:&|$)/i.test(connectionString);
  const match = /[?&]sslmode=([^&]*)/i.exec(connectionString);
  if (!match) {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=no-verify`;
  }
  if (libpqCompat) return connectionString;
  const mode = match[1].toLowerCase();
  if (mode === "require" || mode === "prefer") {
    return connectionString.replace(/([?&]sslmode=)([^&]*)/i, "$1no-verify");
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
 * @param {string} connectionString
 * @param {{ max?: number }} [options]
 * @returns {{
 *   connectionString: string,
 *   max: number,
 *   idleTimeoutMillis: number,
 *   connectionTimeoutMillis: number,
 * }}
 */
export function pgPoolOptions(connectionString, options = {}) {
  const requested = Number(process.env.PGPOOL_MAX ?? options.max ?? 4);
  const max = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 4;
  return {
    connectionString: withSslMode(connectionString),
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  };
}
