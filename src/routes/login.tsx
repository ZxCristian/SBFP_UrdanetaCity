/**
 * The Division Office's sign-in page — `/login`.
 *
 * This is the door to the district console (`/Admin`). The Division Office account is
 * the one account the Division Office itself holds, and it is the only account
 * that can issue School Portal accounts, so the page has two faces:
 *
 *  - **No account exists yet** → first-time setup. Two ways in: make the email of
 *    the session you already have the Division Office (that is the case behind
 *    the Grok gate, where the platform has already verified who you are, so no
 *    password is typed), or create it with an email and a password.
 *  - **An account exists** → sign in with the email and password of that account.
 *
 * School personnel who land here are pointed at the School Portal instead of
 * being left on a form they cannot use.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { signInErrorMessage } from "@/lib/auth/sign-in-error";
import { useAccess } from "@/lib/use-access";
import {
  bootstrapAdminAccount,
  claimAdminAccount,
  fetchBootstrapState,
  requestPasswordReset,
  resetPasswordWithToken,
} from "@/lib/sbfp-api";
import { useStripCredentialQuery } from "@/lib/credential-url";
import { MIN_PASSWORD_LENGTH } from "@/lib/sbfp-credentials";
import { syncWorkspace } from "@/lib/sbfp-store";

/**
 * `?reset=<token>` is the address the password-reset email carries. It is read
 * here so the page can turn the same route into "choose a new password" without
 * a second route (and without losing the console's look).
 */
export interface LoginSearch {
  reset?: string;
}

export const Route = createFileRoute("/login")({
  component: AdminLogin,
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.reset === "string" && search.reset ? { reset: search.reset } : {},
});

// ── Look: the console's own dark, phosphor-green shell ────────────────────────
const T = {
  bg: "#080808",
  surface: "#111111",
  surface2: "#161616",
  border: "#232323",
  text: "#e2e2e2",
  sub: "#9a9a9a",
  dim: "#6a6a6a",
  accent: "#00ff87",
  accentSoft: "#00ff8720",
  danger: "#ff6b6b",
  gold: "#ffdd4b",
};

const font = "'Outfit', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: T.dim,
  marginBottom: 6,
  fontWeight: 600,
};

const card: CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 20,
};

function Field({ text, hint, children }: { text: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={fieldLabel}>{text}</span>
      {children}
      {hint && (
        <span style={{ display: "block", fontSize: 11, color: T.dim, marginTop: 5 }}>{hint}</span>
      )}
    </label>
  );
}

function Submit({
  children,
  busy,
  tone = "accent",
  onClick,
  type = "submit",
}: {
  children: ReactNode;
  busy?: boolean;
  tone?: "accent" | "ghost";
  onClick?: () => void;
  type?: "submit" | "button";
}) {
  const primary = tone === "accent";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "11px 18px",
        fontSize: 13.5,
        fontWeight: 600,
        borderRadius: 9,
        cursor: busy ? "wait" : "pointer",
        border: `1px solid ${primary ? T.accent : T.border}`,
        background: primary ? T.accent : "transparent",
        color: primary ? "#04120a" : T.sub,
        fontFamily: font,
      }}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function Notice({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 12.5,
        color: tone === "error" ? T.danger : T.sub,
        background: tone === "error" ? "#ff6b6b14" : T.surface2,
        border: `1px solid ${tone === "error" ? "#ff6b6b33" : T.border}`,
        borderRadius: 8,
        padding: "9px 11px",
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

/** Sign in with the credentials the Division Office holds. */
function useEmailSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        setError(signInErrorMessage(authError));
        return false;
      }
      // Wait for this identity's workspace before handing the button back: the
      // console can then open with its data already on screen instead of the
      // form flashing "no account" while the first read is still in flight.
      await syncWorkspace(email.trim().toLowerCase(), true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, signIn };
}

function AdminLogin() {
  const access = useAccess();
  const { reset } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The form paints immediately, even while the session and the workspace are
  // still being read. Once the session resolves, a signed-in administrator is
  // sent on to the console instead of being shown the form, and a teacher is
  // sent to the School Portal.
  // A reset link wins over the redirect: someone signed in on this browser may
  // still be the person who lost the password.
  if (access.status === "admin" && !reset) return <Navigate to="/Admin" />;
  if (access.status === "teacher" && !reset) return <Navigate to="/" />;

  return (
    <LoginScreen
      access={access}
      resetToken={reset}
      onResetDone={() => void navigate({ to: "/login", search: {} })}
    />
  );
}

/**
 * The whole sign-in screen, independent of which route is showing it.
 *
 * `/Admin` uses this too, so a signed-out visitor's FIRST HTML response contains
 * the form — not an empty shell waiting for the client bundle to redirect to
 * `/login`. A signed-in administrator still lands on the console as soon as
 * the session read says so.
 */
export function LoginScreen({
  access,
  resetToken,
  onResetDone,
}: {
  access: ReturnType<typeof useAccess>;
  resetToken?: string;
  onResetDone?: () => void;
}) {
  useStripCredentialQuery();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.text,
        fontFamily: font,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <div
        className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 items-start w-full"
        style={{ maxWidth: 1040 }}
      >
        {/* On a phone the sign-in card comes first: nobody should scroll past
            the pitch to reach the form they opened the page for. */}
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <img src="/school-health-wheel.svg" alt="" width={44} height={44} />
            <div>
              <div
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: T.accent,
                  fontWeight: 700,
                }}
              >
                Urdaneta City Schools Division Office
              </div>
              <div style={{ fontSize: 12.5, color: T.dim }}>School-Based Feeding Program</div>
            </div>
          </div>

          <h1 style={{ fontSize: "clamp(26px, 7vw, 34px)", lineHeight: 1.15, fontWeight: 600, marginTop: 22 }}>
            SBFP Division Console
          </h1>
          <p style={{ fontSize: 15, color: T.sub, marginTop: 12, maxWidth: 520, lineHeight: 1.6 }}>
            The Division Office's own desk for the feeding program: the division master list,
            the Summary Tables and analytics, the feedback the schools send up — and the
            School Portal accounts you issue to each school.
          </p>

          <div className="flex flex-col gap-3 mt-8">
            {[
              [
                "1",
                "You hold the Division Office account",
                "It is created once, here. Only this account can issue or change a school's account.",
              ],
              [
                "2",
                "You issue one account per school",
                "School Accounts hands a school its sign-in email and a temporary password — one account, one school.",
              ],
              [
                "3",
                "The schools work on their own site",
                "What they encode and report shows up here in Student Records, the Summary Table and Feedbacks.",
              ],
            ].map(([n, title, body]) => (
              <div key={n} className="flex gap-3 items-start">
                <span
                  style={{
                    width: 24,
                    height: 24,
                    flex: "0 0 24px",
                    borderRadius: 999,
                    background: T.accentSoft,
                    color: T.accent,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11.5,
                    fontWeight: 700,
                    fontFamily: mono,
                  }}
                >
                  {n}
                </span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: T.sub, marginTop: 2, lineHeight: 1.5 }}>
                    {body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 order-1 lg:order-2">
          <AdminPanel access={access} resetToken={resetToken} onResetDone={onResetDone} />
          <p style={{ fontSize: 12, color: T.dim, lineHeight: 1.6 }}>
            A school's personnel signs in on the{" "}
            <Link to="/" style={{ color: T.accent, textDecoration: "none" }}>
              School Portal
            </Link>{" "}
            with the account the Division Office issued.
          </p>
        </div>
      </div>
    </div>
  );
}

function AdminPanel({
  access,
  resetToken,
  onResetDone,
}: {
  access: ReturnType<typeof useAccess>;
  resetToken: string | undefined;
  onResetDone?: () => void;
}) {
  const hasAdmin = useHasAdminAccount();
  const { busy, error, setError, signIn } = useEmailSignIn();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [claiming, setClaiming] = useState(false);
  /** Swapped for the sign-in form: "email me a reset link". */
  const [forgot, setForgot] = useState(false);
  /** Confirmation shown after a reset, above the sign-in form. */
  const [resetNote, setResetNote] = useState("");

  // The emailed link lands here. The token is the proof, so this door opens
  // without a session and stays open even while the rest of the page loads.
  if (resetToken) {
    return (
      <div style={card}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Choose a new password</h2>
        <p style={{ fontSize: 13, color: T.sub, marginTop: 8, lineHeight: 1.6 }}>
          The link in your email works once. Set the password you want, then sign in with it.
        </p>
        <div className="mt-4">
          <ResetPasswordForm
            token={resetToken}
            onDone={(usedEmail) => {
              setEmail(usedEmail);
              setPassword("");
              setResetNote(`Password updated for ${usedEmail}. Sign in with the new one.`);
              onResetDone?.();
            }}
          />
        </div>
      </div>
    );
  }

  if (access.status === "teacher") {
    return (
      <div style={card}>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>You're signed in to the School Portal</h2>
        <p style={{ fontSize: 13, color: T.sub, marginTop: 10, lineHeight: 1.6 }}>
          <strong style={{ color: T.text }}>{access.email}</strong> holds a School
          Portal account, not the Division Office account. Open the portal to work on your
          school, or sign in below with the Division Office credentials.
        </p>
        <div className="mt-5">
          <Link to="/" style={{ textDecoration: "none" }}>
            <Submit type="button">Open the School Portal →</Submit>
          </Link>
        </div>
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${T.border}` }}>
          <SignInForm
            busy={busy}
            error={error}
            setError={setError}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            signIn={signIn}
            title="Sign in as the Division Office"
          />
        </div>
      </div>
    );
  }

  if (access.status === "disabled") {
    return (
      <div style={card}>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>This account is on hold</h2>
        <p style={{ fontSize: 13, color: T.sub, marginTop: 10, lineHeight: 1.6 }}>
          The Division Office put <strong style={{ color: T.text }}>{access.email}</strong> on
          hold. Another Division Office account can lift it from School Accounts.
        </p>
      </div>
    );
  }

  if (hasAdmin === false) {
    return (
      <div style={card}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: T.gold,
            fontWeight: 700,
          }}
        >
          First-time setup
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>
          Create the Division Office account
        </h2>
        <p style={{ fontSize: 13, color: T.sub, marginTop: 8, lineHeight: 1.6 }}>
          No Division Office account exists yet. It is created once: from then on it is the only
          account that can issue School Portal accounts, and this setup door closes.
        </p>

        {access.email && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 11,
              background: T.surface2,
              border: `1px solid ${T.border}`,
            }}
          >
            <p style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>
              You are signed in as <strong style={{ color: T.text }}>{access.email}</strong> —
              that identity is already verified, so no password is needed.
            </p>
            <div className="mt-3.5">
              <Field text="Account holder" hint="Shown as the name on the Division Office account.">
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Division SBFP Coordinator"
                  className="login-control"
                />
              </Field>
            </div>
            {error && (
              <div className="mt-3">
                <Notice tone="error">{error}</Notice>
              </div>
            )}
            <div className="mt-3.5">
              <Submit
                type="button"
                busy={claiming}
                onClick={async () => {
                  if (!fullName.trim()) {
                    setError("Please enter a name for the account holder.");
                    return;
                  }
                  setClaiming(true);
                  setError("");
                  const result = await claimAdminAccount({ data: { fullName: fullName.trim() } });
                  setClaiming(false);
                  if (!result.ok) setError(result.message);
                  else access.reload();
                }}
              >
                Make this the Division Office account
              </Submit>
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <p style={{ fontSize: 12.5, color: T.sub }}>
            {access.email
              ? "Or create it with an email and password you choose:"
              : "Create it with an email and password you choose:"}
          </p>
          <BootstrapForm
            busy={busy}
            error={error}
            setError={setError}
            fullName={fullName}
            setFullName={setFullName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            afterCreate={signIn}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>
        {forgot ? "Reset your password" : "Division Office sign in"}
      </h2>
      <p style={{ fontSize: 13, color: T.sub, marginTop: 8, lineHeight: 1.6 }}>
        {access.status === "no-account" && access.email ? (
          <>
            No SBFP account has been issued for{" "}
            <strong style={{ color: T.text }}>{access.email}</strong>.
          </>
        ) : forgot ? (
          "Enter the Division Office email and we will send a link that lets you choose a new password."
        ) : (
          "Use the account the Division Office holds for this console."
        )}
      </p>

      {resetNote && (
        <div className="mt-3">
          <Notice tone="info">{resetNote}</Notice>
        </div>
      )}

      {forgot ? (
        <div className="mt-4">
          <ForgotPasswordForm
            initialEmail={email}
            onBack={() => {
              setForgot(false);
              setError("");
            }}
          />
        </div>
      ) : (
        <div className="mt-4">
          <SignInForm
            busy={busy}
            error={error}
            setError={setError}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            signIn={signIn}
          />
          <div style={{ marginTop: 14, textAlign: "right" }}>
            <button
              type="button"
              onClick={() => {
                setForgot(true);
                setResetNote("");
                setError("");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 36,
                background: "none",
                border: "none",
                padding: "0 2px",
                fontFamily: font,
                fontSize: 12.5,
                color: T.accent,
                textDecoration: "underline",
                textUnderlineOffset: 3,
                cursor: "pointer",
              }}
            >
              Forgot your password?
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SignInForm({
  busy,
  error,
  setError,
  email,
  setEmail,
  password,
  setPassword,
  signIn,
  title,
}: {
  busy: boolean;
  error: string;
  setError: (s: string) => void;
  email: string;
  setEmail: (s: string) => void;
  password: string;
  setPassword: (s: string) => void;
  signIn: (email: string, password: string) => Promise<boolean>;
  title?: string;
}) {
  const [show, setShow] = useState(false);
  // The credential inputs deliberately have no `name` attribute. A native form
  // submission (before hydration, or with JavaScript unavailable) otherwise
  // serialises them into the URL, putting the password in the address bar,
  // browser history and proxy logs. `method="post"` keeps even a no-JS fallback
  // from ever writing credentials into the query string.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  return (
    <form
      method="post"
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        // Read the fields as they are at submit time. React state can still be
        // empty when a password manager autofills without input events, and the
        // visible email/password must still be the ones submitted.
        const submittedEmail = (emailRef.current?.value ?? email).trim();
        const submittedPassword = passwordRef.current?.value ?? password;
        // Re-sync state before the request so the controlled fields keep the
        // autofilled values if the credentials turn out to be wrong.
        setEmail(submittedEmail);
        setPassword(submittedPassword);
        void signIn(submittedEmail, submittedPassword);
      }}
    >
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: T.sub }}>{title}</div>}
      <Field text="Email">
        <input
          ref={emailRef}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="division@depedurdaneta.gov.ph"
          className="login-control"
          suppressHydrationWarning
        />
      </Field>
      <Field text="Password">
        <div className="flex gap-2">
          <input
            ref={passwordRef}
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="login-control"
            suppressHydrationWarning
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            style={{
              padding: "0 12px",
              fontSize: 11.5,
              borderRadius: 9,
              border: `1px solid ${T.border}`,
              background: "transparent",
              color: T.dim,
              cursor: "pointer",
              fontFamily: font,
              whiteSpace: "nowrap",
            }}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-1">
        <Submit busy={busy}>Sign in</Submit>
      </div>
    </form>
  );
}

/**
 * The locked-out door: ask for a link by email. No session, no recovery code.
 *
 * The confirmation is deliberately neutral — the same words whether or not the
 * address holds the Division Office account — so this form cannot be used to
 * find out which address it is. A transport failure is reported separately, so
 * the Division Office is never told a link went out when the provider rejected
 * it. The server sends at most one link a minute and each new link replaces the
 * previous one.
 */
function ForgotPasswordForm({
  initialEmail,
  onBack,
}: {
  initialEmail: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{
    configured: boolean;
    delivered: boolean;
    reason: "not_configured" | "provider_rejected" | "network_error" | "unavailable" | null;
    previewUrl: string | null;
  } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Enter the Division Office email address.");
      return;
    }
    setBusy(true);
    try {
      const result = await requestPasswordReset({ data: { email: cleanEmail } });
      setSent({
        configured: result.configured,
        delivered: result.delivered,
        reason: result.reason,
        previewUrl: result.previewUrl,
      });
    } catch {
      setError("The reset link could not be requested just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form method="post" className="flex flex-col gap-3.5" onSubmit={submit}>
      <Field
        text="Division Office email"
        hint="The address on the Division Office account — the link is sent to it."
      >
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSent(null);
          }}
          placeholder="division@depedurdaneta.gov.ph"
          className="login-control"
        />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      {sent?.delivered && (
        <Notice tone="info">
          A reset link is on its way to{" "}
          <strong style={{ color: T.text }}>{email.trim().toLowerCase()}</strong>. It works once
          and stops working after 30 minutes. Check spam if it does not arrive.
        </Notice>
      )}

      {sent && !sent.delivered && sent.reason === "not_configured" && (
        <Notice tone="error">
          Email delivery is not configured, so no recovery message was sent. Add{" "}
          <strong style={{ color: T.text }}>MAILJET_API_KEY</strong>,{" "}
          <strong style={{ color: T.text }}>MAILJET_SECRET_KEY</strong>, and a verified{" "}
          <strong style={{ color: T.text }}>MAILJET_FROM</strong> in Settings → Environment, then
          redeploy.
        </Notice>
      )}

      {sent && !sent.delivered && sent.reason && sent.reason !== "not_configured" && (
        <Notice tone="error">
          {sent.reason === "provider_rejected"
            ? "The mail provider refused the recovery message. Verify the sender in Mailjet, set MAILJET_FROM to that verified address, and check the Mailjet account allows this recipient."
            : sent.reason === "unavailable"
              ? "Account recovery is temporarily unavailable because the account store could not be read. Try again in a moment."
              : "The mail provider could not be reached, so the recovery message was not sent. Try again in a moment."}
        </Notice>
      )}

      {sent && !sent.delivered && !sent.reason && (
        <Notice tone="info">
          If <strong style={{ color: T.text }}>{email.trim().toLowerCase()}</strong> holds the
          Division Office account, a reset link is on its way. It works once and stops working
          after 30 minutes.
        </Notice>
      )}

      {sent?.previewUrl && (
        <a
          href={sent.previewUrl}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 40,
            borderRadius: 9,
            border: `1px dashed ${T.accent}66`,
            background: T.accentSoft,
            color: T.accent,
            fontFamily: font,
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
            padding: "0 14px",
          }}
        >
          Open the reset link (preview inbox) →
        </a>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 36,
            background: "none",
            border: "none",
            padding: "0 2px",
            fontSize: 12.5,
            color: T.sub,
            fontFamily: font,
            cursor: "pointer",
          }}
        >
          ← Back to sign in
        </button>
        <Submit busy={busy}>{sent ? "Send another link" : "Email me a reset link"}</Submit>
      </div>

      <p style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.6, marginTop: 2 }}>
        Nothing in your inbox? Check the spam folder, then wait a minute — only one link is sent
        per minute, and each new link replaces the one before it.
      </p>
    </form>
  );
}

/**
 * The other half of the emailed link: a new password, proven by the token from
 * the email rather than by the old one. The server consumes the token as it is
 * read, so the same link cannot be used twice.
 */
function ResetPasswordForm({
  token,
  onDone,
}: {
  token: string;
  onDone: (email: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    const result = await resetPasswordWithToken({ data: { token, password } });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onDone(result.email);
  };

  const showButton = (
    <button
      type="button"
      onClick={() => setShow((v) => !v)}
      style={{
        padding: "0 12px",
        fontSize: 11.5,
        borderRadius: 9,
        border: `1px solid ${T.border}`,
        background: "transparent",
        color: T.dim,
        cursor: "pointer",
        fontFamily: font,
        whiteSpace: "nowrap",
      }}
    >
      {show ? "Hide" : "Show"}
    </button>
  );

  return (
    <form method="post" className="flex flex-col gap-3.5" onSubmit={submit}>
      <Field text="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <div className="flex gap-2">
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your new password"
            className="login-control"
          />
          {showButton}
        </div>
      </Field>
      <Field text="Confirm new password">
        <input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat the password"
          className="login-control"
        />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="mt-1">
        <Submit busy={busy}>Set a new password</Submit>
      </div>

      <p style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.6 }}>
        Setting a new password signs you out everywhere else. For another link, use “Forgot your
        password?” on the sign-in form.
      </p>
    </form>
  );
}

function BootstrapForm({
  busy,
  error,
  setError,
  fullName,
  setFullName,
  email,
  setEmail,
  password,
  setPassword,
  afterCreate,
}: {
  busy: boolean;
  error: string;
  setError: (s: string) => void;
  fullName: string;
  setFullName: (s: string) => void;
  email: string;
  setEmail: (s: string) => void;
  password: string;
  setPassword: (s: string) => void;
  afterCreate: (email: string, password: string) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <form
      method="post"
      className="flex flex-col gap-3.5 mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setCreating(true);
        const result = await bootstrapAdminAccount({
          data: {
            fullName: fullName.trim() || email.trim(),
            email: email.trim(),
            password,
          },
        });
        if (!result.ok) {
          setCreating(false);
          setError(result.message);
          return;
        }
        const signedIn = await afterCreate(email.trim(), password);
        setCreating(false);
        if (!signedIn) setError("The account was created — now sign in with it.");
      }}
    >
      <Field text="Account holder">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Division SBFP Coordinator"
          className="login-control"
        />
      </Field>
      <Field text="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="division@depedurdaneta.gov.ph"
          className="login-control"
        />
      </Field>
      <Field text="Password" hint="At least 8 characters. Keep it safe — it is this console's key.">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="login-control"
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-1">
        <Submit busy={creating || busy}>Create the account and sign in</Submit>
      </div>
    </form>
  );
}

/** Whether the Division Office account exists yet. */
function useHasAdminAccount(): boolean | null {
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fetchBootstrapState()
      .then((result) => {
        if (live) setState(result.hasAdmin);
      })
      .catch(() => {
        // If the check cannot be made, assume setup is done: showing the sign-in
        // form is the safe side, never a second chance to claim the account.
        if (live) setState(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
