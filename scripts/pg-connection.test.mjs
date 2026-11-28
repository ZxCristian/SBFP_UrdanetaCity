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
  it("defaults a Supabase direct connection to verified TLS", () => {
    const url =
      "postgresql://postgres.abcdefgh:p%40ss@db.abcdefgh.supabase.co:5432/postgres";
    assert.equal(withSslMode(url), `${url}?sslmode=verify-full`);
  });

  it("defaults a Supabase pooler connection to verified TLS", () => {
    const url =
      "postgresql://postgres.abcdefgh:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
    assert.equal(withSslMode(url), `${url}?sslmode=verify-full`);
  });

  it("appends with & when the URL already has a query", () => {
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?application_name=sbfp"),
      "postgresql://user@db.x.supabase.co:5432/postgres?application_name=sbfp&sslmode=verify-full",
    );
  });

  it("upgrades legacy require/prefer/no-verify modes to verify-full", () => {
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?sslmode=require"),
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=verify-full",
    );
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?sslmode=prefer&application_name=x"),
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=verify-full&application_name=x",
    );
    assert.equal(
      withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?sslmode=no-verify"),
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=verify-full",
    );
  });

  it("only allows the insecure mode with an explicit opt-in", () => {
    const previous = process.env.PG_ALLOW_INSECURE_TLS;
    process.env.PG_ALLOW_INSECURE_TLS = "true";
    try {
      assert.equal(
        withSslMode("postgresql://user@db.x.supabase.co:5432/postgres?sslmode=require"),
        "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=no-verify",
      );
    } finally {
      if (previous === undefined) delete process.env.PG_ALLOW_INSECURE_TLS;
      else process.env.PG_ALLOW_INSECURE_TLS = previous;
    }
  });

  it("keeps an explicit verify-full sslmode", () => {
    const url = "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=verify-full";
    assert.equal(withSslMode(url), url);
  });

  it("upgrades a libpq-compatible require string unless opted out", () => {
    assert.equal(
      withSslMode(
        "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true",
      ),
      "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=verify-full&uselibpqcompat=true",
    );
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
    assert.equal(options.max, 2);
    assert.equal(options.idleTimeoutMillis, 10_000);
    assert.equal(options.connectionTimeoutMillis, 15_000);
    assert.equal(options.connectionString, "postgresql://user@localhost:5432/app");
  });

  it("accepts an explicit max for tests and single-connection callers", () => {
    assert.equal(pgPoolOptions("postgresql://user@localhost/app", { max: 1 }).max, 1);
  });

  it("verifies a Supabase connection against the bundled root CAs", () => {
    const options = pgPoolOptions("postgresql://user@db.x.supabase.co:5432/postgres");
    // The CA must be passed explicitly and the URL's TLS options removed, or
    // pg-connection-string would replace the ssl object with the URL's own.
    assert.equal(options.connectionString, "postgresql://user@db.x.supabase.co:5432/postgres");
    assert.equal(options.ssl?.rejectUnauthorized, true);
    assert.equal(
      options.ssl?.ca?.match(/-----BEGIN CERTIFICATE-----/g)?.length,
      2,
      "both Supabase roots are trusted",
    );
  });

  it("verifies a Supabase pooler connection with the same bundle", () => {
    const options = pgPoolOptions(
      "postgresql://postgres.x:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    assert.equal(
      options.connectionString,
      "postgresql://postgres.x:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    );
    assert.equal(options.ssl?.rejectUnauthorized, true);
    assert.match(options.ssl?.ca ?? "", /BEGIN CERTIFICATE/);
  });

  it("does not impose a CA on a non-Supabase database", () => {
    const options = pgPoolOptions("postgresql://user@db.example.com:5432/app?sslmode=verify-full");
    assert.equal(options.ssl, undefined);
    assert.equal(
      options.connectionString,
      "postgresql://user@db.example.com:5432/app?sslmode=verify-full",
    );
  });

  it("passes a supplied Supabase CA as an explicit ssl object", () => {
    const previous = process.env.SUPABASE_CA_CERT;
    process.env.SUPABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    try {
      const options = pgPoolOptions(
        "postgresql://user@db.x.supabase.co:5432/postgres?sslmode=require",
      );
      assert.equal(options.connectionString, "postgresql://user@db.x.supabase.co:5432/postgres");
      assert.equal(options.ssl?.rejectUnauthorized, true);
      assert.match(options.ssl?.ca ?? "", /\nabc\n/);
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_CA_CERT;
      else process.env.SUPABASE_CA_CERT = previous;
    }
  });

  it("honors the explicit insecure opt-out even with a CA configured", () => {
    const previousCa = process.env.SUPABASE_CA_CERT;
    const previousOptOut = process.env.PG_ALLOW_INSECURE_TLS;
    process.env.SUPABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    process.env.PG_ALLOW_INSECURE_TLS = "true";
    try {
      const options = pgPoolOptions("postgresql://user@db.x.supabase.co:5432/postgres");
      assert.equal(options.ssl?.rejectUnauthorized, false);
    } finally {
      if (previousCa === undefined) delete process.env.SUPABASE_CA_CERT;
      else process.env.SUPABASE_CA_CERT = previousCa;
      if (previousOptOut === undefined) delete process.env.PG_ALLOW_INSECURE_TLS;
      else process.env.PG_ALLOW_INSECURE_TLS = previousOptOut;
    }
  });
});
