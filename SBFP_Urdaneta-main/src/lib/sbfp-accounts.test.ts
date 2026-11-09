/**
 * The accounts service, against a real database.
 *
 * These run on the app's own embedded PGlite with the SAME migration files the
 * deployed database applies (`migrations/0001_auth.sql` is Better Auth's schema,
 * `0002_sbfp.sql` is ours), so what is asserted here is the SQL the app actually
 * runs — not a mock of it. The password assertions use Better Auth's own hasher,
 * which is the point: an account issued from the Division Console has to be able
 * to sign in through `/api/auth/sign-in/email` like any other.
 *
 * Run with: `node --experimental-strip-types --test src/lib/sbfp-accounts.test.ts`
 * (wired into `npm test`).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verifyPassword } from "better-auth/crypto";
import {
  AccountError,
  assertCanWriteRecord,
  assertCanWriteSchool,
  changeOwnPassword,
  claimAdminAccountForEmail,
  countAdmins,
  createAccount,
  createPasswordReset,
  credentialState,
  dataVersion,
  deleteAccount,
  deleteRecord,
  findAccountByEmail,
  getArchivedYear,
  getSchoolProfile,
  hasAdminAccount,
  hashResetToken,
  insertFeedback,
  listAccounts,
  needsCurrentPassword,
  previousBeneficiaryYear,
  pullData,
  resetPassword,
  resetPasswordWithToken,
  resolveAccess,
  restoreRecord,
  saveSchoolProfile,
  saveSummaryExtra,
  updateAccount,
  updateFeedback,
  updateOwnTeacherDetails,
  upsertRecord,
} from "./sbfp-accounts.ts";
import type { Sql } from "./db.ts";
import {
  getActiveSchoolYear,
  listSchoolYears,
  SchoolYearError,
  startNewSchoolYear,
} from "./sbfp-years.ts";
import { deleteSchool, listSchools, updateSchool } from "./sbfp-schools.ts";
import type { Student } from "@/lib/sbfp-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADMIN = "division@depedurdaneta.gov.ph";
const TEACHER_A = "teacher.a@depedurdaneta.gov.ph";
const SCHOOL_A = "es-001";
const SCHOOL_B = "es-002";
const SCHOOL_C = "hs-001";
const SCHOOL_E = "es-009";

/** The `Sql` surface `@/lib/db` hands the service, over a PGlite instance. */
function toSql(pg: PGlite): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return (await pg.query(text, values)).rows;
  }) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pg.query(text, params)).rows as T[];
  return sql;
}

let pg: PGlite;
let sql: Sql;

type RecordRow = Omit<Student, "schoolId">;

/** A learner record with everything the school's Data Entry form fills in. */
/** A birthday that makes the learner exactly `years` old today. */
function dobForAge(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function record(id: string, name: string, overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id,
    period: "Baseline",
    sy: "2025-2026",
    name,
    sex: "F",
    gradeLevel: "Grade 3",
    dateOfBirth: "2016-04-02",
    dateOfWeighing: "2026-07-10",
    ageYears: "10",
    ageMonths: "3",
    weight: "22.4",
    height: "118",
    bmi: "16.09",
    bmiStatus: "Normal",
    hfaStatus: "Normal",
    nutritionalStatus: "Normal",
    classificationOfBeneficiary: "Secondary",
    pregnant: "",
    hasYoungChildren: "",
    dewormed: "Yes",
    parentConsentMilk: "Yes",
    fourPs: "Yes",
    sbfpPreviousYears: "No",
    ...overrides,
  };
}

/** Wait for a refusal of a specific kind, and hand back its code. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof AccountError, `expected AccountError, got ${String(err)}`);
    return err.code;
  }
  throw new Error("expected the call to be refused, but it succeeded");
}

/**
 * A pristine database with the app's migrations applied — the state a preview
 * starts in, and the only state in which the demo seed has anything to do. The
 * shared `pg` above has accounts in it from the first test onwards, so it can
 * never show what happens on an empty one.
 */
async function emptyDb(): Promise<PGlite> {
  const fresh = new PGlite();
  await fresh.waitReady;
  for (const file of [
    "0001_auth.sql",
    "0002_sbfp.sql",
    "0003_password_reset.sql",
    "0004_school_years.sql",
    "0005_schools.sql",
    "0006_remove_demo_admin.sql",
    "0007_summary_and_trash.sql",
  ]) {
    await fresh.exec(await readFile(join(ROOT, "migrations", file), "utf8"));
  }
  return fresh;
}

before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  for (const file of [
    "0001_auth.sql",
    "0002_sbfp.sql",
    "0003_password_reset.sql",
    "0004_school_years.sql",
    "0005_schools.sql",
    "0006_remove_demo_admin.sql",
    "0007_summary_and_trash.sql",
  ]) {
    await pg.exec(await readFile(join(ROOT, "migrations", file), "utf8"));
  }
  sql = toSql(pg);
});

after(async () => {
  await pg.close();
});

describe("issuing an account", () => {
  it("creates an identity that verifies with Better Auth's own hasher", async () => {
    const account = await createAccount(sql, {
      email: "  TEACHER.A@DepEdUrdaneta.gov.ph ",
      password: "sbpf-ay2k9",
      role: "teacher",
      fullName: "Dela Cruz, Maria",
      position: "SBFP Feeding Focal Person",
      contact: "0917 000 1111",
      schoolId: SCHOOL_A,
    });

    assert.equal(account.email, TEACHER_A, "the email is normalized");
    assert.equal(account.role, "teacher");
    assert.equal(account.schoolId, SCHOOL_A);
    assert.equal(account.status, "active");
    assert.equal(account.tempPassword, true, "an issued password is temporary");

    const credential = await credentialState(sql, account.email);
    assert.ok(credential?.hasPassword, "a password credential was written");
    assert.equal(await verifyPassword({ hash: credential.hash, password: "sbpf-ay2k9" }), true);
    assert.equal(await verifyPassword({ hash: credential.hash, password: "not-the-password" }), false);

    // The credential row must be shaped exactly as Better Auth's sign-in route
    // looks for it: providerId 'credential' keyed on the user's own id.
    const rows = await sql.query<{ accountId: string; userId: string; providerId: string }>(
      'select "accountId", "userId", "providerId" from "account" where "userId" = $1',
      [credential.userId],
    );
    assert.deepEqual(rows, [
      { accountId: credential.userId, userId: credential.userId, providerId: "credential" },
    ]);
    const identity = await sql.query<{ email: string; emailVerified: boolean }>(
      'select "email", "emailVerified" from "user" where "id" = $1',
      [credential.userId],
    );
    assert.equal(identity[0].email, TEACHER_A);
    assert.equal(identity[0].emailVerified, true, "the Division Office vouches for the address");
  });

  it("refuses a second account for the same school, and for the same email", async () => {
    assert.equal(
      await refusal(() =>
        createAccount(sql, {
          email: "other@depedurdaneta.gov.ph",
          password: "sbpf-1234",
          role: "teacher",
          schoolId: SCHOOL_A,
        }),
      ),
      "school_taken",
    );
    assert.equal(
      await refusal(() =>
        createAccount(sql, {
          email: TEACHER_A,
          password: "sbpf-1234",
          role: "teacher",
          schoolId: SCHOOL_C,
        }),
      ),
      "email_taken",
    );
  });

  it("lets a teacher persist her own details, and refuses another role", async () => {
    const updated = await updateOwnTeacherDetails(sql, TEACHER_A, {
      fullName: "Reyes, Maria",
      position: "Grade 3 Adviser",
      contact: "0917 000 2222",
    });
    assert.equal(updated.fullName, "Reyes, Maria");
    assert.equal(updated.position, "Grade 3 Adviser");
    assert.equal(updated.contact, "0917 000 2222");
    assert.equal(updated.schoolId, SCHOOL_A, "the school assignment is not part of this edit");

    const identity = await sql.query<{ name: string }>(
      'select "name" from "user" where lower("email") = $1',
      [TEACHER_A],
    );
    assert.equal(identity[0].name, "Reyes, Maria", "the account menu reads the same name");

    assert.equal(
      await refusal(() => updateOwnTeacherDetails(sql, TEACHER_A, { fullName: "   " })),
      "incomplete_profile",
    );
  });

  it("refuses weak passwords, malformed emails and a missing school", async () => {
    assert.equal(
      await refusal(() =>
        createAccount(sql, { email: "short@deped.gov.ph", password: "abc", role: "teacher", schoolId: SCHOOL_B }),
      ),
      "weak_password",
    );
    assert.equal(
      await refusal(() =>
        createAccount(sql, { email: "not-an-email", password: "sbpf-1234", role: "teacher", schoolId: SCHOOL_B }),
      ),
      "invalid_email",
    );
    assert.equal(
      await refusal(() =>
        createAccount(sql, { email: "school-less@deped.gov.ph", password: "sbpf-1234", role: "teacher" }),
      ),
      "not_found",
    );
    // A refusal must never leave a half-made identity behind.
    const leftovers = await sql.query<{ n: number | string }>(
      'select count(*) as n from "user" where lower("email") in ($1, $2, $3)',
      ["short@deped.gov.ph", "not-an-email", "school-less@deped.gov.ph"],
    );
    assert.equal(Number(leftovers[0].n), 0);
  });
});

describe("the Division Office account", () => {
  it("is claimed once, and blocks a second claim", async () => {
    assert.equal(await hasAdminAccount(sql), false);
    const admin = await claimAdminAccountForEmail(sql, ADMIN, "Division SBFP Coordinator");
    assert.equal(admin.role, "admin");
    assert.equal(admin.schoolId, null);
    assert.equal(await hasAdminAccount(sql), true);
    assert.equal(await countAdmins(sql), 1);

    assert.equal(
      await refusal(() => claimAdminAccountForEmail(sql, "someone.else@deped.gov.ph", "Impostor")),
      "forbidden",
    );
    assert.equal(
      await refusal(() => claimAdminAccountForEmail(sql, "another@deped.gov.ph", "Another")),
      "forbidden",
    );
  });

  it("still lets teacher accounts be issued, and sees the whole division", async () => {
    await createAccount(sql, {
      email: "teacher.b@depedurdaneta.gov.ph",
      password: "sbpf-bbbb",
      role: "teacher",
      fullName: "Ramos, Josefa",
      schoolId: SCHOOL_B,
    });
    await upsertRecord(sql, SCHOOL_A, record("tr_a1", "Learner A"), TEACHER_A);
    await upsertRecord(sql, SCHOOL_B, record("tr_b1", "Learner B"), "teacher.b@depedurdaneta.gov.ph");
    await insertFeedback(
      sql,
      SCHOOL_A,
      {
        id: "tf_a1",
        author: "Dela Cruz, Maria",
        role: "SBFP Focal",
        category: "Nutrition Data",
        rating: 4,
        message: "Baseline complete.",
        createdAt: "2026-08-01",
        status: "New",
        origin: "School Portal",
      },
      TEACHER_A,
    );

    const adminAccess = await resolveAccess(sql, ADMIN);
    assert.ok(adminAccess);
    assert.equal(adminAccess.scope, "all");
    const division = await pullData(sql, adminAccess);
    assert.equal(division.accounts.filter((a) => a.schoolId).length, 2);
    assert.deepEqual(division.records.map((r) => r.id).sort(), ["tr_a1", "tr_b1"]);
    assert.equal(division.feedbacks.length, 1);
  });

  it("sees only her own school as a teacher", async () => {
    const access = await resolveAccess(sql, TEACHER_A);
    assert.ok(access);
    assert.deepEqual(access.scope, [SCHOOL_A]);
    const mine = await pullData(sql, access);
    assert.deepEqual(mine.accounts.map((a) => a.schoolId), [SCHOOL_A]);
    assert.deepEqual(mine.records.map((r) => r.id), ["tr_a1"]);
    assert.deepEqual(mine.feedbacks.map((f) => f.id), ["tf_a1"]);
    // ... and rows come back in the shape the screens use.
    assert.equal(mine.records[0].schoolId, SCHOOL_A);
    assert.equal(mine.records[0].gradeLevel, "Grade 3");
    assert.equal(mine.records[0].bmi, "16.09");
    assert.equal(mine.feedbacks[0].origin, "School Portal");
    assert.equal(mine.feedbacks[0].createdAt, "2026-08-01");
    assert.equal(mine.accounts[0].recordCount, 1);
    assert.equal(mine.accounts[0].feedbackCount, 1);
    // The payload carries the signature the live-update poll compares against.
    assert.equal(mine.version, await dataVersion(sql, access));
  });

  it("moves the change signature only for rows the caller may see", async () => {
    const adminAccess = await resolveAccess(sql, ADMIN);
    const teacherAccess = await resolveAccess(sql, TEACHER_A);
    const otherAccess = await resolveAccess(sql, "teacher.b@depedurdaneta.gov.ph");
    assert.ok(adminAccess && teacherAccess && otherAccess);

    const adminBefore = await dataVersion(sql, adminAccess);
    const teacherBefore = await dataVersion(sql, teacherAccess);
    const otherBefore = await dataVersion(sql, otherAccess);

    // School A encodes another learner: both the division and School A must
    // refresh; School B must not (it cannot see the row).
    await upsertRecord(sql, SCHOOL_A, record("tr_a2", "Learner A2"), TEACHER_A);
    assert.notEqual(await dataVersion(sql, adminAccess), adminBefore);
    assert.notEqual(await dataVersion(sql, teacherAccess), teacherBefore);
    assert.equal(await dataVersion(sql, otherAccess), otherBefore);

    // An account issued for another school moves the division's signature (its
    // accounts table changed) but not School B's.
    const otherBeforeAccount = await dataVersion(sql, otherAccess);
    const adminBeforeAccount = await dataVersion(sql, adminAccess);
    await createAccount(sql, {
      email: "teacher.c@depedurdaneta.gov.ph",
      password: "sbpf-cccc",
      role: "teacher",
      fullName: "Bautista, Lito",
      schoolId: "es-003",
    });
    try {
      assert.notEqual(await dataVersion(sql, adminAccess), adminBeforeAccount);
      assert.equal(await dataVersion(sql, otherAccess), otherBeforeAccount);
    } finally {
      // Later tests reuse this record count, email and school; leave the fixture
      // exactly as it was.
      await sql.query("delete from sbfp_records where id = $1", ["tr_a2"]);
      await deleteAccount(sql, "teacher.c@depedurdaneta.gov.ph");
    }
  });

  it("cannot be removed or put on hold while it is the only one", async () => {
    assert.equal(await refusal(() => deleteAccount(sql, ADMIN)), "last_admin");
    assert.equal(await refusal(() => updateAccount(sql, ADMIN, { status: "disabled" })), "last_admin");

    const second = await createAccount(sql, {
      email: "coordinator@depedurdaneta.gov.ph",
      password: "sbpf-coord",
      role: "admin",
      fullName: "Second Coordinator",
    });
    assert.equal(await countAdmins(sql), 2);
    await updateAccount(sql, ADMIN, { status: "disabled" });
    assert.equal((await findAccountByEmail(sql, ADMIN))?.status, "disabled");
    await updateAccount(sql, ADMIN, { status: "active" });
    await deleteAccount(sql, second.email);
    assert.equal(await countAdmins(sql), 1);
  });

  it("cannot use the School Portal's self-profile edit", async () => {
    assert.equal(
      await refusal(() => updateOwnTeacherDetails(sql, ADMIN, { fullName: "Not a teacher" })),
      "forbidden",
    );
  });

  it("reads a school the Division Office itself has no account for", async () => {
    await createAccount(sql, {
      email: "teacher.c@depedurdaneta.gov.ph",
      password: "sbpf-cccc",
      role: "teacher",
      fullName: "Bautista, Rolando",
      schoolId: SCHOOL_C,
    });
    await updateAccount(sql, "teacher.c@depedurdaneta.gov.ph", { status: "disabled" });

    const onHold = await resolveAccess(sql, "teacher.c@depedurdaneta.gov.ph");
    assert.ok(onHold);
    assert.deepEqual(onHold.scope, [], "an account on hold may reach no school");
    assert.deepEqual((await pullData(sql, onHold)).records, []);
    assert.equal(await refusal(() => Promise.resolve(assertCanWriteSchool(onHold, SCHOOL_C))), "forbidden");

    const admin = await resolveAccess(sql, ADMIN);
    assert.ok(admin);
    assert.ok((await pullData(sql, admin)).accounts.some((a) => a.schoolId === SCHOOL_C));

    await updateAccount(sql, "teacher.c@depedurdaneta.gov.ph", { status: "active" });
    const back = await resolveAccess(sql, "teacher.c@depedurdaneta.gov.ph");
    assert.ok(back);
    assert.deepEqual(back.scope, [SCHOOL_C]);
  });

  it("knows nothing about an email that holds no account", async () => {
    assert.equal(await resolveAccess(sql, "stranger@deped.gov.ph"), null);
    assert.equal(await findAccountByEmail(sql, "stranger@deped.gov.ph"), null);
  });
});

describe("a teacher can only reach her own school", () => {
  it("refuses a write to another school's rows", async () => {
    const access = await resolveAccess(sql, TEACHER_A);
    assert.ok(access);
    assert.equal(await refusal(() => Promise.resolve(assertCanWriteSchool(access, SCHOOL_B))), "forbidden");
    assertCanWriteSchool(access, SCHOOL_A); // her own school is fine

    assert.equal(await refusal(() => assertCanWriteRecord(sql, access, "tr_b1")), "forbidden");
    await assertCanWriteRecord(sql, access, "tr_a1");
  });

  it("cannot overwrite another school's record by reusing its id", async () => {
    // The service's own guard: an upsert whose school does not match the stored
    // row updates nothing, so a forged id cannot rewrite the other school's data.
    await upsertRecord(sql, SCHOOL_A, record("tr_b1", "Hijacked"), TEACHER_A);
    const stored = await sql.query<{ name: string; school_id: string }>(
      "select name, school_id from sbfp_records where id = $1",
      ["tr_b1"],
    );
    assert.equal(stored[0].name, "Learner B");
    assert.equal(stored[0].school_id, SCHOOL_B);
  });

  it("keeps deletes inside the school and moves them to the trash", async () => {
    await deleteRecord(sql, "tr_b1", SCHOOL_A); // someone else's row → no-op
    const still = await sql.query<{ id: string; deleted_at: string | null }>(
      "select id, deleted_at from sbfp_records where id = $1",
      ["tr_b1"],
    );
    assert.equal(still.length, 1);
    assert.equal(still[0].deleted_at, null, "another school's delete changes nothing");

    await deleteRecord(sql, "tr_a1", SCHOOL_A, TEACHER_A);
    const trashed = await sql.query<{ id: string; deleted_by: string | null; deleted_at: string | null }>(
      "select id, deleted_by, deleted_at from sbfp_records where id = $1",
      ["tr_a1"],
    );
    assert.equal(trashed.length, 1, "the row is kept for the trash");
    assert.ok(trashed[0].deleted_at);
    assert.equal(trashed[0].deleted_by, TEACHER_A);

    await restoreRecord(sql, "tr_a1", SCHOOL_A);
    const restored = await sql.query<{ deleted_at: string | null }>(
      "select deleted_at from sbfp_records where id = $1",
      ["tr_a1"],
    );
    assert.equal(restored[0].deleted_at, null);
    await upsertRecord(sql, SCHOOL_A, record("tr_a1", "Learner A"), TEACHER_A);
  });
});

describe("learner encoding rules", () => {
  let rules: PGlite;
  let db: Sql;

  before(async () => {
    rules = await emptyDb();
    db = toSql(rules);
  });

  after(async () => {
    await rules.close();
  });

  it("stores male learners as not pregnant and keeps a female learner's answer", async () => {
    await upsertRecord(db, SCHOOL_A, record("rule_m", "Male Learner", { sex: "M", ageYears: "12", dateOfBirth: dobForAge(12), pregnant: "Yes" }));
    await upsertRecord(db, SCHOOL_A, record("rule_10", "Ten Year Old", { sex: "F", ageYears: "10", dateOfBirth: dobForAge(10), pregnant: "Yes" }));
    await upsertRecord(db, SCHOOL_A, record("rule_11", "Eleven Year Old", { sex: "F", ageYears: "11", dateOfBirth: dobForAge(11), pregnant: "Yes" }));

    const rows = await db.query<{ id: string; pregnant: string }>(
      "select id, pregnant from sbfp_records where id in ('rule_m','rule_10','rule_11') order by id",
    );
    assert.deepEqual(
      rows.map((row) => [row.id, row.pregnant]),
      [
        ["rule_10", "Yes"],
        ["rule_11", "Yes"],
        ["rule_m", "No"],
      ],
    );
  });
});

describe("trash and the Form 2 manual counts", () => {
  let fresh: PGlite;
  let db: Sql;

  before(async () => {
    fresh = await emptyDb();
    db = toSql(fresh);
    await claimAdminAccountForEmail(db, ADMIN, "Division SBFP Coordinator");
  });

  after(async () => {
    await fresh.close();
  });

  it("saves the at-risk and IP counts per school, year, period and grade", async () => {
    await saveSummaryExtra(
      db,
      SCHOOL_A,
      { period: "Baseline", grade: "Grade 3", sex: "F", atRisk: 4, ips: 2 },
      ADMIN,
    );
    await saveSummaryExtra(
      db,
      SCHOOL_A,
      { period: "Baseline", grade: "Grade 3", sex: "M", atRisk: 1, ips: 0 },
      ADMIN,
    );
    const admin = await resolveAccess(db, ADMIN);
    assert.ok(admin);
    const workspace = await pullData(db, admin);
    const saved = workspace.summaryExtras
      .filter((row) => row.schoolId === SCHOOL_A && row.period === "Baseline")
      .map((row) => [row.grade, row.sex, row.atRisk, row.ips])
      .sort();
    assert.deepEqual(saved, [
      ["Grade 3", "F", 4, 2],
      ["Grade 3", "M", 1, 0],
    ]);

    await assert.rejects(
      () => saveSummaryExtra(db, SCHOOL_A, { period: "Baseline", grade: "Grade 3", sex: "F", atRisk: -1, ips: 0 }),
      (err: unknown) => err instanceof AccountError && err.code === "invalid_record",
    );
  });

  it("soft-deletes, restores, then permanently empties the trash at the new year", async () => {
    await upsertRecord(db, SCHOOL_A, record("trash_a1", "Trashed Learner"));
    await deleteRecord(db, "trash_a1", SCHOOL_A, ADMIN);

    const admin = await resolveAccess(db, ADMIN);
    assert.ok(admin);
    let workspace = await pullData(db, admin);
    assert.equal(workspace.records.some((row) => row.id === "trash_a1"), false);
    assert.equal(workspace.trash.some((row) => row.id === "trash_a1"), true);
    assert.equal(workspace.trash.find((row) => row.id === "trash_a1")?.deletedBy, ADMIN);

    await restoreRecord(db, "trash_a1", SCHOOL_A);
    workspace = await pullData(db, admin);
    assert.equal(workspace.records.some((row) => row.id === "trash_a1"), true);
    assert.equal(workspace.trash.some((row) => row.id === "trash_a1"), false);

    await deleteRecord(db, "trash_a1", SCHOOL_A, ADMIN);
    await startNewSchoolYear(db, "2026-2027");
    const gone = await db.query<{ id: string }>("select id from sbfp_records where id = $1", ["trash_a1"]);
    assert.equal(gone.length, 0, "the new school year empties the trash permanently");
  });
});

describe("passwords", () => {
  it("resets to a working password and flags it as temporary", async () => {
    const before = await credentialState(sql, TEACHER_A);
    assert.ok(before);
    const account = await resetPassword(sql, TEACHER_A, "new-pass-99");
    assert.equal(account.tempPassword, true);

    const after = await credentialState(sql, TEACHER_A);
    assert.ok(after);
    assert.equal(await verifyPassword({ hash: after.hash, password: "sbpf-ay2k9" }), false, "the old password stops working");
    assert.equal(await verifyPassword({ hash: after.hash, password: "new-pass-99" }), true);
    assert.equal(after.userId, before.userId, "the identity is reused, only the hash changes");
    assert.equal(await refusal(() => resetPassword(sql, TEACHER_A, "short")), "weak_password");
  });

  it("only demands the current password once the holder has settled on one", () => {
    assert.equal(
      needsCurrentPassword({ hasPassword: true, tempPassword: true }),
      false,
      "a temporary password is the thing being replaced — asking for it refuses the change",
    );
    assert.equal(
      needsCurrentPassword({ hasPassword: false, tempPassword: true }),
      false,
      "an account with no password proves itself with the session",
    );
    assert.equal(
      needsCurrentPassword({ hasPassword: true, tempPassword: false }),
      true,
      "a password the holder chose must be proved",
    );
    assert.equal(needsCurrentPassword({ hasPassword: false, tempPassword: false }), false);
  });

  it("lets the holder choose her own password, clearing the temporary flag", async () => {
    await changeOwnPassword(sql, TEACHER_A, "maria-chose-this");
    assert.equal((await findAccountByEmail(sql, TEACHER_A))?.tempPassword, false);
    const credential = await credentialState(sql, TEACHER_A);
    assert.ok(credential);
    assert.equal(await verifyPassword({ hash: credential.hash, password: "maria-chose-this" }), true);
  });

  it("gives a password to an account whose identity arrived with no credential", async () => {
    // An identity as the Grok gate creates it: a user row, no credential.
    await pg.query(
      'insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())',
      ["gate-user-1", "Grok user", "gated@depedurdaneta.gov.ph"],
    );
    await pg.query(
      "insert into sbfp_accounts (email, role, full_name, school_id, status, temp_password) values ($1, 'teacher', $2, $3, 'active', false)",
      ["gated@depedurdaneta.gov.ph", "Gated Teacher", "es-003"],
    );
    assert.equal((await credentialState(sql, "gated@depedurdaneta.gov.ph"))?.hasPassword, false);

    await resetPassword(sql, "gated@depedurdaneta.gov.ph", "from-the-office");
    const credential = await credentialState(sql, "gated@depedurdaneta.gov.ph");
    assert.ok(credential);
    assert.equal(credential.userId, "gate-user-1", "the existing identity is reused");
    assert.equal(await verifyPassword({ hash: credential.hash, password: "from-the-office" }), true);
  });

  it("mints a reset link for an active account, stored as a hash", async () => {
    const reset = await createPasswordReset(sql, TEACHER_A.toUpperCase());
    assert.ok(reset, "a School Portal account gets a link");
    assert.equal(reset.email, TEACHER_A, "the address is normalized to the account's own");
    assert.equal(reset.role, "teacher", "the link says which sign-in page to use");
    assert.ok(reset.token.length >= 32, "the token is long enough to guess-proof it");
    assert.ok(reset.expiresAt);

    const stored = await sql.query<{ token_hash: string }>(
      "select token_hash from sbfp_admin_password_resets where lower(email) = $1",
      [TEACHER_A],
    );
    assert.equal(stored.length, 1, "one live link per account");
    assert.equal(stored[0].token_hash, hashResetToken(reset.token));
    assert.notEqual(stored[0].token_hash, reset.token, "the token in the email is never stored");

    // Repeat clicks inside the minute are swallowed, so nobody can flood a mailbox.
    assert.equal(await createPasswordReset(sql, TEACHER_A), null);
    assert.equal(await createPasswordReset(sql, "nobody@deped.gov.ph"), null);
  });

  it("issues a new link after the cooldown, replacing the old one", async () => {
    await sql`update sbfp_admin_password_resets set requested_at = now() - interval '2 minutes'`;
    const first = await createPasswordReset(sql, ADMIN);
    assert.ok(first);

    await sql`update sbfp_admin_password_resets set requested_at = now() - interval '2 minutes'`;
    const second = await createPasswordReset(sql, ADMIN);
    assert.ok(second);
    assert.notEqual(second.token, first.token);

    const rows = await sql.query<{ n: number | string }>(
      "select count(*) as n from sbfp_admin_password_resets where lower(email) = $1",
      [ADMIN],
    );
    assert.equal(Number(rows[0].n), 1, "the earlier link is replaced, not added");

    // The replaced link is dead.
    assert.equal(
      await refusal(() => resetPasswordWithToken(sql, first.token, "admin-pass-2026")),
      "reset_token_invalid",
    );
  });

  it("sets a new Division Office password with the emailed link — once", async () => {
    await sql`update sbfp_admin_password_resets set requested_at = now() - interval '2 minutes'`;
    const reset = await createPasswordReset(sql, ADMIN);
    assert.ok(reset);

    // A rejected password must not consume the link.
    assert.equal(
      await refusal(() => resetPasswordWithToken(sql, reset.token, "short")),
      "weak_password",
    );

    const result = await resetPasswordWithToken(sql, reset.token, "admin-pass-2026");
    assert.deepEqual(result, { email: ADMIN, role: "admin" });
    const credential = await credentialState(sql, ADMIN);
    assert.ok(credential?.hasPassword);
    assert.equal(await verifyPassword({ hash: credential.hash, password: "admin-pass-2026" }), true);
    assert.equal(
      (await findAccountByEmail(sql, ADMIN))?.tempPassword,
      false,
      "the new password is the holder's own, not temporary",
    );

    // The same link cannot be replayed.
    assert.equal(
      await refusal(() => resetPasswordWithToken(sql, reset.token, "another-pass-77")),
      "reset_token_invalid",
    );
    assert.equal(
      await refusal(() => resetPasswordWithToken(sql, "not-a-real-token", "another-pass-77")),
      "reset_token_invalid",
    );
  });

  it("sets a new School Portal password with the emailed link — once", async () => {
    await sql`update sbfp_admin_password_resets set requested_at = now() - interval '2 minutes'`;
    const reset = await createPasswordReset(sql, TEACHER_A);
    assert.ok(reset);
    assert.equal(reset.role, "teacher");

    const result = await resetPasswordWithToken(sql, reset.token, "teacher-pass-2026");
    assert.deepEqual(result, { email: TEACHER_A, role: "teacher" });
    const credential = await credentialState(sql, TEACHER_A);
    assert.ok(credential?.hasPassword);
    assert.equal(
      await verifyPassword({ hash: credential.hash, password: "teacher-pass-2026" }),
      true,
    );
    assert.equal(
      (await findAccountByEmail(sql, TEACHER_A))?.tempPassword,
      false,
      "the holder's own password is not temporary",
    );

    assert.equal(
      await refusal(() => resetPasswordWithToken(sql, reset.token, "another-pass-77")),
      "reset_token_invalid",
    );
  });

  it("refuses a link that has expired", async () => {
    await sql`update sbfp_admin_password_resets set requested_at = now() - interval '2 minutes'`;
    const reset = await createPasswordReset(sql, ADMIN);
    assert.ok(reset);
    await sql`update sbfp_admin_password_resets set expires_at = now() - interval '1 minute'`;

    assert.equal(
      await refusal(() => resetPasswordWithToken(sql, reset.token, "admin-pass-2027")),
      "reset_token_invalid",
    );
  });
});

describe("school data", () => {
  it("merges a header instead of blanking the fields a patch omits", async () => {
    await saveSchoolProfile(sql, SCHOOL_A, { principal: "Mr. Reyes", schoolIdNumber: "100123" }, TEACHER_A);
    assert.equal((await findAccountByEmail(sql, TEACHER_A))?.profile.principal, "Mr. Reyes");

    // The Division Office fills in one more field of the same school.
    await saveSchoolProfile(sql, SCHOOL_A, { cityMunicipalityBarangay: "Urdaneta City, Barangay Anonas" }, ADMIN);
    const profile = (await findAccountByEmail(sql, TEACHER_A))?.profile;
    assert.equal(profile?.principal, "Mr. Reyes", "the earlier fields survive");
    assert.equal(profile?.cityMunicipalityBarangay, "Urdaneta City, Barangay Anonas");
    assert.equal(profile?.division, "Urdaneta City");
  });

  it("sanitizes feedback and never overwrites another school's row", async () => {
    await insertFeedback(
      sql,
      SCHOOL_B,
      {
        id: "tf_conflict",
        author: "   ",
        role: "  ",
        category: "Nutrition Data",
        rating: 9,
        message: "  Needs a reply  ",
        createdAt: "not-a-date",
        status: "New",
        origin: "School Portal",
      },
      "teacher.b@depedurdaneta.gov.ph",
    );
    const row = await sql.query<{
      school_id: string;
      author: string;
      rating: number;
      message: string;
      created_at: string;
      status: string;
    }>(
      "select school_id, author, rating, message, created_at::text as created_at, status from sbfp_feedback where id = $1",
      ["tf_conflict"],
    );
    assert.equal(row[0].school_id, SCHOOL_B);
    assert.equal(row[0].author, "School");
    assert.equal(row[0].rating, 5, "a rating outside 1–5 is clamped");
    assert.equal(row[0].message, "Needs a reply");
    assert.match(row[0].created_at, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(row[0].status, "New");

    // The same id from another school is a no-op, not a way to rewrite the row.
    await insertFeedback(
      sql,
      SCHOOL_A,
      {
        id: "tf_conflict",
        author: "Impostor",
        role: "Other",
        category: "Other",
        rating: 1,
        message: "Tampered",
        createdAt: "2026-08-02",
        status: "Resolved",
      },
      TEACHER_A,
    );
    const unchanged = await sql.query<{ school_id: string; message: string; status: string }>(
      "select school_id, message, status from sbfp_feedback where id = $1",
      ["tf_conflict"],
    );
    assert.deepEqual(unchanged, [{ school_id: SCHOOL_B, message: "Needs a reply", status: "New" }]);
  });

  it("updates a reply and a status independently", async () => {
    await updateFeedback(sql, "tf_a1", { response: "Received — thank you." });
    let row = await sql.query<{ status: string; response: string }>(
      "select status, response from sbfp_feedback where id = $1",
      ["tf_a1"],
    );
    assert.equal(row[0].status, "New", "the status is left alone");
    assert.equal(row[0].response, "Received — thank you.");

    await updateFeedback(sql, "tf_a1", { status: "Acknowledged" });
    row = await sql.query<{ status: string; response: string }>(
      "select status, response from sbfp_feedback where id = $1",
      ["tf_a1"],
    );
    assert.equal(row[0].status, "Acknowledged");
    assert.equal(row[0].response, "Received — thank you.", "and the reply is left alone");

    const access = await resolveAccess(sql, TEACHER_A);
    assert.ok(access);
    const mine = await pullData(sql, access);
    assert.equal(mine.feedbacks[0].status, "Acknowledged");
    assert.equal(mine.feedbacks[0].response, "Received — thank you.");
  });

  it("keeps a school's work when its account is removed", async () => {
    const account = await createAccount(sql, {
      email: "teacher.d@depedurdaneta.gov.ph",
      password: "sbpf-dddd",
      role: "teacher",
      fullName: "Aquino, Marilou",
      schoolId: SCHOOL_E,
    });
    await upsertRecord(sql, SCHOOL_E, record("tr_d1", "Learner D"), account.email);
    await saveSchoolProfile(sql, SCHOOL_E, { principal: "Mrs. Santos" }, account.email);
    await deleteAccount(sql, account.email);

    assert.equal(await findAccountByEmail(sql, account.email), null);
    const rows = await sql.query<{ id: string }>("select id from sbfp_records where school_id = $1", [SCHOOL_E]);
    assert.deepEqual(rows.map((r) => r.id), ["tr_d1"], "the learner records stay with the school");
    const headers = await sql.query<{ principal: string }>(
      "select principal from sbfp_school_profiles where school_id = $1",
      [SCHOOL_E],
    );
    assert.equal(headers[0].principal, "Mrs. Santos");

    // ... and a replacement account for the same school picks the work up.
    const replacement = await createAccount(sql, {
      email: "teacher.d2@depedurdaneta.gov.ph",
      password: "sbpf-dddd2",
      role: "teacher",
      fullName: "Bautista, Rina",
      schoolId: SCHOOL_E,
    });
    const access = await resolveAccess(sql, replacement.email);
    assert.ok(access);
    assert.deepEqual((await pullData(sql, access)).records.map((r) => r.id), ["tr_d1"]);
  });

  it("can move an account to another school, but not onto a taken one", async () => {
    const moved = await updateAccount(sql, "teacher.b@depedurdaneta.gov.ph", { schoolId: "hs-002" });
    assert.equal(moved.schoolId, "hs-002");
    assert.equal(
      await refusal(() => updateAccount(sql, "teacher.b@depedurdaneta.gov.ph", { schoolId: SCHOOL_A })),
      "school_taken",
    );
    await updateAccount(sql, "teacher.b@depedurdaneta.gov.ph", { schoolId: SCHOOL_B });
  });

  it("lists every account with the counts the panel shows", async () => {
    const all = await listAccounts(sql);
    const division = all.find((a) => a.email === ADMIN);
    assert.ok(division);
    assert.equal(division.role, "admin");
    assert.equal(division.schoolId, null);

    const teacherA = all.find((a) => a.email === TEACHER_A);
    assert.ok(teacherA);
    assert.equal(teacherA.recordCount, 1);
    assert.equal(teacherA.feedbackCount, 1);
    assert.equal(teacherA.email, TEACHER_A);
    assert.equal(
      all.filter((a) => a.role === "admin").length,
      1,
      `admins now: ${all.filter((a) => a.role === "admin").map((a) => a.email).join(", ")}`,
    );
  });
});

describe("the Division Office account is never seeded", () => {
  let fresh: PGlite;
  let freshSql: Sql;

  before(async () => {
    fresh = await emptyDb();
    freshSql = toSql(fresh);
  });

  after(async () => {
    await fresh.close();
  });

  it("starts empty, so the first-run card is the only way in", async () => {
    // A fixed login would be a password in the source for an account that can
    // read every school's learners. There is deliberately none, on either
    // backend: the card asks for a password nobody has read.
    assert.equal(await hasAdminAccount(freshSql), false);
    assert.equal(await findAccountByEmail(freshSql, "test@gmail.com"), null);
    assert.equal((await listAccounts(freshSql)).length, 0);
  });
});

describe("the seeded school list", () => {
  let fresh: PGlite;
  let freshSql: Sql;

  before(async () => {
    fresh = await emptyDb();
    freshSql = toSql(fresh);
  });

  after(async () => {
    await fresh.close();
  });

  it("holds the division's 45 elementary and 13 high schools", async () => {
    const schools = await listSchools(freshSql);
    assert.equal(schools.length, 58);
    assert.equal(schools.filter((s) => s.type === "Elementary").length, 45);
    assert.equal(schools.filter((s) => s.type === "High School").length, 13);
    assert.ok(schools.some((s) => s.name === "Anonas East Elementary School"));
    assert.ok(schools.some((s) => s.name === "Urdaneta City National High School"));
  });

  it("carries the school's SBFP form header, and never changes a school's id", async () => {
    await saveSchoolProfile(freshSql, "es01", { principal: "Mrs. Reyes" });
    const [school] = await listSchools(freshSql, { only: ["es01"] });
    assert.equal(school?.principal, "Mrs. Reyes");
    assert.equal(school?.id, "es01", "a header edit must not re-key the school");
  });

  it("renames a school in place and refuses a duplicate name", async () => {
    const renamed = await updateSchool(freshSql, "es02", { name: "Anonas Elementary School (Main)" });
    assert.equal(renamed.id, "es02");
    assert.equal(renamed.name, "Anonas Elementary School (Main)");
    await assert.rejects(
      updateSchool(freshSql, "es01", { name: "Anonas Elementary School (Main)" }),
      /already on the list/,
    );
  });

  it("refuses to remove a school that still holds records", async () => {
    await upsertRecord(freshSql, "es02", record("es02_r1", "Learner"));
    await assert.rejects(deleteSchool(freshSql, "es02"), /still holds/);
  });

  it("refuses to clear a required school information field", async () => {
    await saveSchoolProfile(freshSql, "es01", { principal: "Mrs. Reyes" });
    await assert.rejects(
      saveSchoolProfile(freshSql, "es01", { principal: "   " }),
      /Name of Principal \/ School Head is required/,
    );
    assert.equal((await getSchoolProfile(freshSql, "es01"))?.principal, "Mrs. Reyes");
  });

  it("refuses a learner record with no measurements", async () => {
    await assert.rejects(
      upsertRecord(freshSql, "es01", record("es01_r0", "Learner", { weight: "0", height: "0" })),
      /Weight must be/,
    );
  });
});

describe("school years", () => {
  let diff: PGlite;
  let db: Sql;

  before(async () => {
    diff = await emptyDb();
    db = toSql(diff);
    await createAccount(db, {
      email: ADMIN,
      password: "sbpf-admin-2025",
      role: "admin",
      fullName: "Division SBFP Coordinator",
    });
  });

  after(async () => {
    await diff.close();
  });

  it("starts on the year the existing records carry", async () => {
    assert.equal(await getActiveSchoolYear(db), "2025-2026");
    const years = await listSchoolYears(db);
    assert.equal(years.length, 1);
    assert.equal(years[0].sy, "2025-2026");
    assert.equal(years[0].active, true);
    assert.equal(years[0].records, 0);
  });

  it("counts period rows, distinct learners and feedback per year", async () => {
    await saveSchoolProfile(db, SCHOOL_A, { principal: "Mr. Reyes", schoolIdNumber: "100123" }, ADMIN);
    await upsertRecord(db, SCHOOL_A, record("sy_a1", "Learner A"));
    await upsertRecord(db, SCHOOL_A, record("sy_a2", "Learner A", { period: "Midline" }));
    await insertFeedback(
      db,
      SCHOOL_A,
      {
        id: "sy_f1",
        author: "Dela Cruz, Maria",
        role: "SBFP Feeding Focal Person",
        category: "Feeding Implementation",
        rating: 5,
        message: "Feeding started on schedule.",
        createdAt: "2026-07-20",
        status: "New",
      },
      ADMIN,
    );

    await saveSummaryExtra(
      db,
      SCHOOL_A,
      { period: "Baseline", grade: "Grade 3", sex: "F", atRisk: 4, ips: 2 },
      ADMIN,
    );

    const years = await listSchoolYears(db);
    assert.equal(years[0].records, 2, "both period rows belong to the year");
    assert.equal(years[0].learners, 1, "the same learner is counted once");
    assert.equal(years[0].feedback, 1);
    assert.equal(years[0].schools, 1);

    // The still-active year's export reads today's live school information.
    const open = await getArchivedYear(db, "2025-2026");
    assert.equal(open.records.length, 2);
    assert.equal(open.feedbacks.length, 1);
    assert.equal(open.profiles[SCHOOL_A]?.principal, "Mr. Reyes");
  });

  it("refuses a year that does not follow the active one", async () => {
    for (const sy of ["2024-2025", "2026-2028", "SY 2026-2027"]) {
      await assert.rejects(
        () => startNewSchoolYear(db, sy),
        (err: unknown) => err instanceof SchoolYearError && err.code === "invalid_year",
        `${sy} must be refused`,
      );
    }
    // The year that is already open cannot be opened a second time.
    await assert.rejects(
      () => startNewSchoolYear(db, "2025-2026"),
      (err: unknown) => err instanceof SchoolYearError && err.code === "year_exists",
    );
    assert.equal(await getActiveSchoolYear(db), "2025-2026", "a refused year changes nothing");
  });

  it("closes the old year, archives its data and resets everything but accounts", async () => {
    const result = await startNewSchoolYear(db, "2026-2027");
    assert.deepEqual(result, { sy: "2026-2027", closedSy: "2025-2026" });

    const years = await listSchoolYears(db);
    assert.deepEqual(years.map((y) => y.sy), ["2026-2027", "2025-2026"]);
    assert.equal(years[0].active, true);
    assert.equal(years[0].records, 0, "the new year starts empty");
    assert.equal(years[0].feedback, 0);
    assert.ok(years[1].closedAt, "the old year is closed");
    assert.equal(years[1].records, 2, "its rows are still there");
    assert.equal(years[1].learners, 1);

    // The archive holds the year's rows and the form header it closed with.
    const archived = await getArchivedYear(db, "2025-2026");
    assert.deepEqual(archived.records.map((r) => r.id).sort(), ["sy_a1", "sy_a2"]);
    assert.equal(archived.feedbacks[0].id, "sy_f1");
    assert.equal(archived.profiles[SCHOOL_A]?.principal, "Mr. Reyes");
    assert.equal(archived.profiles[SCHOOL_A]?.schoolIdNumber, "100123");
    assert.deepEqual(
      archived.summaryExtras
        .filter((row) => row.schoolId === SCHOOL_A && row.period === "Baseline")
        .map((row) => [row.grade, row.sex, row.atRisk, row.ips])
        .sort(),
      [["Grade 3", "F", 4, 2]],
      "Form 2's manual counts stay with the archived year",
    );

    // Live school information is blank for the new year ...
    assert.equal(await getSchoolProfile(db, SCHOOL_A), null);
    // ... while the account is still there, unchanged.
    const account = await findAccountByEmail(db, ADMIN);
    assert.equal(account?.role, "admin");
    assert.equal(account?.status, "active");

    const admin = await resolveAccess(db, ADMIN);
    assert.ok(admin);
    const workspace = await pullData(db, admin);
    assert.equal(workspace.activeSy, "2026-2027");
    assert.deepEqual(workspace.records, [], "the console no longer sees last year's rows");
    assert.deepEqual(workspace.feedbacks, []);
  });

  it("stamps new rows with the active year and keeps both years apart", async () => {
    // The learner encoded last year is found in the archive for Data Entry's
    // "SBFP beneficiary in previous years?" — by name, and by name + birthday.
    assert.equal(await previousBeneficiaryYear(db, SCHOOL_A, "Learner A"), "2025-2026");
    assert.equal(await previousBeneficiaryYear(db, SCHOOL_A, "  learner   a  "), "2025-2026");
    assert.equal(await previousBeneficiaryYear(db, SCHOOL_A, "Learner A", "2016-04-02"), "2025-2026");
    assert.equal(await previousBeneficiaryYear(db, SCHOOL_A, "Learner A", "2016-04-03"), null, "a namesake with another birthday is someone else");
    assert.equal(await previousBeneficiaryYear(db, SCHOOL_A, "Nobody"), null);

    await upsertRecord(db, SCHOOL_A, record("sy_a3", "Learner B", { sy: "2025-2026" }));
    await insertFeedback(
      db,
      SCHOOL_A,
      {
        id: "sy_f2",
        author: "Dela Cruz, Maria",
        role: "SBFP Feeding Focal Person",
        category: "Feeding Implementation",
        rating: 4,
        message: "Second year feedback.",
        createdAt: "2027-07-20",
        status: "New",
      },
      ADMIN,
    );

    const rows = await db.query<{ sy: string }>("select sy from sbfp_records where id = $1", ["sy_a3"]);
    assert.equal(rows[0].sy, "2026-2027", "the server's year wins over the form's stale value");
    const feedback = await db.query<{ sy: string }>("select sy from sbfp_feedback where id = $1", ["sy_f2"]);
    assert.equal(feedback[0].sy, "2026-2027");

    const years = await listSchoolYears(db);
    assert.equal(years[0].records, 1);
    assert.equal(years[0].feedback, 1);
    assert.equal(years[1].records, 2, "the archived year is untouched");

    const admin = await resolveAccess(db, ADMIN);
    assert.ok(admin);
    const workspace = await pullData(db, admin);
    assert.deepEqual(workspace.records.map((r) => r.id), ["sy_a3"]);
    assert.deepEqual(workspace.feedbacks.map((f) => f.id), ["sy_f2"]);

    const archived = await getArchivedYear(db, "2025-2026");
    assert.deepEqual(archived.records.map((r) => r.id).sort(), ["sy_a1", "sy_a2"]);
    assert.deepEqual(archived.feedbacks.map((f) => f.id), ["sy_f1"]);
  });

  it("refuses to open a year that already exists, or an unknown archive", async () => {
    await assert.rejects(
      () => startNewSchoolYear(db, "2026-2027"),
      (err: unknown) => err instanceof SchoolYearError && err.code === "year_exists",
    );
    await assert.rejects(
      () => getArchivedYear(db, "2030-2031"),
      (err: unknown) => err instanceof SchoolYearError && err.code === "year_not_found",
    );
    assert.equal(await getActiveSchoolYear(db), "2026-2027");
  });

  it("can close a second year and keep all three readable", async () => {
    await startNewSchoolYear(db, "2027-2028");
    const years = await listSchoolYears(db);
    assert.deepEqual(years.map((y) => y.sy), ["2027-2028", "2026-2027", "2025-2026"]);
    assert.equal(years[0].records, 0);
    assert.equal(years[1].records, 1);
    assert.equal(years[2].records, 2);

    // No school information was entered in 2026-2027 (it was reset at the
    // start of the year), so that archive has no header for the school rather
    // than borrowing 2025-2026's principal. Exports fall back to a blank form.
    const archived = await getArchivedYear(db, "2026-2027");
    assert.equal(archived.profiles[SCHOOL_A], undefined);
  });
});
