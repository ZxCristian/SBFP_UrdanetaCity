#!/usr/bin/env node
/**
 * One-off authenticated load test against a DEPLOYED SBFP site.
 *
 * It creates clearly-prefixed temporary accounts directly in the configured
 * Postgres (the same rows `createAccount` writes), signs each one in through
 * the site's own `/api/auth/sign-in/email`, walks signed-in pages concurrently,
 * and deletes every account it created in a `finally` block.
 *
 * This writes to whatever database `SUPABASE_DB_URL` / `DATABASE_URL` points
 * at. Only run it when that is the database the target site uses.
 *
 *   node scripts/loadtest-live.mjs inspect
 *   node scripts/loadtest-live.mjs probe --base-url https://example.com
 *   node scripts/loadtest-live.mjs run --users 100 --base-url https://example.com
 *   node scripts/loadtest-live.mjs cleanup --run-id <id>
 *
 * Every test address starts with `loadtest.` and no real account uses that
 * prefix, so cleanup can always remove leftovers without touching app data.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { databaseUrlFromEnv, pgPoolOptions } from "./pg-connection.mjs";

const PREFIX_ROOT = "loadtest.";
const DEFAULTS = {
  baseUrl: "https://sbfpurdanetacity.vercel.app",
  users: 100,
  iterations: 2,
  timeoutMs: 30_000,
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._mode ??= arg;
      continue;
    }
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

const raw = parseArgs(process.argv.slice(2));
const mode = raw._mode ?? "inspect";
const baseUrl = String(raw["base-url"] ?? DEFAULTS.baseUrl).replace(/\/+$/, "");
const users = Number(raw.users ?? DEFAULTS.users);
const iterations = Number(raw.iterations ?? DEFAULTS.iterations);
const timeoutMs = Number(raw["timeout-ms"] ?? DEFAULTS.timeoutMs);
const runId =
  raw["run-id"] ?? new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const prefix = `${PREFIX_ROOT}${runId}.`;

new URL(baseUrl);

if (!["inspect", "probe", "run", "cleanup"].includes(mode)) {
  throw new Error(`Unknown mode: ${mode}`);
}
if (!Number.isInteger(users) || users < 1 || users > 150) {
  throw new Error("--users must be an integer between 1 and 150");
}
if (!Number.isInteger(iterations) || iterations < 1) {
  throw new Error("--iterations must be a positive integer");
}
if (!prefix.startsWith(PREFIX_ROOT)) {
  throw new Error("Refusing a prefix that does not start with loadtest.");
}

const databaseUrl = databaseUrlFromEnv(process.env);
if (!databaseUrl) {
  console.error("No database URL (SUPABASE_DB_URL / DATABASE_URL) is configured.");
  process.exit(1);
}
const pool = new pg.Pool(pgPoolOptions(databaseUrl, { max: 4 }));

function testEmail(index, runPrefix = prefix) {
  return `${runPrefix}${String(index + 1).padStart(3, "0")}@example.com`;
}

function testPassword() {
  return `Lt-${randomBytes(18).toString("base64url")}`;
}

async function inspect() {
  const accounts = await pool.query(
    "select role, status, count(*)::int as n from sbfp_accounts group by 1,2 order by 1,2",
  );
  const usersRow = await pool.query('select count(*)::int as n from "user"');
  const leftover = await pool.query(
    "select count(*)::int as n from sbfp_accounts where email like $1",
    [`${PREFIX_ROOT}%`],
  );
  console.log(
    JSON.stringify(
      {
        accounts: accounts.rows,
        users: usersRow.rows[0]?.n ?? 0,
        loadtestAccounts: leftover.rows[0]?.n ?? 0,
      },
      null,
      2,
    ),
  );
}

async function removeByPrefix(runPrefix) {
  const pattern = `${runPrefix}%`;
  const accounts = await pool.query(
    "delete from sbfp_accounts where email like $1 returning email",
    [pattern],
  );
  const identities = await pool.query(
    'delete from "user" where lower("email") like $1 returning "email"',
    [pattern],
  );
  return { accounts: accounts.rowCount ?? 0, users: identities.rowCount ?? 0 };
}

async function createTestUser(index, runPrefix) {
  const email = testEmail(index, runPrefix);
  const password = testPassword();
  const userId = randomUUID();
  const passwordHash = await hashPassword(password);
  const name = `Load Test ${String(index + 1).padStart(3, "0")}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, now(), now())`,
      [userId, name, email],
    );
    await client.query(
      `insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
       values ($1, $2, 'credential', $3, $4, now(), now())`,
      [randomUUID(), userId, userId, passwordHash],
    );
    await client.query(
      `insert into sbfp_accounts
         (email, role, full_name, position, contact, school_id, status, temp_password, created_at, updated_at)
       values ($1, 'admin', $2, '', '', null, 'active', false, now(), now())`,
      [email, name],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { email, password };
}

async function signIn(user, index) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(baseUrl).origin,
        "user-agent": "SBFP-loadtest/1.0",
        // Each virtual user represents a different client network. The app's
        // credential limiter is per IP; without this, all 100 share one bucket.
        "x-forwarded-for": `203.0.113.${(index % 250) + 1}`,
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
      signal: controller.signal,
    });
    const text = await response.text();
    const cookies = response.headers.getSetCookie?.() ?? [];
    const session = cookies
      .map((cookie) => cookie.split(";")[0])
      .find((cookie) => cookie.startsWith("__Host-grok-auth.session_token="));
    return {
      status: response.status,
      retryAfter: response.headers.get("x-retry-after"),
      cookie: session ?? "",
      body: text.slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function get(path, cookie, index) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "follow",
      headers: {
        cookie,
        "user-agent": "SBFP-loadtest/1.0",
        "x-forwarded-for": `203.0.113.${(index % 250) + 1}`,
      },
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return {
      path,
      status: response.status,
      ms: performance.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

async function probe() {
  const runPrefix = `${PREFIX_ROOT}probe.${runId}.`;
  console.log(`Probe account prefix: ${runPrefix}`);
  let user;
  try {
    user = await createTestUser(0, runPrefix);
    const result = await signIn(user, 0);
    console.log(
      JSON.stringify(
        {
          signInStatus: result.status,
          gotSessionCookie: Boolean(result.cookie),
          retryAfter: result.retryAfter,
          body: result.body,
        },
        null,
        2,
      ),
    );
    if (result.cookie) {
      const session = await get("/api/auth/get-session", result.cookie, 0);
      console.log(
        JSON.stringify(
          { sessionProbe: session, usingLiveDatabase: true },
          null,
          2,
        ),
      );
    } else {
      console.log(
        JSON.stringify({ sessionProbe: null, usingLiveDatabase: false }, null, 2),
      );
    }
  } finally {
    const removed = await removeByPrefix(runPrefix);
    console.log(
      `Probe cleanup: ${removed.accounts} account row(s), ${removed.users} identity row(s) removed.`,
    );
    const left = await pool.query(
      "select count(*)::int as n from sbfp_accounts where email like $1",
      [`${runPrefix}%`],
    );
    console.log(`Probe rows remaining: ${left.rows[0]?.n ?? 0}`);
  }
}

async function run() {
  console.log(`Run id: ${runId}`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Accounts: ${users} temporary administrators (prefix ${prefix})`);

  const leftovers = await pool.query(
    "select count(*)::int as n from sbfp_accounts where email like $1",
    [`${prefix}%`],
  );
  if ((leftovers.rows[0]?.n ?? 0) > 0) {
    throw new Error(
      `Refusing to start: ${leftovers.rows[0].n} row(s) already use ${prefix}`,
    );
  }

  const credentials = [];
  let sessions = [];
  let completed = false;
  try {
    for (let i = 0; i < users; i += 1) {
      credentials.push(await createTestUser(i, prefix));
      if ((i + 1) % 20 === 0) console.log(`  created ${i + 1}/${users}`);
    }
    console.log(`Created ${credentials.length} accounts.`);

    const records = [];
    for (let i = 0; i < credentials.length; i += 1) {
      const result = await signIn(credentials[i], i);
      records.push({ index: i, ...result });
      if (result.status !== 200 || !result.cookie) {
        console.warn(
          `  sign-in ${i + 1} failed: ${result.status} ${result.retryAfter ?? ""} ${result.body}`,
        );
      }
      if ((i + 1) % 20 === 0) console.log(`  signed in ${i + 1}/${users}`);
    }
    sessions = records.filter((record) => record.status === 200 && record.cookie);
    console.log(
      `Signed in ${sessions.length}/${users} (statuses: ${JSON.stringify(
        records.reduce((counts, record) => {
          counts[record.status] = (counts[record.status] ?? 0) + 1;
          return counts;
        }, {}),
      )})`,
    );
    if (sessions.length === 0) throw new Error("No test user could sign in.");

    // Warm the app so a cold instance does not dominate the measured burst.
    await get("/api/auth/get-session", sessions[0].cookie, 0);

    const routes = ["/", "/Admin", "/api/auth/get-session"];
    const samples = [];
    const started = performance.now();
    await Promise.all(
      sessions.flatMap((session) =>
        Array.from({ length: iterations }, () =>
          (async () => {
            for (const path of routes) {
              try {
                samples.push(await get(path, session.cookie, session.index));
              } catch (error) {
                samples.push({
                  path,
                  status: 0,
                  ms: 0,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          })(),
        ),
      ),
    );
    const elapsed = performance.now() - started;

    const byRoute = {};
    for (const sample of samples) {
      byRoute[sample.path] ??= { statuses: {}, latencies: [] };
      byRoute[sample.path].statuses[sample.status] =
        (byRoute[sample.path].statuses[sample.status] ?? 0) + 1;
      if (sample.status > 0) byRoute[sample.path].latencies.push(sample.ms);
    }
    const report = {
      requests: samples.length,
      elapsedMs: Math.round(elapsed),
      throughput: Number((samples.length / (elapsed / 1000)).toFixed(1)),
      failed: samples.filter((s) => s.status === 0 || s.status >= 500).length,
      throttled: samples.filter((s) => s.status === 429).length,
      latency: {
        p50: Math.round(percentile(samples.map((s) => s.ms), 50)),
        p95: Math.round(percentile(samples.map((s) => s.ms), 95)),
        p99: Math.round(percentile(samples.map((s) => s.ms), 99)),
      },
      routes: Object.fromEntries(
        Object.entries(byRoute).map(([path, data]) => [
          path,
          {
            statuses: data.statuses,
            p50: Math.round(percentile(data.latencies, 50)),
            p95: Math.round(percentile(data.latencies, 95)),
          },
        ]),
      ),
    };
    console.log("\nRESULT");
    console.log(JSON.stringify(report, null, 2));
    completed = true;
  } finally {
    const removed = await removeByPrefix(prefix);
    console.log(
      `\nCleanup: ${removed.accounts} account row(s), ${removed.users} identity row(s) removed.`,
    );
    const left = await pool.query(
      "select count(*)::int as n from sbfp_accounts where email like $1",
      [`${prefix}%`],
    );
    console.log(`Remaining rows for this run: ${left.rows[0]?.n ?? 0}`);
    if (!completed) console.log("Run did not complete; cleanup still executed.");
  }
}

async function main() {
  if (mode === "inspect") return inspect();
  if (mode === "probe") return probe();
  if (mode === "run") return run();
  if (mode === "cleanup") {
    console.log(`Cleaning prefix: ${prefix}`);
    const removed = await removeByPrefix(prefix);
    console.log(
      `Cleanup: ${removed.accounts} account row(s), ${removed.users} identity row(s) removed.`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
