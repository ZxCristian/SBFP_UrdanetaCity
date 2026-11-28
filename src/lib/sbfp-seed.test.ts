/**
 * The sample-data seed, against a real migrated PGlite database.
 *
 * The preview's demo district has to satisfy the product's own rules, not just
 * "rows exist": at least 500 unique learners per school, every feeding period,
 * the SPED cohort at Urdaneta I Central, and measurements that classify into a
 * real WHO status. These assertions run the same SQL and generator the preview
 * uses. Wired into `npm test`.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";
import {
  SAMPLE_ENCODED_BY,
  SAMPLE_LEARNERS_PER_SCHOOL,
  SAMPLE_PERIODS,
  SAMPLE_SPED_LEARNERS_PER_GRADE,
  seedSampleData,
} from "./sbfp-seed.ts";
import { SPED_SCHOOL_ID } from "./sbfp-domain.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The `Sql` surface `@/lib/db` hands the services, over a PGlite instance. */
function toSql(pg: PGlite): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return (await pg.query(text, values)).rows;
  }) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) => (await pg.query(text, params)).rows as T[];
  sql.transaction = async <T>(fn: (tx: Sql) => Promise<T>) => {
    let result!: T;
    await pg.transaction(async (tx) => {
      const inner = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        let text = strings[0];
        for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
        return (await tx.query(text, values)).rows as Record<string, unknown>[];
      }) as unknown as Sql;
      inner.query = async <U = Record<string, unknown>>(text: string, params: unknown[] = []) =>
        (await tx.query<U>(text, params)).rows as U[];
      inner.transaction = async (nested) => nested(inner);
      result = await fn(inner);
    });
    return result;
  };
  return sql;
}

let pg: PGlite;
let sql: Sql;

before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  const files = (await readdir(join(ROOT, "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await pg.exec(await readFile(join(ROOT, "migrations", file), "utf8"));
  }
  sql = toSql(pg);
});

after(async () => {
  await pg.close();
});

describe("sample learner data", () => {
  it("fills every school with 500 unique learners, including the SPED cohort", async () => {
    const result = await seedSampleData(sql);

    assert.equal(result.seeded, true);
    assert.equal(result.schools, 58);
    assert.equal(result.spedLearners, 7 * SAMPLE_SPED_LEARNERS_PER_GRADE);
    assert.equal(
      result.learners,
      58 * SAMPLE_LEARNERS_PER_SCHOOL + result.spedLearners,
    );
    assert.equal(result.records, result.learners * SAMPLE_PERIODS.length);

    const perSchool = await sql.query<{
      school_id: string;
      learners: number | string;
      records: number | string;
    }>(
      `select school_id,
              count(distinct (name, date_of_birth, sex))::int as learners,
              count(*)::int as records
       from sbfp_records
       where encoded_by = $1
       group by school_id`,
      [SAMPLE_ENCODED_BY],
    );
    assert.equal(perSchool.length, 58);
    for (const row of perSchool) {
      assert.ok(
        Number(row.learners) >= SAMPLE_LEARNERS_PER_SCHOOL,
        `${row.school_id} has only ${row.learners} unique learners`,
      );
      assert.equal(Number(row.records), Number(row.learners) * SAMPLE_PERIODS.length);
    }

    const sped = await sql.query<{ learners: number | string; grades: number | string }>(
      `select count(distinct (name, date_of_birth, sex))::int as learners,
              count(distinct grade_level)::int as grades
       from sbfp_records
       where encoded_by = $1 and school_id = $2 and grade_level like 'SPED %'`,
      [SAMPLE_ENCODED_BY, SPED_SCHOOL_ID],
    );
    assert.equal(Number(sped[0].learners), 7 * SAMPLE_SPED_LEARNERS_PER_GRADE);
    assert.equal(Number(sped[0].grades), 7, "every SPED Kinder–Grade 6 level is present");

    const periods = await sql.query<{ period: string }>(
      `select distinct period from sbfp_records where encoded_by = $1 order by period`,
      [SAMPLE_ENCODED_BY],
    );
    assert.deepEqual(
      periods.map((row) => row.period),
      [...SAMPLE_PERIODS].sort(),
    );

    const incomplete = await sql.query<{ n: number | string }>(
      `select count(*)::int as n
       from sbfp_records
       where encoded_by = $1
         and (bmi = '' or bmi_status = '' or hfa_status = '' or nutritional_status = '')`,
      [SAMPLE_ENCODED_BY],
    );
    assert.equal(Number(incomplete[0].n), 0, "every row has a WHO classification");
  });

  it("is idempotent — a second run adds nothing", async () => {
    const rows = await sql<{ n: number | string }>`select count(*) as n from sbfp_records`;
    const before = Number(rows[0]?.n ?? 0);

    const result = await seedSampleData(sql);

    assert.equal(result.seeded, false);
    const afterRows = await sql<{ n: number | string }>`select count(*) as n from sbfp_records`;
    assert.equal(Number(afterRows[0]?.n ?? 0), before);
  });
});
