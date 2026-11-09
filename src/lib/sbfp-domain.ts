/**
 * The SBFP domain — everything both websites share, and nothing that renders.
 *
 * This module used to live inside `src/sbfp-app.tsx` (the district console).
 * The school portal only needs the types, the period/status lists and the WHO
 * classification helpers, but importing them from the console pulled the whole
 * console into the teacher route's bundle. Keeping the domain here means a
 * teacher downloads her own page and no district UI.
 *
 * No React, no theme, no server imports: plain data and pure functions, so both
 * the browser and the PGlite/Node tests can use it.
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export type GradeLevel =
  |"Kinder"|"Grade 1"|"Grade 2"|"Grade 3"|"Grade 4"|"Grade 5"|"Grade 6"
  |"Grade 7"|"Grade 8"|"Grade 9"|"Grade 10"|"Grade 11"|"Grade 12"
  |"SPED"|"SPED Kinder"|"SPED Grade 1"|"SPED Grade 2"|"SPED Grade 3"|"SPED Grade 4"|"SPED Grade 5"|"SPED Grade 6";
export type Sex = "M"|"F";
export type Period = "Baseline"|"Midline"|"Endline";
export type SchoolType = "Elementary"|"High School";
export type BMIStatus = "Severely Wasted"|"Wasted"|"Normal"|"Overweight"|"Obese"|"";
export type HFAStatus = "Severely Stunted"|"Stunted"|"Normal"|"Tall"|"";
export type YesNo = "Yes"|"No"|"";

export interface School {
  id: string; name: string; type: SchoolType;
  /** SBFP form header block (Form 1A export, and Form 2's field block) */
  division: string;
  cityMunicipalityBarangay: string;
  schoolIdNumber: string;
  principal: string;
  focalPerson: string;
  /** Form 2 only: ISO date the feeding starts. */
  dateStartFeeding: string;
  /** Form 2 only: Last Mile School, printed as ___Y ___N. */
  lastMileSchool: YesNo;
}
/** The editable form header fields, minus identity. */
export type SchoolFormDetails = Pick<School, "division"|"cityMunicipalityBarangay"|"schoolIdNumber"|"principal"|"focalPerson"|"dateStartFeeding"|"lastMileSchool">;
export const EMPTY_FORM_DETAILS: SchoolFormDetails = {
  division: "Urdaneta City", cityMunicipalityBarangay: "", schoolIdNumber: "", principal: "", focalPerson: "",
  dateStartFeeding: "", lastMileSchool: "",
};

export const FORM_DETAIL_FIELDS: [keyof SchoolFormDetails, string][] = [
  ["division", "Division"],
  ["cityMunicipalityBarangay", "City/Municipality/Barangay"],
  ["schoolIdNumber", "School ID Number"],
  ["principal", "Name of Principal / School Head"],
  ["focalPerson", "Name of Feeding Focal Person"],
  ["dateStartFeeding", "Date of Start of Feeding"],
  ["lastMileSchool", "Last Mile School"],
];

export interface Student {
  id: string; schoolId: string; period: Period; sy: string;
  name: string; sex: Sex|""; gradeLevel: GradeLevel|"";
  dateOfBirth: string; dateOfWeighing: string;
  ageYears: string; ageMonths: string;
  weight: string; height: string; bmi: string;
  bmiStatus: BMIStatus; hfaStatus: HFAStatus; nutritionalStatus: string;
  classificationOfBeneficiary: "Primary"|"Secondary"|"";
  pregnant: YesNo; hasYoungChildren: YesNo; dewormed: YesNo;
  parentConsentMilk: YesNo; fourPs: YesNo; sbfpPreviousYears: YesNo;
}

/** A learner record in the trash, with when and by whom it was removed. */
export interface TrashedRecord extends Student {
  deletedAt: string;
  deletedBy: string;
}

/** One displayed Form 2 row: a grade (or "GRAND TOTAL") for one sex bucket. */
export interface SummaryMatrixRow {
  grade: string;
  sex: "M" | "F" | "Total";
  /** BMI counts, in the same order as `BMI_STATUSES`. */
  bmi: number[];
  /** HFA counts, in the same order as `HFA_STATUSES`. */
  hfa: number[];
  /** Learners with `pregnant` or `hasYoungChildren` = Yes. */
  pregnantYoung: number;
  /** Learners dewormed (Yes). */
  dewormed: number;
  fourPs: number;
  sbfp: number;
  /** Form 2's hand-entered "pupils at risk of dropping out" count. */
  atRisk: number;
  /** Form 2's hand-entered "Indigenous Peoples (IPs)" count. */
  ips: number;
}

/**
 * Form 2's two hand-entered secondary-target figures, for one grade and sex in
 * one feeding period. `Total` rows are summed on screen and are never stored.
 */
export interface SummaryExtra {
  schoolId: string;
  sy: string;
  period: Period;
  grade: string;
  sex: "M" | "F";
  atRisk: number;
  ips: number;
}

// ── School feedback — what the schools send up, aggregated district-wide ───────
export type FeedbackCategory =
  |"Feeding Implementation"|"Nutrition Data"|"Supplies & Logistics"
  |"Learner Concerns"|"System / Forms"|"Other";
export type FeedbackStatus = "New"|"Acknowledged"|"Resolved";
export interface SchoolFeedback {
  id: string;
  /** The school that sent it — the Feedbacks page shows every school together. */
  schoolId: string;
  author: string;
  /** e.g. "SBFP Focal", "School Head", "Grade 6 Adviser" */
  role: string;
  category: FeedbackCategory;
  /** 1–5: how the feeding program is running at that school. */
  rating: number;
  message: string;
  /** ISO date the school sent it. */
  createdAt: string;
  status: FeedbackStatus;
  /** The district's answer back to the school, once written. */
  response?: string;
  /**
   * Set when the entry came in through the teacher website rather than the
   * district's own Feedbacks form — the feed shows a "School Portal" tag so
   * the district can tell a school's submission from its own records.
   */
  origin?: "School Portal";
}
export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "Feeding Implementation","Nutrition Data","Supplies & Logistics",
  "Learner Concerns","System / Forms","Other",
];
export const FEEDBACK_STATUSES: FeedbackStatus[] = ["New","Acknowledged","Resolved"];

// ── Constants ──────────────────────────────────────────────────────────────────
const ES_GRADES: GradeLevel[] = ["Kinder","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6"];
const ES_GRADES_WITH_SPED: GradeLevel[] = [
  "Kinder","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6",
  "SPED Kinder","SPED Grade 1","SPED Grade 2","SPED Grade 3","SPED Grade 4","SPED Grade 5","SPED Grade 6",
];
const HS_GRADES: GradeLevel[] = ["Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"];
export const PERIODS: Period[] = ["Baseline","Midline","Endline"];
export const BMI_STATUSES: BMIStatus[] = ["Severely Wasted","Wasted","Normal","Overweight","Obese"];
export const HFA_STATUSES: HFAStatus[] = ["Severely Stunted","Stunted","Normal","Tall"];
export const SPED_SCHOOL_NAME = "Urdaneta I Central School";

const GRADE_ORDER: GradeLevel[] = [
  "Kinder","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6",
  "SPED Kinder","SPED Grade 1","SPED Grade 2","SPED Grade 3","SPED Grade 4","SPED Grade 5","SPED Grade 6",
  "Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12","SPED",
];
const gradeRank = (g: string) => {
  const i = GRADE_ORDER.indexOf(g as GradeLevel);
  return i < 0 ? 99 : i;
};
const periodRank: Record<Period, number> = { Baseline: 0, Midline: 1, Endline: 2 };

/** Kinder → Grade 6, then SPED, then Grade 7–12; within a grade, by name, then period. */
export function sortRecords(list: Student[]): Student[] {
  return [...list].sort((a, b) => {
    const ga = gradeRank(a.gradeLevel);
    const gb = gradeRank(b.gradeLevel);
    if (ga !== gb) return ga - gb;
    const name = a.name.localeCompare(b.name);
    if (name !== 0) return name;
    return (periodRank[a.period] ?? 9) - (periodRank[b.period] ?? 9);
  });
}

export const getGrades = (school: School|undefined): GradeLevel[] => {
  if (!school) return ES_GRADES;
  if (school.type === "High School") return HS_GRADES;
  // Only Urdaneta 1 Central School offers SPED Kinder–Grade 6
  if (school.name === SPED_SCHOOL_NAME) return ES_GRADES_WITH_SPED;
  return ES_GRADES;
};

/** Unique person key (same student across Baseline/Midline/Endline) */
export const studentKey = (s: { name: string; dateOfBirth: string; sex: string; schoolId?: string }) =>
  `${s.schoolId ?? ""}|${s.name}|${s.dateOfBirth}|${s.sex}`;

/** Count unique students (not period records) */
export const uniqueCount = (list: Student[]) => new Set(list.map(studentKey)).size;

/** One record per student, preferring Endline → Midline → Baseline (for accurate counts) */
export function uniqueStudents(list: Student[]): Student[] {
  const order: Record<Period, number> = { Endline: 0, Midline: 1, Baseline: 2 };
  const map = new Map<string, Student>();
  for (const s of list) {
    const k = studentKey(s);
    const existing = map.get(k);
    if (!existing || order[s.period] < order[existing.period]) map.set(k, s);
  }
  return Array.from(map.values());
}

/** Grades 2–12 used for Primary/Secondary beneficiary rules */
const BENEFICIARY_GRADES: GradeLevel[] = ["Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"];

/** Auto-assign beneficiary class
 *  - Kinder & Grade 1 → always Primary
 *  - Grades 2–12: Primary = Wasted or Severely Wasted;
 *    Secondary = Stunted or Severely Stunted. When a learner is both, the
 *    wasted status wins (Primary).
 */
export function classifyBeneficiary(grade: string, bmiStatus: string, hfaStatus: string): "Primary"|"Secondary"|"" {
  // Kinder / Grade 1 (regular or SPED) → always Primary
  if (grade === "Kinder" || grade === "Grade 1" || grade === "SPED Kinder" || grade === "SPED Grade 1") return "Primary";
  // SPED Grade 2–6 follow the same rules as the regular grades
  const normalized = grade.replace(/^SPED /, "") as GradeLevel;
  if (!BENEFICIARY_GRADES.includes(normalized) && !BENEFICIARY_GRADES.includes(grade as GradeLevel)) return "";
  if (bmiStatus === "Wasted" || bmiStatus === "Severely Wasted") return "Primary";
  if (hfaStatus === "Stunted" || hfaStatus === "Severely Stunted") return "Secondary";
  return "";
}

/**
 * Whether the pregnancy answer is locked: only male learners are. The server
 * applies the same rule on save, so a crafted request cannot store a male as
 * pregnant. A girl aged 10 or below starts at "No" but keeps the field
 * editable — an unusual case must not be made impossible to record.
 */
export function mustNotBePregnant(sex: string): boolean {
  return sex === "M";
}

/**
 * Whether the pregnancy answer should start (or fall back) to "No" when the
 * learner's sex or age changes. Unlike `mustNotBePregnant`, this is a default,
 * not a lock: a female learner aged 10 or below can still be marked pregnant.
 */
export function defaultsToNotPregnant(sex: string, ageYears: string | number): boolean {
  if (sex === "M") return true;
  const age = Number(ageYears);
  return sex === "F" && Number.isFinite(age) && age > 0 && age <= 10;
}

/**
 * Does this learner count in Form 2's "pregnant / with 0–1 year-old child"
 * column? A legacy row that stored "Yes" for a male must not be counted, even
 * before it is next opened and saved. A female learner's answer always counts,
 * whatever her age, because the field is no longer locked at 10.
 */
export function countsAsPregnantOrYoung(s: {
  sex: string;
  pregnant: string;
  hasYoungChildren: string;
}): boolean {
  if (s.hasYoungChildren === "Yes") return true;
  return s.pregnant === "Yes" && !mustNotBePregnant(s.sex);
}

/** Format date YYYY-MM-DD → MM/DD/YYYY for SBFP form */
export function formatDateMDY(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/**
 * Capitalize every word of a person's name for the printed forms, leaving
 * mixed-case spellings such as "McArthur" and suffixes such as "III" intact.
 */
export function capitalizePersonName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\p{L}+/gu, (word) => {
      const upper = word.toLocaleUpperCase("en-PH");
      const lower = word.toLocaleLowerCase("en-PH");
      if (NAME_SUFFIXES.has(upper)) return upper;
      if (word !== upper && word !== lower) return word;
      return upper.charAt(0) + lower.slice(1);
    });
}

// ── WHO 2007 Reference Tables ──────────────────────────────────────────────────
// BMI-for-age [median, SD] age 5–19 (index 0 = age 5)
const WHO_BMI_M: [number,number][] = [[15.3,1.0],[15.3,1.1],[15.5,1.2],[15.8,1.4],[16.3,1.6],[16.8,1.9],[17.5,2.2],[18.2,2.5],[19.0,2.8],[19.8,3.0],[20.5,3.1],[21.1,3.2],[21.6,3.3],[22.0,3.4],[22.3,3.4]];
const WHO_BMI_F: [number,number][] = [[15.3,1.0],[15.3,1.1],[15.5,1.3],[16.0,1.6],[16.6,1.9],[17.3,2.2],[18.0,2.6],[18.7,2.9],[19.4,3.1],[19.9,3.2],[20.4,3.3],[20.8,3.3],[21.1,3.3],[21.3,3.4],[21.4,3.4]];
// HFA [median cm, SD] age 5–19
const WHO_HFA_M: [number,number][] = [[110.0,4.3],[116.0,4.5],[121.7,4.8],[127.3,5.1],[132.6,5.4],[137.8,5.8],[143.5,6.4],[149.8,7.2],[156.4,7.8],[162.6,7.8],[167.0,7.3],[170.0,6.9],[171.6,6.7],[172.4,6.6],[173.0,6.6]];
const WHO_HFA_F: [number,number][] = [[109.4,4.2],[115.1,4.5],[120.8,4.8],[126.3,5.2],[131.5,5.6],[136.8,5.9],[142.5,6.0],[147.6,6.0],[151.4,5.9],[153.7,5.8],[154.9,5.8],[155.6,5.7],[156.0,5.7],[156.3,5.7],[156.4,5.7]];

// ── Helper Functions ───────────────────────────────────────────────────────────
export function calcBMI(w: string, h: string): string {
  const wn = parseFloat(w), hn = parseFloat(h) / 100;
  if (!wn || !hn || hn <= 0) return "";
  return (wn / (hn * hn)).toFixed(2);
}
export function computeAge(dob: string): { years: string; months: string } {
  if (!dob) return { years:"", months:"" };
  const birth = new Date(dob), today = new Date();
  if (isNaN(birth.getTime()) || birth > today) return { years:"", months:"" };
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years: String(years), months: String(months) };
}
export function classifyBMI(bmi: string, ageYears: string, sex: string): BMIStatus {
  const b = parseFloat(bmi), age = parseInt(ageYears);
  if (!b || !age || age < 5 || age > 19 || (sex !== "M" && sex !== "F")) return "";
  const [med, sd] = (sex === "M" ? WHO_BMI_M : WHO_BMI_F)[Math.min(age - 5, 14)];
  const z = (b - med) / sd;
  if (z < -3) return "Severely Wasted";
  if (z < -2) return "Wasted";
  if (z <= 1) return "Normal";
  if (z <= 2) return "Overweight";
  return "Obese";
}
export function classifyHFA(height: string, ageYears: string, sex: string): HFAStatus {
  const h = parseFloat(height), age = parseInt(ageYears);
  if (!h || !age || age < 5 || age > 19 || (sex !== "M" && sex !== "F")) return "";
  const [med, sd] = (sex === "M" ? WHO_HFA_M : WHO_HFA_F)[Math.min(age - 5, 14)];
  const z = (h - med) / sd;
  if (z < -3) return "Severely Stunted";
  if (z < -2) return "Stunted";
  if (z <= 2) return "Normal";
  return "Tall";
}

// ── Learner records ────────────────────────────────────────────────────────────
export const EMPTY_STUDENT = (schoolId: string, period: Period|"" = "", sy = "2025-2026"): Omit<Student,"id"> => ({
  schoolId, period: (period || "") as Period, sy, name:"", sex:"", gradeLevel: "",
  dateOfBirth:"", dateOfWeighing:"", ageYears:"", ageMonths:"",
  weight:"", height:"", bmi:"", bmiStatus:"", hfaStatus:"",
  nutritionalStatus:"", classificationOfBeneficiary:"",
  pregnant:"", hasYoungChildren:"", dewormed:"", parentConsentMilk:"", fourPs:"", sbfpPreviousYears:"",
});

// ── Feedback helpers ───────────────────────────────────────────────────────────
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** ISO date → "Oct 02, 2026" */
export function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTH_ABBR[Number(m[2]) - 1] ?? m[2]} ${m[3]}, ${m[1]}`;
}

/** ISO date → "today" / "6 days ago"; anything older stays an absolute date. */
export function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(`${iso}T00:00:00`)) / 86400000);
  if (!Number.isFinite(days) || days < 0) return shortDate(iso);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return shortDate(iso);
}
