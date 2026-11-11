/**
 * The app's server functions — the only way the browser talks to the database.
 *
 * Two things matter in this file, and nothing else does:
 *
 *  1. **The caller's identity is verified here.** `authMiddleware` resolves the
 *     same-origin session (cookie when deployed, bearer token in the live
 *     preview) and throws `UnauthorizedError` when nobody is signed in. The
 *     session email is then matched against `sbfp_accounts` to decide the role.
 *     No client-supplied id, email or role is ever trusted.
 *  2. **The caller's school is decided here, not sent by the browser.** A teacher
 *     call carries no usable `schoolId` — hers is read from her own account row,
 *     so an altered request cannot reach another school's learners. The Division
 *     Office may name any school, because its account is checked to be the
 *     Division Office.
 *
 * Endpoints the Division Office fills in answer with a **result** rather than an
 * exception (`{ ok: false, code, message }`), because "that school already has an
 * account" is a normal answer to show in the form, not a crash. Genuine bugs
 * still throw.
 *
 * Server-only modules (`@/lib/db`, the accounts service, `verify.server`) are
 * imported **inside** the handlers, so none of them reach the browser bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { FeedbackStatus, SchoolFormDetails, Student } from "@/lib/sbfp-shared";

/** The `context` shape `authMiddleware` hands a handler, plus the preview token. */
interface AuthedContext {
  userId: string;
  /** The verified session email, put on the context by `authMiddleware`. */
  userEmail?: string | null;
  bearerToken?: string;
}

/** A refusal the UI explains. `code` is `AccountErrorCode` from the service. */
export interface ApiFailure {
  ok: false;
  code: string;
  message: string;
}

export type ApiResult<T> = (T & { ok: true }) | ApiFailure;

/**
 * Run a checked operation, turning a service refusal into a return value.
 * Account operations and school-year operations both refuse with a stable
 * `code` + message the UI can explain.
 */
async function settle<T>(run: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (err) {
    const { AccountError } = await import("./sbfp-accounts");
    const { SchoolYearError } = await import("./sbfp-years");
    const { SchoolError } = await import("./sbfp-schools");
    if (
      err instanceof AccountError ||
      err instanceof SchoolYearError ||
      err instanceof SchoolError
    ) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}

/**
 * Refuse a cross-site scripted request on an endpoint that has no session to
 * protect it (first-run setup and the password-reset pair). `authMiddleware`
 * applies the same guard to every signed-in endpoint; without it here, a
 * malicious page could POST a first-run admin into a deployment that has not
 * claimed its account yet. Non-browser callers and same-origin calls pass.
 */
async function requireSameSiteRequest(): Promise<void> {
  const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
  assertSameSiteRequest();
}

/**
 * The verified session email, or null. `null` means nobody is signed in — a
 * caller with a session but no email cannot hold an account.
 */
async function sessionEmail(context: unknown): Promise<string | null> {
  const ctx = (context ?? {}) as AuthedContext;
  // `authMiddleware` already resolved the session and passed the email along —
  // reading it again here cost a second session query on every page load.
  if (ctx.userEmail !== undefined) return ctx.userEmail;
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const user = await getSessionUser(ctx.bearerToken);
  return user?.email ?? null;
}

/**
 * The caller's access, or a refusal. Built from the verified session email only
 * (see `resolveAccess`); an account on hold resolves but can do nothing.
 */
async function requireAccess(email: string | null) {
  const { resolveAccess, AccountError } = await import("./sbfp-accounts");
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const access = email ? await resolveAccess(sql, email) : null;
  if (!access) {
    throw new AccountError(
      "forbidden",
      "No SBFP account has been issued for your email address.",
    );
  }
  if (access.account.status !== "active") {
    throw new AccountError(
      "forbidden",
      "This account is on hold. Please contact the Division Office.",
    );
  }
  return { sql, access };
}

/** The same, for the operations only the Division Office may perform. */
async function requireAdmin(email: string | null) {
  const { sql, access } = await requireAccess(email);
  const { AccountError } = await import("./sbfp-accounts");
  if (access.account.role !== "admin") {
    throw new AccountError(
      "forbidden",
      "Only the Division Office account can issue or change accounts.",
    );
  }
  return { sql, access };
}

/**
 * Everything a signed-in visitor needs to know about themselves: their account
 * (role, school, status) and whether the Division Office account exists yet.
 *
 * Never throws for an account-less visitor — the sign-in screens are built on
 * this, and "signed in but not issued an account yet" is a normal state.
 */
export const fetchAccountState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const email = await sessionEmail(context);
    const { getSql } = await import("@/lib/db");
    const { findAccountByEmail, hasAdminAccount } = await import("./sbfp-accounts");
    const sql = await getSql();
    const [account, hasAdmin] = await Promise.all([
      email ? findAccountByEmail(sql, email) : Promise.resolve(null),
      hasAdminAccount(sql),
    ]);
    return { email, account, hasAdmin };
  });

/**
 * The whole workspace for the caller: her account, plus the accounts, learner
 * records and feedback she may read. The Division Office gets the division; a
 * teacher gets her own school; an account on hold gets nothing.
 */
export const fetchWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const email = await sessionEmail(context);
    const { getSql } = await import("@/lib/db");
    const { resolveAccess, pullData } = await import("./sbfp-accounts");
    const sql = await getSql();
    const access = email ? await resolveAccess(sql, email) : null;
    if (!access) {
      const { getActiveSchoolYear } = await import("./sbfp-years");
      return {
        email,
        account: null,
        version: "",
        schools: [],
        accounts: [],
        records: [],
        feedbacks: [],
        trash: [],
        summaryExtras: [],
        activeSy: await getActiveSchoolYear(sql),
      };
    }
    const payload = await pullData(sql, access);
    return { email, account: access.account, ...payload };
  });

/**
 * Just the change signature for the caller's data — the live-update poll.
 *
 * This is deliberately tiny: a few counts and newest timestamps, no rows. The
 * sites call it every few seconds while the tab is visible and re-read the
 * workspace only when it differs from the version they already have.
 */
export const fetchDataVersion = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const email = await sessionEmail(context);
    const { getSql } = await import("@/lib/db");
    const { resolveAccess, dataVersion } = await import("./sbfp-accounts");
    const sql = await getSql();
    const access = email ? await resolveAccess(sql, email) : null;
    if (!access) return { version: "" };
    return { version: await dataVersion(sql, access) };
  });

export interface PreviousBeneficiaryInput {
  /** The Division Office may name a school; a teacher's own school is used. */
  schoolId?: string;
  name: string;
  dateOfBirth?: string;
}

/**
 * Did this learner already have a record in a past school year at this school?
 *
 * Data Entry asks this a moment after the name (and date of birth) are typed,
 * so "SBFP beneficiary in previous years?" can be answered from the archive.
 * Returns only the school year — never a past-year row — and is scoped exactly
 * like every other read: a teacher asks about her own school, the Division
 * Office about the school it selected.
 */
export const lookupPreviousBeneficiary = createServerFn({ method: "POST" })
  .validator((input: PreviousBeneficiaryInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const requested = typeof data.schoolId === "string" ? data.schoolId : "";
    const schoolId = access.scope === "all" ? requested : (access.scope[0] ?? "");
    const name = typeof data.name === "string" ? data.name : "";
    const dateOfBirth = typeof data.dateOfBirth === "string" ? data.dateOfBirth : "";
    if (!schoolId || name.trim().length < 3) return { sy: null as string | null };
    const { previousBeneficiaryYear } = await import("./sbfp-accounts");
    return { sy: await previousBeneficiaryYear(sql, schoolId, name, dateOfBirth) };
  });

// ── School years ──────────────────────────────────────────────────────────────

/** Every school year with its totals — the School Years page (Division Office only). */
export const fetchSchoolYears = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await requireAdmin(await sessionEmail(context));
    const { listSchoolYears } = await import("./sbfp-years");
    return { years: await listSchoolYears(sql) };
  });

/** One archived year's learners, feedback and form headers, read-only. */
export const fetchSchoolYearArchive = createServerFn({ method: "POST" })
  .validator((input: { sy: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { getArchivedYear } = await import("./sbfp-accounts");
      return { archive: await getArchivedYear(sql, data.sy) };
    }),
  );

/** Close the current year and open the next one (Division Office only). */
export const startSchoolYear = createServerFn({ method: "POST" })
  .validator((input: { sy: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { startNewSchoolYear } = await import("./sbfp-years");
      return startNewSchoolYear(sql, data.sy);
    }),
  );

/**
 * Does the Division Office account exist yet? (Asked by the sign-in screen.)
 *
 * Read-only. The console's first-run card is the only way to create that
 * account: there is deliberately no seeded login, because a password written in
 * the source is a published password, and this account can read every school's
 * learner records.
 */
export const fetchBootstrapState = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getSql } = await import("@/lib/db");
    const { hasAdminAccount, countAdmins } = await import("./sbfp-accounts");
    const sql = await getSql();
    return { hasAdmin: await hasAdminAccount(sql), admins: await countAdmins(sql) };
  },
);

export interface AdminBootstrapInput {
  fullName: string;
  email: string;
  password: string;
}

/**
 * First-run setup: create the Division Office account. Refused the moment one
 * exists, so it is a one-time door and not a back way in.
 */
export const bootstrapAdminAccount = createServerFn({ method: "POST" })
  .validator((input: AdminBootstrapInput) => input)
  .handler(async ({ data }) =>
    settle(async () => {
      await requireSameSiteRequest();
      const { getSql } = await import("@/lib/db");
      const { createAccount, hasAdminAccount, AccountError } = await import(
        "./sbfp-accounts"
      );
      const sql = await getSql();
      if (await hasAdminAccount(sql)) {
        throw new AccountError(
          "forbidden",
          "The Division Office account already exists. Sign in with it.",
        );
      }
      const account = await createAccount(sql, {
        email: data.email,
        password: data.password,
        role: "admin",
        fullName: data.fullName,
        tempPassword: false,
      });
      return { account };
    }),
  );

export interface ClaimAdminInput {
  fullName: string;
}

/**
 * First-run setup for a visitor who is already signed in: behind the Grok gate
 * that identity was verified by the platform, so no password is typed. Makes the
 * signed-in email the Division Office account.
 */
export const claimAdminAccount = createServerFn({ method: "POST" })
  .validator((input: ClaimAdminInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const email = await sessionEmail(context);
      const { isValidEmail } = await import("./sbfp-credentials");
      const { AccountError } = await import("./sbfp-accounts");
      if (!email || !isValidEmail(email)) {
        throw new AccountError(
          "invalid_email",
          "Your session has no email address, so an account cannot be issued for it.",
        );
      }
      const { getSql } = await import("@/lib/db");
      const { claimAdminAccountForEmail } = await import("./sbfp-accounts");
      const sql = await getSql();
      const account = await claimAdminAccountForEmail(sql, email, data.fullName);
      return { account };
    }),
  );

export interface NewTeacherAccountInput {
  email: string;
  password: string;
  fullName: string;
  position: string;
  contact: string;
  schoolId: string;
}

/** Issue a School Portal account for one school (Division Office only). */
export const createTeacherAccount = createServerFn({ method: "POST" })
  .validator((input: NewTeacherAccountInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { createAccount } = await import("./sbfp-accounts");
      const account = await createAccount(sql, {
        email: data.email,
        password: data.password,
        role: "teacher",
        fullName: data.fullName,
        position: data.position,
        contact: data.contact,
        schoolId: data.schoolId,
      });
      return { account };
    }),
  );

export interface TeacherAccountPatch {
  email: string;
  fullName?: string;
  position?: string;
  contact?: string;
  schoolId?: string | null;
  status?: "active" | "disabled";
}

/** Edit an issued account: who holds it, which school, on hold or live. */
export const updateTeacherAccount = createServerFn({ method: "POST" })
  .validator((input: TeacherAccountPatch) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { updateAccount } = await import("./sbfp-accounts");
      const { email: target, ...patch } = data;
      const account = await updateAccount(sql, target, patch);
      return { account };
    }),
  );

export interface ResetPasswordInput {
  email: string;
  password: string;
}

/** Hand a school a fresh temporary password (Division Office only). */
export const resetAccountPassword = createServerFn({ method: "POST" })
  .validator((input: ResetPasswordInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { resetPassword } = await import("./sbfp-accounts");
      const account = await resetPassword(sql, data.email, data.password);
      return { account };
    }),
  );

export interface ChangePasswordInput {
  currentPassword?: string;
  newPassword: string;
}

export interface OwnTeacherDetailsInput {
  fullName?: string;
  position?: string;
  contact?: string;
}

/** A teacher updates the name and contact details printed on her school's forms. */
export const saveOwnTeacherDetails = createServerFn({ method: "POST" })
  .validator((input: OwnTeacherDetailsInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { updateOwnTeacherDetails, AccountError } = await import("./sbfp-accounts");
    if (access.account.role !== "teacher") {
      throw new AccountError("forbidden", "Only a School Portal account can edit these details.");
    }
    const account = await updateOwnTeacherDetails(sql, access.email, data);
    return { account };
  });

/**
 * The signed-in account changes its own password — the teacher replacing the
 * temporary one she was handed.
 *
 * The current password is proved only once the holder has settled on one of her
 * own. An account still carrying the temporary password the Division Office
 * handed over is not asked for it — that hand-over is exactly when she is meant
 * to choose her own, and the portal does not even offer the field — and one that
 * only ever arrived through the Grok gate has no password at all, so the
 * session itself is the proof.
 *
 * This rule has to match the portal's `needsCurrent` exactly. Requiring proof
 * whenever *any* password exists reads correctly but locks every teacher out of
 * the one action she is told to take: her temporary password is a password, so
 * the change was refused with "your current password is not correct" and she
 * could never set one of her own.
 */
export const changeOwnPassword = createServerFn({ method: "POST" })
  .validator((input: ChangePasswordInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const email = await sessionEmail(context);
      const { getSql } = await import("@/lib/db");
      const {
        changeOwnPassword: apply,
        credentialState,
        findAccountByEmail,
        needsCurrentPassword,
        AccountError,
      } = await import("./sbfp-accounts");
      if (!email) throw new AccountError("forbidden", "You are not signed in.");
      const sql = await getSql();
      const [credential, account] = await Promise.all([
        credentialState(sql, email),
        findAccountByEmail(sql, email),
      ]);
      if (!credential) {
        throw new AccountError("not_found", "That account no longer exists.");
      }
      if (
        needsCurrentPassword({
          hasPassword: credential.hasPassword,
          tempPassword: account?.tempPassword === true,
        })
      ) {
        const { verifyPassword } = await import("better-auth/crypto");
        const ok =
          data.currentPassword !== undefined &&
          (await verifyPassword({ hash: credential.hash, password: data.currentPassword }));
        if (!ok) {
          throw new AccountError("forbidden", "Your current password is not correct.");
        }
      }
      await apply(sql, email, data.newPassword);
      return {};
    }),
  );

// ── Emailed password reset ────────────────────────────────────────────────────

export interface RequestResetInput {
  email: string;
}

/**
 * Ask for a reset link to be emailed to an active SBFP account — either the
 * Division Office or a School Portal account.
 *
 * Deliberately open (no session): the person using it cannot sign in. The answer
 * is the same whether or not the address holds an account — the sign-in screen
 * shows a neutral "if that address holds the account…" confirmation either way,
 * so this cannot be used to find out which addresses exist.
 *
 * A delivery failure is different: the Division Office must be told that no
 * message went out, and why, instead of seeing a false "on its way" confirmation.
 * `reason` is limited to safe transport states; it never reveals whether the
 * address exists.
 *
 * `previewUrl` exists only on the in-memory preview database, where no mail
 * credentials are configured: it lets the flow be completed while building the
 * app. A deployed database never returns it.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: RequestResetInput) => input)
  .handler(async ({ data }) => {
    await requireSameSiteRequest();
    const { getSql, dbSource } = await import("@/lib/db");
    const { createPasswordReset, RESET_LINK_MINUTES } = await import("./sbfp-accounts");
    const { buildResetUrl, emailConfigured, sendPasswordResetEmail } = await import(
      "./email.server"
    );
    const configured = emailConfigured();
    // There is no point minting a token that cannot be delivered. The one
    // exception is the in-memory preview database, where the reset link can be
    // opened from the screen itself while the app is being built. It also keeps
    // a deployment without mail credentials from failing on the account query
    // and leaving the Division Office with a vague "try again" message.
    if (!configured && dbSource !== "pglite") {
      return {
        ok: true as const,
        configured: false,
        delivered: false,
        reason: "not_configured" as const,
        previewUrl: null,
      };
    }

    const sql = await getSql();
    let reset: Awaited<ReturnType<typeof createPasswordReset>>;
    try {
      reset = await createPasswordReset(sql, data.email);
    } catch (err) {
      console.error("[recovery] could not read the account store", err);
      return {
        ok: true as const,
        configured,
        delivered: false,
        reason: "unavailable" as const,
        previewUrl: null,
      };
    }

    if (!reset) {
      // No account, or the one-per-minute throttle. Keep the answer neutral.
      return {
        ok: true as const,
        configured,
        delivered: false,
        reason: configured ? null : ("not_configured" as const),
        previewUrl: null,
      };
    }

    const url = buildResetUrl(reset.token, reset.role);
    const delivery = await sendPasswordResetEmail({
      to: reset.email,
      url,
      expiresMinutes: RESET_LINK_MINUTES,
      role: reset.role,
    });
    const previewUrl = dbSource === "pglite" ? url : null;
    return {
      ok: true as const,
      configured,
      delivered: delivery.delivered,
      reason: delivery.reason ?? null,
      previewUrl,
    };
  });

export interface ResetPasswordWithTokenInput {
  token: string;
  password: string;
}

/**
 * Set a new password from the emailed token. Also open: the token itself is the
 * proof. It is single-use and expires (see `resetPasswordWithToken`). Works for
 * either role; the result says which sign-in page to return to.
 */
export const resetPasswordWithToken = createServerFn({ method: "POST" })
  .validator((input: ResetPasswordWithTokenInput) => input)
  .handler(async ({ data }) =>
    settle(async () => {
      await requireSameSiteRequest();
      const { getSql } = await import("@/lib/db");
      const { resetPasswordWithToken: applyPasswordReset } = await import("./sbfp-accounts");
      const sql = await getSql();
      const account = await applyPasswordReset(sql, data.token, data.password);
      return { email: account.email, role: account.role };
    }),
  );

/** Remove an account. The school keeps its form header, learners and feedback. */
export const removeTeacherAccount = createServerFn({ method: "POST" })
  .validator((input: { email: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { deleteAccount } = await import("./sbfp-accounts");
      await deleteAccount(sql, data.email);
      return {};
    }),
  );

// ── The division's schools (Division Office only) ─────────────────────────────

export interface NewSchoolInput {
  name: string;
  type: "Elementary" | "High School";
}

/** Add a school to the division's list. */
export const createSchoolEntry = createServerFn({ method: "POST" })
  .validator((input: NewSchoolInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { createSchool } = await import("./sbfp-schools");
      return { school: await createSchool(sql, data) };
    }),
  );

export interface SchoolPatchInput {
  id: string;
  name?: string;
  type?: "Elementary" | "High School";
}

/** Rename a school, or move it between the elementary and high-school lists. */
export const updateSchoolEntry = createServerFn({ method: "POST" })
  .validator((input: SchoolPatchInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { updateSchool } = await import("./sbfp-schools");
      const { id, ...patch } = data;
      return { school: await updateSchool(sql, id, patch) };
    }),
  );

/**
 * Remove a school. Refused while it still holds an account, learners or
 * feedback — those rows are keyed by the school's id and are never deleted by a
 * list edit.
 */
export const removeSchoolEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) =>
    settle(async () => {
      const { sql } = await requireAdmin(await sessionEmail(context));
      const { deleteSchool } = await import("./sbfp-schools");
      await deleteSchool(sql, data.id);
      return {};
    }),
  );

// ── School data (either side of the app) ──────────────────────────────────────

/** Save the school information block printed on the SBFP forms. */
export const saveSchoolHeader = createServerFn({ method: "POST" })
  .validator((input: { schoolId: string; patch: Partial<SchoolFormDetails> }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { saveSchoolProfile, AccountError } = await import("./sbfp-accounts");
    // A teacher's school comes from her account, never from the request.
    const schoolId = access.scope === "all" ? data.schoolId : (access.scope[0] ?? "");
    if (!schoolId) throw new AccountError("not_found", "No school is set for this account.");
    await saveSchoolProfile(sql, schoolId, data.patch, access.email);
    return { ok: true as const };
  });

export interface LearnerRecordInput {
  schoolId?: string;
  /** Shaped like the form's `Student`; re-checked at runtime below. */
  record: Student;
}

/** Add or update one learner record. */
export const saveLearnerRecord = createServerFn({ method: "POST" })
  .validator((input: LearnerRecordInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { upsertRecord, assertCanWriteRecord, AccountError } = await import(
      "./sbfp-accounts"
    );
    const record = data.record as unknown as { id?: unknown } | null;
    if (typeof record?.id !== "string" || !record.id) {
      throw new AccountError("not_found", "That learner record has no id.");
    }
    const schoolId = access.scope === "all" ? (data.schoolId ?? "") : (access.scope[0] ?? "");
    if (!schoolId) throw new AccountError("not_found", "No school is set for this account.");
    // An edit of an existing row is checked against the row's own school, so a
    // teacher cannot rewrite another school's record by reusing its id.
    await assertCanWriteRecord(sql, access, record.id);
    await upsertRecord(sql, schoolId, data.record, access.email);
    return { ok: true as const };
  });

/** Delete one learner record the caller may write. */
export const removeLearnerRecord = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { deleteRecord, AccountError } = await import("./sbfp-accounts");
    if (access.scope === "all") {
      await deleteRecord(sql, data.id, undefined, access.email);
    } else {
      const schoolId = access.scope[0];
      if (!schoolId) throw new AccountError("forbidden", "No school is set for this account.");
      await deleteRecord(sql, data.id, schoolId, access.email);
    }
    return { ok: true as const };
  });

/** Put a trashed learner record back on the active list. */
export const restoreLearnerRecord = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { restoreRecord, AccountError } = await import("./sbfp-accounts");
    if (access.scope === "all") {
      await restoreRecord(sql, data.id);
    } else {
      const schoolId = access.scope[0];
      if (!schoolId) throw new AccountError("forbidden", "No school is set for this account.");
      await restoreRecord(sql, data.id, schoolId);
    }
    return { ok: true as const };
  });

export interface SummaryExtraInput {
  schoolId?: string;
  period: string;
  grade: string;
  sex: string;
  atRisk: number;
  ips: number;
}

/** Save the two hand-encoded Form 2 columns for one grade/sex row. */
export const saveSummaryExtra = createServerFn({ method: "POST" })
  .validator((input: SummaryExtraInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { saveSummaryExtra: write, AccountError } = await import("./sbfp-accounts");
    const schoolId = access.scope === "all" ? (data.schoolId ?? "") : (access.scope[0] ?? "");
    if (!schoolId) throw new AccountError("not_found", "No school is set for this account.");
    await write(sql, schoolId, data, access.email);
    return { ok: true as const };
  });

export interface FeedbackInput {
  schoolId?: string;
  entry: {
    id: string;
    author: string;
    role: string;
    category: string;
    rating: number;
    message: string;
    createdAt: string;
    status?: FeedbackStatus;
    response?: string;
    origin?: "School Portal";
  };
}

/** Send feedback up from a school. */
export const sendSchoolFeedback = createServerFn({ method: "POST" })
  .validator((input: FeedbackInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql, access } = await requireAccess(await sessionEmail(context));
    const { insertFeedback, AccountError } = await import("./sbfp-accounts");
    const schoolId = access.scope === "all" ? (data.schoolId ?? "") : (access.scope[0] ?? "");
    if (!schoolId) throw new AccountError("not_found", "No school is set for this account.");
    // A school sends feedback up as "New" and as its own account holder. Only
    // the Division Office records entries on a school's behalf — and can set a
    // status or a reply as it does so.
    const entry = access.scope === "all"
      ? data.entry
      : {
          ...data.entry,
          author: access.account.fullName || access.account.email,
          role: access.account.position || "SBFP Feeding Focal Person",
          status: "New" as const,
          response: undefined,
          origin: "School Portal" as const,
        };
    await insertFeedback(sql, schoolId, entry as never, access.email);
    return { ok: true as const };
  });

export interface FeedbackReplyInput {
  id: string;
  status?: FeedbackStatus;
  response?: string;
}

/** Acknowledge, resolve, or reply — the Division Office's side of the loop. */
export const replyToFeedback = createServerFn({ method: "POST" })
  .validator((input: FeedbackReplyInput) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { sql } = await requireAdmin(await sessionEmail(context));
    const { updateFeedback } = await import("./sbfp-accounts");
    await updateFeedback(sql, data.id, { status: data.status, response: data.response });
    return { ok: true as const };
  });
