#!/usr/bin/env node
/**
 * Database migrator (node-postgres, `pg`).
 *
 * Run it explicitly with `npm run db:migrate`; it is deliberately NOT part of
 * `npm run build`. A Vercel build has no trusted TLS path to the database (it
 * fails with SELF_SIGNED_CERT_IN_CHAIN), and a frontend build should not mutate
 * production data. Run this from a machine that can verify the database's
 * certificate chain, or set `SUPABASE_CA_CERT` / `PG_SSL_CA_CERT` first.
 *
 * Each file in ../migrations is applied in one transaction and recorded in a
 * `_migrations` table, so it runs once and is safe to re-run. The read is
 * non-recursive, so the opt-in auth schema under migrations/auth/ is not applied
 * to an app that never asked for sign-in.
 *
 * No DATABASE_URL (local / preview) -> skip; the PGLite fallback applies the
 * same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";
import { databaseUrlFromEnv, pgPoolOptions } from "./pg-connection.mjs";

const databaseUrl = databaseUrlFromEnv(process.env);

// Deploy script robustness: missing database env is the normal case for local
// and preview builds, and it must not fail the deploy pipeline.
if (!databaseUrl) {
  console.log(
    "[migrate] no database URL (SUPABASE_DB_URL / DATABASE_URL) — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }

  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  // One connection: the migrator is sequential, and Supabase's pooler has a
  // shared connection budget. `pgPoolOptions` also adds the TLS Supabase needs.
  const pool = new pg.Pool(pgPoolOptions(databaseUrl, { max: 1 }));
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  // A configured database that cannot be reached is a real failure: exiting 0
  // here would deploy an app whose schema was never applied. The no-URL case is
  // already handled above (local/preview builds skip cleanly).
  const message = err?.message || String(err);
  console.error("[migrate] failed:", message);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
