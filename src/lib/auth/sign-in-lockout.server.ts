import { getSql, type Sql } from "@/lib/db";
import {
  clearTeacherLoginFailures,
  recordTeacherLoginFailure,
  teacherLoginState,
} from "@/lib/sbfp-accounts";
import { assertSameSiteRequest } from "./isolation.server";
import { auth } from "./server";

/**
 * The teacher sign-in gate in front of Better Auth.
 *
 * Better Auth verifies the password, but it does not know about a school
 * account's hold or cooldown. This wrapper checks both before the credential is
 * compared, then records a failed password atomically. Keeping the counter in
 * `sbfp_accounts` (rather than in the per-instance in-memory rate limiter) makes
 * the five-minute/each-further-minute cooldown survive serverless instances.
 *
 * The Division Office account is deliberately outside this policy: only teacher
 * accounts are counted or held here.
 */
export async function handleEmailSignIn(request: Request): Promise<Response> {
  assertSameSiteRequest();

  const body = await request
    .clone()
    .json()
    .catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return auth.handler(request);

  const sql = await getSql();
  await ensureLoginLockSchema(sql);
  const before = await teacherLoginState(sql, email);
  if (before?.held) {
    return refusal(
      423,
      "ACCOUNT_ON_HOLD",
      "This account is on hold. Contact the Division Office to lift the hold.",
    );
  }
  if (before?.retryAfterSeconds) {
    return refusal(
      429,
      "ACCOUNT_LOCKED",
      `Too many wrong passwords. Try again in ${formatRetry(before.retryAfterSeconds)}.`,
      before.retryAfterSeconds,
    );
  }

  const response = await auth.handler(request);

  if (response.status === 401) {
    const after = await recordTeacherLoginFailure(sql, email);
    if (after?.held) {
      return refusal(
        423,
        "ACCOUNT_ON_HOLD",
        "Too many wrong passwords. This account is now on hold. Contact the Division Office to lift the hold.",
      );
    }
    if (after?.retryAfterSeconds) {
      return refusal(
        429,
        "ACCOUNT_LOCKED",
        `Too many wrong passwords. Try again in ${formatRetry(after.retryAfterSeconds)}.`,
        after.retryAfterSeconds,
      );
    }
  } else if (response.ok) {
    // A correct password starts a fresh sequence, even if the previous attempt
    // had already been put on a short cooldown.
    await clearTeacherLoginFailures(sql, email);
  }

  return response;
}

let schemaReady: Promise<void> | null = null;

/**
 * The two columns are also in migration 0010. This lazy guard keeps sign-in
 * working if a deployment's build step could not reach the database and the
 * migration has not run yet; the statements are idempotent and resolve once per
 * serverless instance.
 */
function ensureLoginLockSchema(sql: Sql): Promise<void> {
  schemaReady ??= (async () => {
    await sql`
      alter table sbfp_accounts
        add column if not exists failed_login_count integer not null default 0
    `;
    await sql`
      alter table sbfp_accounts
        add column if not exists lockout_until timestamptz
    `;
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

function refusal(
  status: number,
  code: string,
  message: string,
  retryAfterSeconds = 0,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (retryAfterSeconds > 0) headers.set("Retry-After", String(retryAfterSeconds));
  return new Response(
    JSON.stringify({ status, code, message, retryAfterSeconds }),
    { status, headers },
  );
}

function formatRetry(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest} second${rest === 1 ? "" : "s"}`;
  if (rest === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes}m ${rest}s`;
}
