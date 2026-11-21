#!/usr/bin/env node
/**
 * Fill a configured Postgres database with the demo district.
 *
 * The live preview runs on the embedded PGlite database and seeds itself (see
 * `src/lib/sbfp-seed.ts` and `fetchWorkspace`). This script is for a real
 * database — Supabase, another hosted Postgres, or a local server — where the
 * app would otherwise start with no learners. Run:
 *
 *   npm run seed
 *
 * It applies pending migrations first (`npm run db:migrate`) and then inserts
 * at least 500 unique learners per school, all three feeding periods, and the
 * SPED cohort at Urdaneta I Central. It refuses to touch a database that already
 * holds learner records it did not create, and a second run is a no-op.
 */
import pg from "pg";
import { databaseUrlFromEnv, pgPoolOptions } from "./pg-connection.mjs";
import { seedSampleData } from "../src/lib/sbfp-seed.ts";

const databaseUrl = databaseUrlFromEnv(process.env);
if (!databaseUrl) {
  console.log(
    "[seed] No Postgres database is configured (SUPABASE_DB_URL / DATABASE_URL).",
  );
  console.log(
    "[seed] The live preview uses the embedded database and seeds itself; nothing to do.",
  );
  process.exit(0);
}

const pool = new pg.Pool(pgPoolOptions(databaseUrl, { max: 1 }));
const run = async (text, params = []) => (await pool.query(text, params)).rows;
const sql = async (strings, ...values) => {
  let text = strings[0];
  for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
  return run(text, values);
};
sql.query = run;

try {
  const result = await seedSampleData(sql);
  if (result.seeded) {
    console.log(
      `[seed] Added ${result.inserted.toLocaleString()} sample rows — ` +
        `${result.learners.toLocaleString()} learners across ${result.schools} schools ` +
        `(including ${result.spedLearners} SPED learners).`,
    );
  } else if (result.records === 0) {
    console.log(
      "[seed] This database already has learner records that were not created by the seed; leaving it untouched.",
    );
  } else {
    console.log(
      `[seed] Already seeded — ${result.learners.toLocaleString()} sample learners across ${result.schools} schools.`,
    );
  }
} finally {
  await pool.end();
}
