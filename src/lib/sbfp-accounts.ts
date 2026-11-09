/**
 * SBFP accounts and the data the schools send up — the server-side half.
 *
 * Everything here is a plain function over the shared `Sql` client (see
 * `@/lib/db`), with no framework in sight: the server functions in
 * `@/lib/sbfp-api` are a thin translation of a **verified session** into the
 * `SbfpAccess` these functions take, and nothing else is allowed to decide who
 * may read or write a school's rows. That keeps the authorization rules in one
 * place — and lets the PGlite-backed test in `sbfp-accounts.test.ts` exercise
 * them for real, against the same SQL the app runs.
 *
 * Who owns what:
 *  - `sbfp_accounts`        — the Division Office's own account, plus one
 *                             account per school (the email and role), issued
 *                             from `/`. This is the only authorization source.
 *  - `sbfp_school_profiles` — the school information block the SBFP forms print,
 *                             owned by the school so it survives a change of
 *                             teacher or of account.
 *  - `sbfp_records`         — learner records encoded through the School Portal.
 *  - `sbfp_feedback`        — what a school sent up, with the Division Office's
 *                             reply stored on the same row.
 *
 * A teacher may only ever touch her own school; the Division Office may touch
 * any. Neither is decided by anything the browser sends — see `SbfpAccess`.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Sql } from "./db.ts";
import {
  isValidEmail,
  normalizeEmail,
  passwordProblem,
} from "./sbfp-credentials.ts";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from "./sbfp-domain.ts";
import type {
  FeedbackCategory,
  FeedbackStatus,
  School,
  SchoolFeedback,
  SchoolFormDetails,
  Student,
  SummaryExtra,
  TrashedRecord,
} from "@/lib/sbfp-shared";
import { listSchools } from "./sbfp-schools.ts";
import { currentSchoolYear, getActiveSchoolYear, SchoolYearError } from "./sbfp-years.ts";
import type { ArchivedSchoolYear } from "./sbfp-years.ts";
import { learnerProblem } from "./sbfp-validation.ts";
import { mustNotBePregnant } from "./sbfp-domain.ts";

export type AccountRole = "admin" | "teacher";
export type AccountStatus = "active" | "disabled";

/** A row of `sbfp_accounts` joined with the school's form header. */
export interface AccountRow {
  email: string;
  role: AccountRole;
  fullName: string;
  position: string;
  contact: string;
  /** The school this teacher account is for; null for the Division Office. */
  schoolId: string | null;
  status: AccountStatus;
  /** True while the password is still the one the Division Office generated. */
  tempPassword: boolean;
  createdAt: string;
  updatedAt: string;
  /** The school's SBFP form header (empty strings until someone fills it in). */
  profile: SchoolFormDetails;
}

/** A learner record may hold nothing the form fields cannot: all strings. */
export type RecordInput = Omit<Student, "schoolId">;

export type AccountErrorCode =
  | "invalid_email"
  | "weak_password"
  | "email_taken"
  | "school_taken"
  | "not_found"
  | "last_admin"
  | "reset_token_invalid"
  | "incomplete_profile"
  | "invalid_record"
  | "forbidden";

/** A refusal the UI can explain. Never carries SQL or a stack. */
export class AccountError extends Error {
  readonly code: AccountErrorCode;
  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

// ── Access ────────────────────────────────────────────────────────────────────

/**
 * What a verified session may do. Built ONLY from the server-resolved session
 * email (`@/lib/auth/verify.server`) — never from a client-supplied id.
 */
export interface SbfpAccess {
  email: string;
  account: AccountRow;
  /** `"all"` for the Division Office, otherwise the caller's one school. */
  scope: "all" | string[];
}

export function isAdmin(access: SbfpAccess): boolean {
  return access.account.role === "admin";
}

/** Every school id this caller may read or write. */
export function scopeIds(access: SbfpAccess): string[] {
  return access.scope === "all" ? [] : access.scope;
}

/** Throw unless the caller may write `schoolId`. */
export function assertCanWriteSchool(access: SbfpAccess, schoolId: string): void {
  if (access.scope === "all") return;
  if (!access.scope.includes(schoolId)) {
    throw new AccountError(
      "forbidden",
      "That school is not on your account. Ask the Division Office for access.",
    );
  }
}

/** Throw unless the caller may write `id`, resolving the row's real school. */
export async function assertCanWriteRecord(
  sql: Sql,
  access: SbfpAccess,
  id: string,
): Promise<void> {
  if (access.scope === "all") return;
  const rows = await sql<{ school_id: string }>`
    select school_id from sbfp_records where id = ${id}
  `;
  const schoolId = rows[0]?.school_id;
  if (schoolId) assertCanWriteSchool(access, schoolId);
}

export async function assertCanWriteFeedback(
  sql: Sql,
  access: SbfpAccess,
  id: string,
): Promise<void> {
  if (access.scope === "all") return;
  const rows = await sql<{ school_id: string }>`
    select school_id from sbfp_feedback where id = ${id}
  `;
  const schoolId = rows[0]?.school_id;
  if (schoolId) assertCanWriteSchool(access, schoolId);
}

// ── Row mapping ───────────────────────────────────────────────────────────────

interface AccountDbRow {
  email: string;
  role: string;
  full_name: string;
  position: string;
  contact: string;
  school_id: string | null;
  status: string;
  temp_password: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  division: string | null;
  city_municipality_barangay: string | null;
  school_id_number: string | null;
  principal: string | null;
  focal_person: string | null;
  date_start_feeding: string | null;
  last_mile_school: string | null;
  record_count?: number | string | null;
  feedback_count?: number | string | null;
}

export interface AccountListRow extends AccountRow {
  recordCount: number;
  feedbackCount: number;
}

/** timestamptz arrives as a Date on pg and as an ISO string on PGLite. */
function isoOf(value: string | Date | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

function textOf(value: string | null | undefined): string {
  return value ?? "";
}

function toAccount(row: AccountDbRow): AccountRow {
  return {
    email: row.email,
    role: row.role === "admin" ? "admin" : "teacher",
    fullName: textOf(row.full_name),
    position: textOf(row.position),
    contact: textOf(row.contact),
    schoolId: row.school_id ?? null,
    status: row.status === "disabled" ? "disabled" : "active",
    tempPassword: Boolean(row.temp_password),
    createdAt: isoOf(row.created_at),
    updatedAt: isoOf(row.updated_at),
    profile: {
      division: textOf(row.division) || "Urdaneta City",
      cityMunicipalityBarangay: textOf(row.city_municipality_barangay),
      schoolIdNumber: textOf(row.school_id_number),
      principal: textOf(row.principal),
      focalPerson: textOf(row.focal_person),
      dateStartFeeding: textOf(row.date_start_feeding),
      lastMileSchool: textOf(row.last_mile_school) as SchoolFormDetails["lastMileSchool"],
    },
  };
}

/**
 * The one SELECT shape for an account: the row, its school's form header, and
 * how much the school has sent up (the accounts panel shows both counts).
 */
const ACCOUNT_SELECT = `
  select a.email, a.role, a.full_name, a.position, a.contact, a.school_id,
         a.status, a.temp_password, a.created_at, a.updated_at,
         p.division, p.city_municipality_barangay, p.school_id_number,
         p.principal, p.focal_person, p.date_start_feeding, p.last_mile_school,
         (select count(*) from sbfp_records r
            where r.school_id = a.school_id
              and r.deleted_at is null
              and r.sy = (select sy from sbfp_school_years where closed_at is null limit 1)
         ) as record_count,
         (select count(*) from sbfp_feedback f
            where f.school_id = a.school_id
              and f.sy = (select sy from sbfp_school_years where closed_at is null limit 1)
         ) as feedback_count
  from sbfp_accounts a
  left join sbfp_school_profiles p on p.school_id = a.school_id
`;

// ── Reading accounts ──────────────────────────────────────────────────────────

/** The account an email holds, or null. Matching is case-insensitive. */
export async function findAccountByEmail(
  sql: Sql,
  email: string,
): Promise<AccountRow | null> {
  const rows = await sql.query<AccountDbRow>(
    `${ACCOUNT_SELECT} where lower(a.email) = $1`,
    [normalizeEmail(email)],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

/**
 * Every account, newest first — the Division Office's accounts panel.
 *
 * `only` narrows the read to those school ids. The school portal only ever
 * shows one school, so without it every workspace load counted records and
 * feedback for all 58 accounts just to throw 57 away.
 */
export async function listAccounts(
  sql: Sql,
  options: { only?: string[] } = {},
): Promise<AccountListRow[]> {
  const where =
    options.only === undefined
      ? ""
      : options.only.length === 0
        ? " where false"
        : ` where a.school_id in (${options.only.map((_, i) => `$${i + 1}`).join(", ")})`;
  const rows = await sql.query<AccountDbRow>(
    `${ACCOUNT_SELECT}${where} order by a.role desc, a.school_id nulls first, a.email`,
    options.only ?? [],
  );
  return rows.map((row) => {
    const account = toAccount(row);
    return {
      ...account,
      recordCount: Number(row.record_count ?? 0),
      feedbackCount: Number(row.feedback_count ?? 0),
    };
  });
}

/** True once the Division Office has claimed its own account. */
export async function hasAdminAccount(sql: Sql): Promise<boolean> {
  const rows = await sql<{ n: number | string }>`
    select count(*) as n from sbfp_accounts where role = 'admin'
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function countAdmins(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number | string }>`
    select count(*) as n from sbfp_accounts where role = 'admin' and status = 'active'
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * The caller's access, resolved from the verified session email. A signed-in
 * visitor whose email holds no account gets `null` — read as "no access yet",
 * never as "the Division Office".
 *
 * A disabled account still resolves (so the UI can say the account was put on
 * hold) but its scope is empty: every read and write of school data is refused.
 */
export async function resolveAccess(
  sql: Sql,
  email: string,
): Promise<SbfpAccess | null> {
  const account = await findAccountByEmail(sql, email);
  if (!account) return null;
  if (account.status !== "active") {
    return { email: account.email, account, scope: [] };
  }
  if (account.role === "admin") {
    return { email: account.email, account, scope: "all" };
  }
  if (!account.schoolId) {
    return { email: account.email, account, scope: [] };
  }
  return { email: account.email, account, scope: [account.schoolId] };
}

// ── Writing accounts ──────────────────────────────────────────────────────────

export interface CreateAccountInput {
  email: string;
  password: string;
  role: AccountRole;
  fullName?: string;
  position?: string;
  contact?: string;
  schoolId?: string | null;
  /** The Division Office's own account is not a temporary password. */
  tempPassword?: boolean;
}

/**
 * Create the identity (a Better Auth email/password user) and the authorization
 * row together.
 *
 * The credentials are written directly rather than through Better Auth's
 * sign-up endpoint: that endpoint also signs the *current* request in as the new
 * user, which would swap the Division Office's own session for the teacher's the
 * moment she issues an account. The hash is Better Auth's own
 * (`better-auth/crypto`), so the account signs in through `/api/auth/sign-in/email`
 * exactly like any other.
 */
export async function createAccount(
  sql: Sql,
  input: CreateAccountInput,
): Promise<AccountRow> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new AccountError("invalid_email", "That does not look like an email address.");
  }
  const problem = passwordProblem(input.password);
  if (problem) throw new AccountError("weak_password", problem);

  const schoolId = input.role === "teacher" ? (input.schoolId ?? "").trim() : null;
  if (input.role === "teacher" && !schoolId) {
    throw new AccountError("not_found", "Choose the school this account is for.");
  }

  const existing = await findAccountByEmail(sql, email);
  if (existing) {
    throw new AccountError("email_taken", `${email} already has an account.`);
  }
  if (schoolId) {
    const taken = await sql<{ email: string }>`
      select email from sbfp_accounts where school_id = ${schoolId} and role = 'teacher'
    `;
    if (taken[0]) {
      throw new AccountError(
        "school_taken",
        `That school already has an account (${taken[0].email}). Edit or remove it first.`,
      );
    }
  }

  const password = await hashPassword(input.password);
  const userId = randomUUID();
  const name = input.fullName?.trim() || email;
  await sql`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${userId}, ${name}, ${email}, true, now(), now())
  `;
  try {
    await sql`
      insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
      values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${password}, now(), now())
    `;
    await sql`
      insert into sbfp_accounts
        (email, role, full_name, position, contact, school_id, status, temp_password, created_at, updated_at)
      values (
        ${email}, ${input.role}, ${input.fullName?.trim() ?? ""}, ${input.position?.trim() ?? ""},
        ${input.contact?.trim() ?? ""}, ${schoolId},
        'active', ${input.tempPassword ?? input.role === "teacher"}, now(), now()
      )
    `;
  } catch (err) {
    // Never leave an identity behind that nothing can authorize.
    await sql`delete from "user" where "id" = ${userId}`.catch(() => undefined);
    throw err;
  }

  const created = await findAccountByEmail(sql, email);
  if (!created) throw new AccountError("not_found", "The account could not be created.");
  return created;
}

export interface AccountPatch {
  fullName?: string;
  position?: string;
  contact?: string;
  schoolId?: string | null;
  status?: AccountStatus;
}

/** Edit a teacher account: who holds it, which school, and whether it is live. */
export async function updateAccount(
  sql: Sql,
  email: string,
  patch: AccountPatch,
): Promise<AccountRow> {
  const current = await findAccountByEmail(sql, email);
  if (!current) throw new AccountError("not_found", "That account no longer exists.");

  const schoolId =
    patch.schoolId === undefined ? current.schoolId : (patch.schoolId ?? null);
  if (schoolId && schoolId !== current.schoolId) {
    const taken = await sql<{ email: string }>`
      select email from sbfp_accounts where school_id = ${schoolId} and role = 'teacher'
    `;
    if (taken[0]) {
      throw new AccountError(
        "school_taken",
        `That school already has an account (${taken[0].email}).`,
      );
    }
  }
  if (patch.status === "disabled" && current.role === "admin") {
    if ((await countAdmins(sql)) <= 1) {
      throw new AccountError(
        "last_admin",
        "This is the only Division Office account — create another before disabling it.",
      );
    }
  }

  const fullName = patch.fullName === undefined ? current.fullName : patch.fullName.trim();
  const position = patch.position === undefined ? current.position : patch.position.trim();
  const contact = patch.contact === undefined ? current.contact : patch.contact.trim();
  await sql`
    update sbfp_accounts set
      full_name = ${fullName},
      position = ${position},
      contact = ${contact},
      school_id = ${schoolId},
      status = ${patch.status ?? current.status},
      updated_at = now()
    where lower(email) = ${normalizeEmail(email)}
  `;
  if (patch.fullName !== undefined) {
    // The auth identity's display name is separate from `sbfp_accounts`; keep
    // them in step so the signed-in user menu does not show the old name.
    await sql`
      update "user" set "name" = ${fullName || current.email}, "updatedAt" = now()
      where lower("email") = ${normalizeEmail(email)}
    `;
  }
  const updated = await findAccountByEmail(sql, email);
  if (!updated) throw new AccountError("not_found", "That account no longer exists.");
  return updated;
}

/** A teacher may edit her own name and contact details, but never her role or school. */
export async function updateOwnTeacherDetails(
  sql: Sql,
  email: string,
  patch: { fullName?: string; position?: string; contact?: string },
): Promise<AccountRow> {
  const current = await findAccountByEmail(sql, email);
  if (!current) throw new AccountError("not_found", "That account no longer exists.");
  if (current.role !== "teacher") {
    throw new AccountError("forbidden", "Only a School Portal account can edit these details.");
  }
  const fullName = (patch.fullName ?? current.fullName).trim();
  if (!fullName) {
    throw new AccountError("incomplete_profile", "Your name is required on the SBFP forms.");
  }
  return updateAccount(sql, email, {
    fullName: fullName.slice(0, 120),
    position: (patch.position ?? current.position).trim().slice(0, 120),
    contact: (patch.contact ?? current.contact).trim().slice(0, 160),
  });
}

/**
 * The credential behind an email: the password hash to verify against, and
 * whether there is one at all. `null` means the email holds no identity AND no
 * SBFP account.
 *
 * An account can legitimately exist without a password — one issued to a visitor
 * who already signs in through the Grok gate never needs one until the Division
 * Office (or the holder) sets it.
 */
export async function credentialState(
  sql: Sql,
  email: string,
): Promise<{ hasPassword: boolean; hash: string; userId: string | null } | null> {
  const normalized = normalizeEmail(email);
  const users = await sql<{ id: string; password: string | null }>`
    select u."id" as id, ac."password" as password
    from "user" u
    left join "account" ac on ac."userId" = u."id" and ac."providerId" = 'credential'
    where lower(u."email") = ${normalized}
  `;
  const user = users[0];
  if (user) {
    const hash = textOf(user.password);
    return { hasPassword: hash.length > 0, hash, userId: user.id };
  }
  const account = await findAccountByEmail(sql, normalized);
  return account ? { hasPassword: false, hash: "", userId: null } : null;
}

/**
 * Whether changing one's own password must prove the current one.
 *
 * The portal asks for the current password only when the holder is not still on
 * the temporary one the Division Office handed out (`needsCurrent` in
 * `teacher-app.tsx`). This is the same rule on the server, encoded once so the
 * two sides cannot drift apart.
 *
 * It matters because a temporary password *is* a password: a rule that demanded
 * proof whenever `hasPassword` is true reads correctly but refuses the one
 * action a newly-issued account is told to take.
 */
export function needsCurrentPassword(state: {
  hasPassword: boolean;
  tempPassword: boolean;
}): boolean {
  return state.hasPassword && !state.tempPassword;
}

/**
 * Set a new password for an account (the "Reset password" action) and flag it as
 * temporary, so the portal prompts the teacher to choose her own.
 *
 * Every existing session for the account is deleted at the same time: the old
 * password is what those sessions were opened with, and leaving them alive would
 * let a stolen session outlive the reset that was meant to end it.
 *
 * The identity and the credential are created when they are missing — that is
 * what lets an account that only ever arrived through the Grok gate be given a
 * password as well.
 */
export async function resetPassword(
  sql: Sql,
  email: string,
  password: string,
): Promise<AccountRow> {
  const problem = passwordProblem(password);
  if (problem) throw new AccountError("weak_password", problem);
  const account = await findAccountByEmail(sql, email);
  if (!account) throw new AccountError("not_found", "That account no longer exists.");

  const state = await credentialState(sql, email);
  let userId = state?.userId ?? null;
  if (!userId) {
    userId = randomUUID();
    await sql`
      insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${userId}, ${account.fullName || account.email}, ${account.email}, true, now(), now())
    `;
  }
  const hash = await hashPassword(password);
  await sql`
    update "account" set "password" = ${hash}, "updatedAt" = now()
    where "userId" = ${userId} and "providerId" = 'credential'
  `;
  // A password change has to end every session it was changed away from —
  // otherwise a stolen session, or the one on an old phone, keeps working with
  // the password that was just replaced. Sessions cascade with the identity.
  await sql`delete from "session" where "userId" = ${userId}`;
  const hasCredential = await sql<{ id: string }>`
    select "id" from "account" where "userId" = ${userId} and "providerId" = 'credential'
  `;
  if (!hasCredential[0]) {
    await sql`
      insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
      values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hash}, now(), now())
    `;
  }
  await sql`
    update sbfp_accounts set temp_password = true, updated_at = now()
    where lower(email) = ${normalizeEmail(email)}
  `;
  const after = await findAccountByEmail(sql, email);
  if (!after) throw new AccountError("not_found", "That account no longer exists.");
  return after;
}

/** Change one's own password (the portal's Account card). */
export async function changeOwnPassword(
  sql: Sql,
  email: string,
  password: string,
): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new AccountError("weak_password", problem);
  await resetPassword(sql, email, password);
  await sql`
    update sbfp_accounts set temp_password = false where lower(email) = ${normalizeEmail(email)}
  `;
}

// ── Emailed password reset ────────────────────────────────────────────────────

/** How long an emailed reset link stays usable. */
export const RESET_LINK_MINUTES = 30;

/**
 * Hash of the token that goes in the email. The token is 256 bits from the OS
 * CSPRNG, so a fast hash is enough — and the token itself never reaches the
 * database, so a database read cannot mint a link.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Mint a reset token for an active SBFP account, or null when no such account
 * exists or a link was requested less than a minute ago.
 *
 * Null is deliberately the same answer for "no such account" and "too soon" —
 * both sign-in screens show the same "if that address has an account" message
 * either way, so this endpoint cannot be used to discover an address. Asking
 * again replaces the previous token, which invalidates the older link.
 *
 * This covers both the Division Office and School Portal accounts. The table
 * predates school-account recovery and keeps its historical name; the rows are
 * keyed by email and work for either role.
 */
export async function createPasswordReset(
  sql: Sql,
  email: string,
): Promise<{ email: string; role: AccountRole; token: string; expiresAt: string } | null> {
  const normalized = normalizeEmail(email);
  const accounts = await sql<{ email: string; role: string }>`
    select email, role from sbfp_accounts
    where lower(email) = ${normalized} and status = 'active'
  `;
  const account = accounts[0];
  if (!account) return null;

  const recent = await sql<{ recent: boolean }>`
    select (requested_at > now() - interval '60 seconds') as recent
    from sbfp_admin_password_resets
    where lower(email) = ${normalized}
  `;
  if (recent[0]?.recent) return null;

  // Expired rows are dead weight; clear them as we go.
  await sql`delete from sbfp_admin_password_resets where expires_at < now()`;

  const token = randomBytes(32).toString("base64url");
  const rows = await sql<{ expires_at: string | Date }>`
    insert into sbfp_admin_password_resets (email, token_hash, expires_at, requested_at)
    values (${account.email}, ${hashResetToken(token)}, now() + interval '30 minutes', now())
    on conflict (email) do update set
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      requested_at = now()
    returning expires_at
  `;
  return {
    email: account.email,
    role: account.role === "admin" ? "admin" : "teacher",
    token,
    expiresAt: isoOf(rows[0]?.expires_at),
  };
}

/**
 * Set a new password from an emailed token. No session is involved — this is the
 * locked-out door for either role.
 *
 * The password is validated before the token is consumed, the row is deleted as
 * it is read (so the link cannot be replayed), and the same refusal covers a
 * malformed, expired and already-used token.
 */
export async function resetPasswordWithToken(
  sql: Sql,
  token: string,
  password: string,
): Promise<{ email: string; role: AccountRole }> {
  const problem = passwordProblem(password);
  if (problem) throw new AccountError("weak_password", problem);

  const consumed = await sql<{ email: string }>`
    delete from sbfp_admin_password_resets
    where token_hash = ${hashResetToken(token)} and expires_at > now()
    returning email
  `;
  const email = consumed[0]?.email;
  if (!email) {
    throw new AccountError(
      "reset_token_invalid",
      "That reset link is invalid or has expired. Request a new one.",
    );
  }

  const account = await findAccountByEmail(sql, email);
  if (!account || account.status !== "active") {
    throw new AccountError(
      "reset_token_invalid",
      "That reset link is invalid or has expired. Request a new one.",
    );
  }

  await resetPassword(sql, email, password);
  await sql`
    update sbfp_accounts set temp_password = false where lower(email) = ${normalizeEmail(email)}
  `;
  return { email, role: account.role };
}

/**
 * First-run setup: make a signed-in visitor's own email the Division Office
 * account. Used behind the Grok gate, where the platform has already verified
 * that identity — so no password is typed, and none is needed until they choose
 * to set one.
 */
export async function claimAdminAccountForEmail(
  sql: Sql,
  email: string,
  fullName: string,
): Promise<AccountRow> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new AccountError("invalid_email", "That does not look like an email address.");
  }
  if (await hasAdminAccount(sql)) {
    throw new AccountError(
      "forbidden",
      "The Division Office account already exists. Sign in with it.",
    );
  }
  const existing = await findAccountByEmail(sql, normalized);
  if (existing) {
    throw new AccountError("email_taken", `${normalized} already has an account.`);
  }
  // The check above reads the table; this INSERT makes "exactly one first-run
  // admin" true even when two claims arrive together. A racing caller inserts
  // nothing instead of a second Division Office account.
  const inserted = await sql<{ email: string }>`
    insert into sbfp_accounts
      (email, role, full_name, position, contact, school_id, status, temp_password, created_at, updated_at)
    select ${normalized}, 'admin', ${fullName.trim()}, '', '', null, 'active', false, now(), now()
    where not exists (select 1 from sbfp_accounts where role = 'admin')
    returning email
  `;
  if (!inserted[0]) {
    throw new AccountError(
      "forbidden",
      "The Division Office account already exists. Sign in with it.",
    );
  }
  const created = await findAccountByEmail(sql, normalized);
  if (!created) throw new AccountError("not_found", "The account could not be created.");
  return created;
}

/**
 * Remove an account. The school's own work — its form header, learner records and
 * feedback — is deliberately kept, so a replacement account for the same school
 * picks the work up where it was left.
 */
export async function deleteAccount(sql: Sql, email: string): Promise<void> {
  const account = await findAccountByEmail(sql, email);
  if (!account) throw new AccountError("not_found", "That account no longer exists.");
  if (account.role === "admin" && (await countAdmins(sql)) <= 1) {
    throw new AccountError(
      "last_admin",
      "This is the only Division Office account — create another before removing it.",
    );
  }
  // Sessions and linked identities cascade with the identity row.
  await sql`delete from "user" where lower("email") = ${normalizeEmail(email)}`;
  await sql`delete from sbfp_accounts where lower(email) = ${normalizeEmail(email)}`;
}

// ── School form headers ───────────────────────────────────────────────────────

export async function getSchoolProfile(
  sql: Sql,
  schoolId: string,
): Promise<SchoolFormDetails | null> {
  const rows = await sql<{
    division: string;
    city_municipality_barangay: string;
    school_id_number: string;
    principal: string;
    focal_person: string;
    date_start_feeding: string;
    last_mile_school: string;
  }>`select * from sbfp_school_profiles where school_id = ${schoolId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    division: row.division || "Urdaneta City",
    cityMunicipalityBarangay: row.city_municipality_barangay ?? "",
    schoolIdNumber: row.school_id_number ?? "",
    principal: row.principal ?? "",
    focalPerson: row.focal_person ?? "",
    dateStartFeeding: row.date_start_feeding ?? "",
    lastMileSchool: (row.last_mile_school ?? "") as SchoolFormDetails["lastMileSchool"],
  };
}

/**
 * The four fields the SBFP forms cannot be printed without. The portal and the
 * console both check these before saving; this is the server's own copy of the
 * rule, so a cleared field cannot slip through an altered request.
 */
export const REQUIRED_PROFILE_FIELDS: [keyof SchoolFormDetails, string][] = [
  ["principal", "Name of Principal / School Head"],
  ["focalPerson", "Name of Feeding Focal Person"],
  ["schoolIdNumber", "School ID Number"],
  ["cityMunicipalityBarangay", "City/Municipality/Barangay"],
];

/**
 * Why this profile patch cannot be saved, or null. Only a required field the
 * patch is actually setting is checked: a save that touches just `division` (or
 * a legacy carry-over) must not be refused for fields it never mentioned.
 */
export function profileProblem(patch: Partial<SchoolFormDetails>): string | null {
  for (const [key, label] of REQUIRED_PROFILE_FIELDS) {
    const value = patch[key];
    if (value !== undefined && !String(value).trim()) {
      return `${label} is required — the SBFP forms cannot be printed without it.`;
    }
  }
  return null;
}

/** Upsert the school information block (either side of the app may edit it). */
export async function saveSchoolProfile(
  sql: Sql,
  schoolId: string,
  patch: Partial<SchoolFormDetails>,
  updatedBy?: string,
): Promise<void> {
  if (!schoolId) return;
  const problem = profileProblem(patch);
  if (problem) throw new AccountError("incomplete_profile", problem);
  const current = await getSchoolProfile(sql, schoolId);
  const next: SchoolFormDetails = {
    division: patch.division ?? current?.division ?? "Urdaneta City",
    cityMunicipalityBarangay: patch.cityMunicipalityBarangay ?? current?.cityMunicipalityBarangay ?? "",
    schoolIdNumber: patch.schoolIdNumber ?? current?.schoolIdNumber ?? "",
    principal: patch.principal ?? current?.principal ?? "",
    focalPerson: patch.focalPerson ?? current?.focalPerson ?? "",
    dateStartFeeding: patch.dateStartFeeding ?? current?.dateStartFeeding ?? "",
    lastMileSchool: patch.lastMileSchool ?? current?.lastMileSchool ?? "",
  };
  await sql`
    insert into sbfp_school_profiles
      (school_id, division, city_municipality_barangay, school_id_number, principal,
       focal_person, date_start_feeding, last_mile_school, updated_at, updated_by)
    values (
      ${schoolId}, ${next.division}, ${next.cityMunicipalityBarangay}, ${next.schoolIdNumber},
      ${next.principal}, ${next.focalPerson}, ${next.dateStartFeeding}, ${next.lastMileSchool},
      now(), ${updatedBy ?? null}
    )
    on conflict (school_id) do update set
      division = excluded.division,
      city_municipality_barangay = excluded.city_municipality_barangay,
      school_id_number = excluded.school_id_number,
      principal = excluded.principal,
      focal_person = excluded.focal_person,
      date_start_feeding = excluded.date_start_feeding,
      last_mile_school = excluded.last_mile_school,
      updated_at = now(),
      updated_by = excluded.updated_by
  `;
}

// ── Learner records ───────────────────────────────────────────────────────────

interface RecordDbRow {
  id: string;
  school_id: string;
  period: string;
  sy: string;
  name: string;
  sex: string;
  grade_level: string;
  date_of_birth: string;
  date_of_weighing: string;
  age_years: string;
  age_months: string;
  weight: string;
  height: string;
  bmi: string;
  bmi_status: string;
  hfa_status: string;
  nutritional_status: string;
  classification_of_beneficiary: string;
  pregnant: string;
  has_young_children: string;
  dewormed: string;
  parent_consent_milk: string;
  four_ps: string;
  sbfp_previous_years: string;
}

const RECORD_COLUMNS = `
  id, school_id, period, sy, name, sex, grade_level, date_of_birth, date_of_weighing,
  age_years, age_months, weight, height, bmi, bmi_status, hfa_status, nutritional_status,
  classification_of_beneficiary, pregnant, has_young_children, dewormed,
  parent_consent_milk, four_ps, sbfp_previous_years
`;

interface TrashedDbRow extends RecordDbRow {
  deleted_at: string | Date;
  deleted_by: string | null;
}

function toStudent(row: RecordDbRow): Student {
  return {
    id: row.id,
    schoolId: row.school_id,
    period: row.period as Student["period"],
    sy: row.sy,
    name: row.name,
    sex: row.sex as Student["sex"],
    gradeLevel: row.grade_level as Student["gradeLevel"],
    dateOfBirth: row.date_of_birth,
    dateOfWeighing: row.date_of_weighing,
    ageYears: row.age_years,
    ageMonths: row.age_months,
    weight: row.weight,
    height: row.height,
    bmi: row.bmi,
    bmiStatus: row.bmi_status as Student["bmiStatus"],
    hfaStatus: row.hfa_status as Student["hfaStatus"],
    nutritionalStatus: row.nutritional_status,
    classificationOfBeneficiary:
      row.classification_of_beneficiary as Student["classificationOfBeneficiary"],
    pregnant: row.pregnant as Student["pregnant"],
    hasYoungChildren: row.has_young_children as Student["hasYoungChildren"],
    dewormed: row.dewormed as Student["dewormed"],
    parentConsentMilk: row.parent_consent_milk as Student["parentConsentMilk"],
    fourPs: row.four_ps as Student["fourPs"],
    sbfpPreviousYears: row.sbfp_previous_years as Student["sbfpPreviousYears"],
  };
}

function toTrashed(row: TrashedDbRow): TrashedRecord {
  return {
    ...toStudent(row),
    deletedAt: isoOf(row.deleted_at),
    deletedBy: textOf(row.deleted_by),
  };
}

/** Add or update one learner record for `schoolId` (already authorized). */
export async function upsertRecord(
  sql: Sql,
  schoolId: string,
  record: RecordInput,
  encodedBy?: string,
): Promise<void> {
  // The year is the server's, not the browser's: a record typed on the last day
  // of one school year and saved on the first day of the next belongs to the
  // year the district is working in. This also stops an edited form from moving
  // an archived row into the active year.
  const problem = learnerProblem(record);
  if (problem) throw new AccountError("invalid_record", problem);
  // Encoding rule, enforced server-side as well as in the forms: a male learner
  // is recorded as not pregnant. A female learner aged 10 or below defaults to
  // "No" in the form but is not locked, so an explicit "Yes" is preserved here.
  const pregnant = mustNotBePregnant(record.sex) ? "No" : record.pregnant;
  const activeSy = await getActiveSchoolYear(sql);
  await sql`
    insert into sbfp_records (
      id, school_id, period, sy, name, sex, grade_level, date_of_birth, date_of_weighing,
      age_years, age_months, weight, height, bmi, bmi_status, hfa_status, nutritional_status,
      classification_of_beneficiary, pregnant, has_young_children, dewormed,
      parent_consent_milk, four_ps, sbfp_previous_years, encoded_by, created_at, updated_at)
    values (
      ${record.id}, ${schoolId}, ${record.period}, ${activeSy}, ${record.name}, ${record.sex},
      ${record.gradeLevel}, ${record.dateOfBirth}, ${record.dateOfWeighing}, ${record.ageYears},
      ${record.ageMonths}, ${record.weight}, ${record.height}, ${record.bmi},
      ${record.bmiStatus}, ${record.hfaStatus}, ${record.nutritionalStatus},
      ${record.classificationOfBeneficiary}, ${pregnant}, ${record.hasYoungChildren},
      ${record.dewormed}, ${record.parentConsentMilk}, ${record.fourPs},
      ${record.sbfpPreviousYears}, ${encodedBy ?? null}, now(), now()
    )
    on conflict (id) do update set
      period = excluded.period,
      sy = excluded.sy,
      name = excluded.name,
      sex = excluded.sex,
      grade_level = excluded.grade_level,
      date_of_birth = excluded.date_of_birth,
      date_of_weighing = excluded.date_of_weighing,
      age_years = excluded.age_years,
      age_months = excluded.age_months,
      weight = excluded.weight,
      height = excluded.height,
      bmi = excluded.bmi,
      bmi_status = excluded.bmi_status,
      hfa_status = excluded.hfa_status,
      nutritional_status = excluded.nutritional_status,
      classification_of_beneficiary = excluded.classification_of_beneficiary,
      pregnant = excluded.pregnant,
      has_young_children = excluded.has_young_children,
      dewormed = excluded.dewormed,
      parent_consent_milk = excluded.parent_consent_milk,
      four_ps = excluded.four_ps,
      sbfp_previous_years = excluded.sbfp_previous_years,
      updated_at = now()
    where sbfp_records.school_id = excluded.school_id
      and sbfp_records.deleted_at is null
  `;
}

/**
 * The newest past school year in which this school already had a record for the
 * learner, or null. Used by Data Entry to answer "SBFP beneficiary in previous
 * years?" from the archive instead of asking the teacher to remember.
 *
 * The match is the school's own rows only, by name (case and outer-space
 * insensitive) and, when a date of birth is supplied, by that date too — a
 * namesake with a different birthday is not the same learner. Only the year is
 * returned; no past-year row leaves the server.
 */
export async function previousBeneficiaryYear(
  sql: Sql,
  schoolId: string,
  name: string,
  dateOfBirth = "",
): Promise<string | null> {
  const normalized = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!schoolId || normalized.length < 3) return null;
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim()) ? dateOfBirth.trim() : "";
  const activeSy = await getActiveSchoolYear(sql);
  const rows = await sql<{ sy: string }>`
    select sy from sbfp_records
    where school_id = ${schoolId}
      and deleted_at is null
      and sy <> ${activeSy}
      and lower(trim(name)) = lower(${normalized})
      and (${dob} = '' or date_of_birth = ${dob})
    order by sy desc
    limit 1
  `;
  return rows[0]?.sy ?? null;
}

/**
 * Move one learner record to the trash. It stops appearing in the school's
 * lists but is kept (with every measurement) until the next school year starts,
 * when `startNewSchoolYear` empties the trash permanently. Refuses to cross
 * schools: an id belonging to another school updates nothing.
 */
export async function deleteRecord(
  sql: Sql,
  id: string,
  schoolId?: string,
  deletedBy?: string,
): Promise<void> {
  if (schoolId === undefined) {
    await sql`
      update sbfp_records
      set deleted_at = now(), deleted_by = ${deletedBy ?? null}, updated_at = now()
      where id = ${id} and deleted_at is null
    `;
    return;
  }
  await sql`
    update sbfp_records
    set deleted_at = now(), deleted_by = ${deletedBy ?? null}, updated_at = now()
    where id = ${id} and school_id = ${schoolId} and deleted_at is null
  `;
}

/** Put a trashed learner record back in the school's active list. */
export async function restoreRecord(
  sql: Sql,
  id: string,
  schoolId?: string,
): Promise<void> {
  if (schoolId === undefined) {
    await sql`
      update sbfp_records set deleted_at = null, deleted_by = null, updated_at = now()
      where id = ${id} and deleted_at is not null
    `;
    return;
  }
  await sql`
    update sbfp_records set deleted_at = null, deleted_by = null, updated_at = now()
    where id = ${id} and school_id = ${schoolId} and deleted_at is not null
  `;
}

// ── Form 2 manual figures ──────────────────────────────────────────────────────

interface SummaryExtraDbRow {
  school_id: string;
  sy: string;
  period: string;
  grade: string;
  sex: string;
  at_risk: number | string;
  ips: number | string;
}

function toSummaryExtra(row: SummaryExtraDbRow): SummaryExtra {
  return {
    schoolId: row.school_id,
    sy: row.sy,
    period: row.period as SummaryExtra["period"],
    grade: row.grade,
    sex: row.sex === "M" ? "M" : "F",
    atRisk: Number(row.at_risk ?? 0),
    ips: Number(row.ips ?? 0),
  };
}

/**
 * Save the two hand-encoded Form 2 columns for one grade/sex row. The school
 * year is the server's active one, so an edited form cannot write into a closed
 * year. Values are whole non-negative counts, capped so a typo cannot overflow
 * the printed form.
 */
export async function saveSummaryExtra(
  sql: Sql,
  schoolId: string,
  input: { period: string; grade: string; sex: string; atRisk: number; ips: number },
  updatedBy?: string,
): Promise<void> {
  const period = input.period;
  if (period !== "Baseline" && period !== "Midline" && period !== "Endline") {
    throw new AccountError("invalid_record", "Unknown feeding period.");
  }
  const grade = input.grade.trim().slice(0, 80);
  if (!grade) throw new AccountError("invalid_record", "A grade level is required.");
  if (input.sex !== "M" && input.sex !== "F") {
    throw new AccountError("invalid_record", "A grade/sex row is required.");
  }
  const count = (value: number) => {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 9999) {
      throw new AccountError("invalid_record", "These counts must be whole numbers from 0 to 9999.");
    }
    return n;
  };
  const atRisk = count(input.atRisk);
  const ips = count(input.ips);
  const activeSy = await getActiveSchoolYear(sql);
  await sql`
    insert into sbfp_summary_extras
      (school_id, sy, period, grade, sex, at_risk, ips, updated_at, updated_by)
    values (${schoolId}, ${activeSy}, ${period}, ${grade}, ${input.sex}, ${atRisk}, ${ips}, now(), ${updatedBy ?? null})
    on conflict (school_id, sy, period, grade, sex) do update set
      at_risk = excluded.at_risk,
      ips = excluded.ips,
      updated_at = now(),
      updated_by = excluded.updated_by
  `;
}

// ── Feedback ──────────────────────────────────────────────────────────────────

interface FeedbackDbRow {
  id: string;
  school_id: string;
  author: string;
  role: string;
  category: string;
  rating: number | string;
  message: string;
  created_at: string | Date;
  status: string;
  response: string;
  origin: string | null;
}

function toFeedback(row: FeedbackDbRow): SchoolFeedback {
  const response = textOf(row.response);
  return {
    id: row.id,
    schoolId: row.school_id,
    author: row.author,
    role: row.role,
    category: row.category as FeedbackCategory,
    rating: Number(row.rating ?? 0),
    message: row.message,
    createdAt: isoOf(row.created_at).slice(0, 10),
    status: row.status as FeedbackStatus,
    ...(response ? { response } : {}),
    ...(row.origin ? { origin: "School Portal" as const } : {}),
  };
}

export async function insertFeedback(
  sql: Sql,
  schoolId: string,
  entry: Omit<SchoolFeedback, "schoolId">,
  sentBy?: string,
): Promise<void> {
  const activeSy = await getActiveSchoolYear(sql);
  const message = entry.message.trim();
  if (!message) throw new AccountError("invalid_record", "Write a message before sending feedback.");
  const category = FEEDBACK_CATEGORIES.includes(entry.category) ? entry.category : "Other";
  const status = FEEDBACK_STATUSES.includes(entry.status) ? entry.status : "New";
  const ratingNumber = Math.trunc(Number(entry.rating));
  const rating = Number.isFinite(ratingNumber) ? Math.min(5, Math.max(0, ratingNumber)) : 0;
  const author = entry.author.trim().slice(0, 120) || "School";
  const role = entry.role.trim().slice(0, 120);
  const createdAt = /^\d{4}-\d{2}-\d{2}$/.test(entry.createdAt)
    ? entry.createdAt
    : new Date().toISOString().slice(0, 10);
  const response = (entry.response ?? "").trim().slice(0, 4000);
  await sql`
    insert into sbfp_feedback
      (id, school_id, sy, author, role, category, rating, message, created_at, status, response, origin, sent_by, updated_at)
    values (
      ${entry.id}, ${schoolId}, ${activeSy}, ${author}, ${role}, ${category},
      ${rating}, ${message.slice(0, 4000)}, ${createdAt}, ${status},
      ${response}, ${entry.origin ?? null}, ${sentBy ?? null}, now()
    )
    on conflict (id) do nothing
  `;
}

/** The Division Office's side of the loop: acknowledge / resolve and reply. */
export async function updateFeedback(
  sql: Sql,
  id: string,
  patch: { status?: FeedbackStatus; response?: string },
): Promise<void> {
  // `coalesce` keeps whichever half the caller did not send: the feed updates a
  // status on its own, and the reply form writes only the response.
  await sql`
    update sbfp_feedback set
      status = coalesce(${patch.status ?? null}::text, status),
      response = coalesce(${patch.response ?? null}::text, response),
      updated_at = now()
    where id = ${id}
  `;
}

// ── Pull ──────────────────────────────────────────────────────────────────────

/** Everything a signed-in caller may read, in one round trip. */
export interface SbfpPayload {
  /**
   * A cheap signature of everything in this payload's scope. The sites poll it
   * (see `sbfp-live.ts`) and re-read the workspace only when it changes, so a
   * record a school saves shows up on the Division Office screen seconds later.
   */
  version: string;
  /** The school year the console and the portal are working in. */
  activeSy: string;
  /** The division's schools (only her own, for a teacher), with form headers. */
  schools: School[];
  accounts: AccountListRow[];
  records: Student[];
  feedbacks: SchoolFeedback[];
  /** Deleted learner records, kept until the next school year starts. */
  trash: TrashedRecord[];
  /** Form 2's hand-entered at-risk / IP counts for the active year. */
  summaryExtras: SummaryExtra[];
}

/**
 * Read every account and school row the caller may see. The Division Office gets
 * the whole division; a teacher gets her own school and nothing else.
 *
 * Only the ACTIVE school year is returned. Closed years keep their rows in the
 * same tables, stamped with their own `sy`, and are read through
 * `getArchivedYear()` — so a new year starts with an empty console without any
 * row being deleted.
 */
export async function pullData(sql: Sql, access: SbfpAccess): Promise<SbfpPayload> {
  const ids = scopeIds(access);
  const all = access.scope === "all";

  // Every read is independent, so all five go out together. The school year is
  // inlined as a subquery (the same rule as `getActiveSchoolYear`) so the record
  // reads do not have to wait for it first: one pooler round trip instead of
  // four. On Supabase that is most of the page's load time.
  const activeYear = `coalesce(
    (select sy from sbfp_school_years where closed_at is null order by sy desc limit 1),
    (select sy from sbfp_school_years order by sy desc limit 1),
    '${currentSchoolYear()}')`;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const [activeSy, accounts, schools, records, feedbacks, trash, summaryExtras, version] = await Promise.all([
    getActiveSchoolYear(sql),
    listAccounts(sql, all ? {} : { only: ids }),
    listSchools(sql, all ? {} : { only: ids }),
    all
      ? sql.query<RecordDbRow>(
          `select ${RECORD_COLUMNS} from sbfp_records
           where deleted_at is null and sy = ${activeYear} order by created_at desc`,
        )
      : ids.length === 0
        ? Promise.resolve([] as RecordDbRow[])
        : sql.query<RecordDbRow>(
            `select ${RECORD_COLUMNS} from sbfp_records
             where deleted_at is null and school_id in (${placeholders}) and sy = ${activeYear}
             order by created_at desc`,
            ids,
          ),
    all
      ? sql.query<FeedbackDbRow>(
          `select id, school_id, author, role, category, rating, message, created_at, status, response, origin
           from sbfp_feedback where sy = ${activeYear} order by created_at desc`,
        )
      : ids.length === 0
        ? Promise.resolve([] as FeedbackDbRow[])
        : sql.query<FeedbackDbRow>(
            `select id, school_id, author, role, category, rating, message, created_at, status, response, origin
             from sbfp_feedback where school_id in (${placeholders}) and sy = ${activeYear}
             order by created_at desc`,
            ids,
          ),
    all
      ? sql.query<TrashedDbRow>(
          `select ${RECORD_COLUMNS}, deleted_at, deleted_by from sbfp_records
           where deleted_at is not null order by deleted_at desc`,
        )
      : ids.length === 0
        ? Promise.resolve([] as TrashedDbRow[])
        : sql.query<TrashedDbRow>(
            `select ${RECORD_COLUMNS}, deleted_at, deleted_by from sbfp_records
             where deleted_at is not null and school_id in (${placeholders})
             order by deleted_at desc`,
            ids,
          ),
    all
      ? sql.query<SummaryExtraDbRow>(
          `select school_id, sy, period, grade, sex, at_risk, ips
           from sbfp_summary_extras where sy = ${activeYear}`,
        )
      : ids.length === 0
        ? Promise.resolve([] as SummaryExtraDbRow[])
        : sql.query<SummaryExtraDbRow>(
            `select school_id, sy, period, grade, sex, at_risk, ips
             from sbfp_summary_extras
             where school_id in (${placeholders}) and sy = ${activeYear}`,
            ids,
          ),
    dataVersion(sql, access),
  ]);

  return {
    version,
    activeSy,
    schools,
    accounts,
    records: records.map(toStudent),
    feedbacks: feedbacks.map(toFeedback),
    trash: trash.map(toTrashed),
    summaryExtras: summaryExtras.map(toSummaryExtra),
  };
}

/**
 * A single string that changes whenever anything the caller can see changes:
 * a learner record added/edited/removed, feedback sent or answered, an account
 * issued or put on hold, a school added/renamed, a form header saved, or a new
 * school year opened.
 *
 * Counts catch inserts and deletes; `max(updated_at)` catches edits. It is read
 * on every workspace load and by the live-update poll, so it stays one small
 * statement — the whole point is to avoid re-reading every row every few
 * seconds.
 */
export async function dataVersion(sql: Sql, access: SbfpAccess): Promise<string> {
  const ids = scopeIds(access);
  const all = access.scope === "all";
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const year = `(select sy from sbfp_school_years where closed_at is null order by sy desc limit 1)`;
  const scoped =
    all ? "" : ids.length === 0 ? " and false" : ` and school_id in (${placeholders})`;
  const scopedWhere =
    all ? "" : ids.length === 0 ? " where false" : ` where school_id in (${placeholders})`;
  const schoolWhere =
    all ? "" : ids.length === 0 ? " where false" : ` where id in (${placeholders})`;
  // The caller's own account row always counts, even when it is on hold or has
  // no school yet: that row is what decides whether this site opens at all.
  const accountWhere = all
    ? ""
    : ` where ${ids.length === 0 ? "false" : `school_id in (${placeholders})`}
        or lower(email) = $${ids.length + 1}`;
  const params = all ? [] : [...ids, access.email];

  const rows = await sql.query<{ version: string }>(
    `select concat_ws('|',
       (select count(*)::text || ':' || coalesce(max(coalesce(closed_at, started_at))::text, '') from sbfp_school_years),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '')
          from sbfp_records where deleted_at is null and sy = ${year}${scoped}),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '')
          from sbfp_records where deleted_at is not null${scoped}),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '')
          from sbfp_summary_extras where sy = ${year}${scoped}),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '')
          from sbfp_feedback where sy = ${year}${scoped}),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from sbfp_accounts${accountWhere}),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from sbfp_schools${schoolWhere}),
       (select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from sbfp_school_profiles${scopedWhere})
     ) as version`,
    params,
  );
  return rows[0]?.version ?? "";
}

// ── Archived school years ─────────────────────────────────────────────────────

interface ArchivedProfileDbRow {
  school_id: string;
  division: string | null;
  city_municipality_barangay: string | null;
  school_id_number: string | null;
  principal: string | null;
  focal_person: string | null;
  date_start_feeding: string | null;
  last_mile_school: string | null;
}

function toArchivedForm(row: ArchivedProfileDbRow): SchoolFormDetails {
  return {
    division: textOf(row.division) || "Urdaneta City",
    cityMunicipalityBarangay: textOf(row.city_municipality_barangay),
    schoolIdNumber: textOf(row.school_id_number),
    principal: textOf(row.principal),
    focalPerson: textOf(row.focal_person),
    dateStartFeeding: textOf(row.date_start_feeding),
    lastMileSchool: textOf(row.last_mile_school) as SchoolFormDetails["lastMileSchool"],
  };
}

/**
 * One closed (or still active) school year, read-only: its learner records,
 * feedback, Form 2 manual counts and the school information block as it stood
 * when the year closed. The School Years page uses this; writes never do.
 */
export async function getArchivedYear(sql: Sql, sy: string): Promise<ArchivedSchoolYear> {
  const years = await sql<{ sy: string; closed_at: string | Date | null }>`
    select sy, closed_at from sbfp_school_years where sy = ${sy}
  `;
  if (!years[0]) {
    throw new SchoolYearError("year_not_found", "That school year is not in the archive.");
  }
  const active = !years[0].closed_at;

  const [records, feedbacks, profiles, live, summaryExtras] = await Promise.all([
    sql.query<RecordDbRow>(
      `select ${RECORD_COLUMNS} from sbfp_records
       where deleted_at is null and sy = $1 order by created_at desc`,
      [sy],
    ),
    sql.query<FeedbackDbRow>(
      `select id, school_id, author, role, category, rating, message, created_at, status, response, origin
       from sbfp_feedback where sy = $1 order by created_at desc`,
      [sy],
    ),
    sql.query<ArchivedProfileDbRow>(
      "select school_id, division, city_municipality_barangay, school_id_number, principal, focal_person, date_start_feeding, last_mile_school from sbfp_school_profiles_archive where sy = $1",
      [sy],
    ),
    // The active year has no archive snapshot yet (it is taken when the year
    // closes), so its Form 1A/2 exports read the live school information.
    active
      ? sql.query<ArchivedProfileDbRow>(
          "select school_id, division, city_municipality_barangay, school_id_number, principal, focal_person, date_start_feeding, last_mile_school from sbfp_school_profiles",
        )
      : Promise.resolve([] as ArchivedProfileDbRow[]),
    sql.query<SummaryExtraDbRow>(
      `select school_id, sy, period, grade, sex, at_risk, ips
       from sbfp_summary_extras where sy = $1`,
      [sy],
    ),
  ]);

  const profileMap: Record<string, SchoolFormDetails> = {};
  for (const row of live) profileMap[row.school_id] = toArchivedForm(row);
  for (const row of profiles) profileMap[row.school_id] = toArchivedForm(row);

  return {
    sy,
    records: records.map(toStudent),
    feedbacks: feedbacks.map(toFeedback),
    profiles: profileMap,
    summaryExtras: summaryExtras.map(toSummaryExtra),
  };
}
