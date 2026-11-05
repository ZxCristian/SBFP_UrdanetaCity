// SBFP Form 1A (.xlsx) export built on ExcelJS (Form 1A + Form 2) — real merges, styles and
// embedded logo images (DepEd left, OK sa DepEd right), matching the printed form.
import { Workbook, type Worksheet, type Cell } from "exceljs";
import type { SummaryMatrixRow } from "./sbfp-domain.ts";

// ── Shared form types (mirrors src/sbfp-app.tsx) ───────────────────────────────
export type GradeLevel =
  |"Kinder"|"Grade 1"|"Grade 2"|"Grade 3"|"Grade 4"|"Grade 5"|"Grade 6"
  |"Grade 7"|"Grade 8"|"Grade 9"|"Grade 10"|"Grade 11"|"Grade 12"
  |"SPED"|"SPED Kinder"|"SPED Grade 1"|"SPED Grade 2"|"SPED Grade 3"|"SPED Grade 4"|"SPED Grade 5"|"SPED Grade 6";
export type Sex = "M"|"F";
export type Period = "Baseline"|"Midline"|"Endline";
export type BMIStatus = "Severely Wasted"|"Wasted"|"Normal"|"Overweight"|"Obese"|"";
export type HFAStatus = "Severely Stunted"|"Stunted"|"Normal"|"Tall"|"";
export type YesNo = "Yes"|"No"|"";

export interface SchoolFormInfo {
  name: string;
  type: string;
  division: string;
  cityMunicipalityBarangay: string;
  schoolIdNumber: string;
  principal: string;
  focalPerson: string;
  /** SBFP Form 2 header: date the feeding starts (ISO YYYY-MM-DD). */
  dateStartFeeding?: string;
  /** SBFP Form 2 header "Last Mile School" — "Yes" | "No" | "". */
  lastMileSchool?: string;
}

export interface StudentRecord {
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

// ── Sorting (Kinder → Grade 6, then name, then Baseline → Endline) ────────────
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

function sortRecords(list: StudentRecord[]): StudentRecord[] {
  return [...list].sort((a, b) => {
    const ga = gradeRank(a.gradeLevel);
    const gb = gradeRank(b.gradeLevel);
    if (ga !== gb) return ga - gb;
    const name = a.name.localeCompare(b.name);
    if (name !== 0) return name;
    return (periodRank[a.period] ?? 9) - (periodRank[b.period] ?? 9);
  });
}

/** Format date YYYY-MM-DD → MM/DD/YYYY for the SBFP form */
function formatDateMDY(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format date YYYY-MM-DD → "July 06, 2026", the printed form's wording. */
function formatDateLong(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[3]}, ${m[1]}`;
}

/** Form 2's "Last Mile School" line: "___Y ___N" with the chosen box ticked. */
function lastMileText(value?: string): string {
  return `${value === "Yes" ? "✓" : "___"}Y    ${value === "No" ? "✓" : "___"}N`;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const HEADER_FILL = "FFD9E1F2"; // light blue like the printed form
const FONT = "Calibri";

function setColWidths(ws: Worksheet) {
  // A–S (19 columns)
  const widths = [4, 22, 6, 14, 14, 14, 12, 10, 10, 12, 14, 12, 16, 12, 14, 12, 14, 12, 16];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function styleHeaderCell(cell: Cell) {
  cell.font = { name: FONT, size: 8, bold: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function borderCell(cell: Cell) {
  cell.border = {
    top: { style: "thin" }, left: { style: "thin" },
    bottom: { style: "thin" }, right: { style: "thin" },
  };
}

// ── Workbook builder ───────────────────────────────────────────────────────────
/**
 * Build the SBFP Form 1A workbook. `logoLeft` / `logoRight` are base64 data URLs
 * (no prefix) or undefined to skip the image.
 */
export async function buildSbfpWorkbook(
  school: SchoolFormInfo,
  rows: StudentRecord[],
  periodLabel: string,
  logoLeft?: string,
  logoRight?: string,
  sy = "2025-2026",
): Promise<ArrayBuffer> {
  const titlePeriod = periodLabel === "All" ? "ALL PERIODS" : periodLabel.toUpperCase();
  const sorted = sortRecords(rows);

  const workbook = new Workbook();
  const ws = workbook.addWorksheet("SBFP Master List", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      horizontalCentered: true,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.3, footer: 0.3 },
    },
  });
  setColWidths(ws);

  // Logos — left over A2:B5, right anchored at S1 (same spots as the printed form).
  // The DepEd seal is square; the "OK sa DepEd" logo is wide (12:7), so each gets
  // its own box — a shared square `ext` would squash that one.
  if (logoLeft) {
    const id = workbook.addImage({ base64: logoLeft, extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: 1 }, ext: { width: 80, height: 80 } });
  }
  if (logoRight) {
    const id = workbook.addImage({ base64: logoRight, extension: "png" });
    // Wide logo (12:7) — a square box would squash it, so it gets its own ext.
    ws.addImage(id, { tl: { col: 18, row: 1 }, ext: { width: 108, height: 63 } });
  }

  // Title block
  ws.getCell("A1").value = "SBFP Form 1A (2026)";
  ws.getCell("A1").font = { name: FONT, size: 11, bold: true };
  ws.getRow(3).height = 26;
  ws.mergeCells("A3:S3");
  ws.getCell("A3").value = "Department of Education";
  ws.getCell("A3").font = { name: FONT, size: 14, bold: true };
  ws.getCell("A3").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(5).height = 20;
  ws.mergeCells("A5:S5");
  ws.getCell("A5").value =
    `Master List of Beneficiaries for School-Based Feeding Program (SBFP) | SY ${sy} — ${titlePeriod}`;
  ws.getCell("A5").font = { name: FONT, size: 12, bold: true };
  ws.getCell("A5").alignment = { horizontal: "center", vertical: "middle" };

  // Form details — bold label + value in adjacent cells (rows 7–11)
  const details: [string, string, string][] = [
    ["A7", "Division:", school.division || ""],
    ["H7", "Name of Principal / School Head:", school.principal || ""],
    ["A8", "City/Municipality/Barangay:", school.cityMunicipalityBarangay || ""],
    ["H8", "Name of Feeding Focal Person:", school.focalPerson || ""],
    ["A9", "Name of School / School District :", school.name || ""],
    ["A10", "School Type:", school.type || ""],
    ["A11", "School ID Number:", school.schoolIdNumber || ""],
  ];
  for (const [labelRef, label, value] of details) {
    // The value sits two columns right of its label: A# → C#, H# → K#.
    const valueRef = (labelRef[0] === "H" ? "K" : "C") + labelRef.slice(1);
    ws.getCell(labelRef).value = label;
    ws.getCell(labelRef).font = { name: FONT, size: 10, bold: true };
    ws.getCell(valueRef).value = value;
    ws.getCell(valueRef).font = { name: FONT, size: 10 };
  }

  // Table headers (rows 12–13)
  const headerRows: [string, string][] = [
    ["A12", "No."], ["B12", "Name"], ["C12", "Sex"], ["D12", "Grade / Section"],
    ["E12", "Date of Birth (MM/DD/YYYY)"], ["F12", "Date of Weighing (MM/DD/YYYY)"],
    ["G12", "Age in Years / Months"], ["H12", "Weight (Kg)"], ["I12", "Height (cm)"],
    ["J12", "BMI for 6 y.o. and above"], ["K12", "Nutritional Status (NS)"],
    ["M12", "Classification of Beneficiary (Primary or Secondary)"],
    ["N12", "Pregnant (Yes or No)"], ["O12", "With 0-1 year old children (Yes or No)"],
    ["P12", "Dewormed (Yes or No)"], ["Q12", "Parent's consent for milk (Yes or No)"],
    ["R12", "Participation in 4Ps (Yes or No)"],
    ["S12", "Beneficiary of SBFP in previous years (Yes or No)"],
  ];
  ws.getRow(12).height = 30;
  ws.getRow(13).height = 22;
  for (const [ref, text] of headerRows) {
    if (ref === "K12") {
      ws.mergeCells("K12:L12");
    } else if (ref !== "K12" && ref.startsWith("K")) continue;
    ws.getCell(ref).value = text;
  }
  ws.getCell("K13").value = "BMI-A";
  ws.getCell("L13").value = "HFA";
  for (let c = 1; c <= 19; c++) {
    if (c !== 11 && c !== 12) ws.mergeCells(`${ws.getCell(12, c).address}:${ws.getCell(13, c).address}`); // K/L: group header K12:L12 with sub-headers in row 13
    styleHeaderCell(ws.getCell(12, c));
    styleHeaderCell(ws.getCell(13, c));
    borderCell(ws.getCell(12, c));
    borderCell(ws.getCell(13, c));
  }

  // Student rows (from row 14)
  sorted.forEach((s, i) => {
    const r = 14 + i;
    const age = s.ageYears || s.ageMonths ? `${s.ageYears || "0"}/${s.ageMonths || "0"}` : "";
    const row = ws.getRow(r);
    const vals: (string | number)[] = [
      i + 1,
      s.name || "",
      s.sex || "",
      s.gradeLevel || "",
      formatDateMDY(s.dateOfBirth),
      formatDateMDY(s.dateOfWeighing),
      age,
      s.weight ? parseFloat(s.weight) : "",
      s.height ? parseFloat(s.height) : "",
      s.bmi ? parseFloat(s.bmi) : "",
      s.bmiStatus || s.nutritionalStatus || "",
      s.hfaStatus || "",
      s.classificationOfBeneficiary || "",
      s.pregnant || "",
      s.hasYoungChildren || "",
      s.dewormed || "",
      s.parentConsentMilk || "",
      s.fourPs || "",
      s.sbfpPreviousYears || "",
    ];
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v === "" ? null : v;
      cell.font = { name: FONT, size: 9 };
      cell.alignment = { vertical: "middle", wrapText: ci !== 1 };
      borderCell(cell);
    });
  });

  // Signature block
  const lastData = 13 + sorted.length;
  const signRow = lastData + 2;
  ws.getCell(`B${signRow}`).value = "Approved by:";
  ws.getCell(`B${signRow}`).font = { name: FONT, size: 10, bold: true };
  // The name above the designation, matching Form 2's signature block — no
  // ruled line over the School Head / Principal.
  ws.getCell(`B${signRow + 3}`).value = school.principal || "";
  ws.getCell(`B${signRow + 3}`).font = { name: FONT, size: 11, bold: true };
  ws.getCell(`B${signRow + 4}`).value = "School Head / Principal";
  ws.getCell(`B${signRow + 4}`).font = { name: FONT, size: 10, bold: true };

  return (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

// ── Summary Table (.xlsx) export — SBFP Form 2 (2026) ─────────────────────────
/**
 * One displayed row of the Summary Table: a grade (or "GRAND TOTAL") for one sex
 * bucket. The caller passes the numbers it already computed for the screen, so
 * the workbook can never drift from the table — including the SPED grade merge.
 */
export type { SummaryMatrixRow } from "./sbfp-domain.ts";

export interface SummaryExportInput {
  school: SchoolFormInfo;
  period: string;
  /** "All" | "Regular" | "SPED" — omitted for schools without SPED grade levels. */
  cohort?: string;
  /** School year printed on the form, e.g. "2025-2026". */
  sy?: string;
  bmiStatuses: string[];
  hfaStatuses: string[];
  rows: SummaryMatrixRow[];
}

// The printed form's WEIGHT block has ONE "Overweight + Obese" column, so the
// BMI statuses are bucketed by name instead of by index.
const WEIGHT_COLUMNS: { label: string; statuses: string[] }[] = [
  { label: "Severely Wasted", statuses: ["Severely Wasted"] },
  { label: "Wasted", statuses: ["Wasted"] },
  { label: "Normal", statuses: ["Normal"] },
  { label: "Overweight + Obese", statuses: ["Overweight", "Obese"] },
];
const HEIGHT_COLUMN_LABELS = ["Severely Stunted", "Stunted", "Normal", "Tall"];
/** The form's "No. of Stunted Learners" is the HFA stunted + severely stunted count. */
const STUNTED_STATUSES = ["Severely Stunted", "Stunted"];

// Column indices (1-based): A grade, B sex, then the two target groups.
const C_GRADE = 1;
const C_SEX = 2;
const C_WEIGHT = 3; // + 4 counts + Total
const C_HEIGHT = C_WEIGHT + WEIGHT_COLUMNS.length + 1; // + 4 counts + Total
const C_PREG = C_HEIGHT + HEIGHT_COLUMN_LABELS.length + 1; // secondary columns start
const C_ATRISK = C_PREG + 1;
const C_STUNTED = C_PREG + 2;
const C_IPS = C_PREG + 3;
const C_DEWORMED = C_PREG + 4;
const C_4PS = C_PREG + 5;
const C_REPEATERS = C_PREG + 6;
const C_DATE = C_PREG + 7;
const C_LAST = C_DATE;

/** The "No. of Secondary Targets" columns, merged down over the header rows. */
const SECONDARY_HEADERS: [number, string][] = [
  [C_PREG, "No. of Adolescent Pregnant Learners/ Learners with 0-1 year-old child/ren"],
  [C_ATRISK, "No. of Pupils at risk of dropping out"],
  [C_STUNTED, "No. of Stunted Learners"],
  [C_IPS, "No. of Indigenous Peoples (IPs)"],
  [C_DEWORMED, "No. of Learners Dewormed"],
  [C_4PS, "No. of 4Ps Beneficiaries"],
  [C_REPEATERS, "No. of Pupils who are beneficiaries in previous years (Repeaters)"],
  [C_DATE, "Date Feeding Started/Ended"],
];
const FORM2_NOTE =
  "Note: This form shall be prepared by the school before the start of feeding and " +
  "after feeding, to be compiled by the SDO, and for the final compilation by the RO, " +
  "for submission to DepEd BLSS-SHD.";

/** Sum the counts of the named statuses out of a status list + parallel counts. */
function countFor(counts: number[], statuses: string[], wanted: string[]): number {
  return wanted.reduce((sum, w) => {
    const i = statuses.indexOf(w);
    return sum + (i < 0 ? 0 : counts[i] ?? 0);
  }, 0);
}

/** Form 2's header cells: bold, wrapped, centred — no band fill, like the print. */
function styleForm2Header(cell: Cell) {
  cell.font = { name: FONT, size: 8, bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

/**
 * Build the SBFP Form 2 (2026) workbook — "SUMMARY OF BENEFICIARIES & START OF
 * FEEDING" — from the numbers the Summary Table screen already computed.
 * `logoLeft` / `logoRight` are base64 PNG payloads (no `data:` prefix).
 */
export async function buildSummaryWorkbook(
  input: SummaryExportInput,
  logoLeft?: string,
  logoRight?: string,
): Promise<ArrayBuffer> {
  const { school, period, cohort, bmiStatuses, hfaStatuses, rows } = input;
  const sy = input.sy || "2025-2026";
  const workbook = new Workbook();
  const ws = workbook.addWorksheet("SBFP Form 2", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      horizontalCentered: true,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.3, footer: 0.3 },
    },
  });
  const L = (n: number) => ws.getColumn(n).letter;

  // NB: ExcelJS treats width 9 as "default" and drops the column record, so the
  // narrow columns are 9.5 — otherwise Excel falls back to its own width.
  const widths: [number, number][] = [
    [C_GRADE, 19], [C_SEX, 5],
    [C_WEIGHT, 10], [C_WEIGHT + 1, 9.5], [C_WEIGHT + 2, 9.5], [C_WEIGHT + 3, 12], [C_WEIGHT + 4, 7],
    [C_HEIGHT, 11], [C_HEIGHT + 1, 9.5], [C_HEIGHT + 2, 9.5], [C_HEIGHT + 3, 9.5], [C_HEIGHT + 4, 7],
    [C_PREG, 14], [C_ATRISK, 13], [C_STUNTED, 12], [C_IPS, 12],
    [C_DEWORMED, 12], [C_4PS, 12], [C_REPEATERS, 15], [C_DATE, 13],
  ];
  for (const [col, w] of widths) ws.getColumn(col).width = w;

  // ── Letterhead (rows 1–3): the form's name at the top left, then the two
  // centred lines — Department of Education, then the form's title — stacked
  // exactly as they are on the printed form.
  ws.getRow(1).height = 20;
  const formTitle = ws.getCell(1, C_GRADE);
  formTitle.value = "SBFP Form 2 (2026)";
  formTitle.font = { name: FONT, size: 12, bold: true };
  formTitle.alignment = { vertical: "middle" };

  ws.getRow(3).height = 20;
  ws.mergeCells(`${L(C_GRADE)}3:${L(C_LAST)}3`);
  const deptHead = ws.getCell(3, C_GRADE);
  deptHead.value = "Department of Education";
  deptHead.font = { name: FONT, size: 14, bold: true };
  deptHead.alignment = { horizontal: "center", vertical: "middle" };

  ws.getRow(5).height = 18;
  ws.mergeCells(`${L(C_GRADE)}5:${L(C_LAST)}5`);
  const formSubtitle = ws.getCell(5, C_GRADE);
  formSubtitle.value =
    `SCHOOL-BASED FEEDING PROGRAM (SBFP) SUMMARY OF BENEFICIARIES & START OF FEEDING (SY:${sy})`;
  formSubtitle.font = { name: FONT, size: 10, bold: true };
  formSubtitle.alignment = { horizontal: "center", vertical: "middle" };

  // Logos sit beside the two centred letterhead lines — the DepEd seal at the
  // left, the "OK sa DepEd" artwork at the right, as on the printed form.
  for (let r = 4; r <= 5; r++) ws.getRow(r).height = 10;
  if (logoLeft) {
    const id = workbook.addImage({ base64: logoLeft, extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: 1 }, ext: { width: 68, height: 68 } });
  }
  if (logoRight) {
    const id = workbook.addImage({ base64: logoRight, extension: "png" });
    ws.addImage(id, { tl: { col: 19, row: 1 }, ext: { width: 87, height: 51 } });
  }

  // ── Field block (rows 6–11): label merged over A:C, value in D ─────────────
  const fields: [string, string][] = [
    ["School Division Office:", school.division || ""],
    ["City/Municipality/Barangay:", school.cityMunicipalityBarangay || ""],
    ["Name of School / School District :", school.name || ""],
    ["School ID Number:", school.schoolIdNumber || ""],
    ["Date of Start of Feeding:", formatDateLong(school.dateStartFeeding || "")],
    ["Last Mile School:", lastMileText(school.lastMileSchool)],
  ];
  // On the print the labels are plain and the answers are the bold part.
  fields.forEach(([label, value], i) => {
    const r = 6 + i;
    ws.getRow(r).height = 14;
    ws.mergeCells(`${L(C_GRADE)}${r}:${L(C_WEIGHT)}${r}`);
    const labelCell = ws.getCell(r, C_GRADE);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 10 };
    const valueCell = ws.getCell(r, C_WEIGHT + 1);
    valueCell.value = value;
    valueCell.font = { name: FONT, size: 10, bold: true };
  });
  // Breathing room between the field block and the table, as on the print.
  ws.getRow(12).height = 12;
  ws.getRow(13).height = 8;

  // ── Table header (rows 14–17), the form's four levels ─────────────────────
  const HR = 14;
  const weightEnd = C_WEIGHT + WEIGHT_COLUMNS.length; // WEIGHT block Total
  const heightEnd = C_HEIGHT + HEIGHT_COLUMN_LABELS.length; // HEIGHT block Total
  ws.getRow(HR).height = 30;
  ws.getRow(HR + 1).height = 28;
  ws.getRow(HR + 2).height = 13;
  ws.getRow(HR + 3).height = 20;

  ws.mergeCells(`${L(C_GRADE)}${HR}:${L(C_GRADE)}${HR + 3}`);
  ws.getCell(HR, C_GRADE).value = "Number of School Children by Grade Level";
  ws.mergeCells(`${L(C_SEX)}${HR}:${L(C_SEX)}${HR + 3}`);
  ws.getCell(HR, C_SEX).value = "Sex";
  ws.mergeCells(`${L(C_WEIGHT)}${HR}:${L(heightEnd)}${HR}`);
  ws.getCell(HR, C_WEIGHT).value = "No. of Primary Targets";
  ws.mergeCells(`${L(C_PREG)}${HR}:${L(C_LAST)}${HR}`);
  ws.getCell(HR, C_PREG).value = "No. of Secondary Targets";

  ws.mergeCells(`${L(C_WEIGHT)}${HR + 1}:${L(heightEnd)}${HR + 1}`);
  ws.getCell(HR + 1, C_WEIGHT).value = "Nutritional Status at Start/End of Feeding*";
  for (const [col, text] of SECONDARY_HEADERS) {
    ws.mergeCells(`${L(col)}${HR + 1}:${L(col)}${HR + 3}`);
    ws.getCell(HR + 1, col).value = text;
  }

  ws.mergeCells(`${L(C_WEIGHT)}${HR + 2}:${L(weightEnd)}${HR + 2}`);
  ws.getCell(HR + 2, C_WEIGHT).value = "WEIGHT";
  ws.mergeCells(`${L(C_HEIGHT)}${HR + 2}:${L(heightEnd)}${HR + 2}`);
  ws.getCell(HR + 2, C_HEIGHT).value = "HEIGHT";

  WEIGHT_COLUMNS.forEach((c, i) => { ws.getCell(HR + 3, C_WEIGHT + i).value = c.label; });
  ws.getCell(HR + 3, weightEnd).value = "Total";
  HEIGHT_COLUMN_LABELS.forEach((label, i) => { ws.getCell(HR + 3, C_HEIGHT + i).value = label; });
  ws.getCell(HR + 3, heightEnd).value = "Total";
  for (let hr = HR; hr <= HR + 3; hr++) {
    for (let c = 1; c <= C_LAST; c++) {
      styleForm2Header(ws.getCell(hr, c));
      borderCell(ws.getCell(hr, c));
    }
  }

  // ── Data — M / F / Total per grade, the label merged down the group ───────
  let r = HR + 4;
  let i = 0;
  while (i < rows.length) {
    const grade = rows[i].grade;
    let j = i;
    while (j < rows.length && rows[j].grade === grade) j++;
    const isGrand = grade === "GRAND TOTAL";
    const first = r;
    if (j - i > 1) ws.mergeCells(`${L(C_GRADE)}${first}:${L(C_GRADE)}${first + (j - i) - 1}`);

    const gradeCell = ws.getCell(first, C_GRADE);
    // The summary screen and the printed sheet name the grade only; the old
    // `1. Kinder` prefixes were removed from the UI but survived here.
    gradeCell.value = isGrand ? "GRAND TOTAL" : grade;
    gradeCell.font = { name: FONT, size: 10, bold: true };
    gradeCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

    for (let k = i; k < j; k++, r++) {
      const row = rows[k];
      ws.getRow(r).height = 16;
      // Columns B–T only: in ExcelJS writing into a merged slave replaces the
      // master's value, which would blank the grade label written once above.
      const values: (string | number | null)[] = [
        row.sex,
        ...WEIGHT_COLUMNS.map(c => countFor(row.bmi, bmiStatuses, c.statuses)),
        row.bmi.reduce((a, b) => a + b, 0),
        ...HEIGHT_COLUMN_LABELS.map(label => countFor(row.hfa, hfaStatuses, [label])),
        row.hfa.reduce((a, b) => a + b, 0),
        row.pregnantYoung,
        row.atRisk,
        countFor(row.hfa, hfaStatuses, STUNTED_STATUSES),
        row.ips,
        row.dewormed,
        row.fourPs,
        row.sbfp,
        // The same date the on-screen Form 2 prints for this column.
        formatDateMDY(school.dateStartFeeding || ""),
      ];
      values.forEach((value, ci) => {
        const cell = ws.getCell(r, ci + 2);
        cell.value = value;
        cell.font = { name: FONT, size: 9, bold: isGrand };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        borderCell(cell);
      });
    }
    for (let rr = first; rr < r; rr++) borderCell(ws.getCell(rr, C_GRADE));
    i = j;
  }

  // ── Signatures + footer, as on the printed form ───────────────────────────
  const preparedCol = 2; // B — indented clear of the grade column, like the print
  const approvedCol = 15; // O — about two thirds across
  const signRow = r + 2; // one blank row between the table and the labels
  const prepared = ws.getCell(signRow, preparedCol);
  prepared.value = "Prepared by:";
  prepared.font = { name: FONT, size: 10, bold: true };
  const approved = ws.getCell(signRow, approvedCol);
  approved.value = "Approved by:";
  approved.font = { name: FONT, size: 10, bold: true };

  const signatures: [number, number, string][] = [
    [signRow + 3, preparedCol, school.focalPerson || ""],
    [signRow + 4, preparedCol, "SBFP DepEd Focal"],
    [signRow + 3, approvedCol, school.principal || ""],
    [signRow + 4, approvedCol, "School Head / Principal"],
  ];
  for (const [rowNo, col, text] of signatures) {
    const cell = ws.getCell(rowNo, col);
    cell.value = text;
    cell.font = { name: FONT, size: 10, bold: true };
  }

  const noteRow = signRow + 6;
  ws.mergeCells(`${L(C_GRADE)}${noteRow}:${L(C_LAST)}${noteRow}`);
  const note = ws.getCell(noteRow, C_GRADE);
  note.value = FORM2_NOTE;
  note.font = { name: FONT, size: 9 };
  note.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

  ws.mergeCells(`${L(C_GRADE)}${noteRow + 1}:${L(C_LAST)}${noteRow + 1}`);
  const scope = cohort && cohort !== "All" ? ` · ${cohort} only` : "";
  const printed = ws.getCell(noteRow + 1, C_GRADE);
  printed.value =
    `Generated ${new Date().toISOString().slice(0, 10)} · ${period} period${scope} · ` +
    `${school.type} · School Year ${sy}`;
  printed.font = { name: FONT, size: 8, italic: true };

  return (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

/** Build the Form 2 workbook and trigger a browser download of the .xlsx file. */
export async function exportSummaryToExcel(input: SummaryExportInput) {
  const [logoLeft, logoRight] = await Promise.all([
    fetchLogoBase64("/deped-logo.png"),
    fetchLogoBase64("/ok-sa-deped.png"),
  ]);
  const buffer = await buildSummaryWorkbook(input, logoLeft, logoRight);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = input.school.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  const safePeriod = input.period.replace(/\s+/g, "_");
  a.href = url;
  a.download = `SBFP_Form_2_${safeName}_${safePeriod}_SY${input.sy || "2025-2026"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Fetch the two DepEd logos from /public and return them as base64 payloads
 * (without the data: prefix — that is what ExcelJS.addImage expects).
 * Missing logos resolve to undefined so the export still works without them.
 */
async function fetchLogoBase64(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.type.includes("png") && !url.endsWith(".png")) return undefined;
    const buf = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch {
    return undefined;
  }
}

/** Build the workbook and trigger a browser download of the .xlsx file. */
export async function exportStudentsToExcel(
  school: SchoolFormInfo,
  rows: StudentRecord[],
  periodLabel: string,
  sy = "2025-2026",
) {
  const [logoLeft, logoRight] = await Promise.all([
    fetchLogoBase64("/deped-logo.png"),
    fetchLogoBase64("/ok-sa-deped.png"),
  ]);

  const buffer = await buildSbfpWorkbook(school, rows, periodLabel, logoLeft, logoRight, sy);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = school.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  const safePeriod = periodLabel.replace(/\s+/g, "_");
  a.href = url;
  a.download = `SBFP_Form_1A_${safeName}_${safePeriod}_SY${sy}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
