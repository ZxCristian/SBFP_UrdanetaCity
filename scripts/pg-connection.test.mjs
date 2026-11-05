import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  databaseUrlFromEnv,
  isSupabaseHost,
  pgPoolOptions,
  withSslMode,
} from "./pg-connection.mjs";

describe("databaseUrlFromEnv", () => {
  it("prefers SUPABASE_DB_URL over a platform DATABASE_URL", () => {
    assert.equal(
      databaseUrlFromEnv({ SUPABASE_DB_URL: "postgres://supabase", DATABASE_URL: "postgres://platform" }),
      "postgres://supabase",
    );
  });

  it("falls back to DATABASE_URL", () => {
    assert.equal(databaseUrlFromEnv({ DATABASE_URL: "postgres://platform" }), "postgres://platform");
  });

  it("treats blank values as unset", () => {
    assert.equal(databaseUrlFromEnv({ SUPABASE_DB_URL: "  ", DATABASE_URL: "" }), undefined);
    assert.equal(databaseUrlFromEnv({}), undefined);
  });

  it("trims surrounding whitespace", () => {
    assert.equal(databaseUrlFromEnv({ SUPABASE_DB_URL: " postgres://supabase\n" }), "postgres://supabase");
  });
});

describe("withSslMode", () => {
  it("adds sslmode=no-verify to a Supabase direct connection", () => {
    const url =
      "postgresql://postgres.abcdefgh:p%40ss@db.abcdefgh.supabase.co:5432/postgres";
    assert.equal(withSslMode(url), `${url}?sslmode=no-verify`);
  });

  it("adds sslmode=no-verify to a Supabase pooler connection", () => {
    const url =
      "postgresql://postgres.abcdefgh:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    assert.equal(withSslMode(url), `${url}?sslmode=no-verify`);
  });

  it("appends with & when the URL already has a query", () => {
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?application_name=sbfp"),
      "postgresql://user@db.x.supabase.co:5432/postgres?application_name=sbfp&sslmode=no-verify",
    );
  });

  it("rewrites require/prefer, which pg 8 would verify and fail on Supabase's CA", () => {
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?sslmode=require"),
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=no-verify",
    );
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?sslmode=prefer&application_name=x"),
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=no-verify&application_name=x",
    );
  });

  it("keeps an explicit verify-full sslmode", () => {
    const url = "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=verify-full";
    assert.equal(withSslMode(url), url);
  });

  it("leaves a libpq-compatible require string alone", () => {
    const url =
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true";
    assert.equal(withSslMode(url), url);
  });

  it("leaves non-Supabase and unparseable strings alone", () => {
    assert.equal(withSslMode("postgresql://user@localhost:5432/app"), "postgresql://user@localhost:5432/app");
    assert.equal(withSslMode("postgresql://user@127.0.0.1:5432/app"), "postgresql://user@127.0.0.1:5432/app");
    assert.equal(withSslMode("not a url"), "not a url");
  });

  it("does not treat a lookalike host as Supabase", () => {
    assert.equal(isSupabaseHost("postgresql://user@supabase.co.evil.test:5432/app"), false);
    assert.equal(
      withSslMode("postgresql://user@supabase.co.evil.test:5432/app"),
      "postgresql://user@supabase.co.evil.test:5432/app",
    );
  });
});

describe("pgPoolOptions", () => {
  it("keeps a small per-instance pool and short timeouts", () => {
    const options = pgPoolOptions("postgresql://user@localhost:5432/app");
    assert.equal(options.max, 4);
    assert.equal(options.idleTimeoutMillis, 10_000);
    assert.equal(options.connectionTimeoutMillis, 15_000);
    assert.equal(options.connectionString, "postgresql://user@localhost:5432/app");
  });

  it("accepts an explicit max for tests and single-connection callers", () => {
    assert.equal(pgPoolOptions("postgresql://user@localhost/app", { max: 1 }).max, 1);
  });

  it("normalizes a Supabase connection string", () => {
    const options = pgPoolOptions("postgresql://user@db.x.supabase.co:5432/postgres");
    assert.match(options.connectionString, /\?sslmode=no-verify$/);
  });
});
