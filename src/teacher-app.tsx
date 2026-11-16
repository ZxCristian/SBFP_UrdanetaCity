/**
 * The School Portal — `/`, the division website's main page.
 *
 * The school's side of the SBFP, deliberately a different product from the
 * district console: one school signs in (one account per school), keeps the
 * school information the district prints on the SBFP forms, encodes learner
 * records, and sends feedback up to the district office.
 *
 * Everything it writes goes through `src/lib/sbfp-store.ts`, which the district
 * console reads back — a record encoded here shows up in the district's Student
 * Records and Summary Table, the profile here is the school's form header, and
 * feedback sent here lands in the district's Feedbacks feed with the district's
 * reply coming back onto the same card.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BMI_STATUSES,
  EMPTY_STUDENT,
  FEEDBACK_CATEGORIES,
  HFA_STATUSES,
  PERIODS,
  SPED_SCHOOL_NAME,
  calcBMI,
  classifyBMI,
  classifyBeneficiary,
  classifyHFA,
  computeAge,
  countsAsPregnantOrYoung,
  defaultsToNotPregnant,
  formatDateMDY,
  getGrades,
  mustNotBePregnant,
  shortDate,
  sortRecords,
  uniqueCount,
} from "@/lib/sbfp-shared";
// Type-only: erased at build time, so ExcelJS stays out of the initial bundle.
import type { SummaryMatrixRow } from "@/lib/sbfp-shared";
import type {
  BMIStatus,
  FeedbackCategory,
  GradeLevel,
  HFAStatus,
  Period,
  School,
  SchoolFeedback,
  SchoolFormDetails,
  Sex,
  Student,
  YesNo,
} from "@/lib/sbfp-shared";
import {
  REQUIRED_PROFILE_FIELDS,
  activeProfile,
  addRecord,
  newFeedbackId,
  newRecordId,
  profileStatus,
  removeRecord,
  restoreRecord,
  saveProfile,
  sendFeedback,
  updateRecord,
  useTeacherStore,
} from "@/lib/sbfp-store";
import type { TeacherProfile } from "@/lib/sbfp-store";
import { useStripCredentialQuery } from "@/lib/credential-url";
import { syncWorkspace } from "@/lib/sbfp-store";
import { useAccess } from "@/lib/use-access";
import type { Access } from "@/lib/use-access";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form2Sheet } from "@/components/form2-sheet";
import { manualTotal, useForm2Extras } from "@/lib/use-form2-extras";
import { UserButton } from "@/lib/auth/gates";
import { authClient, signOut } from "@/lib/auth/client";
import { signInErrorMessage } from "@/lib/auth/sign-in-error";
import {
  changeOwnPassword,
  lookupPreviousBeneficiary,
  resetPasswordWithToken,
} from "@/lib/sbfp-api";
import { MIN_PASSWORD_LENGTH } from "@/lib/sbfp-credentials";
import { learnerProblem } from "@/lib/sbfp-validation";
import { formatSchoolYear } from "@/lib/sbfp-years";

// ── Look: the school's own site — warm paper, DepEd navy and gold, soft cards ──
const C = {
  bg: "#f3f1eb",
  surface: "#ffffff",
  surface2: "#f8f6f0",
  border: "#e0dccf",
  border2: "#cfc9b8",
  text: "#1b2430",
  sub: "#5a6472",
  dim: "#8a939f",
  navy: "#123a6b",
  navySoft: "#e7edf6",
  gold: "#a9761a",
  goldSoft: "#fbf3e2",
  good: "#1c7a4a",
  goodSoft: "#e6f3ec",
  warn: "#a2580a",
  danger: "#b3261e",
  dangerSoft: "#fbecea",
  radius: 14,
};

const font = "'Outfit', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

const label: CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: C.dim,
  marginBottom: 6,
  fontWeight: 600,
};

const control: CSSProperties = {
  width: "100%",
  fontSize: 14,
  padding: "10px 12px",
  borderRadius: 9,
  border: `1px solid ${C.border2}`,
  background: C.surface,
  color: C.text,
  fontFamily: font,
  outline: "none",
};

type Tab = "overview" | "profile" | "entry" | "records" | "summary" | "feedback" | "trash";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "profile", label: "My Profile", icon: "◉" },
  { id: "entry", label: "Data Entry", icon: "✎" },
  { id: "records", label: "My Records", icon: "☰" },
  { id: "summary", label: "Summary Table", icon: "≡" },
  { id: "feedback", label: "Feedback", icon: "✉" },
  { id: "trash", label: "Trash", icon: "♲" },
];

// ── Small building blocks ─────────────────────────────────────────────────────

function Card({
  children,
  title,
  subtitle,
  action,
  pad = 22,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  pad?: number;
}) {
  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: C.radius,
        padding: pad,
        boxShadow: "0 1px 2px rgba(27,36,48,0.04)",
      }}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            {title && <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</h2>}
            {subtitle && <p style={{ fontSize: 12, color: C.sub, marginTop: 3, maxWidth: 620 }}>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Field({
  text,
  required,
  hint,
  children,
}: {
  text: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span style={label}>
        {text}
        {required && <span style={{ color: C.danger }}> *</span>}
      </span>
      {children}
      {hint && (
        <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 5 }}>{hint}</span>
      )}
    </label>
  );
}

function Pill({ text, tone = "navy" }: { text: string; tone?: "navy" | "gold" | "good" | "warn" | "danger" | "muted" }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    navy: { bg: C.navySoft, fg: C.navy },
    gold: { bg: C.goldSoft, fg: C.gold },
    good: { bg: C.goodSoft, fg: C.good },
    warn: { bg: "#fdf1e3", fg: C.warn },
    danger: { bg: C.dangerSoft, fg: C.danger },
    muted: { bg: C.surface2, fg: C.sub },
  };
  const p = palette[tone];
  return (
    <span
      style={{
        background: p.bg,
        color: p.fg,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Stat({ text, value, hint, accent }: { text: string; value: string | number; hint?: string; accent?: boolean }) {
  return (
    <div
      style={{
        background: accent ? C.navy : C.surface,
        border: `1px solid ${accent ? C.navy : C.border}`,
        borderRadius: C.radius,
        padding: "16px 18px",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: accent ? "#b9c9e0" : C.dim, fontWeight: 600 }}>
        {text}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, fontFamily: mono, color: accent ? "#fff" : C.text, marginTop: 6, lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: accent ? "#c9d6e8" : C.dim, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ background: C.surface2, borderRadius: 999, height: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.good : C.navy, transition: "width .3s ease" }} />
    </div>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          title={`${n} of 5`}
          aria-label={`${n} of 5`}
          style={{ background: "none", border: "none", padding: 0, fontSize: 24, lineHeight: 1, color: n <= value ? C.gold : C.border2, cursor: "pointer" }}
        >
          ★
        </button>
      ))}
      <span style={{ fontSize: 12, color: C.sub, marginLeft: 6 }}>{value} of 5</span>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span style={{ color: C.gold, fontSize: 13, letterSpacing: 1 }} title={`${value} of 5`}>
      {"★".repeat(Math.round(value))}
      <span style={{ color: C.border2 }}>{"★".repeat(Math.max(0, 5 - Math.round(value)))}</span>
    </span>
  );
}

function YesNoToggle({
  value,
  onChange,
  disabled,
}: {
  value: YesNo;
  onChange: (v: YesNo) => void;
  /** A rule decided the answer; the learner cannot be marked the other way. */
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2" style={{ opacity: disabled ? 0.65 : 1 }}>
      {(["Yes", "No"] as YesNo[]).map(v => (
        <button
          key={v}
          type="button"
          onClick={() => !disabled && onChange(value === v ? "" : v)}
          disabled={disabled}
          className="flex-1"
          style={{
            padding: "7px 0",
            fontSize: 13,
            borderRadius: 8,
            border: `1px solid ${value === v ? C.navy : C.border2}`,
            background: value === v ? C.navySoft : C.surface,
            color: value === v ? C.navy : C.sub,
            fontWeight: value === v ? 600 : 400,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function Button({
  children,
  onClick,
  tone = "primary",
  disabled,
  small,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "ghost" | "gold" | "danger";
  disabled?: boolean;
  small?: boolean;
  type?: "button" | "submit";
}) {
  const tones: Record<string, CSSProperties> = {
    primary: { background: C.navy, color: "#fff", borderColor: C.navy },
    gold: { background: C.gold, color: "#fff", borderColor: C.gold },
    ghost: { background: C.surface, color: C.sub, borderColor: C.border2 },
    danger: { background: C.dangerSoft, color: C.danger, borderColor: "#efcfcb" },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...tones[tone],
        border: `1px solid ${tones[tone].borderColor as string}`,
        borderRadius: 9,
        padding: small ? "6px 11px" : "10px 18px",
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        fontFamily: font,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** The two status colours, shared by the records list and the feedback list. */
const bmiTone = (s: string): "good" | "warn" | "danger" | "gold" | "muted" =>
  s === "Normal" ? "good" : s === "Severely Wasted" ? "danger" : s === "Wasted" ? "warn" : s ? "gold" : "muted";

// ── Sign in ───────────────────────────────────────────────────────────────────
// Accounts are issued and recovered by the Division Office, so there is nothing
// to register or self-serve here: school personnel sign in with the email and
// temporary password they were handed, and land on their own school. A school
// that loses its account email or password is directed to the Technical
// Assistant of the School-Based Feeding Program, who can reissue the account
// details. Existing emailed reset links still open the password form.

/** A lightweight notice in the School Portal's warm paper palette. */
function SignInNotice({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      style={{
        fontSize: 12.5,
        color: tone === "error" ? C.danger : C.sub,
        background: tone === "error" ? C.dangerSoft : C.surface2,
        border: `1px solid ${tone === "error" ? "#f0d3d0" : C.border}`,
        borderRadius: 9,
        padding: "9px 11px",
        lineHeight: 1.55,
      }}
    >
      {children}
    </p>
  );
}

/**
 * Where a school goes when the account email or password is lost.
 *
 * School accounts are not self-service: they are issued to one school by the
 * Division Office, so recovery is handled by the program's Technical Assistant
 * rather than by a public reset-email form.
 */
function AccountHelp() {
  return (
    <div
      style={{
        marginTop: 14,
        padding: "11px 13px",
        borderRadius: 10,
        border: `1px solid ${C.gold}33`,
        background: C.goldSoft,
        fontSize: 12,
        color: C.sub,
        lineHeight: 1.6,
      }}
    >
      <strong style={{ color: C.text }}>Forgot your account?</strong> Contact the{" "}
      <strong style={{ color: C.text }}>
        Technical Assistant of the School-Based Feeding Program
      </strong>{" "}
      at the Division Office for your school's sign-in email or a new temporary password.
    </div>
  );
}

/**
 * The other half of a previously emailed link: choose a new password, proven by the
 * token from the email. Reached at `/?reset=…`; the token is consumed
 * as it is read, so a used or expired link is refused.
 */
function TeacherResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ email: string; role: "admin" | "teacher" } | null>(null);

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
    try {
      const result = await resetPasswordWithToken({ data: { token, password } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone({ email: result.email, role: result.role });
    } catch {
      setError("That reset link is invalid or has expired. Request a new one.");
    } finally {
      setBusy(false);
    }
  };

  const destination = done?.role === "admin" ? "/login" : "/";
  const destinationLabel = done?.role === "admin" ? "Division Console" : "School Portal";

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: font }}>
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div className="mx-auto px-5 py-3 flex items-center gap-3" style={{ maxWidth: 1080 }}>
          <img src="/school-health-wheel.svg" alt="" width={36} height={36} />
          <span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: C.text }}>
              SBFP School Portal
            </span>
            <span style={{ display: "block", fontSize: 11, color: C.dim }}>
              Urdaneta City Schools Division
            </span>
          </span>
        </div>
      </header>

      <div className="mx-auto px-5 py-8 md:py-12" style={{ maxWidth: 560 }}>
        <Card
          title={done ? "Password updated" : "Choose a new password"}
          subtitle={
            done
              ? "The link has been used and will not work again."
              : "The link in your email works once. Set the password you want, then sign in with it."
          }
        >
          {done ? (
            <div className="flex flex-col gap-4">
              <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.65 }}>
                Your password for <strong style={{ color: C.text }}>{done.email}</strong> has
                been updated. Sign in with the new one.
              </p>
              <a
                href={destination}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 42,
                  borderRadius: 9,
                  background: C.navy,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  padding: "0 18px",
                }}
              >
                Go to {destinationLabel} sign in →
              </a>
              <p style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.6 }}>
                Setting a new password signs you out everywhere else. For another recovery
                link, contact the Technical Assistant of the School-Based Feeding Program.
              </p>
            </div>
          ) : (
            <form method="post" className="flex flex-col gap-4" onSubmit={submit}>
              <Field text="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
                <div className="flex gap-2">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your new password"
                    style={control}
                  />
                  <Button small tone="ghost" onClick={() => setShow((v) => !v)}>
                    {show ? "Hide" : "Show"}
                  </Button>
                </div>
              </Field>
              <Field text="Confirm new password">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat the password"
                  style={control}
                />
              </Field>

              {error && <SignInNotice tone="error">{error}</SignInNotice>}

              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Set a new password"}
                </Button>
              </div>
            </form>
          )}
        </Card>

        <p style={{ marginTop: 16, fontSize: 12, color: C.dim }}>
          <a href="/" style={{ color: C.navy, textDecoration: "none" }}>
            ← Back to School Portal sign in
          </a>
        </p>
      </div>
    </div>
  );
}

function TeacherSignIn({ notice }: { notice?: ReactNode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Credential inputs have no `name` on purpose: a native submission before
  // hydration would otherwise put the password into the URL. `method="post"`
  // keeps that fallback out of the query string too.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useStripCredentialQuery();

  const submit = async (emailValue: string, passwordValue: string) => {
    setError("");
    // Keep the controlled fields in step with an autofilled submission.
    setEmail(emailValue);
    setPassword(passwordValue);
    if (!emailValue.trim() || !passwordValue) {
      setError("Enter the email and password the Division Office gave you.");
      return;
    }
    setBusy(true);
    try {
      const { error: authError } = await authClient.signIn.email({
        email: emailValue.trim(),
        password: passwordValue,
      });
      if (authError) {
        const message = signInErrorMessage(authError);
        setError(
          message === "That email and password do not match an account."
            ? `${message} Check the details, or contact the Technical Assistant of the School-Based Feeding Program for a new temporary password.`
            : message,
        );
        return;
      }
      // Wait for this identity's workspace before releasing the button: the
      // portal can then open on the school's data instead of flashing the form
      // again while the first read is still in flight.
      await syncWorkspace(emailValue.trim().toLowerCase(), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto px-5 py-8 md:py-12" style={{ maxWidth: 1080 }}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-8 items-start">
        {/* On a phone the sign-in card comes first, so school personnel who
            already have an account do not scroll past the introduction to reach it. */}
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <img src="/school-health-wheel.svg" alt="" width={46} height={46} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.gold, fontWeight: 700 }}>
                Department of Education
              </div>
              <div style={{ fontSize: 13, color: C.sub }}>Urdaneta City Schools Division Office</div>
            </div>
          </div>
          <h1 style={{ fontSize: "clamp(26px, 7vw, 34px)", lineHeight: 1.15, fontWeight: 600, marginTop: 22, color: C.text }}>
            SBFP School Portal
          </h1>
          <p style={{ fontSize: 15, color: C.sub, marginTop: 12, maxWidth: 520, lineHeight: 1.65 }}>
            Your school's own desk for the School-Based Feeding Program: the school information the division prints on
            the SBFP forms, the learner records you encode, and the feedback the district office answers.
          </p>

          <div className="flex flex-col gap-3 mt-7">
            {[
              ["1", "Sign in with your school's account", "The Division Office issues one account per school — the email and temporary password they gave you."],
              ["2", "Fill in the school information", "Principal, feeding focal person, School ID, city/municipality/barangay — printed on Form 1A and Form 2."],
              ["3", "Encode learners and report", "Weights and heights with automatic WHO classification, plus feedback straight to the district."],
            ].map(([n, title, body]) => (
              <div key={n} className="flex gap-3 items-start">
                <span
                  style={{
                    width: 26,
                    height: 26,
                    flex: "0 0 26px",
                    borderRadius: 999,
                    background: C.navySoft,
                    color: C.navy,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {n}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2, lineHeight: 1.5 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>

          <div
            className="mt-7"
            style={{ fontSize: 12.5, color: C.sub, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", maxWidth: 520, lineHeight: 1.6 }}
          >
            <strong style={{ color: C.text }}>No account yet?</strong> Accounts are issued by the
            Division Office. Contact the Technical Assistant of the School-Based Feeding Program
            for your school's sign-in email and temporary password.
          </div>

          <div style={{ fontSize: 12, color: C.dim, marginTop: 18 }}>
            One account per school, for every school in the division.{" "}
            <a href="/Admin" style={{ color: C.navy, fontWeight: 600, textDecoration: "none" }}>
              Division Office sign in →
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-4 order-1 lg:order-2">
          {notice}

          <Card
            title="Sign in to your school"
            subtitle="Use the email and temporary password the Division Office issued."
          >
            <form
              method="post"
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                // Read the fields at submit time so a password manager's
                // autofill is accepted even when it did not fire input events.
                void submit(
                  emailRef.current?.value ?? email,
                  passwordRef.current?.value ?? password,
                );
              }}
            >
              <Field text="Email">
                <input
                  ref={emailRef}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="school@depedurdaneta.gov.ph"
                  style={control}
                />
              </Field>
              <Field text="Password">
                <div className="flex gap-2">
                  <input
                    ref={passwordRef}
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="••••••••"
                    style={control}
                  />
                  <Button small tone="ghost" type="button" onClick={() => setShow((v) => !v)}>
                    {show ? "Hide" : "Show"}
                  </Button>
                </div>
              </Field>
              {error && <SignInNotice tone="error">{error}</SignInNotice>}
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <span style={{ fontSize: 11.5, color: C.dim }}>
                  First sign-in? Change the password in My Profile → Account.
                </span>
              </div>
            </form>
            <AccountHelp />
          </Card>

          <p style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.6 }}>
            Everything you encode here is saved to the division's records server, so the district office reads the same
            figures you do — on any device you sign in from.
          </p>
        </div>
      </div>
    </div>
  );
}

/** A signed-in account that has been put on hold by the Division Office. */
function AccountOnHold({ access }: { access: Access }) {
  return (
    <div className="mx-auto px-5 py-10" style={{ maxWidth: 720 }}>
      <Card title="This account is on hold">
        <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.65 }}>
          The Division Office has put <strong style={{ color: C.text }}>{access.email}</strong> on hold, so this school's
          records are read-only for now. Nothing has been deleted — contact the Technical Assistant of the
          School-Based Feeding Program to lift the hold and your work will be back.
        </p>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <UserButton redirectTo="/" />
        </div>
      </Card>
    </div>
  );
}

/** Shown above the sign-in card when the session holds no school's account. */
function NoAccountNotice({ access }: { access: Access }) {
  return (
    <Card title={access.status === "admin" ? "You're signed in as the Division Office" : "This session has no school account"}>
      <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.65 }}>
        {access.status === "admin" ? (
          <>
            <strong style={{ color: C.text }}>{access.email}</strong> holds the Division Office account, not a school's.
            Issue each school its account from the Division Console's School Accounts — or sign in below with a
            school's own account to work on that school.
          </>
        ) : (
          <>
            You are signed in as <strong style={{ color: C.text }}>{access.email}</strong>, but no School Portal account
            has been issued for that email address. Sign in below with the account the Division Office gave your school,
            or contact the Technical Assistant of the School-Based Feeding Program for help.
          </>
        )}
      </p>
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {access.status === "admin" && (
          <a href="/Admin" style={{ textDecoration: "none" }}>
            <Button small>Division Console →</Button>
          </a>
        )}
        <UserButton redirectTo="/" />
      </div>
    </Card>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ profile, school, go }: { profile: TeacherProfile; school: School; go: (t: Tab) => void }) {
  const store = useTeacherStore();
  const status = profileStatus(profile);
  const mine = useMemo(
    () => store.records.filter(r => r.schoolId === school.id),
    [store.records, school.id],
  );
  const myFeedback = useMemo(
    () => store.feedbacks.filter(f => f.schoolId === school.id),
    [store.feedbacks, school.id],
  );

  const learners = uniqueCount(mine);
  const perPeriod = PERIODS.map(p => ({ p, n: mine.filter(r => r.period === p).length }));
  const replied = myFeedback.filter(f => f.response).length;
  const open = myFeedback.filter(f => f.status !== "Resolved").length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = profile.teacherName.split(",")[1]?.trim().split(" ")[0] || profile.teacherName.split(" ")[0];

  const peakPeriod = Math.max(1, ...perPeriod.map(p => p.n));
  const todos: { done: boolean; text: string; hint: string; tab: Tab }[] = [
    {
      done: status.complete,
      text: "Complete the school profile",
      hint: status.complete ? "All four required fields are filled in" : `Missing: ${status.missing.map(([, l]) => l).join(", ")}`,
      tab: "profile",
    },
    {
      done: learners > 0,
      text: "Encode learner records",
      hint: learners > 0 ? `${learners} learner${learners === 1 ? "" : "s"} encoded` : "Start with the Baseline measurements",
      tab: "entry",
    },
    {
      done: myFeedback.length > 0,
      text: "Send feedback to the district",
      hint: myFeedback.length > 0 ? `${myFeedback.length} sent` : "Tell the district how feeding is going",
      tab: "feedback",
    },
    {
      done: replied > 0,
      text: "Read the district's reply",
      hint: replied > 0 ? `${replied} repl${replied === 1 ? "y" : "ies"} waiting` : "No reply yet",
      tab: "feedback",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card pad={24}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: C.gold, fontWeight: 700 }}>
              {greeting}
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 6, color: C.text }}>{firstName}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span style={{ fontSize: 14, color: C.sub }}>{school.name}</span>
              <Pill text={school.type === "Elementary" ? "Elementary" : "High School"} tone={school.type === "Elementary" ? "navy" : "gold"} />
            </div>
          </div>
          <div style={{ minWidth: 220, flex: "1 1 220px", maxWidth: 320 }}>
            <div className="flex items-baseline justify-between mb-2">
              <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.dim, fontWeight: 600 }}>
                School profile
              </span>
              <span style={{ fontSize: 13, fontFamily: mono, color: status.complete ? C.good : C.warn }}>
                {status.done}/{status.total}
              </span>
            </div>
            <Bar done={status.done} total={status.total} />
            {!status.complete && (
              <button
                onClick={() => go("profile")}
                style={{ marginTop: 10, fontSize: 12.5, color: C.navy, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                Finish my profile →
              </button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat text="Learners encoded" value={learners} hint="unique learners" accent />
        <Stat text="Records" value={mine.length} hint="across all periods" />
        <Stat text="Feedback sent" value={myFeedback.length} hint={open ? `${open} still open` : "all closed"} />
        <Stat text="District replies" value={replied} hint={replied ? "read them below" : "none yet"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-5">
        <Card title="What to do next">
          <div className="flex flex-col">
            {todos.map((td, i) => (
              <button
                key={td.text}
                onClick={() => go(td.tab)}
                className="flex items-start gap-3 text-left py-3"
                style={{ borderTop: i === 0 ? "none" : `1px solid ${C.border}`, background: "none", cursor: "pointer" }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    flex: "0 0 20px",
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    background: td.done ? C.goodSoft : C.surface2,
                    color: td.done ? C.good : C.dim,
                    border: `1px solid ${td.done ? "#c6e2d3" : C.border2}`,
                  }}
                >
                  {td.done ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: td.done ? C.sub : C.text, textDecoration: td.done ? "none" : "none" }}>
                    {td.text}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: C.dim, marginTop: 2 }}>{td.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Measurements on file" subtitle="What the district's Summary Table pulls for this school.">
          <div className="flex flex-col gap-3">
            {perPeriod.map(({ p, n }) => (
              <div key={p}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span style={{ fontSize: 12.5, color: C.text, fontWeight: 500 }}>{p}</span>
                  <span style={{ fontSize: 12, fontFamily: mono, color: n ? C.navy : C.dim }}>{n}</span>
                </div>
                <Bar done={n} total={peakPeriod} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 11.5, color: C.dim }}>Latest weighing on file</span>
              <span style={{ fontSize: 12, fontFamily: mono, color: C.text }}>
                {sortRecords(mine)[0]?.dateOfWeighing || "—"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="School information on the SBFP forms" subtitle="These are printed on Form 1A and Form 2 by the district office." action={<Button small tone="ghost" onClick={() => go("profile")}>Edit</Button>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {REQUIRED_PROFILE_FIELDS.map(([key, text]) => {
            const value = String(profile[key] ?? "").trim();
            return (
              <div key={key}>
                <div style={{ ...label, marginBottom: 3 }}>{text}</div>
                <div style={{ fontSize: 14, color: value ? C.text : C.dim, fontWeight: value ? 500 : 400 }}>
                  {value || "Not filled in yet"}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfileScreen({ profile, school }: { profile: TeacherProfile; school: School }) {
  const [form, setForm] = useState<TeacherProfile>(profile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const status = profileStatus(form);
  /**
   * Nothing is saved while a required field is blank. The four marked fields
   * are printed on every SBFP form, so a partial header is a form the district
   * cannot print — the server refuses to clear one as well.
   */
  const missing = !form.teacherName.trim()
    ? "your name"
    : status.missing.map(([, label]) => label).join(" · ");
  const canSave = !missing;

  const set = <K extends keyof TeacherProfile>(key: K, value: TeacherProfile[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setSaved(false);
    setError("");
  };

  const save = () => {
    if (!canSave) {
      setError(`Still needed: ${missing}`);
      return;
    }
    const { schoolId: _id, ...patch } = form;
    saveProfile(school.id, patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const detailFields: [keyof SchoolFormDetails, string, string][] = [
    ["principal", "Name of Principal / School Head", "Printed on both SBFP forms."],
    ["focalPerson", "Name of Feeding Focal Person", "The signatory on the printed forms."],
    ["schoolIdNumber", "School ID Number", "The DepEd school ID of this school."],
    ["cityMunicipalityBarangay", "City/Municipality/Barangay", "e.g. Urdaneta City, Barangay San Vicente East."],
    ["division", "Division", "Schools Division Office."],
    ["dateStartFeeding", "Date of Start of Feeding", "Form 2 field."],
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="My Profile"
        subtitle={`Registered to ${school.name}. Saving here updates the school information the district prints on the SBFP forms.`}
        action={
          <div className="flex items-center gap-3">
            {saved && <span style={{ fontSize: 12, color: C.good, fontWeight: 600 }}>✓ Saved</span>}
            <Button onClick={save} disabled={!canSave}>Save profile</Button>
          </div>
        }
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Pill text={school.type === "Elementary" ? "Elementary" : "High School"} tone={school.type === "Elementary" ? "navy" : "gold"} />
          <Pill text={`${status.done}/${status.total} required fields`} tone={status.complete ? "good" : "warn"} />
          {profile.updatedAt && (
            <span style={{ fontSize: 11.5, color: C.dim }}>Last updated {shortDate(profile.updatedAt.slice(0, 10))}</span>
          )}
        </div>
        {!status.complete && (
          <p style={{ fontSize: 12.5, color: C.warn, marginTop: 12 }}>
            Still needed: {status.missing.map(([, l]) => l).join(" · ")}
          </p>
        )}
      </Card>

      <Card title="School Personnel" subtitle="The person who handles SBFP for this school.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field text="Name of School Personnel" required>
            <input value={form.teacherName} onChange={e => set("teacherName", e.target.value)} style={control} />
          </Field>
          <Field text="Position / designation">
            <input value={form.position} onChange={e => set("position", e.target.value)} style={control} />
          </Field>
          <Field text="Contact number or email">
            <input value={form.contact} onChange={e => set("contact", e.target.value)} style={control} />
          </Field>
        </div>
      </Card>

      <Card title="School information" subtitle="The header block of the SBFP forms. The four marked fields are required by the district.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {detailFields.map(([key, text, hint], i) => {
            const required = i < 4;
            if (key === "dateStartFeeding") {
              return (
                <Field key={key} text={text} hint={hint}>
                  <input type="date" value={form.dateStartFeeding} onChange={e => set("dateStartFeeding", e.target.value)} style={control} />
                </Field>
              );
            }
            return (
              <Field key={key} text={text} required={required} hint={hint}>
                <input value={String(form[key] ?? "")} onChange={e => set(key, e.target.value)} style={control} />
              </Field>
            );
          })}
          <Field text="Last Mile School" hint="Form 2 field — printed as ___Y ___N.">
            <YesNoToggle value={form.lastMileSchool} onChange={v => set("lastMileSchool", v)} />
          </Field>
        </div>
        <div className="flex items-center gap-3 mt-6 flex-wrap">
          <Button onClick={save} disabled={!canSave}>Save profile</Button>
          {saved && <span style={{ fontSize: 12, color: C.good, fontWeight: 600 }}>✓ Saved — the district office sees this now</span>}
          {!canSave && (
            <span style={{ fontSize: 11.5, color: C.warn }}>
              Fill in every required field before saving.
            </span>
          )}
        </div>
        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: C.danger, marginTop: 10 }}>{error}</p>
        )}
      </Card>

      <AccountCard profile={profile} />
    </div>
  );
}

/**
 * The school's sign-in account: who it is for, and the password change the
 * school personnel should make after their first sign-in with the temporary
 * password the Division Office handed them.
 */
function AccountCard({ profile }: { profile: TeacherProfile }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const needsCurrent = !profile.tempPassword;

  const submit = async () => {
    setError("");
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== again) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    const result = await changeOwnPassword({
      data: { currentPassword: needsCurrent ? current : undefined, newPassword: next },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCurrent("");
    setNext("");
    setAgain("");
    setDone(true);
    // Changing the password ends every session for the account on the server
    // (that is what makes a stolen session die with the old password), so this
    // one goes too — back to the sign-in screen with the new password.
    window.setTimeout(() => void signOut("/"), 1600);
  };

  return (
    <Card
      title="Account"
      subtitle="Issued by the Division Office — one account per school. This is what you sign in with on any device."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <span style={label}>Sign-in email</span>
          <div style={{ fontFamily: mono, fontSize: 13, color: C.text, wordBreak: "break-all" }}>{profile.email}</div>
        </div>
        <div>
          <span style={label}>School on this account</span>
          <div style={{ fontSize: 13.5, color: C.text }}>{profile.schoolId.toUpperCase()}</div>
        </div>
        <div>
          <span style={label}>Status</span>
          <div className="flex items-center gap-2">
            <Pill text={profile.status === "active" ? "Active" : "On hold"} tone={profile.status === "active" ? "good" : "warn"} />
            {profile.tempPassword && <Pill text="Temporary password" tone="gold" />}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>Change your password</div>
        <p style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>
          {needsCurrent
            ? "Choose something only you know. If you forget it, contact the Technical Assistant of the School-Based Feeding Program for a new temporary one."
            : "You are still using the temporary password the Division Office gave you — replace it with your own."}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {needsCurrent && (
            <Field text="Current password">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} style={control} />
            </Field>
          )}
          <Field text="New password">
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} style={control} />
          </Field>
          <Field text="Repeat new password">
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} style={control} />
          </Field>
        </div>
        {error && <p style={{ fontSize: 12.5, color: C.danger, marginTop: 12 }}>{error}</p>}
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </Button>
          {done && <span style={{ fontSize: 12, color: C.good, fontWeight: 600 }}>✓ Password changed — sign in again</span>}
          <span style={{ fontSize: 11.5, color: C.dim }}>
            Saving signs you out on every device, including this one.
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Data entry ────────────────────────────────────────────────────────────────

function DataEntry({
  school,
  editing,
  clearEditing,
  goRecords,
}: {
  school: School;
  editing: Student | null;
  clearEditing: () => void;
  goRecords: () => void;
}) {
  const activeSy = useTeacherStore().activeSy;
  const [period, setPeriod] = useState<Period | null>(editing?.period ?? null);
  const [form, setForm] = useState<Omit<Student, "id">>(() =>
    editing ? { ...editing } : EMPTY_STUDENT(school.id, "", activeSy),
  );
  const [saved, setSaved] = useState(false);
  const [periodError, setPeriodError] = useState(false);
  const [nameError, setNameError] = useState(false);
  /** Why the record cannot be saved (missing or impossible measurements). */
  const [formError, setFormError] = useState("");
  /** The past school year this learner's record was found in, or null. */
  const [previousSy, setPreviousSy] = useState<string | null>(null);
  /** The teacher answered the previous-years question herself — respected. */
  const previousTouched = useRef(false);
  /** The current "Yes" was set by the archive lookup, not by a person. */
  const autoPrevious = useRef(false);
  /**
   * A status the teacher picked by hand outranks the WHO auto-classification for
   * this record, while a status that was only ever computed is cleared when the
   * measurements no longer support it.
   */
  const manualStatus = useRef({ bmi: false, hfa: false });
  const resetManualStatus = () => { manualStatus.current = { bmi: false, hfa: false }; };

  // Opening a row for editing from My Records repopulates the form with it.
  useEffect(() => {
    resetManualStatus();
    previousTouched.current = false;
    autoPrevious.current = false;
    setPreviousSy(null);
    if (editing) {
      const loaded = { ...editing };
      // Only a male learner is locked to "No"; an older row saved under the
      // old age-10 rule keeps whatever is stored until someone edits the age.
      if (mustNotBePregnant(loaded.sex)) loaded.pregnant = "No";
      setForm(loaded);
      setPeriod(editing.period);
      setPeriodError(false);
      setNameError(false);
    }
  }, [editing]);

  const grades = getGrades(school);

  // "SBFP beneficiary in previous years?" is answered from the archive: once a
  // name (and date of birth, when one is entered) is on the form, ask the
  // server whether the school already had this learner in a past year. The
  // lookup is debounced, returns only the year, and never overrides a choice
  // the teacher has made herself.
  useEffect(() => {
    if (editing) return;
    const name = form.name.trim();
    if (name.length < 3) {
      if (autoPrevious.current) {
        autoPrevious.current = false;
        setForm((f) =>
          f.sbfpPreviousYears === "Yes" ? { ...f, sbfpPreviousYears: "No" } : f,
        );
      }
      setPreviousSy(null);
      return;
    }
    if (previousTouched.current) {
      setPreviousSy(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void lookupPreviousBeneficiary({ data: { name, dateOfBirth: form.dateOfBirth } })
        .then((result) => {
          if (!live) return;
          setPreviousSy(result.sy);
          if (result.sy) {
            autoPrevious.current = true;
            setForm((f) =>
              f.sbfpPreviousYears === "Yes" ? f : { ...f, sbfpPreviousYears: "Yes" },
            );
          } else if (autoPrevious.current) {
            // The name moved on to someone with no archive match; take back
            // the auto "Yes" rather than leave a stale answer on the form.
            autoPrevious.current = false;
            setForm((f) =>
              f.sbfpPreviousYears === "Yes" ? { ...f, sbfpPreviousYears: "No" } : f,
            );
          }
        })
        .catch(() => {
          if (live) setPreviousSy(null);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [form.name, form.dateOfBirth, editing]);

  /**
   * Same rules as the district console's Data Entry: ages from the date of
   * birth, BMI from weight and height, WHO 2007 BMI/HFA status and the
   * primary/secondary beneficiary class all follow the measurements, and any of
   * them can still be overridden by hand.
   */
  const set = (key: keyof Omit<Student, "id">, value: string) => {
    setNameError(false);
    setFormError("");
    if (key === "sbfpPreviousYears") {
      previousTouched.current = true;
      autoPrevious.current = false;
    }
    if (key === "bmiStatus") manualStatus.current.bmi = true;
    if (key === "hfaStatus") manualStatus.current.hfa = true;
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === "dateOfBirth") {
        const age = computeAge(value);
        next.ageYears = age.years;
        next.ageMonths = age.months;
      }
      const weight = key === "weight" ? value : f.weight;
      const height = key === "height" ? value : f.height;
      const measuresChanged = key === "weight" || key === "height";
      if (measuresChanged) next.bmi = calcBMI(weight, height);
      // The computed value (even an empty one) replaces the old status, so a
      // cleared weight or an out-of-range age cannot leave a stale "Normal".
      if ((measuresChanged || key === "dateOfBirth" || key === "sex" || key === "ageYears") && !manualStatus.current.bmi) {
        next.bmiStatus = classifyBMI(next.bmi || calcBMI(weight, height), next.ageYears, next.sex);
      }
      if ((key === "height" || key === "dateOfBirth" || key === "sex" || key === "ageYears") && !manualStatus.current.hfa) {
        next.hfaStatus = classifyHFA(height, next.ageYears, next.sex);
      }
      next.nutritionalStatus = next.bmiStatus;
      if (key !== "classificationOfBeneficiary") {
        const auto = classifyBeneficiary(next.gradeLevel, next.bmiStatus, next.hfaStatus);
        if (auto) next.classificationOfBeneficiary = auto;
      }
      // A male learner is locked to "No". A female learner aged 10 or below
      // only *defaults* to "No" when sex or age changes; she can still be
      // marked pregnant on purpose, so a later click on Yes is not undone.
      if (mustNotBePregnant(next.sex)) next.pregnant = "No";
      else if (
        (key === "sex" || key === "dateOfBirth" || key === "ageYears") &&
        defaultsToNotPregnant(next.sex, next.ageYears)
      ) {
        next.pregnant = "No";
      }
      return next;
    });
  };

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    setPeriodError(false);
    setForm(f => ({ ...f, period: p }));
  };

  const save = () => {
    if (!period) {
      setPeriodError(true);
      return;
    }
    if (!form.name.trim()) {
      setNameError(true);
      return;
    }
    // A record with no weight or height has no BMI and no nutritional status;
    // it must not be saved as if it were a weighed learner. The server checks
    // the same rule (`learnerProblem` in @/lib/sbfp-validation).
    const problem = learnerProblem({ name: form.name, period, weight: form.weight, height: form.height });
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError("");
    if (editing) {
      updateRecord(editing.id, { ...form, period });
      clearEditing();
      goRecords();
      return;
    }
    addRecord({ ...form, period, id: newRecordId() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    setPeriod(null);
    resetManualStatus();
    previousTouched.current = false;
    autoPrevious.current = false;
    setPreviousSy(null);
    setForm(EMPTY_STUDENT(school.id, "", activeSy));
  };

  const clear = () => {
    setPeriod(null);
    setPeriodError(false);
    setNameError(false);
    resetManualStatus();
    previousTouched.current = false;
    autoPrevious.current = false;
    setPreviousSy(null);
    setForm(EMPTY_STUDENT(school.id, "", activeSy));
  };

  const ageYears = parseInt(form.ageYears) || 0;

  /** Why the WHO auto-status cannot be worked out yet, or null when it can. */
  const autoHint = (() => {
    if (!form.weight || !form.height) return null;
    if (!form.sex) return "Auto status needs the learner's sex — the WHO 2007 tables differ for boys and girls.";
    if (!form.dateOfBirth) return "Auto status needs the date of birth — the WHO 2007 tables start at age 5.";
    if (ageYears < 5 || ageYears > 19) return `Age ${ageYears} is outside the WHO 2007 tables (ages 5–19), so set BMI and HFA status by hand.`;
    return null;
  })();

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={editing ? "Edit learner record" : "Data Entry"}
        subtitle={school.name}
        action={
          <div className="flex items-center gap-3">
            {saved && <span style={{ fontSize: 12, color: C.good, fontWeight: 600 }}>✓ Saved — encode another</span>}
            <Button tone="ghost" small onClick={goRecords}>Go to My Records →</Button>
          </div>
        }
      >
        <div>
          <span style={label}>Measurement period <span style={{ color: C.danger }}>*</span></span>
          <div className="flex gap-2 flex-wrap">
            {PERIODS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => choosePeriod(p)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  borderRadius: 9,
                  border: `1px solid ${period === p ? C.navy : C.border2}`,
                  background: period === p ? C.navy : C.surface,
                  color: period === p ? "#fff" : C.sub,
                  fontWeight: period === p ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {p}
              </button>
            ))}
          </div>
          {periodError && <p style={{ fontSize: 12, color: C.danger, marginTop: 8 }}>Choose Baseline, Midline or Endline first.</p>}
        </div>
      </Card>

      <Card title="Learner information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <Field text="Full name" required hint={nameError ? "The learner's name is required." : "Last name, First name Middle name"}>
              <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="dela Cruz, Juan M." style={control} />
            </Field>
          </div>
          <Field text="Sex">
            <div className="flex gap-2">
              {(["M", "F"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("sex", s)}
                  className="flex-1"
                  style={{
                    padding: "9px 0",
                    fontSize: 13,
                    borderRadius: 9,
                    border: `1px solid ${form.sex === s ? C.navy : C.border2}`,
                    background: form.sex === s ? C.navySoft : C.surface,
                    color: form.sex === s ? C.navy : C.sub,
                    fontWeight: form.sex === s ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {s === "M" ? "Male" : "Female"}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <Field text="Grade level">
            <select value={form.gradeLevel} onChange={e => set("gradeLevel", e.target.value)} style={{ ...control, cursor: "pointer" }}>
              <option value="">— Select —</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field text="Date of birth">
            <input type="date" value={form.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} style={control} />
          </Field>
          <Field text="Date of weighing">
            <input type="date" value={form.dateOfWeighing} onChange={e => set("dateOfWeighing", e.target.value)} style={control} />
          </Field>
          <Field text="School year">
            <input value={form.sy} onChange={e => set("sy", e.target.value)} style={control} />
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <Field text="Age — years (auto)">
            <input readOnly value={form.ageYears} placeholder="—" style={{ ...control, fontFamily: mono, background: C.surface2, color: C.navy }} />
          </Field>
          <Field text="Age — months (auto)">
            <input readOnly value={form.ageMonths} placeholder="—" style={{ ...control, fontFamily: mono, background: C.surface2, color: C.navy }} />
          </Field>
        </div>
      </Card>

      <Card title="Measurements" subtitle="BMI and the WHO 2007 statuses are computed for you — override them if the school's own measurement says otherwise.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field text="Weight (kg)">
            <input type="number" step="0.1" min={0.1} max={300} required value={form.weight} onChange={e => set("weight", e.target.value)} placeholder="e.g. 24.5" style={control} />
          </Field>
          <Field text="Height (cm)">
            <input type="number" step="0.1" min={1} max={250} required value={form.height} onChange={e => set("height", e.target.value)} placeholder="e.g. 118.0" style={control} />
          </Field>
          <Field text={`BMI ${ageYears >= 6 ? "(auto)" : "(6 y.o.+)"}`}>
            <input
              value={form.bmi}
              readOnly={ageYears >= 6}
              onChange={e => ageYears < 6 && set("bmi", e.target.value)}
              placeholder="—"
              style={{ ...control, fontFamily: mono, background: ageYears >= 6 ? C.surface2 : C.surface }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field text="BMI status (WHO 2007)">
            <select value={form.bmiStatus} onChange={e => set("bmiStatus", e.target.value as BMIStatus)} style={{ ...control, cursor: "pointer" }}>
              <option value="">— Select —</option>
              {BMI_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field text="Height-for-age status (WHO 2007)">
            <select value={form.hfaStatus} onChange={e => set("hfaStatus", e.target.value as HFAStatus)} style={{ ...control, cursor: "pointer" }}>
              <option value="">— Select —</option>
              {HFA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        {autoHint && (!form.bmiStatus || !form.hfaStatus) && (
          <p style={{ fontSize: 11.5, color: C.warn, marginTop: 10, lineHeight: 1.5 }}>{autoHint}</p>
        )}
        <div className="mt-4">
          <span style={label}>Beneficiary classification</span>
          <div className="flex gap-2" style={{ maxWidth: 420 }}>
            {(["Primary", "Secondary"] as const).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => set("classificationOfBeneficiary", c)}
                className="flex-1"
                style={{
                  padding: "9px 0",
                  fontSize: 13,
                  borderRadius: 9,
                  border: `1px solid ${form.classificationOfBeneficiary === c ? C.navy : C.border2}`,
                  background: form.classificationOfBeneficiary === c ? C.navySoft : C.surface,
                  color: form.classificationOfBeneficiary === c ? C.navy : C.sub,
                  fontWeight: form.classificationOfBeneficiary === c ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: C.dim, marginTop: 7 }}>
            Kinder and Grade 1 are Primary. From Grade 2, Wasted or Severely Wasted is Primary, and Stunted or Severely Stunted is Secondary. If a learner is both, the wasted status wins.
          </p>
        </div>
      </Card>

      <Card title="Additional information">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {([
            ["Pregnant?", "pregnant"],
            ["With 0–1 year-old child/ren?", "hasYoungChildren"],
            ["Dewormed?", "dewormed"],
            ["Parent's consent for milk?", "parentConsentMilk"],
            ["Participation in 4Ps?", "fourPs"],
            ["SBFP beneficiary in previous years?", "sbfpPreviousYears"],
          ] as [string, keyof Omit<Student, "id">][]).map(([text, key]) => {
            const locked = key === "pregnant" && mustNotBePregnant(form.sex);
            const defaultsNo = key === "pregnant" && !locked &&
              defaultsToNotPregnant(form.sex, form.ageYears);
            return (
              <div key={key as string}>
                <span style={label}>{text}</span>
                <YesNoToggle
                  value={form[key] as YesNo}
                  onChange={v => set(key, v)}
                  disabled={locked}
                />
                {locked && (
                  <p style={{ fontSize: 11, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>
                    Male learners are recorded as not pregnant.
                  </p>
                )}
                {defaultsNo && (
                  <p style={{ fontSize: 11, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>
                    Defaults to No at age 10 or below — you can still change it.
                  </p>
                )}
                {key === "sbfpPreviousYears" && previousSy && (
                  <p style={{ fontSize: 11, color: C.good, marginTop: 5, lineHeight: 1.45 }}>
                    This learner already has a record in SY {formatSchoolYear(previousSy)}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-6 flex-wrap">
          <Button onClick={save}>{editing ? "Update record" : "Save learner record"}</Button>
          {editing ? (
            <Button tone="ghost" onClick={() => { clearEditing(); goRecords(); }}>Cancel</Button>
          ) : (
            <Button tone="ghost" onClick={clear}>Clear form</Button>
          )}
          {saved && <span style={{ fontSize: 12, color: C.good, fontWeight: 600 }}>✓ Saved</span>}
        </div>
        {formError && (
          <p role="alert" style={{ fontSize: 12.5, color: C.danger, marginTop: 12, lineHeight: 1.55 }}>
            {formError}
          </p>
        )}
      </Card>
    </div>
  );
}

// ── My records ────────────────────────────────────────────────────────────────

function MyRecords({
  school,
  onEdit,
  goEntry,
}: {
  school: School;
  onEdit: (s: Student) => void;
  goEntry: () => void;
}) {
  const store = useTeacherStore();
  const [period, setPeriod] = useState<Period | "All">("All");
  const [cohort, setCohort] = useState<"All" | "Regular" | "SPED">("All");
  const [q, setQ] = useState("");
  /** The record the teacher asked to delete — nothing is removed until she confirms. */
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const mine = useMemo(
    () => sortRecords(store.records.filter(r => r.schoolId === school.id)),
    [store.records, school.id],
  );
  // Cohort buttons mirror the Summary Table: only Urdaneta 1 Central splits its
  // learners into Regular and SPED grade levels, so other schools don't see them.
  const isSpedSchool = school.name === SPED_SCHOOL_NAME;
  const isSpedGrade = (g: string) => g.startsWith("SPED");
  const needle = q.trim().toLowerCase();
  const visible = mine.filter(r =>
    (period === "All" || r.period === period) &&
    (!isSpedSchool || cohort === "All" ? true : cohort === "SPED" ? isSpedGrade(r.gradeLevel) : !isSpedGrade(r.gradeLevel)) &&
    (!needle || `${r.name} ${r.gradeLevel} ${r.bmiStatus} ${r.hfaStatus}`.toLowerCase().includes(needle)),
  );

  /**
   * SBFP Form 1A — the master list, with the same header block, columns and
   * signature footer the Division Office prints. It exports exactly what the
   * teacher is looking at (the period tab and the search), so a filtered list
   * is a filtered form.
   */
  const exportForm1 = async () => {
    setExportError("");
    if (visible.length === 0) return;
    setExporting(true);
    try {
      const { exportStudentsToExcel } = await import("@/lib/sbfp-export");
      await exportStudentsToExcel(
        school,
        visible,
        period === "All" ? "All" : period,
        store.activeSy,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "The Form 1 file could not be built.");
    } finally {
      setExporting(false);
    }
  };

  const th: CSSProperties = {
    color: C.dim,
    borderRight: `1px solid ${C.border}`,
    borderBottom: `1px solid ${C.border}`,
    background: C.surface2,
    verticalAlign: "middle",
  };
  const td = (v: string | number, opts?: { mono?: boolean; color?: string; nowrap?: boolean }) => (
    <td
      className="px-1.5 py-2 text-center"
      style={{
        fontFamily: opts?.mono ? mono : undefined,
        color: opts?.color ?? C.sub,
        borderRight: `1px solid ${C.surface2}`,
        whiteSpace: opts?.nowrap === false ? "normal" : "nowrap",
      }}
    >
      {v === "" || v === undefined ? "—" : v}
    </td>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: C.text }}>My Records</h1>
          <p className="text-xs mt-0.5" style={{ color: C.dim }}>
            {school.name} · SBFP Form 1A · sorted Kinder → Grade 6 · {uniqueCount(mine)} students · {mine.length} period records
            {isSpedSchool && cohort !== "All" ? ` · ${cohort} only` : ""}
          </p>
          <p className="text-[11px] mt-1" style={{ color: C.sub }}>
            School Head / Principal:{" "}
            <strong style={{ fontWeight: 600, color: school.principal ? C.text : C.dim }}>
              {school.principal || "Not filled in yet"}
            </strong>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportForm1}
            disabled={exporting || visible.length === 0}
            className="px-4 py-2 text-sm font-semibold rounded-sm border transition-colors"
            style={{
              background: visible.length === 0 || exporting ? C.surface2 : C.surface,
              color: visible.length === 0 || exporting ? C.dim : C.navy,
              borderColor: visible.length === 0 || exporting ? C.border : C.navy + "60",
              cursor: visible.length === 0 || exporting ? "not-allowed" : "pointer",
            }}
            title="SBFP Form 1A master list"
          >
            {exporting ? "Exporting…" : "↓ Export Excel"}
          </button>
          <button
            onClick={goEntry}
            className="px-4 py-2 text-sm font-semibold rounded-sm cursor-pointer"
            style={{ background: C.navy, color: "#fff" }}
          >
            + Add Student
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name or grade…"
          className="text-sm px-3 py-1.5 rounded-sm outline-none flex-1 min-w-[180px]"
          style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}` }}
        />
        {(["All", ...PERIODS] as const).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p as Period | "All")}
            className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
            style={
              period === p
                ? { background: C.navySoft, color: C.navy, borderColor: C.navy + "40" }
                : { background: C.surface, color: C.dim, borderColor: C.border }
            }
          >
            {p}
          </button>
        ))}
        {isSpedSchool &&
          (["All", "Regular", "SPED"] as const).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCohort(c)}
              className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
              style={
                cohort === c
                  ? { background: C.navySoft, color: C.navy, borderColor: C.navy + "40" }
                  : { background: C.surface, color: C.dim, borderColor: C.border }
              }
            >
              {c}
            </button>
          ))}
      </div>

      {exportError && (
        <p role="alert" className="text-xs" style={{ color: C.danger }}>
          {exportError}
        </p>
      )}

      <p className="text-[10px] md:hidden -mb-2" style={{ color: C.dim }}>
        Swipe the table sideways to see every column →
      </p>

      <div style={{ border: `1px solid ${C.border}`, background: C.surface }} className="overflow-x-auto">
        <table className="w-full text-[10px] min-w-[1480px] border-collapse">
          <thead>
            <tr>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>No.</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Name</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Sex</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Grade / Section</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Date of Birth<br />(MM/DD/YYYY)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Date of Weighing<br />(MM/DD/YYYY)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Age in Years / Months</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Weight (Kg)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Height (cm)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>BMI for 6 y.o.<br />and above</th>
              <th colSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase text-center" style={th}>Nutritional Status (NS)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Classification of<br />Beneficiary</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Pregnant<br />(Yes or No)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>With 0-1 year old<br />children</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Dewormed<br />(Yes or No)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Parent's consent<br />for milk</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Participation<br />in 4Ps</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Beneficiary of SBFP<br />in previous years</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={{ ...th, borderRight: "none" }}>Period / Actions</th>
            </tr>
            <tr>
              <th className="px-2 py-1.5 text-[8px] tracking-widest uppercase text-center" style={th}>BMI-A</th>
              <th className="px-2 py-1.5 text-[8px] tracking-widest uppercase text-center" style={th}>HFA</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, idx) => {
              const prev = visible[idx - 1];
              const gradeBreak = Boolean(prev && prev.gradeLevel !== s.gradeLevel);
              return (
                <tr
                  key={s.id}
                  className="group"
                  style={{
                    borderBottom: `1px solid ${C.surface2}`,
                    background: gradeBreak ? C.surface2 : "transparent",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#faf8f1")}
                  onMouseLeave={e => (e.currentTarget.style.background = gradeBreak ? C.surface2 : "transparent")}
                >
                  {td(idx + 1, { mono: true, color: C.dim })}
                  <td className="px-2 py-2 text-left font-medium" style={{ color: C.text, borderRight: `1px solid ${C.surface2}`, whiteSpace: "nowrap" }}>{s.name || "—"}</td>
                  {td(s.sex)}
                  {td(s.gradeLevel)}
                  {td(formatDateMDY(s.dateOfBirth), { mono: true })}
                  {td(formatDateMDY(s.dateOfWeighing), { mono: true })}
                  {td(`${s.ageYears || "0"}/${s.ageMonths || "0"}`, { mono: true })}
                  {td(s.weight || "", { mono: true })}
                  {td(s.height || "", { mono: true })}
                  {td(s.bmi || "", { mono: true, color: s.bmi ? C.navy : C.dim })}
                  <td className="px-1.5 py-2 text-center" style={{ borderRight: `1px solid ${C.surface2}` }}>
                    {s.bmiStatus ? <Pill text={s.bmiStatus} tone={bmiTone(s.bmiStatus)} /> : <span style={{ color: C.dim }}>—</span>}
                  </td>
                  <td className="px-1.5 py-2 text-center" style={{ borderRight: `1px solid ${C.surface2}` }}>
                    {s.hfaStatus ? <Pill text={s.hfaStatus} tone={bmiTone(s.hfaStatus)} /> : <span style={{ color: C.dim }}>—</span>}
                  </td>
                  {td(s.classificationOfBeneficiary || "")}
                  {td(s.pregnant || "")}
                  {td(s.hasYoungChildren || "")}
                  {td(s.dewormed || "")}
                  {td(s.parentConsentMilk || "")}
                  {td(s.fourPs || "")}
                  {td(s.sbfpPreviousYears || "")}
                  <td className="px-2 py-2" style={{ whiteSpace: "nowrap" }}>
                    <div className="flex items-center gap-2 justify-center">
                      {s.period ? (
                        <Pill
                          text={s.period}
                          tone={s.period === "Baseline" ? "navy" : s.period === "Midline" ? "warn" : "good"}
                        />
                      ) : null}
                      <span className="row-actions flex items-center gap-1.5">
                        <button
                          aria-label={`Edit ${s.name || "this learner"}'s record`}
                          onClick={() => onEdit(s)}
                          className="text-[11px] px-2.5 py-1 rounded-sm cursor-pointer border transition-colors"
                          style={{ background: C.surface2, color: C.sub, borderColor: C.border }}
                          onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.dim; }}
                          onMouseLeave={e => { e.currentTarget.style.color = C.sub; e.currentTarget.style.borderColor = C.border; }}
                        >
                          Edit
                        </button>
                        <button
                          aria-label={`Delete ${s.name || "this learner"}'s record`}
                          onClick={() => setPendingDelete(s)}
                          className="text-[11px] px-2.5 py-1 rounded-sm cursor-pointer border transition-colors"
                          style={{ background: "transparent", color: C.danger, borderColor: C.danger + "55" }}
                          onMouseEnter={e => { e.currentTarget.style.background = C.danger; e.currentTarget.style.color = "#fff"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.danger; }}
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={20} className="px-4 py-10 text-center text-sm" style={{ color: C.dim }}>
                  {mine.length === 0
                    ? "No learner records yet — use Add Student to encode the first one."
                    : "No record matches those filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name || "this learner"}'s record?`}
        confirmLabel="Delete record"
        cancelLabel="Keep record"
        palette={{
          surface: C.surface,
          surface2: C.dangerSoft,
          border: C.border2,
          text: C.text,
          sub: C.sub,
          danger: C.danger,
          dangerSoft: C.dangerSoft,
          font,
        }}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeRecord(pendingDelete.id);
          setPendingDelete(null);
        }}
      >
        <strong style={{ color: C.text }}>
          {pendingDelete?.name || "This learner"}
          {pendingDelete?.gradeLevel ? ` · ${pendingDelete.gradeLevel}` : ""}
          {pendingDelete?.period ? ` · ${pendingDelete.period}` : ""}
        </strong>
        <br />
        The record leaves {school.name}'s active list and moves to Trash, with its measurements intact. It stays
        recoverable until the Division Office opens the next school year, when the trash is emptied permanently.
      </ConfirmDialog>
    </div>
  );
}

// ── Trash ─────────────────────────────────────────────────────────────────────

function TrashScreen({ school }: { school: School }) {
  const store = useTeacherStore();
  const mine = useMemo(
    () => store.trash.filter(r => r.schoolId === school.id),
    [store.trash, school.id],
  );

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Trash"
        subtitle={`${mine.length} deleted record${mine.length === 1 ? "" : "s"} · ${school.name}`}
      >
        <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.65, maxWidth: 760 }}>
          Deleted learner records stay here during the current school year, with their measurements intact, so a
          mistake can be undone. When the Division Office opens the next school year, everything in the trash is
          deleted permanently.
        </p>
      </Card>

      {mine.length === 0 ? (
        <Card>
          <p style={{ fontSize: 13.5, color: C.sub }}>The trash is empty.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {mine.map(r => (
            <div
              key={r.id}
              className="flex flex-col md:flex-row md:items-center gap-3"
              style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", background: C.surface }}
            >
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
                  {r.name || "Unnamed learner"}
                </div>
                <div style={{ fontSize: 11.5, color: C.dim, marginTop: 5 }}>
                  {r.gradeLevel || "Grade not set"} · {r.period} · SY {formatSchoolYear(r.sy)}
                  {r.deletedAt ? ` · deleted ${shortDate(r.deletedAt)}` : ""}
                </div>
              </div>
              <Button small tone="ghost" onClick={() => restoreRecord(r.id)}>Restore</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Feedback to the district ──────────────────────────────────────────────────

function FeedbackScreen({ profile, school }: { profile: TeacherProfile; school: School }) {
  const store = useTeacherStore();
  const [category, setCategory] = useState<FeedbackCategory>("Feeding Implementation");
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [filter, setFilter] = useState<"All" | "New" | "Acknowledged" | "Resolved">("All");

  const mine = useMemo(
    () => store.feedbacks.filter(f => f.schoolId === school.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [store.feedbacks, school.id],
  );
  const visible = filter === "All" ? mine : mine.filter(f => f.status === filter);
  const replies = mine.filter(f => f.response).length;

  const submit = () => {
    if (!message.trim()) return;
    const entry: SchoolFeedback = {
      id: newFeedbackId(),
      schoolId: school.id,
      author: profile.teacherName,
      role: profile.position || "SBFP Feeding Focal Person",
      category,
      rating,
      message: message.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
      status: "New",
      origin: "School Portal",
    };
    sendFeedback(entry);
    setMessage("");
    setRating(5);
    setFilter("All");
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  };

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Feedback to the district office"
        subtitle={`Sent as ${profile.teacherName}${profile.position ? ` · ${profile.position}` : ""} · it appears in the district's Feedbacks feed and their reply comes back here.`}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field text="What is this about?">
            <select value={category} onChange={e => setCategory(e.target.value as FeedbackCategory)} style={{ ...control, cursor: "pointer" }}>
              {FEEDBACK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field text="How is feeding going at your school?">
            <StarPicker value={rating} onChange={setRating} />
          </Field>
        </div>
        <div className="mt-4">
          <Field text="Message" hint="Be specific — delivery counts, learners referred, supplies, anything the district needs to act on.">
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="e.g. The Grade 4 milk delivery for week 3 was short by two cartons."
              style={{ ...control, resize: "vertical" }}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <Button onClick={submit} disabled={!message.trim()}>Send to district office</Button>
          {sent && <span style={{ fontSize: 12, color: C.good, fontWeight: 600 }}>✓ Sent — the district office has it now</span>}
        </div>
      </Card>

      <Card
        title="What I have sent"
        subtitle={`${mine.length} sent · ${replies} replied to`}
        action={
          <div className="flex gap-2 flex-wrap">
            {(["All", "New", "Acknowledged", "Resolved"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  padding: "6px 11px",
                  fontSize: 12,
                  borderRadius: 999,
                  border: `1px solid ${filter === f ? C.navy : C.border2}`,
                  background: filter === f ? C.navySoft : C.surface,
                  color: filter === f ? C.navy : C.sub,
                  fontWeight: filter === f ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        {visible.length === 0 ? (
          <p style={{ fontSize: 13.5, color: C.sub }}>
            {mine.length === 0 ? "Nothing sent yet. Tell the district office how the feeding program is going." : `No ${filter.toLowerCase()} feedback.`}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map(f => (
              <div key={f.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: C.surface2 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Pill text={f.category} tone="navy" />
                  <Pill
                    text={f.status}
                    tone={f.status === "Resolved" ? "good" : f.status === "Acknowledged" ? "warn" : "gold"}
                  />
                  <Stars value={f.rating} />
                  <span style={{ fontSize: 11.5, color: C.dim, marginLeft: "auto" }}>{shortDate(f.createdAt)}</span>
                </div>
                <p style={{ fontSize: 13.5, color: C.text, marginTop: 10, lineHeight: 1.55 }}>{f.message}</p>
                {f.response ? (
                  <div style={{ marginTop: 12, paddingLeft: 13, borderLeft: `3px solid ${C.navy}`, background: C.navySoft, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.navy, fontWeight: 700 }}>
                      District response
                    </div>
                    <p style={{ fontSize: 13, color: C.text, marginTop: 5, lineHeight: 1.5 }}>{f.response}</p>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>Waiting for the district office's reply.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── The site ──────────────────────────────────────────────────────────────────

// ── Summary Table — the school's SBFP numbers, and Form 2 ──────────────────

/** Every figure for one grade/sex row, computed once in a single pass. */
interface Tally {
  bmi: number[];
  hfa: number[];
  learners: number;
  fourPs: number;
  sbfp: number;
  dewormed: number;
  pregnantYoung: number;
}

function SummaryTable({ school, onEntry }: { school: School; onEntry: () => void }) {
  const store = useTeacherStore();
  const [cohort, setCohort] = useState<"All" | "Regular" | "SPED">("All");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  // Open on the period the school actually has records in: a teacher who has
  // just encoded Baseline should not land on an empty Endline table.
  const [chosenPeriod, setPeriod] = useState<Period | null>(null);

  const isSpedSchool = school.name === SPED_SCHOOL_NAME;
  const isSpedGrade = (g: string) => g.startsWith("SPED");
  const allGrades = getGrades(school);
  // Urdaneta 1 Central is the division's SPED school: "All Students" folds SPED
  // Kinder into Kinder, exactly as the district's own Summary Table does, so a
  // school's figures and the district's agree for the same records.
  const mergeSped = isSpedSchool && cohort === "All";
  const grades = !isSpedSchool || cohort === "All"
    ? (mergeSped ? allGrades.filter(g => !isSpedGrade(g)) : allGrades)
    : cohort === "SPED"
      ? allGrades.filter(isSpedGrade)
      : allGrades.filter(g => !isSpedGrade(g));

  const mine = useMemo(() => store.records.filter(r => r.schoolId === school.id), [store.records, school.id]);
  const period: Period = chosenPeriod ?? PERIODS.find(p => mine.some(r => r.period === p)) ?? "Baseline";
  const { extras, setExtra } = useForm2Extras(school.id, period);
  /**
   * Only this period's records. The cohort filter has to be parenthesised:
   * `&&` binds tighter than `?:`, so without the parentheses the whole filter
   * became `(period matches && not a SPED school) ? keep : (grade test)` — and
   * a regular school's grade test passes, so the table silently counted every
   * period at once and the Baseline/Midline/Endline tabs showed the same
   * inflated figures.
   */
  const shown = useMemo(
    () => mine.filter(s =>
      s.period === period &&
      (!isSpedSchool || cohort === "All"
        ? true
        : cohort === "SPED" ? isSpedGrade(s.gradeLevel) : !isSpedGrade(s.gradeLevel)),
    ),
    [mine, period, isSpedSchool, cohort],
  );
  const perPeriod = PERIODS.map(p => ({ p, n: mine.filter(r => r.period === p).length }));

  /**
   * A record can carry no stored WHO status (an older record, or one whose
   * status was cleared). Classify it from its own measurements here, so the
   * table never counts a weighed learner in the learner total but in none of
   * the status columns.
   */
  const rows = useMemo(
    () => shown.map(s => ({
      ...s,
      bmiStatus: s.bmiStatus || classifyBMI(
        s.bmi || calcBMI(s.weight, s.height),
        s.ageYears || computeAge(s.dateOfBirth).years,
        s.sex,
      ),
      hfaStatus: s.hfaStatus || classifyHFA(
        s.height,
        s.ageYears || computeAge(s.dateOfBirth).years,
        s.sex,
      ),
    })),
    [shown],
  );

  /** A learner's grade belongs in this row — merged rows also take the SPED grade. */
  const inGrade = (g: string, grade: GradeLevel) => (mergeSped ? g.replace(/^SPED /, "") === grade : g === grade);

  /**
   * Every figure for one grade/sex row, in a single pass over this period.
   * The previous version ran a separate `.filter` per cell — a few hundred
   * passes over the same records every render, which is what made opening the
   * table feel slow on a school with many records.
   */
  const tally = (grade: GradeLevel | null, sex: Sex | null): Tally => {
    const out: Tally = {
      bmi: BMI_STATUSES.map(() => 0), hfa: HFA_STATUSES.map(() => 0), learners: 0,
      fourPs: 0, sbfp: 0, dewormed: 0, pregnantYoung: 0,
    };
    for (const s of rows) {
      if (sex !== null && s.sex !== sex) continue;
      if (grade !== null && !inGrade(s.gradeLevel, grade)) continue;
      out.learners += 1;
      const b = BMI_STATUSES.indexOf(s.bmiStatus);
      if (b >= 0) out.bmi[b] += 1;
      const h = HFA_STATUSES.indexOf(s.hfaStatus);
      if (h >= 0) out.hfa[h] += 1;
      if (s.fourPs === "Yes") out.fourPs += 1;
      if (s.sbfpPreviousYears === "Yes") out.sbfp += 1;
      if (s.dewormed === "Yes") out.dewormed += 1;
      if (countsAsPregnantOrYoung(s)) out.pregnantYoung += 1;
    }
    return out;
  };
  const sx = (lbl: "M" | "F" | "Total"): Sex | null => (lbl === "Total" ? null : lbl);
  /** Learners counted in the table but still missing one of the two WHO classes. */
  const unclassified = rows.filter(s => !s.bmiStatus || !s.hfaStatus).length;
  const overall = tally(null, null);

  /**
   * The rows below, flattened for the Form 2 export — built from the same
   * counters as the table, so the .xlsx cannot drift from the screen.
   */
  const summaryMatrix = (): SummaryMatrixRow[] => {
    const perGrade = (grade: GradeLevel | null, text: string): SummaryMatrixRow[] =>
      (["M", "F", "Total"] as const).map(lbl => {
        const t = tally(grade, sx(lbl));
        return {
          grade: text,
          sex: lbl,
          bmi: t.bmi,
          hfa: t.hfa,
          pregnantYoung: t.pregnantYoung,
          dewormed: t.dewormed,
          fourPs: t.fourPs,
          sbfp: t.sbfp,
          atRisk: manualTotal(extras, grades, grade, lbl, "atRisk"),
          ips: manualTotal(extras, grades, grade, lbl, "ips"),
        };
      });
    return [...grades.flatMap(g => perGrade(g, g)), ...perGrade(null, "GRAND TOTAL")];
  };
  /** The same matrix the screen shows and the .xlsx prints. */
  const summaryRows = summaryMatrix();

  const exportForm2 = async () => {
    setExporting(true);
    setExportError("");
    try {
      const { exportSummaryToExcel } = await import("@/lib/sbfp-export");
      await exportSummaryToExcel({
        school,
        period,
        cohort,
        sy: store.activeSy,
        bmiStatuses: BMI_STATUSES,
        hfaStatuses: HFA_STATUSES,
        rows: summaryRows,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "The Form 2 export could not be built.");
    } finally {
      setExporting(false);
    }
  };

  const males = tally(null, "M").learners;
  const wasted = overall.bmi[0] + overall.bmi[1];
  const stunted = overall.hfa[0] + overall.hfa[1];

  if (mine.length === 0) {
    return (
      <Card title="Summary Table" subtitle={`${school.name} — the SBFP Form 2 figures per grade and sex.`}>
        <p style={{ fontSize: 13.5, color: C.sub, maxWidth: 620 }}>
          Nothing to summarise yet. Encode the school's learners — Baseline, Midline and Endline — and this table fills in
          per grade and sex, ready to export as SBFP Form 2.
        </p>
        <div className="mt-4">
          <Button onClick={onEntry}>Go to Data Entry</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Summary Table"
        subtitle={`${school.name} · ${period} · SY ${formatSchoolYear(store.activeSy)}${isSpedSchool && cohort !== "All" ? ` · ${cohort} only` : ""}`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {isSpedSchool && (["All", "Regular", "SPED"] as const).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCohort(c)}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 999,
                  border: `1px solid ${cohort === c ? C.navy : C.border2}`,
                  background: cohort === c ? C.navySoft : C.surface,
                  color: cohort === c ? C.navy : C.sub,
                  fontWeight: cohort === c ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {c === "All" ? "All Students" : c}
              </button>
            ))}
            <Button onClick={exportForm2} disabled={shown.length === 0 || exporting}>
              {exporting ? "Exporting…" : "↓ Export Form 2"}
            </Button>
          </div>
        }
      >
        <div className="flex gap-2 flex-wrap items-center">
          <span style={{ ...label, marginBottom: 0 }}>Period</span>
          {perPeriod.map(({ p, n }) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              title={`${n} record${n === 1 ? "" : "s"} encoded`}
              style={{
                padding: "6px 12px", fontSize: 12, borderRadius: 999,
                border: `1px solid ${period === p ? C.navy : C.border2}`,
                background: period === p ? C.navy : C.surface,
                color: period === p ? "#fff" : n ? C.sub : C.dim,
                fontWeight: period === p ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {p} · {n}
            </button>
          ))}
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <p style={{ fontSize: 13.5, color: C.sub }}>
            No {period} records yet{isSpedSchool && cohort !== "All" ? ` for the ${cohort} cohort` : ""}. Encode them and
            this table fills in.
          </p>
          <div className="mt-4"><Button onClick={onEntry}>Encode {period} records</Button></div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat text={`${period} learners`} value={overall.learners} hint={`${males} M · ${overall.learners - males} F`} accent />
            <Stat text="Wasted" value={wasted} hint="severely wasted + wasted" />
            <Stat text="Stunted" value={stunted} hint="severely stunted + stunted" />
            <Stat text="Dewormed" value={overall.dewormed} hint={`4P's: ${overall.fourPs}`} />
          </div>

          {exportError && (
            <p role="alert" style={{ fontSize: 12.5, color: C.danger }}>
              {exportError}
            </p>
          )}

          <Form2Sheet
            school={school}
            period={period}
            cohort={isSpedSchool ? cohort : "All"}
            sy={store.activeSy}
            rows={summaryRows}
            onExtraChange={(grade, sex, patch) => setExtra(grade, sex, patch)}
          />

          {unclassified > 0 && (
            <p style={{ fontSize: 12, color: C.warn, marginTop: -6 }}>
              {unclassified} learner{unclassified === 1 ? "" : "s"} in this period {unclassified === 1 ? "has" : "have"} no
              BMI or height-for-age classification yet — open the record and complete the measurements. The status columns
              count classified learners only.
            </p>
          )}

          <Card>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <p style={{ fontSize: 12.5, color: C.sub, maxWidth: 640, lineHeight: 1.6 }}>
                This table covers the {shown.length} {period} record{shown.length === 1 ? "" : "s"} this school has encoded
                from the portal. The district office keeps the school's full master list in its own Summary Table, and both
                use the same per-grade, per-sex figures and the same Form 2 layout — so what you export here is the same
                printed form, filled from the school's own encoding.
              </p>
              <Button tone="ghost" small onClick={onEntry}>＋ Encode more records</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── The site ──────────────────────────────────────────────────────────────

export default function TeacherApp({ resetToken }: { resetToken?: string } = {}) {
  // The signed-in account and the rows the server handed it. Which one of the
  // screens below shows is decided by that account — not by anything stored in
  // this browser — so a teacher on a borrowed laptop sees exactly her school.
  const access = useAccess();
  const store = access.store;
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState<Student | null>(null);

  // The workbook engine (ExcelJS) is a ~900 KB chunk that only an export needs.
  // Warm it once a teacher is signed in — not for every visitor on the sign-in
  // screen — so the first Form 1/2 export builds straight away.
  useEffect(() => {
    if (typeof window === "undefined" || access.status !== "teacher") return;
    const warm = () => void import("@/lib/sbfp-export");
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(warm, 2000);
    return () => globalThis.clearTimeout(id);
  }, [access.status]);

  // Signing in always opens on the Overview rather than wherever the last
  // teacher left the tab.
  const activeSchoolId = store.activeSchoolId;
  useEffect(() => {
    setTab("overview");
    setEditing(null);
  }, [activeSchoolId]);

  const profile = activeProfile(store);
  // The profile IS the school's SBFP form header, so what the teacher saved is
  // what this site shows — and what the Form 2 export prints on the form.
  const school = useMemo(() => {
    if (!profile) return null;
    // The school row comes from the database (see migrations/0005) — the
    // portal reads the same list the Division Office sees.
    const base = store.schools.find(s => s.id === profile.schoolId);
    if (!base) return null;
    return {
      ...base,
      division: profile.division,
      cityMunicipalityBarangay: profile.cityMunicipalityBarangay,
      schoolIdNumber: profile.schoolIdNumber,
      principal: profile.principal,
      focalPerson: profile.focalPerson,
      dateStartFeeding: profile.dateStartFeeding,
      lastMileSchool: profile.lastMileSchool,
    };
  }, [profile, store.schools]);

  // A reset link wins over the signed-in portal and the on-hold screen: the
  // person opening it may be on a borrowed device or still holding a stale
  // session, and the token itself is the proof. All hooks above run first.
  if (resetToken) return <TeacherResetPassword token={resetToken} />;

  const signedIn = access.status === "teacher" && Boolean(school && profile);

  // No loading screen: the sign-in form below is the first paint. A teacher who
  // is already signed in is swapped to her portal as soon as the session and
  // workspace arrive; a signed-out visitor can start typing immediately.
  if (access.status === "disabled") return <AccountOnHold access={access} />;

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: font }}>
      <header className="app-topbar" style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 10 }}>
        <div className="mx-auto px-5" style={{ maxWidth: tab === "summary" ? 1680 : tab === "records" ? 1680 : 1080 }}>
          <div className="flex items-center gap-3 py-3 flex-wrap">
            <a href="/" className="flex items-center gap-3" style={{ textDecoration: "none" }}>
              <img src="/school-health-wheel.svg" alt="" width={36} height={36} />
              <span>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: C.text }}>SBFP School Portal</span>
                <span style={{ display: "block", fontSize: 11, color: C.dim }}>
                  Urdaneta City Schools Division · SY {formatSchoolYear(store.activeSy)}
                </span>
              </span>
            </a>
            <div className="flex items-center gap-3 ml-auto" style={{ color: C.sub }}>
              {signedIn && profile && school && (
                <>
                  <div className="text-right hidden sm:block">
                    <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{profile.teacherName}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>{school.name}</div>
                  </div>
                  <UserButton redirectTo="/" />
                </>
              )}
            </div>
          </div>

          {signedIn && (
            <nav className="flex gap-1 pb-2 overflow-x-auto">
              {TABS.map(item => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setTab(item.id);
                      if (item.id !== "entry") setEditing(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      fontSize: 13,
                      whiteSpace: "nowrap",
                      borderRadius: 999,
                      border: `1px solid ${active ? C.navy : "transparent"}`,
                      background: active ? C.navySoft : "transparent",
                      color: active ? C.navy : C.sub,
                      fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      {store.syncError && (
        <div
          className="mx-auto px-5"
          style={{ maxWidth: 1080, marginTop: 14, background: C.dangerSoft, border: "1px solid #f0d3d0", color: C.danger, borderRadius: 10, padding: "10px 12px", fontSize: 12.5 }}
        >
          {store.syncError}
        </div>
      )}

      {!signedIn ? (
        <TeacherSignIn
          notice={
            access.status === "no-account" || access.status === "admin"
              ? <NoAccountNotice access={access} />
              : undefined
          }
        />
      ) : !school || !profile ? (
        <div className="mx-auto px-5 py-10" style={{ maxWidth: 720 }}>
          <Card title="This account's school is not in the division list">
            <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.65 }}>
              The account <strong style={{ color: C.text }}>{access.email}</strong> is set to a school the division
              console no longer has on file. Ask the Division Office to point your account at the right school from
              School Accounts.
            </p>
          </Card>
        </div>
      ) : (
        <main className="mx-auto px-5 py-6" style={{ maxWidth: tab === "summary" ? 1680 : tab === "records" ? 1680 : 1080 }}>
          {tab === "overview" && <Overview profile={profile} school={school} go={setTab} />}
          {tab === "profile" && <ProfileScreen profile={profile} school={school} />}
          {tab === "entry" && (
            <DataEntry
              school={school}
              editing={editing}
              clearEditing={() => setEditing(null)}
              goRecords={() => setTab("records")}
            />
          )}
          {tab === "records" && (
            <MyRecords
              school={school}
              onEdit={s => { setEditing(s); setTab("entry"); }}
              goEntry={() => { setEditing(null); setTab("entry"); }}
            />
          )}
          {tab === "summary" && <SummaryTable school={school} onEntry={() => { setEditing(null); setTab("entry"); }} />}
          {tab === "feedback" && <FeedbackScreen profile={profile} school={school} />}
          {tab === "trash" && <TrashScreen school={school} />}

          <footer className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: 34, paddingTop: 16, borderTop: `1px solid ${C.border}`, fontSize: 11.5, color: C.dim }}>
            <span>
              SBFP School Portal · one account per school · saved to the division's records server
            </span>
          </footer>
        </main>
      )}
    </div>
  );
}
