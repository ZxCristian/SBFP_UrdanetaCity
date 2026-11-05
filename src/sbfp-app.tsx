import { useState, useMemo, createContext, useContext, useEffect, useRef, Fragment, type CSSProperties } from "react";
// Type-only: erased at build time, so ExcelJS stays out of the initial bundle.
import type { SummaryMatrixRow } from "@/lib/sbfp-domain";
// What the schools sent up through the teacher website (`/SchoolPortal`).
import {
  addRecord,
  removeRecord,
  restoreRecord,
  sendFeedback,
  updateRecord,
  updateTeacherFeedback,
} from "@/lib/sbfp-store";
import { UserButton } from "@/lib/auth/gates";
import { useAccess } from "@/lib/use-access";
import { formatSchoolYear } from "@/lib/sbfp-years";
import { learnerProblem } from "@/lib/sbfp-validation";
import {
  createSchoolEntry,
  lookupPreviousBeneficiary,
  removeSchoolEntry,
  saveSchoolHeader,
  updateSchoolEntry,
} from "@/lib/sbfp-api";
import AccountsPanel from "@/components/accounts-panel";
import SchoolYears from "@/components/school-years";
import { ConfirmDialog, type ConfirmPalette } from "@/components/confirm-dialog";
import { Form2Sheet } from "@/components/form2-sheet";
import { ImportLearnersDialog } from "@/components/import-learners-dialog";
import { manualTotal, useForm2Extras } from "@/lib/use-form2-extras";
import {
  BMI_STATUSES,
  EMPTY_FORM_DETAILS,
  EMPTY_STUDENT,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  FORM_DETAIL_FIELDS,
  HFA_STATUSES,
  PERIODS,
  SPED_SCHOOL_NAME,
  ageLabel,
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
  uniqueStudents,
} from "@/lib/sbfp-domain";
import type {
  BMIStatus,
  FeedbackCategory,
  FeedbackStatus,
  GradeLevel,
  HFAStatus,
  Period,
  School,
  SchoolFeedback,
  SchoolFormDetails,
  SchoolType,
  Sex,
  Student,
  TrashedRecord,
  YesNo,
} from "@/lib/sbfp-domain";

// ── Domain ────────────────────────────────────────────────────────────────────
// Types, the period/status lists and the WHO classification live in
// `@/lib/sbfp-domain` so the school portal can import them without pulling
// this console (and its screens) into the teacher route's bundle. The
// re-export keeps this module's public surface unchanged.
export * from "@/lib/sbfp-domain";
type View = "district"|"feedback"|"schools"|"accounts"|"years"|"dashboard"|"records"|"entry"|"table"|"analytics"|"trash";

/** Where the browser remembers feedback it has already shown the Division Office. */
const FEEDBACK_SEEN_KEY = "sbfp.feedbackSeen.v1";

/** The school-list columns a teacher's profile owns — see the sync in `App`. */
const SCHOOL_HEADER_KEYS = [
  "division", "cityMunicipalityBarangay", "schoolIdNumber", "principal", "focalPerson",
  "dateStartFeeding", "lastMileSchool",
] as const;

// ── Theme ──────────────────────────────────────────────────────────────────────
export interface TC {
  bg: string; surface: string; surface2: string; surfaceDeep: string;
  hover: string; border: string; text: string; sub: string; dim: string; faint: string;
  accent: string; accentBg: string; accentText: string;
  danger: string; warning: string; grandBg: string; isDark: boolean;
  /**
   * Data colours (measurement periods, BMI/HFA statuses, BMI/HFA/4P's/SBFP
   * columns and school pills). Dark mode keeps the phosphor neon set; day mode
   * uses deeper tones of the same hue so numbers and labels stay readable
   * against a white surface instead of washing out.
   */
  blue: string; lime: string; orange: string;
  period: Record<string,string>;
  bmi: Record<string,string>;
  hfa: Record<string,string>;
}
const DARK: TC = {
  bg:"#080808", surface:"#111111", surface2:"#161616", surfaceDeep:"#0d0d0d",
  hover:"#161616", border:"#1e1e1e", text:"#e2e2e2", sub:"#888", dim:"#555", faint:"#2a2a2a",
  accent:"#00ff87", accentBg:"#00ff8720", accentText:"#000", danger:"#ff4b4b", warning:"#ff9f4b",
  grandBg:"#0a1a10", isDark:true,
  blue:"#00c9ff", lime:"#b8ff4f", orange:"#ff9f4b",
  period:{ Baseline:"#00c9ff", Midline:"#ff9f4b", Endline:"#00ff87" },
  bmi:{ "Severely Wasted":"#ff4b4b", Wasted:"#ff9f4b", Normal:"#00ff87", Overweight:"#ffdd4b", Obese:"#ff6b9d" },
  hfa:{ "Severely Stunted":"#ff4b4b", Stunted:"#ff9f4b", Normal:"#00ff87", Tall:"#00c9ff" },
};
const LIGHT: TC = {
  bg:"#f1f1ed", surface:"#ffffff", surface2:"#f7f7f3", surfaceDeep:"#e6e6e0",
  hover:"#eaeae6", border:"#d3d3ca", text:"#1b1b17", sub:"#4d4d46", dim:"#6d6d64", faint:"#8e8e85",
  accent:"#0b7a41", accentBg:"#0b7a4118", accentText:"#ffffff", danger:"#bc2f2f", warning:"#9d5200",
  grandBg:"#e4f1e8", isDark:false,
  blue:"#0f6f91", lime:"#557a12", orange:"#a25a09",
  period:{ Baseline:"#0f6f91", Midline:"#a25a09", Endline:"#0e7a41" },
  bmi:{ "Severely Wasted":"#c22b2b", Wasted:"#a25a09", Normal:"#0e7a41", Overweight:"#8a6a00", Obese:"#b3316a" },
  hfa:{ "Severely Stunted":"#c22b2b", Stunted:"#a25a09", Normal:"#0e7a41", Tall:"#0f6f91" },
};
const ThemeCtx = createContext<TC>(DARK);
const useT = () => useContext(ThemeCtx);

// ── Schools ───────────────────────────────────────────────────────────────────
// The division's schools are rows in `sbfp_schools` (seed: migrations/0005),
// read through `@/lib/sbfp-store` — not a constant in this file. Both sites use
// the same list, and the Division Office can add or rename a school without a
// redeploy. `School` stays the shape every screen already expects.

/** One hue per kind of feedback (6-digit hex — Pill appends alpha to it). */
function categoryColor(c: FeedbackCategory, t: TC): string {
  switch (c) {
    case "Feeding Implementation": return t.accent;
    case "Nutrition Data": return t.blue;
    case "Supplies & Logistics": return t.orange;
    case "Learner Concerns": return t.lime;
    case "System / Forms": return t.isDark ? "#c9a4ff" : "#6b3fa0";
    default: return t.isDark ? "#9a9a9a" : "#57574f";
  }
}

/** Status pill colour — amber while new, blue once acknowledged, green when closed. */
function statusColor(s: FeedbackStatus, t: TC): string {
  return s === "New" ? t.orange : s === "Acknowledged" ? t.blue : t.accent;
}

function Stars({ rating, color, size = 11 }: { rating: number; color: string; size?: number }) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span title={`${rating} of 5`} style={{ fontFamily:"'JetBrains Mono',monospace", color, fontSize:`${size}px`, letterSpacing:"1px" }}>
      {"★".repeat(full)}{"☆".repeat(5 - full)}
    </span>
  );
}

// ── Shared UI Primitives ───────────────────────────────────────────────────────
/** The delete-warning dialog, in the console's theme. */
const confirmPalette = (t: TC): ConfirmPalette => ({
  surface: t.surface,
  surface2: t.surfaceDeep,
  border: t.border,
  text: t.text,
  sub: t.sub,
  danger: t.danger,
  dangerSoft: t.isDark ? "#ff4b4b22" : "#bc2f2f16",
  dangerText: t.isDark ? "#100505" : "#ffffff",
  font: "'Outfit',sans-serif",
});

function Pill({ label, color }: { label: string; color: string }) {
  return <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ background:color+"20", color, border:`1px solid ${color}40` }}>{label}</span>;
}

function StatCard({ label, value, accent, t }: { label:string; value:string|number; accent?:boolean; t:TC }) {
  return (
    <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-4 flex flex-col gap-2">
      <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>{label}</div>
      <div className="text-2xl font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color: accent ? t.accent : t.text }}>{value}</div>
    </div>
  );
}

function Bar({ val, max, color, t }: { val:number; max:number; color:string; t:TC }) {
  return (
    <div className="h-0.5 rounded-full overflow-hidden" style={{ background:t.border }}>
      <div style={{ width:`${max>0?(val/max)*100:0}%`, background:color }} className="h-full" />
    </div>
  );
}

function YesNoToggle({ value, onChange, t, disabled }: { value:YesNo; onChange:(v:YesNo)=>void; t:TC; disabled?:boolean }) {
  return (
    <div className="flex gap-1" style={{ opacity: disabled ? 0.65 : 1 }}>
      {(["Yes","No"] as YesNo[]).map(v => (
        <button key={v} onClick={() => !disabled && onChange(v)} disabled={disabled} className="flex-1 h-[38px] text-xs rounded-sm border transition-colors"
          style={{ ...(value===v ? { background:v==="Yes"?t.accentBg:t.danger+"15", color:v==="Yes"?t.accent:t.danger, borderColor:v==="Yes"?t.accent+"40":t.danger+"40" } : { background:t.surface2, color:t.dim, borderColor:t.border }), cursor: disabled ? "not-allowed" : "pointer" }}>
          {v}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, span, t }: { label: string; children: React.ReactNode; span?: string; t: TC }) {
  return (
    <div className={span}>
      <label className="block text-[9px] tracking-widest uppercase mb-1.5" style={{ color: t.dim }}>{label}</label>
      {children}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ view, setView, selectedSchool, setSelectedSchool, themeMode, toggleTheme, schools, registeredSchools, activeSy, mobileOpen, onNavigate, unreadFeedback, trashCount }: {
  view:View; setView:(v:View)=>void; selectedSchool:School|null; setSelectedSchool:(s:School|null)=>void;
  themeMode:"dark"|"light"; toggleTheme:()=>void; schools:School[];
  /** How many schools hold a School Portal account issued from this console. */
  registeredSchools:number;
  /** The school year every screen below is working in. */
  activeSy:string;
  /** Narrow screens: the same panel slides in over the content as a drawer. */
  mobileOpen:boolean; onNavigate:()=>void;
  /** Feedback that arrived since the Division Office last opened the feed. */
  unreadFeedback:number;
  /** Learner records waiting in the trash. */
  trashCount:number;
}) {
  const t = useT();
  const nav: { id:View; label:string; icon:string; requiresSchool?:boolean }[] = [
    { id:"district", label:"District Dashboard", icon:"◎" },
    { id:"feedback", label:"Feedbacks", icon:"✉" },
    { id:"schools", label:"All Schools", icon:"◉" },
    { id:"accounts", label:"School Accounts", icon:"⚙" },
    { id:"years", label:"School Years", icon:"▤" },
    { id:"dashboard", label:"Dashboard", icon:"▦", requiresSchool:true },
    { id:"records", label:"Student Records", icon:"☰", requiresSchool:true },
    { id:"entry", label:"Data Entry", icon:"✎", requiresSchool:true },
    { id:"table", label:"Summary Table", icon:"≡", requiresSchool:true },
    { id:"analytics", label:"Analytics", icon:"↗", requiresSchool:true },
    { id:"trash", label:"Trash", icon:"♲" },
  ];
  return (
    <aside style={{ borderRight:`1px solid ${t.border}`, background:t.surface }}
      className={`w-56 max-w-[85vw] flex-shrink-0 flex flex-col h-full fixed md:static inset-y-0 left-0 z-40 transition-transform duration-200 ${mobileOpen ? "translate-x-0 shadow-2xl md:shadow-none" : "-translate-x-full"} md:translate-x-0`}>
      <div className="px-5 py-4" style={{ borderBottom:`1px solid ${t.border}` }}>
        <div className="flex items-center gap-3">
          <img src="/school-health-wheel.svg" alt="Coordinated School Health" width={44} height={44} className="w-11 h-11 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight" style={{ color:t.text }}>Health Monitor</div>
            <div className="text-[10px] leading-tight mt-1" style={{ color:t.dim }}>Urdaneta City Schools</div>
          </div>
        </div>
      </div>

      {selectedSchool && (
        <div className="mx-3 mt-3 p-3 rounded-sm" style={{ border:`1px solid ${t.border}`, background:t.surface2 }}>
          <div className="text-[8px] tracking-widest uppercase mb-1" style={{ color:t.dim }}>Selected School</div>
          <div className="text-[11px] leading-snug font-medium" style={{ color:t.text }}>{selectedSchool.name}</div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <Pill label={selectedSchool.type==="Elementary"?"ES":"HS"} color={selectedSchool.type==="Elementary"?t.blue:t.lime} />
            <button onClick={() => { setSelectedSchool(null); setView("schools"); onNavigate(); }} className="text-[9px] cursor-pointer ml-auto transition-colors" style={{ color:t.dim }}
              onMouseEnter={e=>(e.currentTarget.style.color=t.sub)} onMouseLeave={e=>(e.currentTarget.style.color=t.dim)}>✕ clear</button>
          </div>
        </div>
      )}

      <nav className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-0.5 mt-1">
        {nav.map(item => {
          const disabled = !!(item.requiresSchool && !selectedSchool);
          const active = view === item.id;
          return (
            <button key={item.id} onClick={() => { if (disabled) return; setView(item.id); onNavigate(); }} disabled={disabled}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-left text-sm transition-all"
              style={{ color: disabled ? t.faint : active ? t.accent : t.dim, background: active ? t.accentBg : "transparent", cursor: disabled ? "not-allowed" : "pointer" }}
              onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.color = t.sub; }}
              onMouseLeave={e => { if (!disabled && !active) e.currentTarget.style.color = t.dim; }}>
              <span className="w-4 text-center text-base">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.id === "feedback" && unreadFeedback > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 999, padding: "0 5px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: t.danger, color: "#fff", fontSize: 10, fontWeight: 700 }}>
                  {unreadFeedback}
                </span>
              )}
              {item.id === "trash" && trashCount > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 999, padding: "0 5px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: t.surface2, color: t.dim, border: `1px solid ${t.border}`, fontSize: 10, fontWeight: 700 }}>
                  {trashCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="side-safe p-4 flex flex-col gap-3" style={{ borderTop:`1px solid ${t.border}` }}>
        <div style={{ color:t.sub }} className="flex flex-col gap-1">
          <span className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Signed in</span>
          <UserButton />
        </div>
        <a href="/SchoolPortal" title="The website each school's personnel signs in to"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs transition-all"
          style={{ border:`1px solid ${t.border}`, background:t.surface2, color:t.sub, textDecoration:"none" }}>
          <span>⇱</span>
          <span className="flex-1">School Portal</span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", color: registeredSchools ? t.accent : t.dim }}>
            {registeredSchools}/{schools.length}
          </span>
        </a>
        <button onClick={toggleTheme} className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs cursor-pointer transition-all"
          style={{ border:`1px solid ${t.border}`, background:t.surface2, color:t.sub }}>
          <span>{themeMode === "dark" ? "☀" : "☾"}</span>
          {themeMode === "dark" ? "Day Mode" : "Night Mode"}
        </button>
        <div className="text-[10px] leading-relaxed" style={{ color:t.faint }}>
          {schools.filter(s=>s.type==="Elementary").length} ES · {schools.filter(s=>s.type==="High School").length} HS<br />SY {formatSchoolYear(activeSy)}
        </div>
      </div>
    </aside>
  );
}

// ── District Dashboard ────────────────────────────────────────────────────────
function DistrictDashboard({ students, schools, feedbacks, activeSy, onOpenFeedbacks }: {
  students:Student[]; schools:School[]; feedbacks:SchoolFeedback[]; activeSy:string; onOpenFeedbacks:()=>void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"All"|"Elementary"|"High School">("All");

  const esIds = useMemo(() => new Set(schools.filter(s=>s.type==="Elementary").map(s=>s.id)), [schools]);
  const hsIds = useMemo(() => new Set(schools.filter(s=>s.type==="High School").map(s=>s.id)), [schools]);

  const filtered = useMemo(() => tab==="All" ? students : students.filter(s => tab==="Elementary" ? esIds.has(s.schoolId) : hsIds.has(s.schoolId)), [students, tab, esIds, hsIds]);
  // One row per student (prefer Endline) so totals are not tripled by period records
  const uniqueFiltered = useMemo(() => uniqueStudents(filtered), [filtered]);

  const bmiDist = BMI_STATUSES.map(st => ({ label:st, val:uniqueFiltered.filter(s=>s.bmiStatus===st).length, color:t.bmi[st] }));
  const hfaDist = HFA_STATUSES.map(st => ({ label:st, val:uniqueFiltered.filter(s=>s.hfaStatus===st).length, color:t.hfa[st] }));
  const maxBMI = Math.max(...bmiDist.map(x=>x.val), 1);
  const maxHFA = Math.max(...hfaDist.map(x=>x.val), 1);

  const periodCounts = PERIODS.map(p => ({ period:p, count:uniqueCount(filtered.filter(s=>s.period===p)) }));
  const maxPeriod = Math.max(...periodCounts.map(x=>x.count), 1);

  const topSchools = schools.map(s => {
    const schoolRecs = students.filter(st=>st.schoolId===s.id);
    const uniq = uniqueStudents(schoolRecs);
    return {
      school: s,
      count: uniq.length,
      atRisk: uniq.filter(st=>st.bmiStatus==="Severely Wasted"||st.bmiStatus==="Wasted").length,
    };
  }).filter(x=>x.count>0).sort((a,b)=>b.atRisk-a.atRisk).slice(0,8);

  const esCount = uniqueCount(students.filter(s=>esIds.has(s.schoolId)));
  const hsCount = uniqueCount(students.filter(s=>hsIds.has(s.schoolId)));
  const esSchoolsWithData = schools.filter(s=>s.type==="Elementary"&&students.some(st=>st.schoolId===s.id)).length;
  const hsSchoolsWithData = schools.filter(s=>s.type==="High School"&&students.some(st=>st.schoolId===s.id)).length;

  // Feedbacks from every school, newest first — the Feedbacks page shows the rest.
  const latestFeedback = useMemo(
    () => [...feedbacks].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    [feedbacks]
  );
  const openFeedback = feedbacks.filter(f=>f.status!=="Resolved").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>District Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>All Schools · SY {formatSchoolYear(activeSy)}</p>
        </div>
        <div className="flex gap-1.5">
          {(["All","Elementary","High School"] as const).map(tb => (
            <button key={tb} onClick={() => setTab(tb)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
              style={tab===tb ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:t.surface, color:t.dim, borderColor:t.border }}>
              {tb}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background:t.border }}>
        <StatCard label="Total Students" value={uniqueFiltered.length} accent t={t} />
        <StatCard label="Schools with Data" value={tab==="All"?`${esSchoolsWithData+hsSchoolsWithData}/${schools.length}`:tab==="Elementary"?`${esSchoolsWithData}/${schools.filter(s=>s.type==="Elementary").length}`:`${hsSchoolsWithData}/${schools.filter(s=>s.type==="High School").length}`} t={t} />
        <StatCard label="Elementary Students" value={esCount} t={t} />
        <StatCard label="High School Students" value={hsCount} t={t} />
      </div>

      {students.length === 0 && (
        <div style={{ border:`1px dashed ${t.border}`, background:t.surface }} className="p-5">
          <p className="text-sm" style={{ color:t.sub }}>No learner records yet.</p>
          <p className="text-xs mt-1" style={{ color:t.dim }}>
            Schools encode their learners in the School Portal. The totals and the BMI, HFA and period charts fill in as those records arrive.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background:t.border }}>
        <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
          <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>BMI Distribution</div>
          {bmiDist.map(c => (
            <div key={c.label} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs" style={{ color:t.sub }}>{c.label}</span>
                <span className="text-[10px]" style={{ fontFamily:"'JetBrains Mono',monospace", color:c.color }}>{c.val}</span>
              </div>
              <Bar val={c.val} max={maxBMI} color={c.color} t={t} />
            </div>
          ))}
        </div>
        <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
          <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>HFA Distribution</div>
          {hfaDist.map(c => (
            <div key={c.label} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs" style={{ color:t.sub }}>{c.label}</span>
                <span className="text-[10px]" style={{ fontFamily:"'JetBrains Mono',monospace", color:c.color }}>{c.val}</span>
              </div>
              <Bar val={c.val} max={maxHFA} color={c.color} t={t} />
            </div>
          ))}
        </div>
        <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
          <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>Students by Period</div>
          <div className="flex items-end gap-3 h-28">
            {periodCounts.map(d => (
              <div key={d.period} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-sm font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.period[d.period] }}>{d.count}</span>
                <div className="w-full rounded-sm" style={{ height:`${(d.count/maxPeriod)*70}px`, minHeight:"2px", background:t.period[d.period]+"70" }} />
                <span className="text-[9px]" style={{ color:t.period[d.period] }}>{d.period}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {topSchools.length > 0 && (
        <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
          <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>Schools with Most At-Risk Students (Wasted/Severely Wasted)</div>
          <div className="flex flex-col gap-0">
            {topSchools.map(x => (
              <div key={x.school.id} className="flex items-center justify-between py-2.5" style={{ borderBottom:`1px solid ${t.border}` }}>
                <div className="flex items-center gap-2">
                  <Pill label={x.school.type==="Elementary"?"ES":"HS"} color={x.school.type==="Elementary"?t.blue:t.lime} />
                  <span className="text-sm" style={{ color:t.text }}>{x.school.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs" style={{ color:t.dim }}>{x.count} students</span>
                  <span className="text-xs font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:x.atRisk>0?t.danger:t.dim }}>{x.atRisk} at-risk</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedbacks — every school's submissions, newest first */}
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Feedbacks — from all schools</span>
            {openFeedback > 0 && <Pill label={`${openFeedback} open`} color={t.orange} />}
          </div>
          <button onClick={onOpenFeedbacks} className="text-[11px] px-3 py-1.5 rounded-sm cursor-pointer border transition-colors"
            style={{ background:t.accentBg, color:t.accent, borderColor:t.accent+"40" }}>
            View all {feedbacks.length} feedbacks →
          </button>
        </div>
        {latestFeedback.length === 0 ? (
          <p className="text-xs" style={{ color:t.dim }}>No school has sent feedback yet.</p>
        ) : (
          <div className="flex flex-col gap-0">
            {latestFeedback.map(f => {
              const school = schools.find(s=>s.id===f.schoolId);
              return (
                <div key={f.id} className="flex items-start justify-between gap-4 py-3" style={{ borderBottom:`1px solid ${t.border}` }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium" style={{ color:t.text }}>{school?.name ?? "Unknown school"}</span>
                      <Pill label={f.category} color={categoryColor(f.category, t)} />
                    </div>
                    <p className="text-[11px] mt-1 leading-relaxed line-clamp-2" style={{ color:t.sub }}>{f.message}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <Pill label={f.status} color={statusColor(f.status, t)} />
                    <span className="text-[9px]" style={{ color:t.faint }}>{ageLabel(f.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Feedbacks — one district feed fed by every school ─────────────────────────
function Feedbacks({ feedbacks, setFeedbacks, schools, defaultSchool }: {
  feedbacks:SchoolFeedback[]; setFeedbacks:(f:SchoolFeedback[])=>void;
  schools:School[]; defaultSchool:School|null;
}) {
  const t = useT();
  const [tab, setTab] = useState<"All"|SchoolType>("All");
  const [status, setStatus] = useState<FeedbackStatus|"All">("All");
  const [category, setCategory] = useState<FeedbackCategory|"All">("All");
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [openReply, setOpenReply] = useState<string|null>(null);
  const [replyText, setReplyText] = useState("");
  // Record-feedback form
  const [fSchool, setFSchool] = useState(defaultSchool?.id ?? "");
  const [fAuthor, setFAuthor] = useState("");
  const [fRole, setFRole] = useState("SBFP Focal");
  const [fCategory, setFCategory] = useState<FeedbackCategory>("Feeding Implementation");
  const [fRating, setFRating] = useState(5);
  const [fMessage, setFMessage] = useState("");

  const byId = useMemo(() => new Map(schools.map(s => [s.id, s])), [schools]);

  const filtered = useMemo(() => feedbacks
    .filter(f => {
      const school = byId.get(f.schoolId);
      if (tab !== "All" && school?.type !== tab) return false;
      if (status !== "All" && f.status !== status) return false;
      if (category !== "All" && f.category !== category) return false;
      const needle = q.trim().toLowerCase();
      if (needle) {
        const hay = `${f.message} ${f.author} ${f.role} ${f.response ?? ""} ${school?.name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
  [feedbacks, byId, tab, status, category, q]);

  const newCount = feedbacks.filter(f => f.status === "New").length;
  const openCount = feedbacks.filter(f => f.status !== "Resolved").length;
  const schoolsReporting = new Set(feedbacks.map(f => f.schoolId)).size;
  const rated = feedbacks.filter(f => f.rating > 0);
  const avgRating = rated.length ? rated.reduce((s, f) => s + f.rating, 0) / rated.length : 0;

  const setStatusOf = (id: string, next: FeedbackStatus) =>
    setFeedbacks(feedbacks.map(f => f.id === id ? { ...f, status: next } : f));

  const saveResponse = (id: string) => {
    const text = replyText.trim();
    if (!text) return;
    setFeedbacks(feedbacks.map(f => f.id === id
      ? { ...f, response: text, status: f.status === "New" ? "Acknowledged" : f.status }
      : f));
    setReplyText("");
    setOpenReply(null);
  };

  const submit = () => {
    if (!fSchool || !fMessage.trim()) return;
    const entry: SchoolFeedback = {
      id: `fb-${Date.now()}`,
      schoolId: fSchool,
      author: fAuthor.trim() || "Unspecified",
      role: fRole.trim() || "School staff",
      category: fCategory,
      rating: fRating,
      message: fMessage.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
      status: "New",
    };
    setFeedbacks([entry, ...feedbacks]);
    // Clear the filters too, so what was just recorded is on screen.
    setTab("All"); setStatus("All"); setCategory("All"); setQ("");
    setFMessage(""); setFAuthor(""); setFRating(5); setShowForm(false);
  };

  const inp = { background:t.surface2, color:t.text, border:`1px solid ${t.border}` } as CSSProperties;
  const chip = (active: boolean) => active
    ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" }
    : { background:t.surface, color:t.dim, borderColor:t.border };
  const canSubmit = !!fSchool && !!fMessage.trim();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>Feedbacks</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>
            Every school's feedback in one district feed · {schoolsReporting} of {schools.length} schools have sent in
          </p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer font-semibold border transition-colors"
          style={showForm ? { background:t.surface2, color:t.sub, borderColor:t.border } : { background:t.accent, color:t.accentText, borderColor:t.accent }}>
          {showForm ? "Cancel" : "＋ Record Feedback"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background:t.border }}>
        <StatCard label="Total Feedback" value={feedbacks.length} accent t={t} />
        <StatCard label="New" value={newCount} t={t} />
        <StatCard label="Still Open" value={openCount} t={t} />
        <StatCard label="Resolved" value={feedbacks.length - openCount} t={t} />
      </div>

      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Schools Reporting</div>
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color:t.dim }}>Average rating</span>
            <span className="text-sm font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.text }}>{avgRating ? avgRating.toFixed(1) : "—"}</span>
            <Stars rating={avgRating} color={t.orange} size={12} />
          </div>
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-xl font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.accent }}>{schoolsReporting}</span>
          <span className="text-[11px]" style={{ color:t.dim }}>of {schools.length} schools</span>
        </div>
        <Bar val={schoolsReporting} max={Math.max(schools.length, 1)} color={t.accent} t={t} />
      </div>

      {showForm && (
        <div style={{ border:`1px solid ${t.accent}40`, background:t.surface }} className="p-5 flex flex-col gap-4">
          <div className="text-[9px] tracking-widest uppercase" style={{ color:t.accent }}>Record feedback from a school</div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="School" span="md:col-span-2" t={t}>
              <select value={fSchool} onChange={e => setFSchool(e.target.value)} className="w-full text-sm px-3 py-2 rounded-sm outline-none" style={{ ...inp, cursor:"pointer" }}>
                <option value="">— Select a school —</option>
                {schools.filter(s => s.type === "Elementary").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                {schools.filter(s => s.type === "High School").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Submitted by" t={t}>
              <input value={fAuthor} onChange={e => setFAuthor(e.target.value)} placeholder="Name of sender"
                className="w-full text-sm px-3 py-2 rounded-sm outline-none" style={{ ...inp, fontFamily:"'Outfit',sans-serif" }} />
            </Field>
            <Field label="Role" t={t}>
              <input value={fRole} onChange={e => setFRole(e.target.value)} placeholder="SBFP Focal"
                className="w-full text-sm px-3 py-2 rounded-sm outline-none" style={{ ...inp, fontFamily:"'Outfit',sans-serif" }} />
            </Field>
            <Field label="Category" t={t}>
              <select value={fCategory} onChange={e => setFCategory(e.target.value as FeedbackCategory)} className="w-full text-sm px-3 py-2 rounded-sm outline-none" style={{ ...inp, cursor:"pointer" }}>
                {FEEDBACK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Rating — how is feeding going?" span="md:col-span-3" t={t}>
              <div className="flex items-center gap-2">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setFRating(n)} className="cursor-pointer leading-none"
                    title={`${n} of 5`} style={{ color:n <= fRating ? t.orange : t.faint, fontSize:"20px" }}>★</button>
                ))}
                <span className="text-[10px] ml-1" style={{ color:t.dim }}>{fRating} of 5</span>
              </div>
            </Field>
            <Field label="Feedback" span="md:col-span-4" t={t}>
              <textarea rows={3} value={fMessage} onChange={e => setFMessage(e.target.value)} placeholder="What is the school reporting?"
                className="w-full text-sm px-3 py-2 rounded-sm outline-none resize-y" style={{ ...inp, fontFamily:"'Outfit',sans-serif" }} />
            </Field>
          </div>
          <div className="flex justify-end">
            <button onClick={submit} disabled={!canSubmit} className="px-4 py-2 text-xs rounded-sm font-semibold border transition-colors"
              style={{ background:canSubmit ? t.accent : t.surface2, color:canSubmit ? t.accentText : t.faint, borderColor:t.border, cursor:canSubmit ? "pointer" : "not-allowed" }}>
              Submit feedback
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {(["All","Elementary","High School"] as const).map(tb => (
          <button key={tb} onClick={() => setTab(tb)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors" style={chip(tab===tb)}>
            {tb === "All" ? "All Schools" : tb}
          </button>
        ))}
        <span className="w-px h-5 mx-1" style={{ background:t.border }} />
        {(["All", ...FEEDBACK_STATUSES] as const).map(s => {
          const n = s === "All" ? feedbacks.length : feedbacks.filter(f => f.status === s).length;
          return (
            <button key={s} onClick={() => setStatus(s)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors" style={chip(status===s)}>
              {s} <span style={{ color: status===s ? t.accent : t.faint }}>{n}</span>
            </button>
          );
        })}
        <select value={category} onChange={e => setCategory(e.target.value as FeedbackCategory|"All")}
          className="text-xs px-2 py-1.5 rounded-sm outline-none cursor-pointer" style={inp}>
          <option value="All">All categories</option>
          {FEEDBACK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search feedback…"
          className="text-xs px-3 py-1.5 rounded-sm outline-none w-44 md:ml-auto" style={{ ...inp, fontFamily:"'Outfit',sans-serif" }} />
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <div style={{ border:`1px dashed ${t.border}`, background:t.surface }} className="p-8 text-center">
            {feedbacks.length === 0 ? (
              <>
                <p className="text-sm" style={{ color:t.sub }}>No feedback yet.</p>
                <p className="text-xs mt-1" style={{ color:t.dim }}>Schools send feedback from the School Portal, or record one here with ＋ Record Feedback.</p>
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color:t.sub }}>No feedback matches these filters.</p>
                <p className="text-xs mt-1" style={{ color:t.dim }}>Try another status, category or school type.</p>
              </>
            )}
          </div>
        )}
        {filtered.map(f => {
          const school = byId.get(f.schoolId);
          const isOpen = openReply === f.id;
          const canSend = !!replyText.trim();
          return (
            <div key={f.id} style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  {school && <Pill label={school.type === "Elementary" ? "ES" : "HS"} color={school.type === "Elementary" ? t.blue : t.lime} />}
                  <span className="text-sm font-medium" style={{ color:t.text }}>{school?.name ?? "Unknown school"}</span>
                  <Pill label={f.category} color={categoryColor(f.category, t)} />
                  {f.origin && (
                    <span title="The school sent this from the School Portal"
                      className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ border:`1px solid ${t.border}`, color:t.sub, background:t.surface2 }}>
                      ⇱ School Portal
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Stars rating={f.rating} color={t.orange} />
                  <Pill label={f.status} color={statusColor(f.status, t)} />
                </div>
              </div>

              <p className="text-sm mt-3 leading-relaxed" style={{ color:t.text }}>{f.message}</p>

              <div className="flex items-center gap-2 mt-3 flex-wrap text-[10px]" style={{ color:t.dim }}>
                <span>{f.author} · {f.role}</span>
                <span style={{ color:t.faint }}>•</span>
                <span style={{ color:t.faint }}>{shortDate(f.createdAt)} · {ageLabel(f.createdAt)}</span>
              </div>

              {f.response && (
                <div className="mt-3 pl-3 py-2" style={{ borderLeft:`2px solid ${t.accent}`, background:t.accentBg }}>
                  <div className="text-[9px] tracking-widest uppercase mb-1" style={{ color:t.accent }}>District response</div>
                  <p className="text-xs leading-relaxed" style={{ color:t.sub }}>{f.response}</p>
                </div>
              )}

              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {f.status === "New" && (
                  <button onClick={() => setStatusOf(f.id, "Acknowledged")} className="px-2.5 py-1 text-[10px] rounded-sm cursor-pointer border"
                    style={{ color:t.blue, borderColor:t.blue+"40", background:t.blue+"15" }}>Acknowledge</button>
                )}
                {f.status !== "Resolved" ? (
                  <button onClick={() => setStatusOf(f.id, "Resolved")} className="px-2.5 py-1 text-[10px] rounded-sm cursor-pointer border"
                    style={{ color:t.accent, borderColor:t.accent+"40", background:t.accentBg }}>Mark resolved</button>
                ) : (
                  <button onClick={() => setStatusOf(f.id, "Acknowledged")} className="px-2.5 py-1 text-[10px] rounded-sm cursor-pointer border"
                    style={{ color:t.dim, borderColor:t.border, background:t.surface2 }}>Reopen</button>
                )}
                <button onClick={() => { setOpenReply(isOpen ? null : f.id); setReplyText(f.response ?? ""); }}
                  className="px-2.5 py-1 text-[10px] rounded-sm cursor-pointer border"
                  style={{ color:t.dim, borderColor:t.border, background:t.surface2 }}>
                  {f.response ? "Edit response" : "Respond"}
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea rows={2} value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Write the district's answer back to this school…"
                    className="w-full text-sm px-3 py-2 rounded-sm outline-none resize-y" style={{ ...inp, fontFamily:"'Outfit',sans-serif" }} />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setOpenReply(null); setReplyText(""); }} className="px-3 py-1.5 text-[10px] rounded-sm cursor-pointer border"
                      style={{ color:t.dim, borderColor:t.border, background:t.surface2 }}>Cancel</button>
                    <button onClick={() => saveResponse(f.id)} disabled={!canSend} className="px-3 py-1.5 text-[10px] rounded-sm font-semibold border"
                      style={{ background:canSend ? t.accent : t.surface2, color:canSend ? t.accentText : t.faint, borderColor:t.border, cursor:canSend ? "pointer" : "not-allowed" }}>
                      Send response
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Schools List ──────────────────────────────────────────────────────────────
function SchoolsList({ students, schools, setSchools, setStudents, onSelect }: {
  students:Student[]; schools:School[]; setSchools:(s:School[])=>void;
  setStudents:(s:Student[])=>void; onSelect:(s:School)=>void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<SchoolType|"All">("All");
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editingName, setEditingName] = useState("");
  /** Form 1A header fields of the school being edited (Excel export header block) */
  const [editingDetails, setEditingDetails] = useState<SchoolFormDetails>(EMPTY_FORM_DETAILS);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<SchoolType>("Elementary");
  /** Deleting a school deletes its learner records too — warn before that. */
  const [pendingDelete, setPendingDelete] = useState<School | null>(null);

  const filtered = useMemo(() => schools.filter(
    s => (typeFilter==="All"||s.type===typeFilter) && s.name.toLowerCase().includes(search.toLowerCase())
  ), [schools, search, typeFilter]);

  const coverage = (id: string) => PERIODS.filter(p => students.some(s=>s.schoolId===id&&s.period===p));
  const count = (id: string) => uniqueCount(students.filter(s=>s.schoolId===id));

  const startEdit = (s: School) => {
    setEditingId(s.id);
    setEditingName(s.name);
    setEditingDetails({
      division: s.division, cityMunicipalityBarangay: s.cityMunicipalityBarangay, schoolIdNumber: s.schoolIdNumber,
      principal: s.principal, focalPerson: s.focalPerson,
      dateStartFeeding: s.dateStartFeeding, lastMileSchool: s.lastMileSchool,
    });
  };
  const saveEdit = () => {
    if (editingName.trim()) {
      setSchools(schools.map(s => s.id===editingId ? { ...s, name:editingName.trim(), ...editingDetails } : s));
    }
    setEditingId(null);
  };
  const deleteSchool = (id: string) => {
    setSchools(schools.filter(s=>s.id!==id));
    setStudents(students.filter(s=>s.schoolId!==id));
  };
  const addSchool = () => {
    if (!newName.trim()) return;
    const id = `${newType==="Elementary"?"es":"hs"}${Date.now()}`;
    setSchools([...schools, { id, name:newName.trim(), type:newType, ...EMPTY_FORM_DETAILS }]);
    setNewName(""); setShowAdd(false);
  };

  const inp = { background:t.surface2, color:t.text, border:`1px solid ${t.border}` } as CSSProperties;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>All Schools</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>{schools.filter(s=>s.type==="Elementary").length} elementary · {schools.filter(s=>s.type==="High School").length} high school</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search schools…"
            className="text-sm px-3 py-1.5 rounded-sm outline-none w-48" style={{ ...inp, fontFamily:"'Outfit',sans-serif" }} />
          {(["All","Elementary","High School"] as const).map(type => (
            <button key={type} onClick={() => setTypeFilter(type)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
              style={typeFilter===type ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:t.surface, color:t.dim, borderColor:t.border }}>
              {type}
            </button>
          ))}
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer font-semibold transition-colors"
            style={{ background:t.accent, color:t.accentText }}>
            + Add School
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px" style={{ background:t.border }}>
        {PERIODS.map(p => {
          const n = schools.filter(s=>students.some(st=>st.schoolId===s.id&&st.period===p)).length;
          return (
            <div key={p} style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-4">
              <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color:t.period[p] }}>{p}</div>
              <div className="text-xl font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.text }}>{n}<span className="text-sm" style={{ color:t.faint }}>/{schools.length}</span></div>
              <div className="text-[10px] mt-1" style={{ color:t.dim }}>schools with data</div>
              <Bar val={n} max={schools.length} color={t.period[p]} t={t} />
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div style={{ border:`1px solid ${t.accent}40`, background:t.accentBg }} className="p-4 rounded-sm flex items-center gap-3 flex-wrap">
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="School name…" onKeyDown={e=>e.key==="Enter"&&addSchool()}
            className="flex-1 min-w-[200px] text-sm px-3 py-2 rounded-sm outline-none" style={{ ...inp }} />
          <div className="flex gap-1.5">
            {(["Elementary","High School"] as SchoolType[]).map(type => (
              <button key={type} onClick={() => setNewType(type)} className="px-3 py-2 text-xs rounded-sm cursor-pointer border transition-colors"
                style={newType===type ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:t.surface2, color:t.dim, borderColor:t.border }}>
                {type}
              </button>
            ))}
          </div>
          <button onClick={addSchool} className="px-4 py-2 text-sm font-semibold rounded-sm cursor-pointer" style={{ background:t.accent, color:t.accentText }}>Save</button>
          <button onClick={() => { setShowAdd(false); setNewName(""); }} className="text-sm cursor-pointer" style={{ color:t.dim }}>Cancel</button>
        </div>
      )}

      <p className="text-[10px] md:hidden -mb-2" style={{ color: t.dim }}>
        Swipe the table sideways for the period columns and actions →
      </p>
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr style={{ borderBottom:`1px solid ${t.border}` }}>
              <th className="text-left px-4 py-3 text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>School</th>
              <th className="px-4 py-3 text-[9px] tracking-widest uppercase text-center" style={{ color:t.dim }}>Type</th>
              {PERIODS.map(p => <th key={p} className="px-4 py-3 text-[9px] tracking-widest uppercase text-center" style={{ color:t.period[p]+"99" }}>{p}</th>)}
              <th className="px-4 py-3 text-[9px] tracking-widest uppercase text-center" style={{ color:t.dim }}>Students</th>
              <th className="px-4 py-3 w-56 text-right text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(school => {
              const cov = coverage(school.id);
              const n = count(school.id);
              const isEditing = editingId === school.id;
              return (
                <Fragment key={school.id}>
                <tr className="group transition-colors" style={{ borderBottom:`1px solid ${t.border}` }}
                  onMouseEnter={e=>(e.currentTarget.style.background=t.hover)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  <td className="px-4 py-2.5 font-medium">
                    {/* The row's own Open button sits at the far right, which on a
                        phone is a sideways scroll away. Tapping the school's own
                        name opens it too, right where the eye already is. */}
                    <button type="button" onClick={() => onSelect(school)} title={`Open ${school.name}`}
                      className="text-left transition-colors"
                      style={{ color: isEditing ? t.accent : t.text, background:"none", border:"none", padding:0, font:"inherit", cursor:"pointer" }}
                      onMouseEnter={e=>{ e.currentTarget.style.textDecoration="underline"; }}
                      onMouseLeave={e=>{ e.currentTarget.style.textDecoration="none"; }}>{school.name}</button>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Pill label={school.type==="Elementary"?"ES":"HS"} color={school.type==="Elementary"?t.blue:t.lime} />
                  </td>
                  {PERIODS.map(p => (
                    <td key={p} className="px-4 py-2.5 text-center">
                      {cov.includes(p) ? <span style={{ color:t.period[p] }}>✓</span> : <span style={{ color:t.faint }}>—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center text-xs" style={{ fontFamily:"'JetBrains Mono',monospace", color:n>0?t.sub:t.faint }}>{n}</td>
                  <td className="px-4 py-2.5">
                    {/* Revealed on row hover / keyboard focus (see `.row-actions` in
                        styles.css); a row being edited keeps Save / Cancel in view. */}
                    <div
                      className={
                        isEditing
                          ? "flex items-center gap-1.5 justify-end whitespace-nowrap"
                          : "row-actions flex items-center gap-1.5 justify-end whitespace-nowrap"
                      }
                    >
                      {isEditing
                        ? <>
                            <button onClick={saveEdit} className="text-xs px-3 py-1.5 rounded-sm cursor-pointer border font-semibold" style={{ background:t.accentBg, color:t.accent, borderColor:t.accent+"55" }}>Save</button>
                            <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 rounded-sm cursor-pointer border" style={{ background:t.surface2, color:t.sub, borderColor:t.border }}>Cancel</button>
                          </>
                        : <>
                            <button aria-label={`Open ${school.name}`} onClick={() => onSelect(school)}
                              className="text-xs px-3 py-1.5 rounded-sm cursor-pointer border font-medium transition-colors"
                              style={{ background:t.accentBg, color:t.accent, borderColor:t.accent+"55" }}
                              onMouseEnter={e=>{ e.currentTarget.style.background=t.accent; e.currentTarget.style.color=t.accentText; }}
                              onMouseLeave={e=>{ e.currentTarget.style.background=t.accentBg; e.currentTarget.style.color=t.accent; }}>Open</button>
                            <button aria-label={`Edit ${school.name}`} onClick={() => startEdit(school)}
                              className="text-xs px-3 py-1.5 rounded-sm cursor-pointer border transition-colors"
                              style={{ background:t.surface2, color:t.sub, borderColor:t.border }}
                              onMouseEnter={e=>{ e.currentTarget.style.color=t.text; e.currentTarget.style.borderColor=t.dim; }}
                              onMouseLeave={e=>{ e.currentTarget.style.color=t.sub; e.currentTarget.style.borderColor=t.border; }}>Edit</button>
                            <button aria-label={`Delete ${school.name}`} onClick={() => setPendingDelete(school)}
                              className="text-xs px-3 py-1.5 rounded-sm cursor-pointer border transition-colors"
                              style={{ background:"transparent", color:t.danger, borderColor:t.danger+"55" }}
                              onMouseEnter={e=>{ e.currentTarget.style.background=t.danger; e.currentTarget.style.color=t.isDark ? "#100505" : "#ffffff"; }}
                              onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; e.currentTarget.style.color=t.danger; }}>Delete</button>
                          </>}
                    </div>
                  </td>
                </tr>
                {isEditing && (
                  <tr>
                    <td colSpan={8} className="px-4 py-4" style={{ background: t.surfaceDeep }}>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>Edit School — SBFP Form Details</span>
                          <span className="text-[9px]" style={{ color: t.faint }}>(printed in the Excel export header)</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[9px] tracking-widest uppercase mb-1.5" style={{ color: t.dim }}>School Name</label>
                            <input value={editingName} onChange={e=>setEditingName(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter")saveEdit(); if(e.key==="Escape")setEditingId(null); }}
                              autoFocus className="text-sm px-3 py-2 rounded-sm outline-none w-full" style={{ ...inp }} />
                          </div>
                          {FORM_DETAIL_FIELDS.map(([key, label]) => (
                            <div key={key}>
                              <label className="block text-[9px] tracking-widest uppercase mb-1.5" style={{ color: t.dim }}>{label}</label>
                              {key === "lastMileSchool" ? (
                                <div className="flex gap-1.5">
                                  {(["Yes","No"] as YesNo[]).map(v => (
                                    <button key={v} type="button"
                                      onClick={() => setEditingDetails(d => ({ ...d, lastMileSchool: d.lastMileSchool === v ? "" : v }))}
                                      className="px-4 py-2 text-xs font-semibold rounded-sm cursor-pointer border transition-colors"
                                      style={editingDetails.lastMileSchool === v
                                        ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" }
                                        : { ...inp, color:t.dim }}>
                                      {v}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <input value={editingDetails[key]} type={key === "dateStartFeeding" ? "date" : "text"}
                                  onChange={e=>setEditingDetails(d=>({ ...d, [key]: e.target.value }))}
                                  onKeyDown={e=>{ if(e.key==="Enter")saveEdit(); if(e.key==="Escape")setEditingId(null); }}
                                  className="text-sm px-3 py-2 rounded-sm outline-none w-full"
                                  style={{ ...inp, colorScheme: t.isDark ? "dark" : "light" }} />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={saveEdit} className="px-4 py-2 text-xs font-semibold rounded-sm cursor-pointer" style={{ background: t.accent, color: t.accentText }}>Save Details</button>
                          <button onClick={() => setEditingId(null)} className="px-3 py-2 text-xs cursor-pointer rounded-sm border" style={{ borderColor: t.border, color: t.dim }}>Cancel</button>
                          <span className="text-[10px]" style={{ color: t.faint }}>Tip: press Enter to save · Esc to cancel</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this school"}?`}
        confirmLabel="Delete school"
        cancelLabel="Keep school"
        palette={confirmPalette(t)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteSchool(pendingDelete.id);
          setPendingDelete(null);
        }}
      >
        {(() => {
          const count = pendingDelete
            ? students.filter(s => s.schoolId === pendingDelete.id).length
            : 0;
          return (
            <>
              The school is removed from the district list
              {count > 0
                ? " and its " + count + (count === 1 ? " learner record is" : " learner records are") + " deleted with it"
                : ""}
              , including the records the school encoded from the School Portal.{" "}
              <strong style={{ color: t.text }}>This cannot be undone.</strong>
            </>
          );
        })()}
      </ConfirmDialog>
    </div>
  );
}

// ── Per-School Dashboard ──────────────────────────────────────────────────────
function Dashboard({ students, school, activeSy }: { students:Student[]; school:School; activeSy:string }) {
  const t = useT();
  const [period, setPeriod] = useState<Period|"All">("All");
  const fRaw = period==="All" ? students : students.filter(s=>s.period===period);
  // Deduplicate so one student is counted once (prefer Endline when period=All)
  const f = period==="All" ? uniqueStudents(fRaw) : fRaw;
  const bmiDist = BMI_STATUSES.map(st=>({ label:st, val:f.filter(s=>s.bmiStatus===st).length, color:t.bmi[st] }));
  const hfaDist = HFA_STATUSES.map(st=>({ label:st, val:f.filter(s=>s.hfaStatus===st).length, color:t.hfa[st] }));
  const maxBMI = Math.max(...bmiDist.map(x=>x.val),1);
  const maxHFA = Math.max(...hfaDist.map(x=>x.val),1);
  const grades = getGrades(school);
  const byGrade = grades.map(g=>({ grade:g, count:f.filter(s=>s.gradeLevel===g).length }));
  const maxG = Math.max(...byGrade.map(x=>x.count),1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>{school.name}</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>{school.type} · SY {formatSchoolYear(activeSy)}</p>
        </div>
        <div className="flex gap-1.5">
          {(["All",...PERIODS] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
              style={period===p
                ? p==="All" ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:t.period[p as Period]+"20", color:t.period[p as Period], borderColor:t.period[p as Period]+"40" }
                : { background:t.surface, color:t.dim, borderColor:t.border }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background:t.border }}>
        <StatCard label="Total Students" value={f.length} accent t={t} />
        <StatCard label="4Ps Beneficiaries" value={f.filter(s=>s.fourPs==="Yes").length} t={t} />
        <StatCard label="SBFP Prev. Years" value={f.filter(s=>s.sbfpPreviousYears==="Yes").length} t={t} />
        <StatCard label="Dewormed" value={f.filter(s=>s.dewormed==="Yes").length} t={t} />
      </div>

      {students.length === 0 && (
        <div style={{ border:`1px dashed ${t.border}`, background:t.surface }} className="p-5">
          <p className="text-sm" style={{ color:t.sub }}>No learner records yet.</p>
          <p className="text-xs mt-1" style={{ color:t.dim }}>
            Add this school's learners from Student Records, or wait for the school to submit them through the School Portal.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ background:t.border }}>
        <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
          <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>BMI Status</div>
          {bmiDist.map(c=>(
            <div key={c.label} className="mb-3">
              <div className="flex justify-between mb-1"><span className="text-xs" style={{ color:t.sub }}>{c.label}</span>
                <span className="text-[10px]" style={{ fontFamily:"'JetBrains Mono',monospace", color:c.color }}>{c.val}</span></div>
              <Bar val={c.val} max={maxBMI} color={c.color} t={t} />
            </div>
          ))}
        </div>
        <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
          <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>HFA Status</div>
          {hfaDist.map(c=>(
            <div key={c.label} className="mb-3">
              <div className="flex justify-between mb-1"><span className="text-xs" style={{ color:t.sub }}>{c.label}</span>
                <span className="text-[10px]" style={{ fontFamily:"'JetBrains Mono',monospace", color:c.color }}>{c.val}</span></div>
              <Bar val={c.val} max={maxHFA} color={c.color} t={t} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
        <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>Students by Grade</div>
        <div className="flex items-end gap-2">
          {byGrade.map(({grade,count}) => (
            <div key={grade} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="w-full rounded-sm" style={{ height:`${(count/maxG)*60}px`, minHeight:"2px", background:count>0?t.accent:t.border }} />
              <span className="text-[8px]" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.faint }}>{grade.replace("SPED ","S").replace("Grade ","G").replace("Kinder","KG")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Data Entry ────────────────────────────────────────────────────────────────
function DataEntry({ students, setStudents, school, setView, editingStudent, clearEditing, activeSy }: {
  students:Student[]; setStudents:(s:Student[])=>void; school:School;
  setView:(v:View)=>void; editingStudent:Student|null; clearEditing:()=>void; activeSy:string;
}) {
  const t = useT();
  const [period, setPeriod] = useState<Period|null>(editingStudent?.period ?? null);
  const [form, setForm] = useState<Omit<Student,"id">>(() =>
    editingStudent ? { ...editingStudent } : EMPTY_STUDENT(school.id, "", activeSy)
  );
  const [saved, setSaved] = useState(false);
  const [periodError, setPeriodError] = useState(false);
  /** Why the record cannot be saved (missing or impossible measurements). */
  const [formError, setFormError] = useState("");
  /** The past year this learner's record was found in, or null. */
  const [previousSy, setPreviousSy] = useState<string | null>(null);
  /** The Form 1A workbook import opened from this screen. */
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<{
    count: number; period: Period; invalid: number; duplicates: number; fileName: string;
  } | null>(null);
  /** The Division Office answered the previous-years question itself. */
  const previousTouched = useRef(false);
  /** The current "Yes" was set by the archive lookup, not by a person. */
  const autoPrevious = useRef(false);
  const periodRef = useRef<HTMLDivElement>(null);
  /**
   * A status the user picked by hand outranks the WHO auto-classification for
   * this record. Without this, recalculating on every measurement would silently
   * throw the override away; with it, clearing the measurements still clears a
   * status that was only ever computed.
   */
  const manualStatus = useRef({ bmi: false, hfa: false });
  const resetManualStatus = () => { manualStatus.current = { bmi: false, hfa: false }; };

  // Populate form when editingStudent changes
  useEffect(() => {
    resetManualStatus();
    previousTouched.current = false;
    autoPrevious.current = false;
    setPreviousSy(null);
    if (editingStudent) {
      const loaded = { ...editingStudent };
      // Only a male learner is locked to "No"; a female learner aged 10 or
      // below keeps whatever is stored until her age is edited again.
      if (mustNotBePregnant(loaded.sex)) loaded.pregnant = "No";
      setForm(loaded);
      setPeriod(editingStudent.period);
      setPeriodError(false);
    }
  }, [editingStudent]);

  const grades = getGrades(school);

  // Answer "beneficiary in previous years?" from the school's archive once a
  // name (and date of birth, if given) is on the form. Debounced; returns only
  // the year; never overrides a choice the Division Office made itself.
  useEffect(() => {
    if (editingStudent) return;
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
      void lookupPreviousBeneficiary({ data: { schoolId: school.id, name, dateOfBirth: form.dateOfBirth } })
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
  }, [form.name, form.dateOfBirth, editingStudent, school.id]);
  const inp: CSSProperties = { background:t.surface2, color:t.text, border:`1px solid ${t.border}`, fontFamily:"'Outfit',sans-serif" };
  const inpMono: CSSProperties = { ...inp, fontFamily:"'JetBrains Mono',monospace" };
  const cls = "w-full text-sm px-3 py-2 rounded-sm outline-none";

  const set = (key: keyof Omit<Student,"id">, val: string) => {
    setFormError("");
    if (key === "sbfpPreviousYears") {
      previousTouched.current = true;
      autoPrevious.current = false;
    }
    if (key === "bmiStatus") manualStatus.current.bmi = true;
    if (key === "hfaStatus") manualStatus.current.hfa = true;
    setForm(f => {
      const next = { ...f, [key]: val };
      if (key === "dateOfBirth") {
        const age = computeAge(val);
        next.ageYears = age.years;
        next.ageMonths = age.months;
      }

      const ageY = next.ageYears;
      const sex = next.sex;
      const weight = key === "weight" ? val : f.weight;
      const height = key === "height" ? val : f.height;

      // Only recalculate BMI number when weight or height changes
      const measuresChanged = key === "weight" || key === "height";
      if (measuresChanged) {
        next.bmi = calcBMI(weight, height);
      }

      // Auto-classify BMI only when measurements / age / sex change — NOT when editing HFA status.
      // The computed value (even an empty one) replaces the old status, so a
      // cleared weight can never leave a confident "Normal" behind.
      const bmiInputsChanged = measuresChanged || key === "dateOfBirth" || key === "sex" || key === "ageYears";
      if (bmiInputsChanged && !manualStatus.current.bmi) {
        next.bmiStatus = classifyBMI(next.bmi || calcBMI(weight, height), ageY, sex);
      }

      // Auto-classify HFA only when height / age / sex change — NOT when editing BMI status
      const hfaInputsChanged = key === "height" || key === "dateOfBirth" || key === "sex" || key === "ageYears";
      if (hfaInputsChanged && !manualStatus.current.hfa) {
        next.hfaStatus = classifyHFA(height, ageY, sex);
      }

      // Keep nutritionalStatus in sync with BMI status (an auto field, not a separate one)
      next.nutritionalStatus = next.bmiStatus;

      // Beneficiary class (Kinder/G1 = Primary; G2–12 from wasted/stunted status) — still editable
      if (key !== "classificationOfBeneficiary") {
        const autoClass = classifyBeneficiary(next.gradeLevel, next.bmiStatus, next.hfaStatus);
        if (autoClass) next.classificationOfBeneficiary = autoClass;
      }
      // A male learner is locked to "No". A female learner aged 10 or below
      // only defaults to "No" when sex or age changes; the answer stays
      // editable, so a deliberate "Yes" is not overwritten on every keystroke.
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

  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
    setPeriodError(false);
    setForm(f => ({ ...f, period: p }));
  };

  const handleSave = () => {
    if (!period) {
      setPeriodError(true);
      periodRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const firstBtn = periodRef.current?.querySelector("button") as HTMLButtonElement | null;
      firstBtn?.focus();
      return;
    }
    if (!form.name.trim()) return;
    // Same rule as the school portal and the server: an unweighed learner is
    // not a record. Without this, 0 kg / 0 cm was saved and counted as a
    // learner with no BMI classification.
    const problem = learnerProblem({
      name: form.name,
      period,
      weight: form.weight,
      height: form.height,
    });
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError("");
    const id = editingStudent?.id ?? "s" + Date.now();
    const payload = { ...form, period, id };
    if (editingStudent) {
      setStudents(students.map(s => s.id === editingStudent.id ? payload : s));
    } else {
      setStudents([...students, payload]);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (editingStudent) { clearEditing(); setView("records"); }
    else {
      setPeriod(null);
      setPeriodError(false);
      resetManualStatus();
      previousTouched.current = false;
      autoPrevious.current = false;
      setPreviousSy(null);
      setForm(EMPTY_STUDENT(school.id, "", activeSy));
    }
  };

  const handleCancel = () => { clearEditing(); setView("records"); };

  const ageYrs = parseInt(form.ageYears) || 0;

  /** Why the WHO auto-status cannot be worked out yet, or null when it can. */
  const autoHint = (() => {
    if (!form.weight || !form.height) return null;
    if (!form.sex) return "Auto status needs the learner's sex — the WHO 2007 tables differ for boys and girls.";
    if (!form.dateOfBirth) return "Auto status needs the date of birth — the WHO 2007 tables start at age 5.";
    if (ageYrs < 5 || ageYrs > 19) return `Age ${ageYrs} is outside the WHO 2007 tables (ages 5–19), so set BMI and HFA status by hand.`;
    return null;
  })();

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>{editingStudent ? "Edit Student" : "Data Entry"}</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>{school.name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!editingStudent && (
              <button
                type="button"
                onClick={() => { setImportOpen(true); setImportNotice(null); }}
                className="px-3 py-1.5 text-xs font-semibold rounded-sm cursor-pointer border transition-colors"
                style={{ background: t.surface, color: t.accent, borderColor: t.accent + "55" }}
              >
                ↑ Import Excel
              </button>
            )}
            <div ref={periodRef} className="flex gap-1.5" tabIndex={-1}
              style={periodError ? { outline: `2px solid ${t.danger}`, outlineOffset: 2, borderRadius: 4, padding: 2 } : undefined}>
              {PERIODS.map(p => (
                <button key={p} onClick={() => handlePeriodChange(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
                  style={period===p ? { background:t.period[p]+"20", color:t.period[p], borderColor:t.period[p]+"40" } : { background:t.surface, color:t.dim, borderColor:t.border }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          {periodError && (
            <span className="text-[10px]" style={{ color: t.danger }}>Please select Baseline, Midline, or Endline</span>
          )}
          {!period && !periodError && (
            <span className="text-[10px]" style={{ color: t.dim }}>Select a period</span>
          )}
        </div>
      </div>

      {importNotice && (
        <div
          role="status"
          className="flex items-start gap-3 text-xs"
          style={{
            color: t.sub, background: t.accentBg, border: `1px solid ${t.accent}45`,
            borderLeft: `3px solid ${t.accent}`, borderRadius: 5, padding: "10px 12px", lineHeight: 1.55,
          }}
        >
          <span aria-hidden="true" style={{ color: t.accent, fontWeight: 700 }}>✓</span>
          <div className="min-w-0 flex-1">
            <strong style={{ color: t.text }}>
              Imported {importNotice.count} {importNotice.period} learner record{importNotice.count === 1 ? "" : "s"}
            </strong>{" "}from {importNotice.fileName}. They are in Student Records now.
            {(importNotice.invalid > 0 || importNotice.duplicates > 0) && (
              <div style={{ color: t.dim, marginTop: 2 }}>
                {importNotice.invalid > 0 ? `${importNotice.invalid} invalid row${importNotice.invalid === 1 ? " was" : "s were"} skipped.` : ""}
                {importNotice.invalid > 0 && importNotice.duplicates > 0 ? " " : ""}
                {importNotice.duplicates > 0 ? `${importNotice.duplicates} duplicate row${importNotice.duplicates === 1 ? " was" : "s were"} skipped.` : ""}
              </div>
            )}
          </div>
          <button type="button" aria-label="Dismiss import summary" onClick={() => setImportNotice(null)}
            className="cursor-pointer" style={{ color: t.dim, background: "transparent", border: "none" }}>✕</button>
        </div>
      )}

      {/* Two columns on a wide screen: the learner + her measurements on the
          left, the classification and yes/no block on the right, instead of a
          narrow form with a wide empty margin beside it. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-5 items-start">
      <div className="flex flex-col gap-5">

      {/* Identity */}
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5 flex flex-col gap-4">
        <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Student Information</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field t={t} label="Full Name" span="md:col-span-2">
            <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Last, First Middle" style={inp} className={cls} />
          </Field>
          <Field t={t} label="Sex">
            <div className="flex gap-1.5 h-[38px]">
              {(["M","F"] as Sex[]).map(s => (
                <button key={s} onClick={() => set("sex",s)} className="flex-1 text-sm rounded-sm cursor-pointer border transition-colors"
                  style={form.sex===s ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:t.surface2, color:t.dim, borderColor:t.border }}>
                  {s==="M"?"Male":"Female"}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field t={t} label="Grade Level">
            <select value={form.gradeLevel} onChange={e=>set("gradeLevel",e.target.value)} style={{ ...inp, cursor:"pointer" }} className={cls}>
              {grades.map(g=><option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field t={t} label="Date of Birth">
            <input type="date" value={form.dateOfBirth} onChange={e=>set("dateOfBirth",e.target.value)} style={inp} className={cls} />
          </Field>
          <Field t={t} label="Date of Weighing">
            <input type="date" value={form.dateOfWeighing} onChange={e=>set("dateOfWeighing",e.target.value)} style={inp} className={cls} />
          </Field>
          <Field t={t} label="School Year">
            <input value={form.sy} onChange={e=>set("sy",e.target.value)} style={inp} className={cls} />
          </Field>
        </div>
        {/* Age follows the same 4-column rhythm as the row above, so the computed
            fields sit under the dates instead of stretching across the form. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field t={t} label="Age — Years (auto)">
            <input readOnly value={form.ageYears} placeholder="—" style={{ ...inpMono, opacity:form.ageYears?1:0.4, color:t.accent, cursor:"default" }} className={cls} />
          </Field>
          <Field t={t} label="Age — Months (auto)">
            <input readOnly value={form.ageMonths} placeholder="—" style={{ ...inpMono, opacity:form.ageMonths?1:0.4, color:t.accent, cursor:"default" }} className={cls} />
          </Field>
        </div>
      </div>

      {/* Measurements */}
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5 flex flex-col gap-4">
        <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Anthropometric Measurements</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field t={t} label="Weight (kg)">
            <input type="number" step="0.1" min={0.1} max={300} required value={form.weight} onChange={e=>set("weight",e.target.value)} placeholder="e.g. 24.5" style={inp} className={cls} />
          </Field>
          <Field t={t} label="Height (cm)">
            <input type="number" step="0.1" min={1} max={250} required value={form.height} onChange={e=>set("height",e.target.value)} placeholder="e.g. 118.0" style={inp} className={cls} />
          </Field>
          <Field t={t} label={`BMI ${ageYrs>=6?"(auto)":"(6 y.o.+)"}`}>
            <input value={form.bmi} readOnly={ageYrs>=6} onChange={e=>ageYrs<6&&set("bmi",e.target.value)}
              style={{ ...inpMono, color:form.bmi?t.accent:t.dim, opacity:form.bmi?1:0.5, cursor:ageYrs>=6?"default":"text" }} className={cls} placeholder="—" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field t={t} label="BMI Status (WHO 2007 — auto, editable)">
            <div className="flex gap-2 items-center">
              <select value={form.bmiStatus} onChange={e=>set("bmiStatus",e.target.value as BMIStatus)} style={{ ...inp, cursor:"pointer", flex:1, color: form.bmiStatus ? t.bmi[form.bmiStatus] : t.dim }} className={cls}>
                <option value="">— Select —</option>
                {BMI_STATUSES.map(s=><option key={s} value={s} style={{ color:t.bmi[s] }}>{s}</option>)}
              </select>
              {form.bmiStatus && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:t.bmi[form.bmiStatus] }} />}
            </div>
          </Field>
          <Field t={t} label="HFA Status (WHO 2007 — auto, editable)">
            <div className="flex gap-2 items-center">
              <select value={form.hfaStatus} onChange={e=>set("hfaStatus",e.target.value as HFAStatus)} style={{ ...inp, cursor:"pointer", flex:1, color: form.hfaStatus ? t.hfa[form.hfaStatus] : t.dim }} className={cls}>
                <option value="">— Select —</option>
                {HFA_STATUSES.map(s=><option key={s} value={s} style={{ color:t.hfa[s] }}>{s}</option>)}
              </select>
              {form.hfaStatus && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:t.hfa[form.hfaStatus] }} />}
            </div>
          </Field>
        </div>
        {autoHint && (!form.bmiStatus || !form.hfaStatus) && (
          <p className="text-[10px] -mt-1" style={{ color:t.warning, lineHeight:1.5 }}>{autoHint}</p>
        )}
      </div>

      </div>

      <div className="flex flex-col gap-5">

      {/* Classification */}
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5 flex flex-col gap-4">
        <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Beneficiary Classification</div>
        <p className="text-[10px] -mt-2" style={{ color:t.faint }}>Kinder &amp; Grade 1 = Primary · Grades 2–12: Wasted or Severely Wasted = Primary · Stunted or Severely Stunted = Secondary · auto, editable</p>
        <div className="flex gap-2" style={{ maxWidth: 420 }}>
          {(["Primary","Secondary"] as const).map(c => (
            <button key={c} onClick={() => set("classificationOfBeneficiary",c)} className="flex-1 py-2 text-sm rounded-sm cursor-pointer border transition-colors"
              style={form.classificationOfBeneficiary===c ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:t.surface2, color:t.dim, borderColor:t.border }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Yes/No */}
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5 flex flex-col gap-4">
        <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Additional Information</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {([
            ["Pregnant?","pregnant"], ["With 0–1 Year Old Children?","hasYoungChildren"],
            ["Dewormed?","dewormed"], ["Parent's Consent for Milk?","parentConsentMilk"],
            ["Participation in 4Ps?","fourPs"], ["Beneficiary of SBFP in Previous Years?","sbfpPreviousYears"],
          ] as [string, keyof Omit<Student,"id">][]).map(([label,key]) => {
            const locked = key === "pregnant" && mustNotBePregnant(form.sex);
            const defaultsNo = key === "pregnant" && !locked &&
              defaultsToNotPregnant(form.sex, form.ageYears);
            return (
              <div key={key as string}>
                <label className="block text-[9px] tracking-widest uppercase mb-1.5" style={{ color:t.dim }}>{label}</label>
                <YesNoToggle value={form[key] as YesNo} onChange={v=>set(key,v)} t={t} disabled={locked} />
                {locked && (
                  <p className="text-[10px] mt-1.5" style={{ color:t.dim, lineHeight:1.45 }}>
                    Male learners are recorded as not pregnant.
                  </p>
                )}
                {defaultsNo && (
                  <p className="text-[10px] mt-1.5" style={{ color:t.dim, lineHeight:1.45 }}>
                    Defaults to No at age 10 or below — you can still change it.
                  </p>
                )}
                {key === "sbfpPreviousYears" && previousSy && (
                  <p className="text-[10px] mt-1.5" style={{ color:t.accent, lineHeight:1.45 }}>
                    This learner already has a record in SY {formatSchoolYear(previousSy)}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <button onClick={handleSave} className="px-6 py-2.5 text-sm font-semibold rounded-sm cursor-pointer transition-colors"
          style={{ background:t.accent, color:t.accentText }}>
          {saved ? "✓ Saved" : editingStudent ? "Update Student" : "Save Student"}
        </button>
        {editingStudent
          ? <button onClick={handleCancel} className="px-4 py-2.5 text-sm cursor-pointer rounded-sm border transition-colors" style={{ borderColor:t.border, color:t.dim, background:t.surface }}>Cancel</button>
          : <button onClick={() => { setPeriod(null); setPeriodError(false); resetManualStatus(); previousTouched.current = false; autoPrevious.current = false; setPreviousSy(null); setForm(EMPTY_STUDENT(school.id, "", activeSy)); }} className="px-4 py-2.5 text-sm cursor-pointer rounded-sm border" style={{ borderColor:t.border, color:t.dim }}>Clear</button>}
        <button onClick={() => setView("records")} className="text-xs ml-auto cursor-pointer" style={{ color:t.dim }}>View all records →</button>
      </div>
      {formError && (
        <p role="alert" className="text-xs" style={{ color:t.danger, lineHeight:1.55 }}>{formError}</p>
      )}

      {importOpen && (
        <ImportLearnersDialog
          t={t}
          school={school}
          sy={activeSy}
          existing={students.filter((student) => student.schoolId === school.id)}
          initialPeriod={period}
          onClose={() => setImportOpen(false)}
          onImported={(rows, importedPeriod, summary) => {
            setStudents([...students, ...rows]);
            setImportOpen(false);
            setImportNotice({ count: rows.length, period: importedPeriod, ...summary });
          }}
        />
      )}
    </div>
  );
}

// ── Student Records ────────────────────────────────────────────────────────────
function StudentRecords({ students, setStudents, school, setView, onEdit, activeSy }: {
  students:Student[]; setStudents:(s:Student[])=>void; school:School;
  setView:(v:View)=>void; onEdit:(s:Student)=>void; activeSy:string;
}) {
  const t = useT();
  const [period, setPeriod] = useState<Period|"All">("All");
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  /** The learner whose ✕ was clicked — nothing is removed until this is confirmed. */
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);

  const uniqueStudentCount = useMemo(() => uniqueCount(students), [students]);

  const filtered = useMemo(() => {
    const list = students.filter(
      s => (period === "All" || s.period === period) &&
        (s.name.toLowerCase().includes(search.toLowerCase()) || s.gradeLevel.toLowerCase().includes(search.toLowerCase()))
    );
    return sortRecords(list);
  }, [students, period, search]);

  const del = (id: string) => setStudents(students.filter(s => s.id !== id));
  const th: CSSProperties = {
    color: t.dim, borderRight: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`,
    background: t.surfaceDeep, verticalAlign: "middle",
  };
  const td = (v: string | number, opts?: { mono?: boolean; color?: string; nowrap?: boolean }) => (
    <td className="px-1.5 py-2 text-center" style={{
      fontFamily: opts?.mono ? "'JetBrains Mono',monospace" : undefined,
      color: opts?.color ?? t.sub,
      borderRight: `1px solid ${t.surfaceDeep}`,
      whiteSpace: opts?.nowrap === false ? "normal" : "nowrap",
    }}>{v === "" || v === undefined ? "—" : v}</td>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: t.text }}>Student Records</h1>
          <p className="text-xs mt-0.5" style={{ color: t.dim }}>
            {school.name} · SBFP Form 1A · sorted Kinder → Grade 6 · {uniqueStudentCount} students · {students.length} period records
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => { setExporting(true); try { const { exportStudentsToExcel } = await import("@/lib/sbfp-export"); await exportStudentsToExcel(school, filtered, period === "All" ? "All" : period, activeSy); } finally { setExporting(false); } }}
            disabled={filtered.length === 0}
            className="px-4 py-2 text-sm font-semibold rounded-sm cursor-pointer border transition-colors"
            style={{
              background: filtered.length === 0 ? t.surface2 : t.surface,
              color: filtered.length === 0 ? t.faint : t.accent,
              borderColor: filtered.length === 0 ? t.border : t.accent + "60",
              cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {exporting ? "Exporting…" : "↓ Export Excel"}
          </button>
          <button onClick={() => setView("entry")} className="px-4 py-2 text-sm font-semibold rounded-sm cursor-pointer" style={{ background: t.accent, color: t.accentText }}>+ Add Student</button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or grade…"
          className="text-sm px-3 py-1.5 rounded-sm outline-none flex-1 min-w-[180px]"
          style={{ background: t.surface, color: t.text, border: `1px solid ${t.border}` }} />
        {(["All", ...PERIODS] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
            style={period === p
              ? p === "All" ? { background: t.accentBg, color: t.accent, borderColor: t.accent + "40" } : { background: t.period[p as Period] + "20", color: t.period[p as Period], borderColor: t.period[p as Period] + "40" }
              : { background: t.surface, color: t.dim, borderColor: t.border }}>
            {p}
          </button>
        ))}
      </div>
      <p className="text-[10px] md:hidden -mb-2" style={{ color: t.dim }}>
        Swipe the table sideways to see every column →
      </p>
      <div style={{ border: `1px solid ${t.border}`, background: t.surface }} className="overflow-x-auto">
        <table className="w-full text-[10px] min-w-[1480px] border-collapse">
          <thead>
            <tr>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>No.</th>
              <th rowSpan={2} className="px-2 py-2 text-left text-[8px] tracking-widest uppercase" style={th}>Name</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Sex</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Grade / Section</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Date of Birth<br/>(MM/DD/YYYY)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Date of Weighing<br/>(MM/DD/YYYY)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Age in Years / Months</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Weight (Kg)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Height (cm)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>BMI for 6 y.o.<br/>and above</th>
              <th colSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase text-center" style={th}>Nutritional Status (NS)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Classification of<br/>Beneficiary</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Pregnant<br/>(Yes or No)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>With 0-1 year old<br/>children</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Dewormed<br/>(Yes or No)</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Parent's consent<br/>for milk</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Participation<br/>in 4Ps</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={th}>Beneficiary of SBFP<br/>in previous years</th>
              <th rowSpan={2} className="px-2 py-2 text-[8px] tracking-widest uppercase" style={{ ...th, borderRight: "none" }}>Period / Actions</th>
            </tr>
            <tr>
              <th className="px-2 py-1.5 text-[8px] tracking-widest uppercase text-center" style={th}>BMI-A</th>
              <th className="px-2 py-1.5 text-[8px] tracking-widest uppercase text-center" style={th}>HFA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, idx) => {
              const prev = filtered[idx - 1];
              const gradeBreak = prev && prev.gradeLevel !== s.gradeLevel;
              return (
                <tr key={s.id} className="group"
                  style={{
                    borderBottom: `1px solid ${t.surfaceDeep}`,
                    background: gradeBreak ? t.surfaceDeep : "transparent",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = t.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = gradeBreak ? t.surfaceDeep : "transparent")}>
                  {td(idx + 1, { mono: true, color: t.dim })}
                  <td className="px-2 py-2 text-left font-medium" style={{ color: t.text, borderRight: `1px solid ${t.surfaceDeep}`, whiteSpace: "nowrap" }}>{s.name || "—"}</td>
                  {td(s.sex)}
                  {td(s.gradeLevel)}
                  {td(formatDateMDY(s.dateOfBirth), { mono: true })}
                  {td(formatDateMDY(s.dateOfWeighing), { mono: true })}
                  {td(`${s.ageYears || "0"}/${s.ageMonths || "0"}`, { mono: true })}
                  {td(s.weight || "", { mono: true })}
                  {td(s.height || "", { mono: true })}
                  {td(s.bmi || "", { mono: true, color: s.bmi ? t.accent : t.faint })}
                  <td className="px-1.5 py-2 text-center" style={{ borderRight: `1px solid ${t.surfaceDeep}` }}>
                    {s.bmiStatus ? <Pill label={s.bmiStatus} color={t.bmi[s.bmiStatus]} /> : <span style={{ color: t.faint }}>—</span>}
                  </td>
                  <td className="px-1.5 py-2 text-center" style={{ borderRight: `1px solid ${t.surfaceDeep}` }}>
                    {s.hfaStatus ? <Pill label={s.hfaStatus} color={t.hfa[s.hfaStatus]} /> : <span style={{ color: t.faint }}>—</span>}
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
                      {s.period ? <Pill label={s.period} color={t.period[s.period]} /> : null}
                      {/* Row actions: hover / keyboard focus reveals them, touch keeps them. */}
                      <span className="row-actions flex items-center gap-1.5">
                        <button aria-label={`Edit ${s.name || "this learner"}'s record`}
                          onClick={() => { onEdit(s); setView("entry"); }}
                          className="text-[11px] px-2.5 py-1 rounded-sm cursor-pointer border transition-colors"
                          style={{ background:t.surface2, color:t.sub, borderColor:t.border }}
                          onMouseEnter={e=>{ e.currentTarget.style.color=t.text; e.currentTarget.style.borderColor=t.dim; }}
                          onMouseLeave={e=>{ e.currentTarget.style.color=t.sub; e.currentTarget.style.borderColor=t.border; }}>Edit</button>
                        <button aria-label={`Delete ${s.name || "this learner"}'s record`}
                          onClick={() => setPendingDelete(s)}
                          className="text-[11px] px-2.5 py-1 rounded-sm cursor-pointer border transition-colors"
                          style={{ background:"transparent", color:t.danger, borderColor:t.danger+"55" }}
                          onMouseEnter={e=>{ e.currentTarget.style.background=t.danger; e.currentTarget.style.color=t.isDark ? "#100505" : "#ffffff"; }}
                          onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; e.currentTarget.style.color=t.danger; }}>Delete</button>
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={21} className="px-4 py-10 text-center text-sm" style={{ color: t.faint }}>No students found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name || "this learner"}'s record?`}
        confirmLabel="Delete record"
        cancelLabel="Keep record"
        palette={confirmPalette(t)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) del(pendingDelete.id);
          setPendingDelete(null);
        }}
      >
        <strong style={{ color: t.text }}>
          {pendingDelete?.name || "This learner"}
          {pendingDelete?.gradeLevel ? ` · ${pendingDelete.gradeLevel}` : ""}
          {pendingDelete?.period ? ` · ${pendingDelete.period}` : ""}
        </strong>
        <br />
        The record leaves {school.name}'s active list and moves to Trash with its measurements intact. It stays
        recoverable until the Division Office opens the next school year, when the trash is emptied permanently.
      </ConfirmDialog>
    </div>
  );
}

// ── Trash ─────────────────────────────────────────────────────────────────────
function TrashPanel({ trash, schools }: { trash: TrashedRecord[]; schools: School[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const schoolName = (id: string) => schools.find(s => s.id === id)?.name ?? "Unknown school";
  const needle = q.trim().toLowerCase();
  const rows = trash.filter(r =>
    !needle || `${r.name} ${r.gradeLevel} ${r.period} ${schoolName(r.schoolId)}`.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: t.text }}>Trash</h1>
          <p className="text-xs mt-0.5" style={{ color: t.dim }}>
            {trash.length} deleted learner record{trash.length === 1 ? "" : "s"} · recoverable until the next school year starts
          </p>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search learner, school or grade…"
          className="text-sm px-3 py-2 rounded-sm outline-none"
          style={{ background: t.surface, color: t.text, border: `1px solid ${t.border}`, minWidth: 260 }}
        />
      </div>

      <div style={{ border: `1px solid ${t.border}`, background: t.surface, borderLeft: `3px solid ${t.warning}`, padding: "12px 15px", fontSize: 11.5, lineHeight: 1.6, color: t.sub }}>
        A deleted record leaves the active Student Records, Summary Table and Analytics but keeps every measurement here.
        Choose <strong style={{ color: t.text }}>Restore</strong> to put it back. When the Division Office opens a new school
        year, the trash is emptied permanently.
      </div>

      {rows.length === 0 ? (
        <div style={{ border: `1px solid ${t.border}`, background: t.surface, padding: "40px 20px", textAlign: "center" }}>
          <p className="text-sm" style={{ color: t.sub }}>{trash.length === 0 ? "The trash is empty." : "No deleted record matches that search."}</p>
        </div>
      ) : (
        <div style={{ border: `1px solid ${t.border}`, background: t.surface }} className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px] border-collapse">
            <thead>
              <tr style={{ background: t.surfaceDeep, borderBottom: `1px solid ${t.border}` }}>
                {["Learner", "School", "Grade / Period", "Deleted", ""].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${t.surfaceDeep}` }}>
                  <td className="px-3 py-2.5" style={{ color: t.text }}>
                    <div style={{ fontWeight: 500 }}>{r.name || "Unnamed learner"}</div>
                    <div style={{ color: t.faint, fontSize: 10 }}>{r.schoolId} · {r.sy}</div>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: t.sub }}>{schoolName(r.schoolId)}</td>
                  <td className="px-3 py-2.5" style={{ color: t.sub }}>{r.gradeLevel || "—"} · {r.period}</td>
                  <td className="px-3 py-2.5" style={{ color: t.dim }}>
                    {r.deletedAt ? shortDate(r.deletedAt) : "—"}
                    {r.deletedBy ? <div style={{ color: t.faint, fontSize: 10 }}>{r.deletedBy}</div> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => restoreRecord(r.id)}
                      className="px-3 py-1.5 text-[11px] rounded-sm cursor-pointer border transition-colors"
                      style={{ borderColor: t.accent + "55", color: t.accent, background: t.accentBg }}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Summary Table ─────────────────────────────────────────────────────────────
function SummaryTable({ students, school, activeSy }: { students:Student[]; school:School; activeSy:string }) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("Endline");
  const isSpedSchool = school.name === SPED_SCHOOL_NAME;
  const [cohort, setCohort] = useState<"All"|"Regular"|"SPED">("All");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const { extras, setExtra } = useForm2Extras(school.id, period);

  const isSpedGrade = (g: string) => g.startsWith("SPED");
  const allGrades = getGrades(school);
  // In "All Students" the SPED school counts each SPED grade together with its
  // regular grade (Kinder + SPED Kinder, Grade 1 + SPED Grade 1, …), so the table
  // shows one row per grade level; the Regular / SPED filters keep rows separate.
  const mergeSped = isSpedSchool && cohort === "All";
  const grades = !isSpedSchool || cohort === "All"
    ? (mergeSped ? allGrades.filter(g => !isSpedGrade(g)) : allGrades)
    : cohort === "SPED"
      ? allGrades.filter(isSpedGrade)
      : allGrades.filter(g => !isSpedGrade(g));

  const f = students.filter(s =>
    s.period === period &&
    (!isSpedSchool || cohort === "All"
      ? true
      : cohort === "SPED" ? isSpedGrade(s.gradeLevel) : !isSpedGrade(s.gradeLevel))
  );

  /** Whether a student's grade belongs in this row — merged rows also take the SPED grade. */
  const inGrade = (g: string, grade: GradeLevel) =>
    mergeSped ? g.replace(/^SPED /, "") === grade : g === grade;
  const cntBMI = (grade:GradeLevel|null, sex:Sex|null, st:BMIStatus) =>
    f.filter(s=>(grade===null||inGrade(s.gradeLevel,grade))&&(sex===null||s.sex===sex)&&s.bmiStatus===st).length;
  const cntHFA = (grade:GradeLevel|null, sex:Sex|null, st:HFAStatus) =>
    f.filter(s=>(grade===null||inGrade(s.gradeLevel,grade))&&(sex===null||s.sex===sex)&&s.hfaStatus===st).length;
  const cntFlag = (grade:GradeLevel|null, sex:Sex|null, field:keyof Student, val:string) =>
    f.filter(s=>(grade===null||inGrade(s.gradeLevel,grade))&&(sex===null||s.sex===sex)&&s[field]===val).length;
  const sx = (lbl:"M"|"F"|"Total"): Sex|null => lbl==="Total"?null:lbl;

  /**
   * The rows shown below, flattened for the Excel export. Built from the same
   * cnt* helpers as the table, so the file always matches what is on screen —
   * including which grade levels the SPED cohort merge folds together.
   */
  const summaryMatrix = (): SummaryMatrixRow[] => {
    const perGrade = (grade: GradeLevel|null, label: string): SummaryMatrixRow[] =>
      (["M","F","Total"] as const).map(lbl => {
        const s = sx(lbl);
        return {
          grade: label,
          sex: lbl,
          bmi: BMI_STATUSES.map(st=>cntBMI(grade,s,st)),
          hfa: HFA_STATUSES.map(st=>cntHFA(grade,s,st)),
          pregnantYoung: f.filter(st =>
            (grade===null||inGrade(st.gradeLevel,grade)) &&
            (s===null||st.sex===s) &&
            countsAsPregnantOrYoung(st),
          ).length,
          dewormed: cntFlag(grade,s,"dewormed","Yes"),
          fourPs: cntFlag(grade,s,"fourPs","Yes"),
          sbfp: cntFlag(grade,s,"sbfpPreviousYears","Yes"),
          atRisk: manualTotal(extras, grades, grade, lbl, "atRisk"),
          ips: manualTotal(extras, grades, grade, lbl, "ips"),
        };
      });
    return [...grades.flatMap(g => perGrade(g, g)), ...perGrade(null, "GRAND TOTAL")];
  };
  const summaryRows = summaryMatrix();

  /** School year printed on the Form 2 export — the one most of these records use. */
  const syForExport = () => {
    const tally = new Map<string, number>();
    for (const s of f) if (s.sy) tally.set(s.sy, (tally.get(s.sy) ?? 0) + 1);
    let best = "2025-2026", n = 0;
    for (const [sy, c] of tally) if (c > n) { best = sy; n = c; }
    return best;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>Summary Table</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>
            {school.name} — SY {formatSchoolYear(activeSy)}
            {isSpedSchool && (cohort === "All" ? " · SPED merged into grade levels" : ` · ${cohort} only`)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isSpedSchool && (
            <div className="flex gap-1.5">
              {(["All","Regular","SPED"] as const).map(c => (
                <button key={c} onClick={() => setCohort(c)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
                  style={cohort===c
                    ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" }
                    : { background:t.surface, color:t.dim, borderColor:t.border }}>
                  {c === "All" ? "All Students" : c === "Regular" ? "Regular" : "SPED"}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border"
                style={period===p ? { background:t.period[p]+"20", color:t.period[p], borderColor:t.period[p]+"40" } : { background:t.surface, color:t.dim, borderColor:t.border }}>
                {p}
              </button>
            ))}
            <button
              title="SBFP Form 2 — Summary of Beneficiaries & Start of Feeding"
              onClick={async () => {
                setExporting(true);
                setExportError("");
                try {
                  const { exportSummaryToExcel } = await import("@/lib/sbfp-export");
                  await exportSummaryToExcel({
                    school, period, cohort, sy: syForExport(),
                    bmiStatuses: BMI_STATUSES,
                    hfaStatuses: HFA_STATUSES,
                    rows: summaryRows,
                  });
                } catch (err) {
                  setExportError(err instanceof Error ? err.message : "The Form 2 export could not be built.");
                } finally { setExporting(false); }
              }}
              disabled={f.length === 0}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm border transition-colors"
              style={{
                background: f.length === 0 ? t.surface2 : t.surface,
                color: f.length === 0 ? t.faint : t.accent,
                borderColor: f.length === 0 ? t.border : t.accent + "60",
                cursor: f.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              {exporting ? "Exporting…" : "↓ Export Form 2"}
            </button>
          </div>
        </div>
      </div>

      <p className="text-[10px] md:hidden -mb-2" style={{ color: t.dim }}>
        Swipe the form sideways to see every column →
      </p>

      {exportError && (
        <p role="alert" className="text-xs" style={{ color: t.danger }}>
          {exportError}
        </p>
      )}

      <Form2Sheet
        school={school}
        period={period}
        cohort={cohort}
        sy={activeSy}
        rows={summaryRows}
        onExtraChange={(grade, sex, patch) => setExtra(grade, sex, patch)}
      />
    </div>
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function Analytics({ students, school }: { students:Student[]; school:School }) {
  const t = useT();
  const isSpedSchool = school.name === SPED_SCHOOL_NAME;
  const [cohort, setCohort] = useState<"All"|"Regular"|"SPED">("All");
  const isSpedGrade = (g: string) => g.startsWith("SPED");

  const filtered = useMemo(() => {
    if (!isSpedSchool || cohort === "All") return students;
    return students.filter(s =>
      cohort === "SPED" ? isSpedGrade(s.gradeLevel) : !isSpedGrade(s.gradeLevel)
    );
  }, [students, cohort, isSpedSchool]);

  const uniqAll = uniqueStudents(filtered);
  const periodData = PERIODS.map(p => {
    const pe = filtered.filter(s=>s.period===p);
    return {
      period: p,
      total: uniqueCount(pe),
      bmi: BMI_STATUSES.map(st => ({ st, n: pe.filter(s => s.bmiStatus === st).length, c: t.bmi[st] })),
      hfa: HFA_STATUSES.map(st => ({ st, n: pe.filter(s => s.hfaStatus === st).length, c: t.hfa[st] })),
    };
  });
  const maxTotal = Math.max(...periodData.map(d=>d.total),1);
  const allBMI = BMI_STATUSES.map(st=>({ label:st, val:uniqAll.filter(s=>s.bmiStatus===st).length, color:t.bmi[st] }));
  const allHFA = HFA_STATUSES.map(st=>({ label:st, val:uniqAll.filter(s=>s.hfaStatus===st).length, color:t.hfa[st] }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>Analytics</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>
            {school.name} · {uniqAll.length} students · {filtered.length} period records
            {isSpedSchool && cohort !== "All" ? ` · ${cohort} only` : ""}
          </p>
        </div>
        {isSpedSchool && (
          <div className="flex gap-1.5">
            {(["All","Regular","SPED"] as const).map(c => (
              <button key={c} onClick={() => setCohort(c)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
                style={cohort===c
                  ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" }
                  : { background:t.surface, color:t.dim, borderColor:t.border }}>
                {c === "All" ? "All Students" : c === "Regular" ? "Regular" : "SPED"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
        <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>Student Count by Period</div>
        <div className="flex items-end gap-6">
          {periodData.map(d=>(
            <div key={d.period} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-sm font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.period[d.period] }}>{d.total}</span>
              <div className="w-full rounded-sm" style={{ height:`${(d.total/maxTotal)*80}px`, minHeight:"2px", background:t.period[d.period]+"60" }} />
              <span className="text-[10px]" style={{ color:t.period[d.period] }}>{d.period}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ background:t.border }}>
        {[{title:"BMI Distribution",cats:allBMI},{title:"HFA Distribution",cats:allHFA}].map(({title,cats})=>{
          const total = cats.reduce((s,c)=>s+c.val,0)||1;
          return (
            <div key={title} style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5">
              <div className="text-[9px] tracking-widest uppercase mb-4" style={{ color:t.dim }}>{title}</div>
              {cats.map(c=>(
                <div key={c.label} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs" style={{ color:t.sub }}>{c.label}</span>
                    <span className="text-[10px]" style={{ fontFamily:"'JetBrains Mono',monospace", color:c.color }}>{c.val} <span style={{ color:t.faint }}>({((c.val/total)*100).toFixed(0)}%)</span></span>
                  </div>
                  <Bar val={c.val} max={total} color={c.color} t={t} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background:t.border }}>
        {periodData.map(d=>{
          const total = d.total||1;
          return (
            <div key={`bmi-${d.period}`} style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-4">
              <div className="text-[9px] tracking-widest uppercase mb-3" style={{ color:t.period[d.period] }}>{d.period} — BMI</div>
              {d.bmi.map(b=>(
                <div key={b.st} className="flex items-center gap-2 mb-1.5">
                  <span className="text-[9px] w-20 truncate" style={{ color:t.dim }}>{b.st}</span>
                  <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background:t.border }}>
                    <div style={{ width:`${(b.n/total)*100}%`, background:b.c }} className="h-full" />
                  </div>
                  <span className="text-[9px] w-4 text-right" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.dim }}>{b.n}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background:t.border }}>
        {periodData.map(d=>{
          const total = d.total||1;
          return (
            <div key={`hfa-${d.period}`} style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-4">
              <div className="text-[9px] tracking-widest uppercase mb-3" style={{ color:t.period[d.period] }}>{d.period} — HFA</div>
              {d.hfa.map(h=>(
                <div key={h.st} className="flex items-center gap-2 mb-1.5">
                  <span className="text-[9px] w-20 truncate" style={{ color:t.dim }}>{h.st}</span>
                  <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background:t.border }}>
                    <div style={{ width:`${(h.n/total)*100}%`, background:h.c }} className="h-full" />
                  </div>
                  <span className="text-[9px] w-4 text-right" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.dim }}>{h.n}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [themeMode, setThemeMode] = useState<"dark"|"light">("dark");
  const t = themeMode === "dark" ? DARK : LIGHT;
  const [view, setView] = useState<View>("district");
  const [selectedSchool, setSelectedSchool] = useState<School|null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [feedbacks, setFeedbacks] = useState<SchoolFeedback[]>([]);
  /** A refused school-list write (rename, add, remove) shown above the console. */
  const [schoolError, setSchoolError] = useState("");
  const [editingStudent, setEditingStudent] = useState<Student|null>(null);
  /** Feedback ids already seen; null until the browser has restored the list. */
  const [seenFeedback, setSeenFeedback] = useState<Set<string> | null>(null);
  const announcedFeedback = useRef(new Set<string>());
  const [feedbackToast, setFeedbackToast] = useState<{ entry: SchoolFeedback; count: number } | null>(null);

  // The workbook engine is a large chunk only an export needs: warm it in the
  // background so the first Form 1A/2 download does not wait for it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const warm = () => void import("@/lib/sbfp-export");
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(warm, 2000);
    return () => globalThis.clearTimeout(id);
  }, []);

  // ── The teacher website's side of the loop ──────────────────────────────────
  // Which Division Office account is signed in, and the school rows the server
  // handed it. The console is only rendered once an admin session is resolved
  // (see `src/routes/index.tsx`), so this is the division-wide view.
  const access = useAccess();
  const teacherData = access.store;

  // The school list is the database's, and a teacher's profile IS her school's
  // SBFP form header — so what she saves on `/SchoolPortal` is folded in here rather
  // than duplicated in local state.
  const schools = useMemo<School[]>(() => {
    const profiles = teacherData.profiles;
    return teacherData.schools.map(s => {
      const p = profiles[s.id];
      if (!p) return s;
      return {
        ...s,
        division: p.division,
        cityMunicipalityBarangay: p.cityMunicipalityBarangay,
        schoolIdNumber: p.schoolIdNumber,
        principal: p.principal,
        focalPerson: p.focalPerson,
        dateStartFeeding: p.dateStartFeeding,
        lastMileSchool: p.lastMileSchool,
      };
    });
  }, [teacherData.schools, teacherData.profiles]);

  const teacherRecords = teacherData.records;
  const teacherFeedbacks = teacherData.feedbacks;

  // Starting a new school year swaps the workspace underneath these screens.
  // The console keeps a small local list for rows it is still editing; clear it
  // so last year's rows cannot appear in the new year while the reload lands.
  const loadedSy = useRef<string | null>(null);
  useEffect(() => {
    if (!teacherData.hydrated) return;
    if (loadedSy.current === null) {
      loadedSy.current = teacherData.activeSy;
      return;
    }
    if (loadedSy.current !== teacherData.activeSy) {
      loadedSy.current = teacherData.activeSy;
      setStudents([]);
      setFeedbacks([]);
    }
  }, [teacherData.activeSy, teacherData.hydrated]);

  /**
   * School-list writes, all through the database: a rename or a new school is a
   * `sbfp_schools` row, and the form header is the school's profile (the same
   * block the teacher saves on `/SchoolPortal`), so neither side can silently undo
   * the other. The list itself is re-read afterwards rather than patched in
   * place, so what is on screen is what the server holds.
   */
  const saveSchools = (next: School[]) => {
    void (async () => {
      setSchoolError("");
      try {
        const kept = new Set(next.map(s => s.id));
        for (const school of schools) {
          if (kept.has(school.id)) continue;
          const result = await removeSchoolEntry({ data: { id: school.id } });
          if (!result.ok) throw new Error(result.message);
        }
        for (const school of next) {
          const before = schools.find(s => s.id === school.id);
          if (!before) {
            const result = await createSchoolEntry({ data: { name: school.name, type: school.type } });
            if (!result.ok) throw new Error(result.message);
            continue;
          }
          if (before.name !== school.name || before.type !== school.type) {
            const result = await updateSchoolEntry({
              data: { id: school.id, name: school.name, type: school.type },
            });
            if (!result.ok) throw new Error(result.message);
          }
          // Only the Form 1A/2 header fields are the school's profile; name and
          // type live on the school row above.
          const profile = teacherData.profiles[school.id];
          if (!profile || !SCHOOL_HEADER_KEYS.some(key => school[key] !== profile[key])) continue;
          await saveSchoolHeader({
            data: {
              schoolId: school.id,
              patch: {
                division: school.division,
                cityMunicipalityBarangay: school.cityMunicipalityBarangay,
                schoolIdNumber: school.schoolIdNumber,
                principal: school.principal,
                focalPerson: school.focalPerson,
                dateStartFeeding: school.dateStartFeeding,
                lastMileSchool: school.lastMileSchool,
              },
            },
          });
        }
      } catch (err) {
        setSchoolError(err instanceof Error ? err.message : String(err));
      }
      access.reload();
    })();
  };

  /** The district's own rows plus everything the schools encoded on `/SchoolPortal`. */
  const allStudents = useMemo(() => {
    const seen = new Set(students.map(s => s.id));
    return [...students, ...teacherRecords.filter(r => !seen.has(r.id))];
  }, [students, teacherRecords]);

  const allFeedbacks = useMemo(() => {
    const seen = new Set(feedbacks.map(f => f.id));
    return [...feedbacks, ...teacherFeedbacks.filter(f => !seen.has(f.id))];
  }, [feedbacks, teacherFeedbacks]);

  /** Remember which feedback the Division Office has already looked at. */
  const markFeedbackSeen = (ids: string[]) => {
    setSeenFeedback(previous => {
      const next = new Set(previous ?? []);
      let changed = previous === null;
      for (const id of ids) {
        if (next.has(id)) continue;
        next.add(id);
        changed = true;
      }
      if (!changed) return previous;
      try {
        window.localStorage.setItem(FEEDBACK_SEEN_KEY, JSON.stringify(Array.from(next).slice(-800)));
      } catch {
        // Private mode / quota: the badge still clears for this session.
      }
      return next;
    });
  };

  // On the first read, restore the seen list. With no list yet, feedback that
  // was already acknowledged is not news; anything still marked New stays
  // unread until the Division Office opens the feed.
  useEffect(() => {
    if (!teacherData.hydrated || seenFeedback !== null) return;
    let stored: unknown = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(FEEDBACK_SEEN_KEY) ?? "null");
    } catch {
      stored = null;
    }
    const valid = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : null;
    // With no saved list (a new browser), the already-acknowledged feedback is
    // not news; anything still marked New is, and shows as a badge/notification
    // until the Division Office opens the feed.
    setSeenFeedback(new Set(
      valid ?? teacherData.feedbacks.filter(f => f.status !== "New").map(f => f.id),
    ));
  }, [teacherData.hydrated, teacherData.feedbacks, seenFeedback]);

  const unreadFeedback = seenFeedback
    ? allFeedbacks.filter(f => !seenFeedback.has(f.id)).length
    : 0;

  // Announce the newest arrival once. Opening the feed marks everything seen;
  // the badge stays until then, even after the toast has faded.
  useEffect(() => {
    if (seenFeedback === null) return;
    if (view === "feedback") {
      markFeedbackSeen(allFeedbacks.map(f => f.id));
      setFeedbackToast(null);
      return;
    }
    const unseen = allFeedbacks.filter(f => !seenFeedback.has(f.id));
    const latest = unseen.find(f => !announcedFeedback.current.has(f.id));
    if (!latest) return;
    announcedFeedback.current.add(latest.id);
    setFeedbackToast({ entry: latest, count: unseen.length });
  }, [allFeedbacks, seenFeedback, view]);

  useEffect(() => {
    if (!feedbackToast) return;
    const timer = window.setTimeout(() => setFeedbackToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [feedbackToast]);

  /**
   * Both sides write through the shared store, so every learner record and
   * feedback row reaches the database, is stamped with the active school year
   * by the server, and is kept in that year's archive. The console's local
   * arrays are just the not-yet-echoed copy for the current render.
   */
  const saveStudents = (next: Student[]) => {
    const byId = new Map(next.map(s => [s.id, s]));
    // Rows the schools encoded: edits go back through the same server row.
    for (const owned of teacherRecords) {
      const edited = byId.get(owned.id);
      if (!edited) removeRecord(owned.id);
      else if (edited !== owned) updateRecord(owned.id, edited);
    }
    // Rows the Division Office encoded: saved to the same table, so they carry
    // the active year and reach the archive when the year closes. Without this
    // they only lived in this browser tab.
    for (const row of next) {
      if (teacherRecords.some(r => r.id === row.id)) continue;
      const before = students.find(s => s.id === row.id);
      if (!before) addRecord(row);
      else if (before !== row) updateRecord(row.id, row);
    }
    for (const row of students) {
      if (!byId.has(row.id)) removeRecord(row.id);
    }
    const ownedIds = new Set(teacherRecords.map(r => r.id));
    setStudents(next.filter(s => !ownedIds.has(s.id)));
  };

  const saveFeedbacks = (next: SchoolFeedback[]) => {
    const byId = new Map(next.map(f => [f.id, f]));
    for (const owned of teacherFeedbacks) {
      const edited = byId.get(owned.id);
      if (edited && (edited.status !== owned.status || edited.response !== owned.response)) {
        updateTeacherFeedback(owned.id, { status: edited.status, response: edited.response });
      }
    }
    // Feedback the Division Office records itself must be persisted too, for
    // the same reason: the archive reads the table, not this tab's state.
    const known = new Set(allFeedbacks.map(f => f.id));
    for (const entry of next) {
      if (!known.has(entry.id)) sendFeedback(entry);
    }
    const ownedIds = new Set(teacherFeedbacks.map(f => f.id));
    setFeedbacks(next.filter(f => !ownedIds.has(f.id)));
  };

  const schoolStudents = useMemo(
    () => selectedSchool ? allStudents.filter(s=>s.schoolId===selectedSchool.id) : allStudents,
    [allStudents, selectedSchool]
  );

  /** Narrow-screen navigation drawer — closed by default, and by any choice in it. */
  const [navOpen, setNavOpen] = useState(false);

  // Escape closes the drawer, the same way it closes the delete dialog.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const handleSelectSchool = (school: School) => { setSelectedSchool(school); setView("dashboard"); setNavOpen(false); };
  const handleEdit = (student: Student) => { setEditingStudent(student); setView("entry"); };
  const clearEditing = () => setEditingStudent(null);

  return (
    <ThemeCtx.Provider value={t}>
      <div className="flex min-h-0" style={{ height:"100dvh", background:t.bg, color:t.text, fontFamily:"'Outfit',sans-serif" }}>
        {navOpen && (
          <div aria-hidden="true" onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-30 md:hidden" style={{ background:"rgba(0,0,0,0.5)" }} />
        )}
        <Sidebar view={view} setView={setView} selectedSchool={selectedSchool} setSelectedSchool={setSelectedSchool}
          themeMode={themeMode} toggleTheme={() => setThemeMode(m=>m==="dark"?"light":"dark")} schools={schools}
          registeredSchools={Object.keys(teacherData.profiles).length}
          activeSy={teacherData.activeSy}
          mobileOpen={navOpen} onNavigate={() => setNavOpen(false)}
          unreadFeedback={unreadFeedback} trashCount={teacherData.trash.length} />
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* The sidebar is off-canvas below md, so the console keeps a way in. */}
          <header className="app-topbar md:hidden flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ borderBottom:`1px solid ${t.border}`, background:t.surface }}>
            <button aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}
              className="min-h-10 min-w-10 px-2.5 py-1.5 rounded-sm cursor-pointer border text-sm"
              style={{ borderColor:t.border, color:t.text, background:t.surface2 }}>☰</button>
            <img src="/school-health-wheel.svg" alt="" width={28} height={28} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold truncate" style={{ color:t.text }}>Health Monitor</div>
              <div className="text-[10px] truncate" style={{ color:t.dim }}>{selectedSchool?.name ?? "Urdaneta City Schools"}</div>
            </div>
            <div className="ml-auto flex-shrink-0"><UserButton compact /></div>
          </header>
        <main className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8">
          {schoolError && (
            <div role="alert" className="mb-4 p-3 text-xs" style={{ border:`1px solid ${t.danger}55`, background:`${t.danger}14`, color:t.danger, borderRadius:4, lineHeight:1.6 }}>
              {schoolError}
            </div>
          )}
          {view==="district" && <DistrictDashboard students={allStudents} schools={schools}
            feedbacks={allFeedbacks} activeSy={teacherData.activeSy} onOpenFeedbacks={()=>setView("feedback")} />}
          {view==="feedback" && <Feedbacks feedbacks={allFeedbacks} setFeedbacks={saveFeedbacks}
            schools={schools} defaultSchool={selectedSchool} />}
          {view==="schools" && <SchoolsList students={allStudents} schools={schools} setSchools={saveSchools}
            setStudents={saveStudents} onSelect={handleSelectSchool} />}
          {view==="accounts" && <AccountsPanel theme={t} schools={schools} accounts={teacherData.accounts}
            viewerEmail={teacherData.account?.email ?? ""}
            onChanged={() => access.reload()} />}
          {view==="years" && <SchoolYears theme={t} schools={schools} activeSy={teacherData.activeSy}
            onChanged={() => access.reload()} />}
          {view==="dashboard" && selectedSchool && <Dashboard students={schoolStudents} school={selectedSchool} activeSy={teacherData.activeSy} />}
          {view==="records" && selectedSchool && <StudentRecords students={schoolStudents}
            setStudents={ss => saveStudents([...allStudents.filter(s=>s.schoolId!==selectedSchool.id),...ss])}
            school={selectedSchool} setView={setView} onEdit={handleEdit} activeSy={teacherData.activeSy} />}
          {view==="entry" && selectedSchool && <DataEntry students={allStudents} setStudents={saveStudents}
            school={selectedSchool} setView={setView} editingStudent={editingStudent} clearEditing={clearEditing}
            activeSy={teacherData.activeSy} />}
          {view==="table" && selectedSchool && <SummaryTable students={schoolStudents} school={selectedSchool} activeSy={teacherData.activeSy} />}
          {view==="analytics" && selectedSchool && <Analytics students={schoolStudents} school={selectedSchool} />}
          {view==="trash" && <TrashPanel trash={teacherData.trash} schools={schools} />}
        </main>
        </div>

        {feedbackToast && (() => {
          const from = schools.find(s => s.id === feedbackToast.entry.schoolId)?.name ?? "a school";
          return (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: "fixed", right: 18, bottom: 18, zIndex: 60,
                width: "min(390px, calc(100vw - 36px))",
                background: t.surface, color: t.text,
                border: `1px solid ${t.accent}66`, borderLeft: `4px solid ${t.accent}`,
                borderRadius: 6, padding: "13px 14px",
                boxShadow: "0 12px 34px rgba(0,0,0,0.35)",
              }}
            >
              <div className="flex items-start gap-3">
                <span style={{ fontSize: 18, color: t.accent }}>✉</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] tracking-widest uppercase" style={{ color: t.accent }}>
                    New feedback{feedbackToast.count > 1 ? ` · ${feedbackToast.count} waiting` : ""}
                  </div>
                  <div className="text-sm font-semibold mt-1" style={{ color: t.text }}>{from}</div>
                  <p className="text-xs mt-1" style={{ color: t.sub, lineHeight: 1.5 }}>
                    {feedbackToast.entry.message.length > 130
                      ? `${feedbackToast.entry.message.slice(0, 130)}…`
                      : feedbackToast.entry.message}
                  </p>
                  <button
                    onClick={() => { setView("feedback"); setNavOpen(false); setFeedbackToast(null); }}
                    className="text-xs mt-2.5 cursor-pointer"
                    style={{ color: t.accent, fontWeight: 600 }}
                  >
                    Open feedbacks →
                  </button>
                </div>
                <button aria-label="Dismiss notification" onClick={() => setFeedbackToast(null)}
                  className="cursor-pointer text-sm" style={{ color: t.dim }}>✕</button>
              </div>
            </div>
          );
        })()}
      </div>
    </ThemeCtx.Provider>
  );
}
