/**
 * Transactional email — the password reset for either account role.
 *
 * The app has no mail server of its own; Mailjet's Send API v3.1 is called with
 * `fetch`, so nothing is added to the client bundle and no SDK is needed. The
 * API key and secret live only on the server (`MAILJET_API_KEY` and
 * `MAILJET_SECRET_KEY`, or Mailjet's own `MJ_APIKEY_PUBLIC` and
 * `MJ_APIKEY_PRIVATE`). `MAILJET_FROM` is a sender verified in Mailjet, either
 * `name@example.com` or `Display Name <name@example.com>`;
 * `MAILJET_FROM_NAME` can supply the display name when only an address is set.
 *
 * A failed send is never thrown at the sign-in screen: the screen deliberately
 * says the same thing whether or not an address holds the account, so it does
 * not reveal which addresses exist. The reason is logged on the server and the
 * safe part (not configured / provider refused / network) is returned to the
 * Division Office's recovery form, which must not claim an email was sent when
 * it was not.
 *
 * The reset tokens live in Postgres alongside the accounts. This app uses
 * Better Auth with Supabase Postgres, not Supabase Auth, so Supabase's built-in
 * auth emailer cannot send these messages; this Mailjet sender does.
 */
import { getRequestUrl } from "@tanstack/react-start/server";

const MAILJET_ENDPOINT = "https://api.mailjet.com/v3.1/send";

interface MailjetCredentials {
  key: string;
  secret: string;
}

interface MailjetSender {
  email: string;
  name?: string;
}

/** The API pair, or null when either half has not been configured. */
function mailjetCredentials(): MailjetCredentials | null {
  const key = process.env.MAILJET_API_KEY?.trim();
  const secret = process.env.MAILJET_SECRET_KEY?.trim();
  if (key && secret) return { key, secret };
  // Mailjet's documentation uses these names, so accept a copy/paste of them.
  const publicKey = process.env.MJ_APIKEY_PUBLIC?.trim();
  const privateKey = process.env.MJ_APIKEY_PRIVATE?.trim();
  if (publicKey && privateKey) return { key: publicKey, secret: privateKey };
  return null;
}

/** Read the verified sender, accepting `Name <email>` or a bare address. */
function mailjetSender(): MailjetSender | null {
  const raw = process.env.MAILJET_FROM?.trim();
  if (!raw) return null;
  const angled = raw.match(/^(.*?)\s*<([^<>]+)>$/);
  const email = (angled?.[2] ?? raw).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  const inlineName = (angled?.[1] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  const name = inlineName || process.env.MAILJET_FROM_NAME?.trim() || "";
  return name ? { email, name } : { email };
}

/** Whether this deployment can actually send mail. */
export function emailConfigured(): boolean {
  return Boolean(mailjetCredentials() && mailjetSender());
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

/** Why a recovery message did not go out. Safe to return to the sign-in screen. */
export type EmailFailureReason = "not_configured" | "provider_rejected" | "network_error";

/** The result of one send attempt. */
export interface EmailDelivery {
  delivered: boolean;
  reason?: EmailFailureReason;
}

/**
 * Send the reset link. The caller shows the neutral confirmation for "no such
 * account" but must not claim the message is on its way when delivery failed;
 * the reason lets the sign-in screen tell the Division Office what to fix.
 */
export async function sendPasswordResetEmail(args: {
  to: string;
  url: string;
  expiresMinutes: number;
  role: "admin" | "teacher";
}): Promise<EmailDelivery> {
  const credentials = mailjetCredentials();
  const sender = mailjetSender();
  if (!credentials || !sender) {
    console.warn(
      "[email] Mailjet credentials are not complete — password-reset email was not sent. " +
        "Set MAILJET_API_KEY, MAILJET_SECRET_KEY, and MAILJET_FROM in Settings → Environment.",
    );
    return { delivered: false, reason: "not_configured" };
  }

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
    `${product} — account recovery`,
    "",
    `An account recovery link was requested for the ${account} (${to}).`,
    `Open this link to choose a new password. It works once and expires in ${minutes} minutes:`,
    "",
    url,
    "",
    "If you did not request account recovery, ignore this email — your password has not changed.",
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
          An account recovery link was requested for the ${account}
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
          If you did not request account recovery, ignore this email — your password has not changed.
        </p>
      </div>
    </div>
  </body>
</html>`;

  try {
    const response = await fetch(MAILJET_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${credentials.key}:${credentials.secret}`)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        SandboxMode: false,
        Messages: [
          {
            From: {
              Email: sender.email,
              ...(sender.name ? { Name: sender.name } : {}),
            },
            To: [{ Email: to }],
            Subject: subject,
            TextPart: text,
            HTMLPart: html,
          },
        ],
      }),
    });
    const detail = await response.text().catch(() => "");
    if (!response.ok) {
      console.error(
        `[email] Mailjet refused the reset email (${response.status}) from "${sender.email}": ${detail.slice(0, 300)}`,
      );
      return { delivered: false, reason: "provider_rejected" };
    }

    // A 2xx only means Mailjet accepted the request. The per-message Status says
    // whether it actually accepted this message for delivery.
    let result: { Messages?: Array<{ Status?: string }> } | null = null;
    try {
      result = JSON.parse(detail) as { Messages?: Array<{ Status?: string }> };
    } catch {
      console.error(`[email] Mailjet returned an unreadable success body: ${detail.slice(0, 300)}`);
    }
    const message = result?.Messages?.[0];
    if (message?.Status !== "success") {
      console.error(`[email] Mailjet did not accept the reset email: ${detail.slice(0, 300)}`);
      return { delivered: false, reason: "provider_rejected" };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[email] could not reach Mailjet", err);
    return { delivered: false, reason: "network_error" };
  }
}
