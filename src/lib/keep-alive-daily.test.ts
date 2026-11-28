import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";
import { keepAliveWrite } from "./sbfp-keepalive.ts";

// The daily keep-alive is one silent write into `sbfp_keepalive`, created by
// `migrations/0013_keepalive.sql`. These tests run the real SQL the app runs,
// against a real PGlite with that migration applied — not a stubbed fetch.
//
// Run with: `node --experimental-strip-types --test src/lib/keep-alive-daily.test.ts`
// (wired into `npm test`).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The `Sql` surface `@/lib/db` hands the app, over a PGlite instance. */
function toSql(pg: PGlite): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return (await pg.query(text, values)).rows;
  }) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pg.query(text, params)).rows as T[];
  sql.transaction = async <T>(fn: (tx: Sql) => Promise<T>) => fn(sql);
  return sql;
}

let pg: PGlite;
let sql: Sql;

before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(await readFile(join(ROOT, "migrations", "0013_keepalive.sql"), "utf8"));
  sql = toSql(pg);
});

after(async () => {
  await pg.close();
});

async function dailyStamp(): Promise<string> {
  const rows = await sql<{ ts: string }>`
    select ts from sbfp_keepalive where kind = 'daily'
  `;
  return rows[0]?.ts ?? "";
}

describe("keepAliveWrite", () => {
  it("writes a daily timestamp", async () => {
    await keepAliveWrite(sql);

    const written = new Date(await dailyStamp());
    assert.equal(Number.isNaN(written.getTime()), false);
  });

  it("keeps exactly one row per kind, so repeated calls overwrite in place", async () => {
    await keepAliveWrite(sql);
    await keepAliveWrite(sql);

    const rows = await sql<{ count: string }>`
      select count(*)::text as count from sbfp_keepalive where kind = 'daily'
    `;
    assert.equal(rows[0]?.count, "1");
  });

  it("moves the timestamp forward on the next touch", async () => {
    const first = new Date(await dailyStamp());
    await new Promise((resolve) => setTimeout(resolve, 10));
    await keepAliveWrite(sql);

    const second = new Date(await dailyStamp());
    assert.ok(second.getTime() >= first.getTime());
  });

  it("provisions its own table on a database without the migration", async () => {
    // Deploys do not run migrations, so the daily touch cannot assume the
    // table exists. A bare database is that exact state.
    const bare = new PGlite();
    await bare.waitReady;
    try {
      const bareSql = toSql(bare);
      await keepAliveWrite(bareSql);

      const rows = await bareSql<{ count: string }>`
        select count(*)::text as count from sbfp_keepalive where kind = 'daily'
      `;
      assert.equal(rows[0]?.count, "1");
    } finally {
      await bare.close();
    }
  });
});
