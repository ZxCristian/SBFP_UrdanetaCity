/**
 * Read learners out of a SBFP Form 1A workbook.
 *
 * The school exports its Master List from Student Records, sends the .xlsx to
 * the Division Office, and the Division Office imports it here instead of
 * re-typing every learner. This module is deliberately separate from ExcelJS:
 * the workbook reader hands it a plain grid, so the header mapping, dates and
 * validation can be tested in Node without a spreadsheet engine.
 *
 * It is also deliberately forgiving about *where* the table starts. The
 * exported form has its header on rows 12–13 after the letterhead, but schools
 * often paste the same columns into a clean sheet. The header is found by its
 * labels (Name, Weight, Height, …), not by a fixed cell.
 */
import {
  BMI_STATUSES,
  HFA_STATUSES,
  calcBMI,
  classifyBeneficiary,
  classifyBMI,
  classifyHFA,
  computeAge,
  getGrades,
  mustNotBePregnant,
  type BMIStatus,
  type GradeLevel,
  type HFAStatus,
  type Period,
  type School,
  type Sex,
  type Student,
  type YesNo,
} from "./sbfp-domain.ts";
import { learnerProblem } from "./sbfp-validation.ts";

/** One worksheet cell after the ExcelJS value object has been unwrapped. */
export type ImportCell = string | number | boolean | Date | null;

/** A worksheet without ExcelJS types, so this module stays engine-free. */
export interface ImportGrid {
  sheetName: string;
  cells: ImportCell[][];
}

export interface SbfpImportIssue {
  /** Excel's 1-based row number, so the message points at what the user sees. */
  rowNumber: number;
  name: string;
  message: string;
}

export type ImportedStudent = Omit<Student, "id" | "schoolId" | "period" | "sy">;

export interface ImportedLearnerRow {
  rowNumber: number;
  student: ImportedStudent;
}

export interface SbfpImportResult {
  sheetName: string;
  /** 1-based row the column labels were found on. */
  headerRow: number;
  detectedPeriod: Period | "";
  rows: ImportedLearnerRow[];
  issues: SbfpImportIssue[];
}

/** Thrown when the workbook does not contain a Form 1A-style learner table. */
export class SbfpImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbfpImportFormatError";
  }
}

type Field =
  | "name"
  | "sex"
  | "grade"
  | "dateOfBirth"
  | "dateOfWeighing"
  | "age"
  | "weight"
  | "height"
  | "bmi"
  | "bmiStatus"
  | "hfaStatus"
  | "classification"
  | "pregnant"
  | "youngChildren"
  | "dewormed"
  | "milkConsent"
  | "fourPs"
  | "previousYears";

type ColumnMap = Partial<Record<Field, number>>;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const BLANKISH = /^(?:|[-—–]|n\/?a|none|null)$/i;

function cellText(value: ImportCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

function normalized(value: ImportCell): string {
  return cellText(value).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function fieldForHeader(label: string): Field | null {
  if (!label) return null;

  // The two status sub-columns come before the generic BMI column: on the
  // exported form K13 is "BMI-A" under a merged "Nutritional Status (NS)".
  if (/\bbmi\s*[- ]?\s*a\b|\bbmi\s+status\b/.test(label)) return "bmiStatus";
  if (/\bhfa\b|height\s*[- ]?for\s*[- ]?age/.test(label)) return "hfaStatus";
  if (/nutritional status/.test(label) && !/\bbmi\b/.test(label)) return "bmiStatus";
  if (/\bbmi\b/.test(label) && !/status/.test(label)) return "bmi";

  if (
    /^(?:name|learner'?s? name|student'?s? name|full name)\b/.test(label) &&
    !/principal|school|focal|teacher|adviser/.test(label)
  ) return "name";
  if (/(?:^|\s)(?:sex|gender)(?:\s|$)/.test(label)) return "sex";
  if (/^grade\b|grade level|grade and section/.test(label)) return "grade";
  if (/date of birth|birth\s*date|birthday/.test(label)) return "dateOfBirth";
  if (/date of weighing|weighing date|date weighed/.test(label)) return "dateOfWeighing";
  if (/^age\b|age in years/.test(label)) return "age";
  if (/^weight\b|body weight/.test(label)) return "weight";
  if (/^height\b/.test(label)) return "height";
  if (/classification/.test(label)) return "classification";
  if (/pregnant/.test(label)) return "pregnant";
  if (/0\s*[-–]\s*1\s*year|young child/.test(label)) return "youngChildren";
  if (/deworm/.test(label)) return "dewormed";
  if (/consent.*milk|milk.*consent/.test(label)) return "milkConsent";
  if (/4\s*ps|4p'?s/.test(label)) return "fourPs";
  if (/previous years|repeater/.test(label)) return "previousYears";
  return null;
}

/**
 * Locate the header row and map labels to columns.
 *
 * A label is the cell plus the cell beneath it, because Form 1A puts the merged
 * "Nutritional Status (NS)" group on one row and BMI-A/HFA on the next. On a
 * one-row sheet the second half is just the first learner value, which does not
 * affect the matching.
 */
function columnsFrom(row: ImportCell[], next: ImportCell[], combine: boolean): ColumnMap {
  const columns: ColumnMap = {};
  const width = Math.max(row.length, next.length);
  for (let c = 0; c < width; c++) {
    const label = combine
      ? `${normalized(row[c])} ${normalized(next[c])}`.trim()
      : normalized(row[c]);
    const field = fieldForHeader(label);
    if (field && columns[field] === undefined) columns[field] = c;
  }
  return columns;
}

function hasLearnerColumns(columns: ColumnMap): boolean {
  return columns.name !== undefined && columns.weight !== undefined && columns.height !== undefined;
}

function findHeader(cells: ImportCell[][]): { rowIndex: number; columns: ColumnMap } | null {
  const limit = Math.min(cells.length, 60);

  // Prefer the row that literally carries Name / Weight / Height. Looking at
  // row + next row makes the blank row *above* the real header look valid too;
  // this first pass picks the header itself, then combines the row below for
  // the merged BMI-A / HFA sub-columns.
  for (let r = 0; r < limit; r++) {
    const row = cells[r] ?? [];
    const next = cells[r + 1] ?? [];
    if (!hasLearnerColumns(columnsFrom(row, next, false))) continue;
    return { rowIndex: r, columns: columnsFrom(row, next, true) };
  }

  // A sheet whose required labels live under a group heading still works: use
  // the row with the labels, not the blank/grouped row above it.
  for (let r = 0; r < limit; r++) {
    const row = cells[r] ?? [];
    const next = cells[r + 1] ?? [];
    const combined = columnsFrom(row, next, true);
    if (!hasLearnerColumns(combined)) continue;
    const direct = columnsFrom(row, next, false);
    const actual = Object.keys(direct).length === 0 ? r + 1 : r;
    return { rowIndex: Math.min(actual, cells.length - 1), columns: combined };
  }
  return null;
}

function detectPeriod(cells: ImportCell[][], headerIndex: number): Period | "" {
  const heading = cells
    .slice(0, headerIndex)
    .flat()
    .map(cellText)
    .join(" ");
  if (/all\s+periods/i.test(heading)) return "";
  const match = heading.match(/\b(baseline|midline|endline)\b/i);
  if (!match) return "";
  const value = match[1]!.toLowerCase();
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Period;
}

function makeIso(year: number, month: number, day: number): string {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function excelSerialToIso(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return "";
  // Excel's day 1 is 1900-01-01; 25569 is the serial for 1970-01-01.
  const date = new Date(Math.round((Math.floor(serial) - 25569) * 86400000));
  return makeIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Normalize the form's MM/DD/YYYY, ISO, Excel date cells and serials to ISO. */
export function parseImportDate(value: ImportCell): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return makeIso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") return excelSerialToIso(value);

  const text = cellText(value);
  if (BLANKISH.test(text)) return "";
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/);
  if (match) return makeIso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\D.*)?$/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return makeIso(year, Number(match[1]), Number(match[2]));
  }
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1]!.toLowerCase()];
    return month ? makeIso(Number(match[3]), month, Number(match[2])) : "";
  }
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[2]!.toLowerCase()];
    return month ? makeIso(Number(match[3]), month, Number(match[1])) : "";
  }
  // A date column formatted as text can carry the raw Excel serial.
  if (/^\d{5,6}(?:\.\d+)?$/.test(text)) return excelSerialToIso(Number(text));
  return "";
}

function parseSex(value: ImportCell): Sex | "" {
  const text = normalized(value);
  if (/^(m|male|boy)\b/.test(text)) return "M";
  if (/^(f|female|girl)\b/.test(text)) return "F";
  return "";
}

function normalizeGrade(value: ImportCell, allowed: GradeLevel[]): GradeLevel | "" {
  const text = cellText(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const direct = allowed.find((grade) => grade.toLowerCase() === lower);
  if (direct) return direct;

  const globalMatch = text.match(/\b(G(?:RADE)?\.?\s*\d{1,2})\b/i);
  const gradeNumber =
    text.match(/\bgrade\s*(\d{1,2})\b/i)?.[1] ??
    text.match(/\bG\.?\s*(\d{1,2})\b/i)?.[1] ??
    (!/\bsped\b/i.test(text) ? text.match(/^(\d{1,2})\b/)?.[1] : undefined);

  if (/\bsped\b/i.test(text)) {
    if (/\bk(?:inder(?:garten)?)?\b/i.test(text.replace(/^.*?\bsped\b/i, ""))) {
      return allowed.find((grade) => grade === "SPED Kinder") ?? "";
    }
    if (gradeNumber) {
      const candidate = `SPED Grade ${Number(gradeNumber)}` as GradeLevel;
      return allowed.find((grade) => grade === candidate) ?? "";
    }
    return "";
  }

  // "G1" and "Grade 1 - Rizal" both resolve to Grade 1.
  if (globalMatch && gradeNumber) {
    const candidate = `Grade ${Number(gradeNumber)}` as GradeLevel;
    return allowed.find((grade) => grade === candidate) ?? "";
  }
  if (/\bk(?:inder(?:garten)?)?\b/i.test(text)) {
    return allowed.find((grade) => grade === "Kinder") ?? "";
  }
  if (gradeNumber) {
    const candidate = `Grade ${Number(gradeNumber)}` as GradeLevel;
    return allowed.find((grade) => grade === candidate) ?? "";
  }
  return "";
}

function parseMeasure(value: ImportCell): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = cellText(value).replace(/,/g, "");
  if (BLANKISH.test(text)) return "";
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match?.[0] ?? "";
}

function parseAge(value: ImportCell): { years: string; months: string } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 && value < 40 ? { years: String(Math.floor(value)), months: "0" } : { years: "", months: "" };
  }
  const text = cellText(value);
  if (BLANKISH.test(text)) return { years: "", months: "" };
  const match = text.match(/^(\d{1,2})\s*(?:\/|years?|yrs?|y)?\s*(\d{1,2})?/i);
  if (!match) return { years: "", months: "" };
  const years = Number(match[1]);
  const months = match[2] === undefined ? 0 : Number(match[2]);
  if (years > 30 || months > 11) return { years: "", months: "" };
  return { years: String(years), months: String(months) };
}

function normalizeBmiStatus(value: ImportCell): BMIStatus {
  const text = normalized(value);
  if (!text) return "";
  const full = BMI_STATUSES.find((status) => text === status.toLowerCase() || text.startsWith(status.toLowerCase()));
  if (full) return full;
  const short: Record<string, BMIStatus> = {
    sw: "Severely Wasted", w: "Wasted", n: "Normal", ow: "Overweight", o: "Obese",
  };
  return short[text] ?? "";
}

function normalizeHfaStatus(value: ImportCell): HFAStatus {
  const text = normalized(value);
  if (!text) return "";
  const full = HFA_STATUSES.find((status) => text === status.toLowerCase() || text.startsWith(status.toLowerCase()));
  if (full) return full;
  const short: Record<string, HFAStatus> = {
    ss: "Severely Stunted", s: "Stunted", n: "Normal", t: "Tall",
  };
  return short[text] ?? "";
}

function normalizeClassification(value: ImportCell): "Primary" | "Secondary" | "" {
  const text = normalized(value);
  if (text.startsWith("primary")) return "Primary";
  if (text.startsWith("secondary")) return "Secondary";
  return "";
}

function parseYesNo(value: ImportCell): YesNo {
  const text = normalized(value).replace(/[.\s]+$/, "");
  if (!text || /^(?:n\/?a|none|-|—)$/.test(text)) return "";
  if (/^(?:yes|y|true|1|✓|✔)$/.test(text)) return "Yes";
  if (/^(?:no|n|false|0|x)$/.test(text)) return "No";
  return "";
}

/** A person key used to keep one period from receiving the same learner twice. */
export function learnerImportKey(person: Pick<Student, "name" | "dateOfBirth" | "sex" | "gradeLevel">): string {
  const name = person.name.trim().replace(/\s+/g, " ").toLowerCase();
  // With a birth date, the person is identified by name + DOB + sex even if a
  // file spells the grade differently. Without one, grade is the best guard.
  return person.dateOfBirth
    ? `${name}|${person.dateOfBirth}|${person.sex}`
    : `${name}||${person.sex}|${person.gradeLevel}`;
}

/**
 * Parse one worksheet grid into learner rows.
 *
 * Valid rows are returned ready for a period / school / id to be attached by
 * the caller. Invalid rows are left in `issues`, with their Excel row number,
 * so the preview can show exactly what would be skipped.
 */
export function parseSbfpImport(grid: ImportGrid, school: School): SbfpImportResult {
  const header = findHeader(grid.cells);
  if (!header) {
    throw new SbfpImportFormatError(
      "No learner table was found. Use the exported SBFP Form 1A workbook, or make sure the sheet has Name, Weight, and Height columns.",
    );
  }

  const { rowIndex, columns } = header;
  const heading = grid.cells
    .slice(0, rowIndex)
    .flat()
    .map(cellText)
    .join(" ");
  if (/all\s+periods/i.test(heading)) {
    throw new SbfpImportFormatError(
      "This workbook contains all periods. In Student Records, export one period at a time (Baseline, Midline, or Endline), then import that file.",
    );
  }
  const grades = getGrades(school);
  const rows: ImportedLearnerRow[] = [];
  const issues: SbfpImportIssue[] = [];
  const at = (row: ImportCell[], field: Field): ImportCell => {
    const column = columns[field];
    return column === undefined ? null : row[column] ?? null;
  };
  const dataFields: Field[] = [
    "sex", "grade", "dateOfBirth", "dateOfWeighing", "age",
    "weight", "height", "bmi", "bmiStatus", "hfaStatus",
    "classification", "pregnant", "youngChildren", "dewormed",
    "milkConsent", "fourPs", "previousYears",
  ];

  let started = false;
  for (let r = rowIndex + 1; r < grid.cells.length; r++) {
    const row = grid.cells[r] ?? [];
    const name = cellText(at(row, "name"));
    const hasAny = dataFields.some((field) => !BLANKISH.test(cellText(at(row, field))));
    if (!name) {
      if (!hasAny) {
        // The blank row after the last learner. Without stopping here, the
        // "Approved by" block below the table would look like a learner.
        if (started) break;
        continue;
      }
      if (started) {
        // A row with measurements but no name is a data problem, not a
        // sub-header; flag it rather than silently dropping it.
        const hasLearnerData = ["sex", "grade", "dateOfBirth", "dateOfWeighing", "weight", "height"]
          .some((field) => !BLANKISH.test(cellText(at(row, field as Field))));
        if (hasLearnerData) {
          issues.push({
            rowNumber: r + 1,
            name: "",
            message: "This row has learner data but no name.",
          });
        }
      }
      continue;
    }
    if (/^name$/i.test(name)) continue;
    started = true;

    const rowNumber = r + 1;
    const errors: string[] = [];
    const sex = parseSex(at(row, "sex"));
    if (!sex) errors.push("Sex must be Male or Female (M/F).");

    const grade = normalizeGrade(at(row, "grade"), grades);
    if (!grade) {
      const shown = cellText(at(row, "grade"));
      errors.push(shown ? `Grade “${shown}” is not offered by this school.` : "Grade is missing.");
    }

    const dobText = cellText(at(row, "dateOfBirth"));
    const dateOfBirth = parseImportDate(at(row, "dateOfBirth"));
    if (dobText && !BLANKISH.test(dobText) && !dateOfBirth) {
      errors.push("Date of birth is not a valid date (use MM/DD/YYYY).");
    } else if (dateOfBirth && Date.parse(`${dateOfBirth}T00:00:00`) > Date.now()) {
      errors.push("Date of birth is in the future.");
    }

    const weighedText = cellText(at(row, "dateOfWeighing"));
    const dateOfWeighing = parseImportDate(at(row, "dateOfWeighing"));
    if (weighedText && !BLANKISH.test(weighedText) && !dateOfWeighing) {
      errors.push("Date of weighing is not a valid date (use MM/DD/YYYY).");
    }

    const weight = parseMeasure(at(row, "weight"));
    const height = parseMeasure(at(row, "height"));
    const problem = learnerProblem({ name, period: "Baseline", weight, height });
    if (problem) errors.push(problem);

    if (errors.length > 0) {
      issues.push({ rowNumber, name, message: errors.join(" ") });
      continue;
    }

    const computedAge = computeAge(dateOfBirth);
    const sheetAge = parseAge(at(row, "age"));
    const ageYears = computedAge.years || sheetAge.years;
    const ageMonths = computedAge.years ? computedAge.months : sheetAge.months;

    const bmi = calcBMI(weight, height);
    const bmiStatus = normalizeBmiStatus(at(row, "bmiStatus")) ||
      classifyBMI(bmi, ageYears, sex);
    const hfaStatus = normalizeHfaStatus(at(row, "hfaStatus")) ||
      classifyHFA(height, ageYears, sex);
    const classification = normalizeClassification(at(row, "classification")) ||
      classifyBeneficiary(grade, bmiStatus, hfaStatus);
    const pregnant = mustNotBePregnant(sex) ? "No" : parseYesNo(at(row, "pregnant"));

    rows.push({
      rowNumber,
      student: {
        name,
        sex,
        gradeLevel: grade,
        dateOfBirth,
        dateOfWeighing,
        ageYears,
        ageMonths,
        weight,
        height,
        bmi,
        bmiStatus,
        hfaStatus,
        nutritionalStatus: bmiStatus,
        classificationOfBeneficiary: classification,
        pregnant,
        hasYoungChildren: parseYesNo(at(row, "youngChildren")),
        dewormed: parseYesNo(at(row, "dewormed")),
        parentConsentMilk: parseYesNo(at(row, "milkConsent")),
        fourPs: parseYesNo(at(row, "fourPs")),
        sbfpPreviousYears: parseYesNo(at(row, "previousYears")),
      },
    });
  }

  if (rows.length === 0 && issues.length === 0) {
    issues.push({
      rowNumber: rowIndex + 2,
      name: "",
      message: "No learner rows were found below the header row.",
    });
  }

  return {
    sheetName: grid.sheetName,
    headerRow: rowIndex + 1,
    detectedPeriod: detectPeriod(grid.cells, rowIndex),
    rows,
    issues,
  };
}
