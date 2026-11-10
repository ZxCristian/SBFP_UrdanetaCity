/**
 * The seam between the two SBFP websites.
 *
 * `/Admin` (the Division Office console) and `/` (a school's own site) are one
 * app in two products, and this module is the shared, **server-backed** state
 * they both read:
 *
 *  - `account`   — who the signed-in visitor is: the Division Office, or one
 *                  school's teacher (the account the Division Office issued).
 *  - `profiles`  — every school's SBFP form header the caller may see, keyed by
 *                  school, with the teacher who holds the account.
 *  - `records`   — learner records encoded through the School Portal.
 *  - `feedbacks` — what a school sent up, with the Division Office's reply on the
 *                  same row so the school sees the answer.
 *
 * Nothing here decides who may read or write what: the server functions in
 * `@/lib/sbfp-api` verify the session and scope every row (see
 * `@/lib/sbfp-accounts`). This module keeps a synchronous mirror of what the
 * server returned, so the screens stay simple — reads are plain values, and each
 * action applies locally first and then writes through, surfacing `syncError`
 * when the write did not land.
 *
 * SSR note: state is only read on the client. Module init touches no storage,
 * `getServerSnapshot` returns a frozen empty state, and `syncWorkspace()` loads
 * from the server from an effect, so server HTML and client HTML never disagree.
 */
import { useSyncExternalStore } from "react";
import {
  fetchWorkspace,
  removeLearnerRecord,
  replyToFeedback,
  restoreLearnerRecord,
  saveLearnerRecord,
  saveOwnTeacherDetails,
  saveSchoolHeader,
  saveSummaryExtra as saveSummaryExtraApi,
  sendSchoolFeedback,
} from "./sbfp-api";
// Type-only, so this import is erased and sbfp-app.tsx -> sbfp-store.ts stays
// a one-way runtime edge (no import cycle).
import type {
  School,
  SchoolFeedback,
  SchoolFormDetails,
  Student,
  SummaryExtra,
  TrashedRecord,
} from "@/lib/sbfp-domain";
import { currentSchoolYear } from "./sbfp-years";

/** The pre-accounts store's key; read once to carry a school's work forward. */
const LEGACY_STORAGE_KEY = "sbfp.teachers.v1";

export type AccountRole = "admin" | "teacher";

/** The caller's own account, as issued by the Division Office. */
export interface SbfpAccount {
  email: string;
  role: AccountRole;
  fullName: string;
  position: string;
  contact: string;
  schoolId: string | null;
  status: "active" | "disabled";
  /** True while the password is still the one the Division Office generated. */
  tempPassword: boolean;
  /** ISO timestamps from `sbfp_accounts`. */
  createdAt: string;
  updatedAt: string;
  /** The school's SBFP form header. */
  profile: SchoolFormDetails;
  recordCount?: number;
  feedbackCount?: number;
}

/** A school's SBFP form header plus the teacher holding the account for it. */
export interface TeacherProfile extends SchoolFormDetails {
  /** The `School.id` this account is for — exactly one account per school. */
  schoolId: string;
  /** The teacher herself: name, position, how the district reaches her. */
  teacherName: string;
  position: string;
  contact: string;
  /** ISO timestamp of the last save, shown as "last updated". */
  updatedAt: string;
  /** The account this profile belongs to. */
  email: string;
  status: "active" | "disabled";
  tempPassword: boolean;
  recordCount: number;
  feedbackCount: number;
}

/** The four fields the school must supply — the rest are optional extras. */
export const REQUIRED_PROFILE_FIELDS: [keyof TeacherProfile, string][] = [
  ["principal", "Name of Principal / School Head"],
  ["focalPerson", "Name of Feeding Focal Person"],
  ["schoolIdNumber", "School ID Number"],
  ["cityMunicipalityBarangay", "City/Municipality/Barangay"],
];

export interface TeacherStoreState {
  /** False until the first server read has come back — the sites show a boot screen until then. */
  hydrated: boolean;
  /** The server's signature for the rows below — see `sbfp-live.ts`. */
  version: string;
  /** The email of the account the workspace was loaded for, or null. */
  email: string | null;
  /** The caller's own account, or null when no account has been issued for it. */
  account: SbfpAccount | null;
  /**
   * The division's schools, read from the database — the whole list for the
   * Division Office, only her own school for a teacher. Each carries its SBFP
   * form header, so the console's school list and the portal's forms print the
   * same block.
   */
  schools: School[];
  /** Every school's header the caller may see, keyed by school id. */
  profiles: Record<string, TeacherProfile>;
  /** The same rows as a list — the Division Office's accounts table. */
  accounts: TeacherProfile[];
  /** The school the signed-in teacher is working on, or null. */
  activeSchoolId: string | null;
  /** The school year the district is working in (e.g. "2025-2026"). */
  activeSy: string;
  /** Learner records encoded through the School Portal. */
  records: Student[];
  /** Feedback the schools sent up, with the Division Office's reply merged in. */
  feedbacks: SchoolFeedback[];
  /** Deleted learner records, kept until the next school year starts. */
  trash: TrashedRecord[];
  /** Form 2's hand-entered at-risk / IP counts for the active year. */
  summaryExtras: SummaryExtra[];
  /** Why the last server write failed, if it did. */
  syncError: string | null;
  /** True while a workspace read is in flight. */
  syncing: boolean;
}

const EMPTY: TeacherStoreState = Object.freeze({
  hydrated: false,
  version: "",
  email: null,
  account: null,
  schools: [],
  profiles: {},
  accounts: [],
  activeSchoolId: null,
  activeSy: currentSchoolYear(),
  records: [],
  feedbacks: [],
  trash: [],
  summaryExtras: [],
  syncError: null,
  syncing: false,
});

let state: TeacherStoreState = EMPTY;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

function set(patch: Partial<TeacherStoreState>) {
  state = { ...state, ...patch };
  for (const listener of Array.from(listeners)) listener();
}

/** Subscribe a component to everything the schools have sent up. */
export function useTeacherStore(): TeacherStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The current rows, for readers outside React (scripts, tests). */
export function teacherStoreSnapshot(): TeacherStoreState {
  return state;
}

/** The school signed in on this device, or null. */
export function activeProfile(s: TeacherStoreState): TeacherProfile | null {
  return s.activeSchoolId ? (s.profiles[s.activeSchoolId] ?? null) : null;
}

/** How much of the required school information is filled in. */
export function profileStatus(profile: TeacherProfile | null) {
  const done = profile
    ? REQUIRED_PROFILE_FIELDS.filter(([key]) => String(profile[key] ?? "").trim().length > 0)
    : [];
  const missing = REQUIRED_PROFILE_FIELDS.filter(([key]) => !done.some(([k]) => k === key));
  return { done: done.length, total: REQUIRED_PROFILE_FIELDS.length, missing, complete: done.length === REQUIRED_PROFILE_FIELDS.length };
}

/** Short unique ids; the prefixes let the two sides tell rows apart. */
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
export const newRecordId = () => uid("tr");
export const newFeedbackId = () => uid("tf");

/** Is this row one the teacher website owns? */
export const isTeacherRecord = (s: { id: string }) => s.id.startsWith("tr_");
export const isTeacherFeedback = (f: { id: string }) => f.id.startsWith("tf_");

// ── Loading from the server ───────────────────────────────────────────────────

/**
 * One read per resolved session, shared by both sites: the district console and
 * the school portal both call `syncWorkspace()`, and they must not race two
 * reads on the same email.
 */
let inFlight: Promise<void> | null = null;
let loadedFor: string | null = null;
/**
 * Identifies the newest read. A forced read (after sign-in) can start while the
 * signed-out boot read is still in flight; the older response must not land on
 * top of the signed-in workspace when it finally arrives.
 */
let readGeneration = 0;

function profileOf(account: SbfpAccount): TeacherProfile | null {
  if (!account.schoolId) return null;
  return {
    ...account.profile,
    schoolId: account.schoolId,
    teacherName: account.fullName,
    position: account.position,
    contact: account.contact,
    updatedAt: account.updatedAt ?? "",
    email: account.email,
    status: account.status,
    tempPassword: account.tempPassword,
    recordCount: account.recordCount ?? 0,
    feedbackCount: account.feedbackCount ?? 0,
  };
}

/** Fold the accounts the server returned into the by-school map both sites use. */
function profilesOf(accounts: SbfpAccount[]): Record<string, TeacherProfile> {
  const profiles: Record<string, TeacherProfile> = {};
  for (const account of accounts) {
    const profile = profileOf(account);
    if (profile) profiles[profile.schoolId] = profile;
  }
  return profiles;
}

/**
 * Read this visitor's workspace, for the identity `expectedEmail`.
 *
 * Safe to call repeatedly — the same read is shared and an already-loaded
 * identity is skipped — and safe to call from both sites, which both do. A
 * different identity clears the previous one's rows first, so a switched session
 * never flashes the other person's school.
 */
export function syncWorkspace(expectedEmail?: string | null, force = false): Promise<void> {
  const target = (expectedEmail ?? state.email)?.toLowerCase() ?? null;
  if (target && state.email && state.email !== target) {
    loadedFor = null;
    state = { ...EMPTY };
  }
  // A non-forced caller shares an in-flight read. A forced read (right after
  // sign-in) supersedes whatever started before the session existed, so the
  // click never waits on the signed-out boot request.
  if (!force) {
    if (inFlight) return inFlight;
    if (loadedFor && loadedFor === target) return Promise.resolve();
  }
  const generation = ++readGeneration;
  loadedFor = target;
  // The identity is claimed up front: a read that fails must not leave the site
  // spinning on "loading" forever, and `syncError` carries the reason.
  set({ syncing: true, email: target, hydrated: state.hydrated });
  inFlight = fetchWorkspace()
    .then(async (workspace) => {
      if (generation !== readGeneration) return;
      const accounts = (workspace.accounts ?? []) as SbfpAccount[];
      const profiles = profilesOf(accounts);
      const account = (workspace.account ?? null) as SbfpAccount | null;
      const loadedEmail = workspace.email?.toLowerCase() ?? target;
      loadedFor = loadedEmail;
      set({
        hydrated: true,
        version: workspace.version ?? "",
        syncing: false,
        syncError: null,
        email: loadedEmail,
        account,
        schools: (workspace.schools ?? []) as School[],
        accounts: accounts.filter((a) => a.schoolId).map((a) => profiles[a.schoolId as string]).filter(Boolean),
        profiles,
        activeSchoolId: account?.role === "teacher" ? account.schoolId : null,
        activeSy: workspace.activeSy,
        records: (workspace.records ?? []) as Student[],
        feedbacks: (workspace.feedbacks ?? []) as SchoolFeedback[],
        trash: (workspace.trash ?? []) as TrashedRecord[],
        summaryExtras: (workspace.summaryExtras ?? []) as SummaryExtra[],
      });
      await carryLegacyWorkForward();
    })
    .catch((err: unknown) => {
      if (generation !== readGeneration) return;
      // Let a later call retry this identity after a transient failure.
      loadedFor = null;
      // Signed out is not an error: the sites ask for a session first and only
      // then for the workspace.
      const message = err instanceof Error ? err.message : String(err);
      const signedOut = /unauthor/i.test(message);
      set({
        hydrated: true,
        syncing: false,
        account: null,
        schools: [],
        accounts: [],
        profiles: {},
        activeSchoolId: null,
        records: [],
        feedbacks: [],
        trash: [],
        summaryExtras: [],
        syncError: signedOut ? null : `Could not reach the division server: ${message}`,
      });
    })
    .finally(() => {
      if (generation === readGeneration) inFlight = null;
    });
  return inFlight;
}

/** Forget everything (sign-out). */
export function resetWorkspace() {
  // Invalidate a read that was already in flight: its response belongs to the
  // identity that just signed out and must not repopulate the store.
  readGeneration++;
  inFlight = null;
  loadedFor = null;
  state = { ...EMPTY, hydrated: true };
  for (const listener of Array.from(listeners)) listener();
}

/**
 * Carry work encoded through the pre-accounts portal into the account that now
 * owns the school, then drop the old local copy — the rows would otherwise be
 * stranded in this browser with nothing left to show them.
 *
 * Deliberately conservative: only for a school the caller can write, only when
 * the server has no rows for it yet, and the school header is only taken over
 * when the server has none.
 */
async function carryLegacyWorkForward() {
  const account = state.account;
  if (!account || typeof window === "undefined") return;
  const schoolId = account.schoolId;
  if (!schoolId) return;
  let legacy: { profiles?: Record<string, SchoolFormDetails>; records?: Student[]; feedbacks?: SchoolFeedback[] };
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    legacy = JSON.parse(raw) as typeof legacy;
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  const mine = (legacy.records ?? []).filter((r) => r && r.schoolId === schoolId);
  const alreadyHere = state.records.some((r) => r.schoolId === schoolId);
  if (mine.length > 0 && !alreadyHere) {
    for (const record of mine) {
      addRecord({ ...record, schoolId });
    }
  }
  const legacyProfile = legacy.profiles?.[schoolId];
  const serverHeaderEmpty = !Object.values(account.profile).some((value) => String(value ?? "").trim());
  if (legacyProfile && serverHeaderEmpty) {
    const patch: Partial<SchoolFormDetails> = {};
    for (const key of [
      "division",
      "cityMunicipalityBarangay",
      "schoolIdNumber",
      "principal",
      "focalPerson",
      "dateStartFeeding",
      "lastMileSchool",
    ] as (keyof SchoolFormDetails)[]) {
      const value = legacyProfile[key];
      if (String(value ?? "").trim()) patch[key] = value as never;
    }
    if (Object.keys(patch).length > 0) saveProfile(schoolId, patch);
  }
}

// ── Writing back ──────────────────────────────────────────────────────────────

/** Keep a failed write visible instead of pretending it was saved. */
function reportFailure(err: unknown, what: string, rollback?: () => void) {
  rollback?.();
  const message = err instanceof Error ? err.message : String(err);
  set({ syncError: `${what} was not saved to the division server: ${message}` });
}

function ok() {
  if (state.syncError) set({ syncError: null });
}

function patchProfile(schoolId: string, patch: Partial<TeacherProfile>) {
  const existing = state.profiles[schoolId];
  if (!existing) return;
  const next: TeacherProfile = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  set({
    profiles: { ...state.profiles, [schoolId]: next },
    accounts: state.accounts.map((a) => (a.schoolId === schoolId ? next : a)),
  });
}

/** Save profile edits (the school information block on the SBFP forms). */
export function saveProfile(schoolId: string, patch: Partial<TeacherProfile>) {
  if (!state.profiles[schoolId] && !state.account?.schoolId) return;
  const target = schoolId;
  patchProfile(target, patch);
  if (state.account?.schoolId === target) {
    set({
      account: {
        ...state.account,
        profile: { ...state.account.profile, ...patch } as SchoolFormDetails,
        ...(patch.teacherName === undefined ? {} : { fullName: patch.teacherName }),
        ...(patch.position === undefined ? {} : { position: patch.position }),
        ...(patch.contact === undefined ? {} : { contact: patch.contact }),
      },
    });
  }
  const header: Partial<SchoolFormDetails> = {};
  for (const key of [
    "division",
    "cityMunicipalityBarangay",
    "schoolIdNumber",
    "principal",
    "focalPerson",
    "dateStartFeeding",
    "lastMileSchool",
  ] as (keyof SchoolFormDetails)[]) {
    if (patch[key] !== undefined) header[key] = patch[key] as never;
  }
  const writes: Promise<unknown>[] = [];
  if (Object.keys(header).length > 0) {
    writes.push(saveSchoolHeader({ data: { schoolId: target, patch: header } }));
  }
  // The teacher's own name and contact details live on her account row, not
  // the school header. Saving only the header used to make those edits look
  // saved until the next reload, then silently lose them.
  const details: { fullName?: string; position?: string; contact?: string } = {};
  if (patch.teacherName !== undefined) details.fullName = patch.teacherName;
  if (patch.position !== undefined) details.position = patch.position;
  if (patch.contact !== undefined) details.contact = patch.contact;
  if (Object.keys(details).length > 0 && state.account?.role === "teacher" && state.account.schoolId === target) {
    writes.push(saveOwnTeacherDetails({ data: details }));
  }
  if (writes.length === 0) return;
  void Promise.all(writes)
    .then(ok)
    .catch((err) => reportFailure(err, "Your profile"));
}

export function addRecord(record: Student) {
  set({ records: [record, ...state.records] });
  void saveLearnerRecord({ data: { schoolId: record.schoolId, record } })
    .then(ok)
    .catch((err) => {
      // The server refused it, so it does not exist: drop the optimistic row
      // instead of leaving a learner on screen that no report will ever see.
      reportFailure(err, "The learner record", () =>
        set({ records: state.records.filter((r) => r.id !== record.id) }),
      );
    });
}

export function updateRecord(id: string, patch: Partial<Student>) {
  const next = state.records.map((r) => (r.id === id ? { ...r, ...patch } : r));
  set({ records: next });
  const record = next.find((r) => r.id === id);
  if (!record) return;
  void saveLearnerRecord({ data: { schoolId: record.schoolId, record } })
    .then(ok)
    .catch((err) => reportFailure(err, "The learner record"));
}

export function removeRecord(id: string) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  const trashed: TrashedRecord = {
    ...record,
    deletedAt: new Date().toISOString(),
    deletedBy: state.account?.email ?? "",
  };
  set({
    records: state.records.filter((r) => r.id !== id),
    trash: [trashed, ...state.trash],
  });
  void removeLearnerRecord({ data: { id } })
    .then(ok)
    .catch((err) => {
      // Nothing was deleted on the server, so put the record back rather than
      // show it in the trash as though the removal had worked.
      set({
        records: [record, ...state.records.filter((r) => r.id !== id)],
        trash: state.trash.filter((r) => r.id !== id),
      });
      reportFailure(err, "The learner record");
    });
}

/** Put a record from the trash back on the school's active list. */
export function restoreRecord(id: string) {
  const record = state.trash.find((r) => r.id === id);
  if (!record) return;
  const previousTrash = state.trash;
  const previousRecords = state.records;
  const { deletedAt, deletedBy, ...restored } = record;
  void deletedAt;
  void deletedBy;
  set({
    trash: state.trash.filter((r) => r.id !== id),
    records: record.sy === state.activeSy ? [restored, ...state.records] : state.records,
  });
  void restoreLearnerRecord({ data: { id } })
    .then(ok)
    .catch((err) => {
      set({ trash: previousTrash, records: previousRecords });
      reportFailure(err, "The learner record");
    });
}

/** Store one Form 2 hand-entered count pair, optimistically for the screen. */
export function saveSummaryExtra(input: {
  schoolId: string;
  period: SummaryExtra["period"];
  grade: string;
  sex: "M" | "F";
  atRisk: number;
  ips: number;
}) {
  const extra: SummaryExtra = { ...input, sy: state.activeSy };
  const same = (row: SummaryExtra) =>
    row.schoolId === extra.schoolId &&
    row.sy === extra.sy &&
    row.period === extra.period &&
    row.grade === extra.grade &&
    row.sex === extra.sex;
  set({
    summaryExtras: [...state.summaryExtras.filter((row) => !same(row)), extra],
  });
  void saveSummaryExtraApi({ data: input })
    .then(ok)
    .catch((err) => reportFailure(err, "The Form 2 count"));
}

export function sendFeedback(entry: SchoolFeedback) {
  set({ feedbacks: [entry, ...state.feedbacks] });
  void sendSchoolFeedback({ data: { schoolId: entry.schoolId, entry } })
    .then(ok)
    .catch((err) => reportFailure(err, "The feedback"));
}

/** The Division Office's side of the loop: acknowledge / resolve and reply. */
export function updateTeacherFeedback(
  id: string,
  patch: Partial<Pick<SchoolFeedback, "status" | "response">>,
) {
  set({
    feedbacks: state.feedbacks.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
  void replyToFeedback({ data: { id, ...patch } })
    .then(ok)
    .catch((err) => reportFailure(err, "The reply"));
}

/** Test/QA hook: drop everything, as if the browser were new. */
export function resetTeacherStore() {
  resetWorkspace();
}
