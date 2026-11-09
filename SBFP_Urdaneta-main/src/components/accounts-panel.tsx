/**
 * School Accounts — where the Division Office issues and runs the schools'
 * School Portal accounts.
 *
 * One account per school: the panel creates it (email + a temporary password to
 * hand over), shows what each school has sent up, and lets the Division Office
 * put an account on hold, move it to another school, hand out a new password, or
 * take it away. The account itself is what authorizes school personnel — see
 * `@/lib/sbfp-accounts` — so nothing here is decoration: without a row on this
 * page, a school cannot reach the portal at all.
 *
 * The school's own work is never deleted from here: removing or replacing an
 * account leaves the school's form header, learner records and feedback in place.
 */
import { useMemo, useState, type CSSProperties } from "react";
import {
  changeOwnPassword,
  createTeacherAccount,
  removeTeacherAccount,
  resetAccountPassword,
  updateTeacherAccount,
} from "@/lib/sbfp-api";
import { signOut } from "@/lib/auth/client";
import { generateTempPassword, MIN_PASSWORD_LENGTH } from "@/lib/sbfp-credentials";
import type { School } from "@/lib/sbfp-shared";
import type { TeacherProfile } from "@/lib/sbfp-store";
import type { TC } from "@/sbfp-app";

const font = "'Outfit', sans-serif";
const mono = "'JetBrains Mono', monospace";

/** ISO timestamp or date → "Oct 02, 2026"; empty stays empty. */
function shortDate(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1] ?? m[2]} ${m[3]}, ${m[1]}`;
}

const label: CSSProperties = {
  display: "block",
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  marginBottom: 6,
  fontWeight: 600,
};

export interface CredentialSlip {
  schoolName: string;
  teacherName: string;
  email: string;
  password: string;
  /** True when the password was just issued (reset), false on creation. */
  reset: boolean;
}

function input(t: TC): CSSProperties {
  return {
    width: "100%",
    fontSize: 13,
    padding: "9px 11px",
    borderRadius: 6,
    border: `1px solid ${t.border}`,
    background: t.surfaceDeep,
    color: t.text,
    fontFamily: font,
    outline: "none",
  };
}

function Btn({
  t,
  children,
  onClick,
  tone = "ghost",
  small,
  disabled,
  type = "button",
}: {
  t: TC;
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "accent" | "ghost" | "danger";
  small?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const color = tone === "accent" ? t.accent : tone === "danger" ? t.danger : t.sub;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="transition-all"
      style={{
        padding: small ? "5px 10px" : "9px 15px",
        fontSize: small ? 11 : 12.5,
        fontWeight: 500,
        borderRadius: 6,
        cursor: disabled ? "wait" : "pointer",
        border: `1px solid ${tone === "ghost" ? t.border : `${color}55`}`,
        background: tone === "ghost" ? t.surface2 : `${color}18`,
        color,
        fontFamily: font,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Card({ t, title, subtitle, action, children }: {
  t: TC;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.surface, padding: 18 }}>
      {(title || action) && (
        <div className="flex items-start gap-4 mb-4">
          <div className="min-w-0 flex-1">
            {title && (
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{title}</div>
            )}
            {subtitle && (
              <div style={{ fontSize: 11.5, color: t.dim, marginTop: 4, lineHeight: 1.55 }}>
                {subtitle}
              </div>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The Division Office's own sign-in.
 *
 * Without this card the only way to change the console password was an emailed
 * reset link, and email delivery is not configured — so the account was stuck
 * with whatever password it was created with. It is the account that can read
 * every school's learner records, which made that the most important password
 * in the app to be able to rotate.
 *
 * Saving deletes every session for the account (see `resetPassword` in
 * `@/lib/sbfp-accounts`), including this one, so it signs out afterwards and
 * asks for the new password.
 */
function SecurityCard({ t, email }: { t: TC; email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

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
      data: { currentPassword: current, newPassword: next },
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    setDone(true);
    // The server ended every session for this account, so this one is gone too.
    window.setTimeout(() => void signOut("/"), 1600);
  };

  return (
    <Card
      t={t}
      title="Your Division Office sign-in"
      subtitle="This account can read every school's learner records and issue any school's sign-in. Change its password whenever someone who knew it leaves."
    >
      <div style={{ fontSize: 12, color: t.sub, marginBottom: 14 }}>
        Signed in as <span style={{ fontFamily: mono, color: t.text }}>{email || "—"}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label>
          <span style={{ ...label, color: t.dim }}>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={input(t)} />
        </label>
        <label>
          <span style={{ ...label, color: t.dim }}>New password</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={input(t)} />
        </label>
        <label>
          <span style={{ ...label, color: t.dim }}>Repeat new password</span>
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} style={input(t)} />
        </label>
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 12.5, color: t.danger, marginTop: 12 }}>{error}</p>
      )}
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        <Btn t={t} tone="accent" onClick={() => void submit()} disabled={busy || done}>
          {busy ? "Saving…" : "Change password"}
        </Btn>
        <span style={{ fontSize: 11.5, color: done ? t.accent : t.dim }}>
          {done
            ? "Password changed. Every session was signed out — sign in again with the new password…"
            : "Saving signs you out on every device, including this one."}
        </span>
      </div>
    </Card>
  );
}

export default function AccountsPanel({
  theme: t,
  schools,
  accounts,
  viewerEmail,
  onChanged,
}: {
  theme: TC;
  schools: School[];
  accounts: TeacherProfile[];
  /** The signed-in Division Office account — the one this panel can re-password. */
  viewerEmail: string;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [slip, setSlip] = useState<CredentialSlip | null>(null);
  const [error, setError] = useState("");
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const bySchool = useMemo(() => new Map(accounts.map((a) => [a.schoolId, a])), [accounts]);
  const active = accounts.filter((a) => a.status === "active").length;
  const onHold = accounts.length - active;
  const sorted = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        const an = schools.find((s) => s.id === a.schoolId)?.name ?? a.schoolId;
        const bn = schools.find((s) => s.id === b.schoolId)?.name ?? b.schoolId;
        return an.localeCompare(bn);
      }),
    [accounts, schools],
  );

  const openCount = schools.length - accounts.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[240px]">
          <h2 style={{ fontSize: 19, fontWeight: 600, color: t.text }}>School Accounts</h2>
          <p style={{ fontSize: 12.5, color: t.dim, marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
            One account per school — the email and temporary password you issue here are what the
            school personnel signs in with on the School Portal. A school without an account cannot
            reach the portal at all.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {[
            { k: "With an account", v: accounts.length, c: t.accent },
            { k: "On hold", v: onHold, c: onHold ? t.warning : t.dim },
            { k: "Still to issue", v: openCount, c: t.blue },
          ].map((s) => (
            <div key={s.k}>
              <div style={{ fontSize: 20, fontFamily: mono, color: s.c, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: t.dim, marginTop: 4 }}>{s.k}</div>
            </div>
          ))}
          <Btn t={t} tone="accent" onClick={() => { setCreating(true); setError(""); }}>
            ＋ New school account
          </Btn>
        </div>
      </div>

      <SecurityCard t={t} email={viewerEmail} />

      {slip && <CredentialCard t={t} slip={slip} onClose={() => setSlip(null)} />}

      {error && (
        <div
          style={{
            border: `1px solid ${t.danger}55`,
            background: `${t.danger}14`,
            color: t.danger,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {creating && (
        <CreateAccountForm
          t={t}
          schools={schools}
          bySchool={bySchool}
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setSlip(created);
            onChanged();
          }}
        />
      )}

      {accounts.length === 0 ? (
        <Card t={t}>
          <p style={{ fontSize: 13.5, color: t.sub, lineHeight: 1.6 }}>
            No school has an account yet. Create the first one: pick the school, name the school
            personnel, and hand over the email and temporary password — they can then sign in at the
            School Portal and encode the school's learner records.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((account) => {
            const school = schools.find((s) => s.id === account.schoolId);
            const name = school?.name ?? account.schoolId;
            const held = account.status !== "active";
            return (
              <div
                key={account.email}
                style={{
                  border: `1px solid ${held ? `${t.warning}44` : t.border}`,
                  borderRadius: 8,
                  background: t.surface,
                  padding: "14px 16px",
                }}
              >
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{name}</span>
                      {school && (
                        <span
                          style={{
                            fontSize: 9,
                            fontFamily: mono,
                            padding: "2px 6px",
                            borderRadius: 4,
                            border: `1px solid ${t.border}`,
                            color: school.type === "Elementary" ? t.blue : t.lime,
                          }}
                        >
                          {school.type === "Elementary" ? "ES" : "HS"}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 9.5,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          padding: "2px 7px",
                          borderRadius: 999,
                          color: held ? t.warning : t.accent,
                          background: held ? `${t.warning}18` : t.accentBg,
                          border: `1px solid ${held ? `${t.warning}44` : `${t.accent}44`}`,
                        }}
                      >
                        {held ? "On hold" : "Active"}
                      </span>
                      {account.tempPassword && !held && (
                        <span style={{ fontSize: 10, color: t.dim }}>
                          temporary password still in use
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: t.sub, marginTop: 6 }}>
                      {account.teacherName || "— unfilled —"}
                      {account.position ? ` · ${account.position}` : ""}
                      {account.contact ? ` · ${account.contact}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: t.dim, marginTop: 4, fontFamily: mono }}>
                      {account.email}
                    </div>
                    <div style={{ fontSize: 11, color: t.dim, marginTop: 6 }}>
                      {account.recordCount} learner record{account.recordCount === 1 ? "" : "s"} ·{" "}
                      {account.feedbackCount} feedback entr{account.feedbackCount === 1 ? "y" : "ies"}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Btn
                      t={t}
                      small
                      disabled={busyEmail === account.email}
                      onClick={async () => {
                        setBusyEmail(account.email);
                        setError("");
                        const password = generateTempPassword();
                        const result = await resetAccountPassword({
                          data: { email: account.email, password },
                        });
                        setBusyEmail(null);
                        if (!result.ok) {
                          setError(result.message);
                          return;
                        }
                        setSlip({
                          schoolName: name,
                          teacherName: account.teacherName,
                          email: account.email,
                          password,
                          reset: true,
                        });
                        onChanged();
                      }}
                    >
                      {busyEmail === account.email ? "Working…" : "New password"}
                    </Btn>
                    <Btn
                      t={t}
                      small
                      onClick={() => setEditing(editing === account.email ? null : account.email)}
                    >
                      {editing === account.email ? "Close" : "Edit"}
                    </Btn>
                    <Btn
                      t={t}
                      small
                      disabled={busyEmail === account.email}
                      onClick={async () => {
                        setBusyEmail(account.email);
                        setError("");
                        const result = await updateTeacherAccount({
                          data: { email: account.email, status: held ? "active" : "disabled" },
                        });
                        setBusyEmail(null);
                        if (!result.ok) setError(result.message);
                        else onChanged();
                      }}
                    >
                      {held ? "Lift hold" : "Put on hold"}
                    </Btn>
                    <Btn
                      t={t}
                      small
                      tone="danger"
                      disabled={busyEmail === account.email}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Remove the account for ${name}? The school keeps its learner records, form header and feedback — only the sign-in goes away.`,
                          )
                        ) {
                          return;
                        }
                        setBusyEmail(account.email);
                        setError("");
                        const result = await removeTeacherAccount({ data: { email: account.email } });
                        setBusyEmail(null);
                        if (!result.ok) setError(result.message);
                        else {
                          setSlip(null);
                          onChanged();
                        }
                      }}
                    >
                      Remove
                    </Btn>
                  </div>
                </div>

                {editing === account.email && (
                  <EditAccountForm
                    t={t}
                    schools={schools}
                    bySchool={bySchool}
                    account={account}
                    onDone={() => { setEditing(null); onChanged(); }}
                    onError={setError}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The one-time slip the Division Office hands a school. */
function CredentialCard({ t, slip, onClose }: { t: TC; slip: CredentialSlip; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = [
    "SBFP School Portal — sign-in",
    `School: ${slip.schoolName}`,
    `School Personnel: ${slip.teacherName || "(name to follow)"}`,
    `Email: ${slip.email}`,
    `Temporary password: ${slip.password}`,
    "",
    "Open the School Portal, sign in with the email and password above, then change the password in My Profile → Account.",
  ].join("\n");
  return (
    <div
      style={{
        border: `1px solid ${t.accent}55`,
        background: t.grandBg,
        borderRadius: 8,
        padding: 18,
      }}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: t.accent,
              fontWeight: 700,
            }}
          >
            {slip.reset ? "New temporary password" : "Account issued"}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginTop: 8 }}>
            {slip.schoolName}
          </div>
          <div style={{ fontSize: 12, color: t.sub, marginTop: 2 }}>
            {slip.teacherName || "— name to follow —"}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4" style={{ maxWidth: 520 }}>
            <div>
              <span style={{ ...label, color: t.dim }}>Sign-in email</span>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 13,
                  color: t.text,
                  background: t.surfaceDeep,
                  border: `1px solid ${t.border}`,
                  borderRadius: 6,
                  padding: "9px 11px",
                  wordBreak: "break-all",
                }}
              >
                {slip.email}
              </div>
            </div>
            <div>
              <span style={{ ...label, color: t.dim }}>Temporary password</span>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 15,
                  letterSpacing: "0.06em",
                  color: t.accent,
                  background: t.surfaceDeep,
                  border: `1px solid ${t.border}`,
                  borderRadius: 6,
                  padding: "9px 11px",
                }}
              >
                {slip.password}
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: t.dim, marginTop: 10, lineHeight: 1.6, maxWidth: 560 }}>
            This is the only time the password is shown. The account holder can change it in
            My Profile → Account on the School Portal; if it is lost, issue a new one from here.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Btn
            t={t}
            tone="accent"
            small
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "✓ Copied" : "Copy sign-in details"}
          </Btn>
          <Btn t={t} small onClick={onClose}>
            Done
          </Btn>
        </div>
      </div>
    </div>
  );
}

function CreateAccountForm({
  t,
  schools,
  bySchool,
  onCancel,
  onCreated,
}: {
  t: TC;
  schools: School[];
  bySchool: Map<string, TeacherProfile>;
  onCancel: () => void;
  onCreated: (slip: CredentialSlip) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("SBFP Feeding Focal Person");
  const [contact, setContact] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generateTempPassword());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = schools.filter((s) => !bySchool.has(s.id));
  const elementary = open.filter((s) => s.type === "Elementary");
  const high = open.filter((s) => s.type === "High School");

  return (
    <Card
      t={t}
      title="New school account"
      subtitle="One account per school. The email and temporary password below are what the school personnel signs in with — they are shown once, right after you create it."
      action={<Btn t={t} small onClick={onCancel}>Cancel</Btn>}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!fullName.trim()) { setError("Enter the school personnel's name."); return; }
          if (!schoolId) { setError("Choose the school this account is for."); return; }
          if (!email.trim()) { setError("Enter the sign-in email."); return; }
          if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
          }
          setBusy(true);
          setError("");
          const result = await createTeacherAccount({
            data: {
              email: email.trim(),
              password,
              fullName: fullName.trim(),
              position: position.trim(),
              contact: contact.trim(),
              schoolId,
            },
          });
          setBusy(false);
          if (!result.ok) { setError(result.message); return; }
          const school = schools.find((s) => s.id === schoolId);
          onCreated({
            schoolName: school?.name ?? schoolId,
            teacherName: fullName.trim(),
            email: email.trim().toLowerCase(),
            password,
            reset: false,
          });
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label>
            <span style={{ ...label, color: t.dim }}>School Personnel's name *</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Last, First Middle" style={input(t)} />
          </label>
          <label>
            <span style={{ ...label, color: t.dim }}>Position / designation</span>
            <input value={position} onChange={(e) => setPosition(e.target.value)} style={input(t)} />
          </label>
          <label>
            <span style={{ ...label, color: t.dim }}>Contact</span>
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="09xx xxx xxxx" style={input(t)} />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="md:col-span-2">
            <span style={{ ...label, color: t.dim }}>School *</span>
            <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} style={{ ...input(t), cursor: "pointer" }}>
              <option value="">— Select the school —</option>
              {elementary.length > 0 && (
                <optgroup label={`Elementary (${elementary.length} without an account)`}>
                  {elementary.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              )}
              {high.length > 0 && (
                <optgroup label={`High School (${high.length} without an account)`}>
                  {high.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label>
            <span style={{ ...label, color: t.dim }}>Sign-in email *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="school@depedurdaneta.gov.ph" style={input(t)} />
          </label>
        </div>

        <label>
          <span style={{ ...label, color: t.dim }}>Temporary password *</span>
          <div className="flex gap-2" style={{ maxWidth: 420 }}>
            <input value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input(t), fontFamily: mono }} />
            <Btn t={t} small onClick={() => setPassword(generateTempPassword())}>
              Generate
            </Btn>
          </div>
        </label>

        {error && (
          <div
            style={{
              border: `1px solid ${t.danger}55`,
              background: `${t.danger}14`,
              color: t.danger,
              borderRadius: 6,
              padding: "9px 11px",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Btn t={t} tone="accent" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create the account"}
          </Btn>
          <span style={{ fontSize: 11.5, color: t.dim }}>
            {open.length} of {schools.length} schools still have no account
          </span>
        </div>
      </form>
    </Card>
  );
}

function EditAccountForm({
  t,
  schools,
  bySchool,
  account,
  onDone,
  onError,
  onCancel,
}: {
  t: TC;
  schools: School[];
  bySchool: Map<string, TeacherProfile>;
  account: TeacherProfile;
  onDone: () => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(account.teacherName);
  const [position, setPosition] = useState(account.position);
  const [contact, setContact] = useState(account.contact);
  const [schoolId, setSchoolId] = useState(account.schoolId);
  const [busy, setBusy] = useState(false);
  const takenByOthers = new Set(
    [...bySchool.values()].filter((a) => a.email !== account.email).map((a) => a.schoolId),
  );

  return (
    <form
      className="mt-4 pt-4 flex flex-col gap-4"
      style={{ borderTop: `1px solid ${t.border}` }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const result = await updateTeacherAccount({
          data: {
            email: account.email,
            fullName: fullName.trim(),
            position: position.trim(),
            contact: contact.trim(),
            schoolId,
          },
        });
        setBusy(false);
        if (!result.ok) onError(result.message);
        else onDone();
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label>
          <span style={{ ...label, color: t.dim }}>School Personnel's name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={input(t)} />
        </label>
        <label>
          <span style={{ ...label, color: t.dim }}>Position</span>
          <input value={position} onChange={(e) => setPosition(e.target.value)} style={input(t)} />
        </label>
        <label>
          <span style={{ ...label, color: t.dim }}>Contact</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} style={input(t)} />
        </label>
      </div>
      <label>
        <span style={{ ...label, color: t.dim }}>School</span>
        <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} style={{ ...input(t), cursor: "pointer", maxWidth: 460 }}>
          {schools.map((s) => (
            <option key={s.id} value={s.id} disabled={takenByOthers.has(s.id)}>
              {s.name}
              {takenByOthers.has(s.id) ? " — has an account" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <Btn t={t} tone="accent" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Btn>
        <Btn t={t} onClick={onCancel}>Cancel</Btn>
        <span style={{ fontSize: 11, color: t.dim }}>
          This account was issued {shortDate(account.updatedAt.slice(0, 10))}
        </span>
      </div>
    </form>
  );
}
