#!/usr/bin/env node
/**
 * Concurrent virtual-user load test.
 *
 * Starts N independent "visitors" at the same instant and has each walk the
 * app's signed-out journeys (landing page, sign-in page, session probe, the
 * protected teacher/admin routes). Every request keeps its own cookie jar, so
 * the run models separate browsers rather than one client firing in a loop.
 *
 * Read-only by design: it never signs in, creates an account or writes a row,
 * so it is safe to point at the deployed site as well as the preview. To
 * include signed-in page loads, pass a session cookie with
 * `--cookie "$LOADTEST_COOKIE"`; the same cookie is then sent by every virtual
 * user (the harness does not mint or store credentials itself).
 *
 *   node scripts/load-test.mjs --users 100 --iterations 3
 *   node scripts/load-test.mjs --base-url https://example.com --users 100
 *
 * Exits non-zero when any request fails (network error, 5xx) so it can become
 * a check, and prints p50 / p95 / p99 per route plus overall throughput.
 */

import { performance } from "node:perf_hooks";

const DEFAULTS = {
  users: 100,
  iterations: 3,
  timeoutMs: 15_000,
  baseUrl: process.env.LOADTEST_BASE_URL ?? "http://127.0.0.1:8080",
  cookie: process.env.LOADTEST_COOKIE ?? "",
};

/** Minimal `--flag value` / `--flag=value` parser. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

const raw = parseArgs(process.argv.slice(2));
const config = {
  users: Number(raw.users ?? DEFAULTS.users),
  iterations: Number(raw.iterations ?? DEFAULTS.iterations),
  timeoutMs: Number(raw["timeout-ms"] ?? DEFAULTS.timeoutMs),
  baseUrl: String(raw["base-url"] ?? DEFAULTS.baseUrl).replace(/\/+$/, ""),
  cookie: String(raw.cookie ?? DEFAULTS.cookie),
};

if (!Number.isInteger(config.users) || config.users < 1) {
  throw new Error("--users must be a positive integer");
}
if (!Number.isInteger(config.iterations) || config.iterations < 1) {
  throw new Error("--iterations must be a positive integer");
}
new URL(config.baseUrl); // fail fast on a malformed target

/** Each virtual user walks the same short journey a signed-out browser does. */
const JOURNEY = [
  { name: "landing", path: "/" },
  { name: "sign-in", path: "/login" },
  { name: "session", path: "/api/auth/get-session" },
  { name: "teacher", path: "/teacher" },
  { name: "admin", path: "/admin" },
];

const samples = [];
let failures = 0;
let requests = 0;
let throttled = 0;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function round(ms) {
  return `${ms.toFixed(ms >= 100 ? 0 : 1)} ms`;
}

/** One request as a standalone browser: own redirect handling, own timeout. */
async function get(path, cookie) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      redirect: "follow",
      headers: cookie ? { cookie } : undefined,
      signal: controller.signal,
    });
    // Drain the body so the measurement includes the full response, the way a
    // browser would before it can paint the page.
    await response.arrayBuffer();
    return { path, status: response.status, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function record({ path, status, ms, error }) {
  requests += 1;
  if (status === 429) throttled += 1;
  const failed = Boolean(error) || status >= 500;
  if (failed) failures += 1;
  const sample = { path, status, ms, error, failed };
  samples.push(sample);
  return sample;
}

async function virtualUser() {
  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    for (const step of JOURNEY) {
      try {
        const result = await get(step.path, config.cookie);
        record(result);
      } catch (err) {
        record({
          path: step.path,
          status: 0,
          ms: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/** Stand up the stack before the timed burst so cold compilation is excluded. */
async function warmup() {
  for (const step of JOURNEY) {
    try {
      await get(step.path, config.cookie);
    } catch {
      /* warmup failures are reported by the timed run, not here */
    }
  }
}

function report(wallMs) {
  const durationSec = wallMs / 1000;
  const ok = samples.filter((s) => !s.failed);
  const latencies = ok.map((s) => s.ms);
  const byPath = new Map();
  for (const sample of samples) {
    const entry = byPath.get(sample.path) ?? { statuses: new Map(), latencies: [], failed: 0 };
    entry.statuses.set(
      sample.error ? `error: ${sample.error}` : sample.status,
      (entry.statuses.get(sample.error ? `error: ${sample.error}` : sample.status) ?? 0) + 1,
    );
    if (!sample.failed) entry.latencies.push(sample.ms);
    else entry.failed += 1;
    byPath.set(sample.path, entry);
  }

  console.log("");
  console.log(`Target            ${config.baseUrl}`);
  console.log(`Virtual users     ${config.users}`);
  console.log(`Iterations        ${config.iterations}`);
  console.log(`Requests          ${requests} in ${durationSec.toFixed(1)}s`);
  console.log(`Throughput        ${(requests / durationSec).toFixed(1)} req/s`);
  console.log(`Failed            ${failures}`);
  console.log(`Throttled (429)   ${throttled}`);
  console.log("");
  console.log("Latency (successful requests)");
  console.log(`  overall         p50 ${round(percentile(latencies, 50))}   p95 ${round(percentile(latencies, 95))}   p99 ${round(percentile(latencies, 99))}`);
  console.log("");
  console.log("Per route");
  for (const step of JOURNEY) {
    const entry = byPath.get(step.path);
    if (!entry) continue;
    const statuses = [...entry.statuses.entries()]
      .map(([status, count]) => `${status} ×${count}`)
      .join(", ");
    const p50 = percentile(entry.latencies, 50);
    const p95 = percentile(entry.latencies, 95);
    console.log(
      `  ${step.path.padEnd(22)} p50 ${round(p50).padEnd(8)} p95 ${round(p95).padEnd(8)} ${statuses}`,
    );
  }
  console.log("");
  if (failures > 0) {
    console.log(`${failures} request(s) failed — see the statuses above.`);
  } else {
    console.log("All requests completed without a network error or 5xx.");
  }
  if (throttled > 0) {
    console.log(
      `${throttled} request(s) were throttled (429). Every virtual user here shares one ` +
        "IP, and Better Auth limits auth endpoints per address (60/min; sign-in 10/min).",
    );
  }
  console.log("");
}

async function main() {
  console.log(`Warming up ${config.baseUrl} …`);
  await warmup();
  console.log(`Starting ${config.users} virtual users at once …`);

  const started = performance.now();
  // Every user begins before anyone awaits: same-instant arrival, not a queue.
  const arrivals = Array.from({ length: config.users }, () => virtualUser());
  await Promise.all(arrivals);
  const wallMs = performance.now() - started;

  report(wallMs);
  process.exitCode = failures > 0 ? 1 : 0;
}

await main();
