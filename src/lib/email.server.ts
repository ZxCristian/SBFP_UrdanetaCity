/**
 * Transactional email — the password reset for either account role.
 *
 * The app has no mail server of its own; Resend's HTTP API is called with
 * `fetch`, so nothing is added to the client bundle and no SDK is needed. The
 * API key lives only on the server (`RESEND_API_KEY`). `RESEND_FROM` is the
 * sender — a verified domain in production; Resend's own `onboarding@resend.dev`
 * works out of the box for testing to the account owner's address.
 *
 * A failed send is never thrown at the sign-in screen: the screen deliberately
 * says the same thing whether or not an address holds the account, so it does
 * not reveal which addresses exist. The reason is logged on the server instead.
 *
 * The reset tokens live in Supabase alongside the accounts. This app uses
 * Better Auth with Supabase Postgres, not Supabase Auth, so Supabase's built-in
 * auth emailer cannot send these messages; the existing Resend sender does.
 */
import { getRequestUrl } from "@tanstack/react-start/server";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "SBFP Health Monitor <onboarding@resend.dev>";

/** Whether this deployment can actually send mail. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** A safe http(s) origin from a configured value, or null. */
function configuredOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The link the email carries. `APP_ORIGIN` is the canonical, trusted origin and
 * takes precedence; the platform's `BETTER_AUTH_URL` is next, and only then the
 * request's own origin. Restricting the value to an http(s) origin keeps a
 * malformed env value or a forged Host header from becoming the link's host.
 *
 * The reset token travels in the query string (not a path segment) so each
 * sign-in route can recognise it without a second route just to carry it. The
 * Division Office lands on `/login`; a school account lands on `/` with the same
 * form, in its own theme.
 */
export function buildResetUrl(token: string, role: "admin" | "teacher"): string {
  // A reset link carries a bearer-like token, so its host must come from trusted
  // configuration first: APP_ORIGIN, then the platform's BETTER_AUTH_URL. Only
  // when neither exists (local preview) do we use the request's own origin.
  let origin =
    configuredOrigin(process.env.APP_ORIGIN) ??
    configuredOrigin(process.env.BETTER_AUTH_URL);
  if (!origin) {
    try {
      origin = configuredOrigin(getRequestUrl().origin);
    } catch {
      // Outside a request (tests): fall back to the local preview origin.
      origin = null;
    }
  }
  const safe = origin ?? "http://localhost:8080";
  const path = role === "teacher" ? "/" : "/login";
  return `${safe}${path}?reset=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send the reset link. Returns whether Resend accepted the message; the caller
 * treats `false` as "nothing was sent" but still shows the neutral confirmation
 * (see the note at the top of this file).
 */
export async function sendPasswordResetEmail(args: {
  to: string;
  url: string;
  expiresMinutes: number;
  role: "admin" | "teacher";
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    console.warn(
      "[email] RESEND_API_KEY is not set — password-reset email was not sent. " +
        "Add it in Settings → Environment (and RESEND_FROM for a verified sender).",
    );
    return false;
  }

  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
  const to = args.to.trim();
  const url = args.url;
  const minutes = args.expiresMinutes;
  const safeUrl = escapeHtml(url);
  const safeTo = escapeHtml(to);
  const isTeacher = args.role === "teacher";
  const product = isTeacher ? "SBFP School Portal" : "SBFP Division Console";
  const account = isTeacher ? "School Portal account" : "Division Office account";
  const subject = isTeacher
    ? "Reset your SBFP School Portal password"
    : "Reset your SBFP Division Console password";

  const text = [
    `${product} — password reset`,
    "",
    `A new password was requested for the ${account} (${to}).`,
    `Open this link to choose one. It works once and expires in ${minutes} minutes:`,
    "",
    url,
    "",
    "If you did not ask for this, ignore this email — your password has not changed.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#080808;">
    <div style="padding:32px 16px;background:#080808;font-family:'Outfit',Helvetica,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#111111;border:1px solid #232323;border-radius:14px;padding:28px 26px;color:#e2e2e2;">
        <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#00ff87;font-weight:700;">
          ${product}
        </div>
        <h1 style="margin:14px 0 0;font-size:22px;line-height:1.25;font-weight:600;color:#e2e2e2;">
          Reset your password
        </h1>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:#9a9a9a;">
          A new password was requested for the ${account}
          <strong style="color:#e2e2e2;">${safeTo}</strong>.
        </p>
        <p style="margin:18px 0 22px;">
          <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;border-radius:9px;background:#00ff87;color:#04120a;font-size:14px;font-weight:600;text-decoration:none;">
            Choose a new password
          </a>
        </p>
        <p style="margin:0 0 6px;font-size:12.5px;line-height:1.6;color:#9a9a9a;">
          The link works once and expires in ${minutes} minutes. If the button does not work,
          paste this address into your browser:
        </p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#7f7f7f;word-break:break-all;">${safeUrl}</p>
        <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #232323;font-size:12px;line-height:1.6;color:#6a6a6a;">
          If you did not ask for this, ignore this email — your password has not changed.
        </p>
      </div>
    </div>
  </body>
</html>`;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[email] Resend refused the reset email (${response.status}): ${detail.slice(0, 300)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] could not reach Resend", err);
    return false;
  }
}
