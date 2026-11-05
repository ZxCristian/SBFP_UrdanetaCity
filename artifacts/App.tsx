import { useState, useMemo, createContext, useContext, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
type GradeLevel =
  |"Kinder"|"Grade 1"|"Grade 2"|"Grade 3"|"Grade 4"|"Grade 5"|"Grade 6"
  |"Grade 7"|"Grade 8"|"Grade 9"|"Grade 10"|"Grade 11"|"Grade 12"
  |"SPED"|"SPED Kinder"|"SPED Grade 1"|"SPED Grade 2"|"SPED Grade 3"|"SPED Grade 4"|"SPED Grade 5"|"SPED Grade 6";
type Sex = "M"|"F";
type Period = "Baseline"|"Midline"|"Endline";
type SchoolType = "Elementary"|"High School";
type BMIStatus = "Severely Wasted"|"Wasted"|"Normal"|"Overweight"|"Obese"|"";
type HFAStatus = "Severely Stunted"|"Stunted"|"Normal"|"Tall"|"";
type YesNo = "Yes"|"No"|"";
type View = "district"|"schools"|"dashboard"|"records"|"entry"|"table"|"analytics";

interface School { id: string; name: string; type: SchoolType; }
interface Student {
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

// ── Theme ──────────────────────────────────────────────────────────────────────
interface TC {
  bg: string; surface: string; surface2: string; surfaceDeep: string;
  hover: string; border: string; text: string; sub: string; dim: string; faint: string;
  accent: string; accentBg: string; accentText: string;
  danger: string; warning: string; grandBg: string; isDark: boolean;
}
const DARK: TC = {
  bg:"#080808", surface:"#111111", surface2:"#161616", surfaceDeep:"#0d0d0d",
  hover:"#161616", border:"#1e1e1e", text:"#e2e2e2", sub:"#888", dim:"#555", faint:"#2a2a2a",
  accent:"#00ff87", accentBg:"#00ff8720", accentText:"#000", danger:"#ff4b4b", warning:"#ff9f4b",
  grandBg:"#0a1a10", isDark:true,
};
const LIGHT: TC = {
  bg:"#f2f2ee", surface:"#ffffff", surface2:"#f0f0ec", surfaceDeep:"#e8e8e4",
  hover:"#ebebea", border:"#ddddd8", text:"#1a1a1a", sub:"#666", dim:"#999", faint:"#bbb",
  accent:"#00a855", accentBg:"#00a85515", accentText:"#fff", danger:"#cc3333", warning:"#cc6600",
  grandBg:"#e8f5ee", isDark:false,
};
const ThemeCtx = createContext<TC>(DARK);
const useT = () => useContext(ThemeCtx);

// ── Schools (initial constants) ────────────────────────────────────────────────
const INIT_ES: School[] = [
  "Anonas East Elementary School",
  "Anonas Elementary School",
  "Bactad East Elementary School",
  "Bactad Community School",
  "Badipa Elementary School",
  "Bolaoen Elementary School",
  "Cabaruan Elementary School",
  "Cabuloan Elementary School",
  "Calegu Integrated School",
  "Camanang Elementary School",
  "Camantiles Elementary School",
  "Casabula Elementary School",
  "Catablan Integrated School",
  "Cayambanan Elementary School",
  "Consolacion Elementary School",
  "DAFSIS",
  "DAPSMECS East",
  "DAPSMECS Main",
  "DAPSMECS West",
  "Don A. Maiquez Memorial Elementary School",
  "Don C. Blanco Elementary School",
  "DF Maramba Elementary School",
  "Don V. Ordoñez Memorial School",
  "F. B. Goce Community School",
  "Labit East Elementary School",
  "Labit West Elementary School",
  "Lananpin Elementary School",
  "Lazaga Elementary School",
  "Manan Elementary School",
  "Nanbacuran Elementary School",
  "Nancalobasaan Elementary School",
  "Nancalobasaan RIS",
  "Nancayasan Elementary School",
  "Oltama Elementary School",
  "Palina East Elementary School",
  "Pinmaludpod Elementary School",
  "San Jose Elementary School",
  "San Jose Leet Integrated School",
  "Sta. Lucia Elementary School",
  "Tabuyoc Elementary School",
  "Tiposu Elementary School",
  "Trinidad S. Perez Elementary School",
  "Tulong Integrated School",
  "Urdaneta 1 Central School",
  "Vicente Taaca Memorial School",
].map((name, i) => ({ id:`es${String(i+1).padStart(2,"0")}`, name, type:"Elementary" as SchoolType }));

const INIT_HS: School[] = [
  "Anonas National High School",
  "Bactad East National High School",
  "Badipa National High School",
  "Cabaruan National High School",
  "Cabuloan National High School",
  "Camantiles National High School",
  "Catablan Integrated School",
  "Labit National High School",
  "Lananpin National High School",
  "MQ Umipig National High School",
  "Palina East National High School",
  "PT Orata National High School",
  "Urdaneta City National High School",
].map((name, i) => ({ id:`hs${String(i+1).padStart(2,"0")}`, name, type:"High School" as SchoolType }));

// ── Constants ──────────────────────────────────────────────────────────────────
const ES_GRADES: GradeLevel[] = ["Kinder","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6"];
const ES_GRADES_WITH_SPED: GradeLevel[] = [
  "Kinder","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6",
  "SPED Kinder","SPED Grade 1","SPED Grade 2","SPED Grade 3","SPED Grade 4","SPED Grade 5","SPED Grade 6",
];
const HS_GRADES: GradeLevel[] = ["Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"];
const PERIODS: Period[] = ["Baseline","Midline","Endline"];
const PC: Record<Period,string> = { Baseline:"#00c9ff", Midline:"#ff9f4b", Endline:"#00ff87" };
const BMI_STATUSES: BMIStatus[] = ["Severely Wasted","Wasted","Normal","Overweight","Obese"];
const HFA_STATUSES: HFAStatus[] = ["Severely Stunted","Stunted","Normal","Tall"];
const BMI_C: Record<string,string> = { "Severely Wasted":"#ff4b4b","Wasted":"#ff9f4b","Normal":"#00ff87","Overweight":"#ffdd4b","Obese":"#ff6b9d" };
const HFA_C: Record<string,string> = { "Severely Stunted":"#ff4b4b","Stunted":"#ff9f4b","Normal":"#00ff87","Tall":"#00c9ff" };

const getSchool = (schools: School[], id: string) => schools.find(s => s.id === id);
const SPED_SCHOOL_NAME = "Urdaneta 1 Central School";
const getGrades = (school: School|undefined): GradeLevel[] => {
  if (!school) return ES_GRADES;
  if (school.type === "High School") return HS_GRADES;
  // Only Urdaneta 1 Central School offers SPED Kinder–Grade 6
  if (school.name === SPED_SCHOOL_NAME) return ES_GRADES_WITH_SPED;
  return ES_GRADES;
};

/** Unique person key (same student across Baseline/Midline/Endline) */
const studentKey = (s: { name: string; dateOfBirth: string; sex: string; schoolId?: string }) =>
  `${s.schoolId ?? ""}|${s.name}|${s.dateOfBirth}|${s.sex}`;

/** Count unique students (not period records) */
const uniqueCount = (list: Student[]) => new Set(list.map(studentKey)).size;

/** One record per student, preferring Endline → Midline → Baseline (for accurate counts) */
function uniqueStudents(list: Student[]): Student[] {
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
 *  - Grades 2–12: Primary = Severely Wasted, Secondary = Severely Stunted
 */
function classifyBeneficiary(grade: string, bmiStatus: string, hfaStatus: string): "Primary"|"Secondary"|"" {
  // Kinder / Grade 1 (regular or SPED) → always Primary
  if (grade === "Kinder" || grade === "Grade 1" || grade === "SPED Kinder" || grade === "SPED Grade 1") return "Primary";
  // SPED Grade 2–6 follow same severe rules as regular G2–6
  const normalized = grade.replace(/^SPED /, "") as GradeLevel;
  if (!BENEFICIARY_GRADES.includes(normalized) && !BENEFICIARY_GRADES.includes(grade as GradeLevel)) return "";
  if (bmiStatus === "Severely Wasted") return "Primary";
  if (hfaStatus === "Severely Stunted") return "Secondary";
  return "";
}

/** Format date YYYY-MM-DD → MM/DD/YYYY for SBFP form */
function formatDateMDY(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function strToUint8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** CRC32 for ZIP */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build an uncompressed ZIP from name→bytes map */
function buildZip(files: Record<string, Uint8Array>): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  };
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };
  const concat = (arrs: Uint8Array[]) => {
    const len = arrs.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  };

  for (const [name, data] of Object.entries(files)) {
    const nameBytes = strToUint8(name);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20), u16(0), u16(0),
      u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0),
      nameBytes, data,
    ]);
    parts.push(local);
    const cen = concat([
      u32(0x02014b50),
      u16(20), u16(20), u16(0), u16(0),
      u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset),
      nameBytes,
    ]);
    central.push(cen);
    offset += local.length;
  }
  const centralDir = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(Object.keys(files).length), u16(Object.keys(files).length),
    u32(centralDir.length), u32(offset), u16(0),
  ]);
  return new Blob([concat([...parts, centralDir, end])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function xmlEsc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Export SBFP Form 1A as .xlsx (no embedded images — add logos manually in Excel if needed)
 * Page: 8.5" × 13" (Folio) landscape, L/R margin 0, T/B 0.5", center horizontal
 */
function exportStudentsToExcel(school: School, rows: Student[], periodLabel: string) {
  const titlePeriod = periodLabel === "All" ? "ALL PERIODS" : periodLabel.toUpperCase();

  const colWidths = [4, 22, 6, 14, 14, 14, 12, 10, 10, 12, 14, 12, 16, 12, 14, 12, 14, 12, 16];
  const colsXml = colWidths.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  const merges = [
    "A12:A13","B12:B13","C12:C13","D12:D13","E12:E13","F12:F13","G12:G13",
    "H12:H13","I12:I13","J12:J13","K12:L12",
    "M12:M13","N12:N13","O12:O13","P12:P13","Q12:Q13","R12:R13","S12:S13",
    "A3:S3","A5:S5",
  ];
  const mergeXml = merges.map(m => `<mergeCell ref="${m}"/>`).join("");

  const cell = (ref: string, value: string | number, style = 0) => {
    if (value === "" || value === undefined || value === null) {
      return `<c r="${ref}" s="${style}"/>`;
    }
    if (typeof value === "number" && !Number.isNaN(value)) {
      return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEsc(String(value))}</t></is></c>`;
  };

  const headersR12: [string, string][] = [
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
  const headersR13: [string, string][] = [["K13", "BMI-A"], ["L13", "HFA"]];

  let sheetRows = "";
  sheetRows += `<row r="1" ht="18" customHeight="1">${cell("A1", "SBFP Form 1A (2026)", 1)}</row>`;
  sheetRows += `<row r="2" ht="8" customHeight="1"/>`;
  sheetRows += `<row r="3" ht="28" customHeight="1">${cell("A3", "Department of Education", 2)}</row>`;
  sheetRows += `<row r="4" ht="8" customHeight="1"/>`;
  sheetRows += `<row r="5" ht="20" customHeight="1">${cell("A5", `Master List of Beneficiaries for School-Based Feeding Program (SBFP) | SY 2025-2026 — ${titlePeriod}`, 2)}</row>`;
  sheetRows += `<row r="6" ht="8" customHeight="1"/>`;
  sheetRows += `<row r="7">${cell("A7", "Division: Urdaneta City", 3)}${cell("G7", "Name of Principal: _______________________________", 3)}</row>`;
  sheetRows += `<row r="8">${cell("A8", "City/Municipality/Barangay: _______________________", 3)}${cell("G8", "Name of Feeding Focal Person: ____________________", 3)}</row>`;
  sheetRows += `<row r="9">${cell("A9", `Name of School / School District : ${school.name}`, 3)}</row>`;
  sheetRows += `<row r="10">${cell("A10", `School Type: ${school.type}`, 3)}</row>`;
  sheetRows += `<row r="11">${cell("A11", "School ID Number: _______________", 3)}</row>`;
  sheetRows += `<row r="12" ht="30" customHeight="1">${headersR12.map(([r, v]) => cell(r, v, 4)).join("")}</row>`;
  sheetRows += `<row r="13" ht="22" customHeight="1">${headersR13.map(([r, v]) => cell(r, v, 4)).join("")}</row>`;

  rows.forEach((s, i) => {
    const r = 14 + i;
    const age = s.ageYears || s.ageMonths ? `${s.ageYears || "0"}/${s.ageMonths || "0"}` : "";
    const vals: (string | number)[] = [
      i + 1, s.name || "", s.sex || "", s.gradeLevel || "",
      formatDateMDY(s.dateOfBirth), formatDateMDY(s.dateOfWeighing), age,
      s.weight ? parseFloat(s.weight) : "",
      s.height ? parseFloat(s.height) : "",
      s.bmi ? parseFloat(s.bmi) : "",
      s.bmiStatus || s.nutritionalStatus || "", s.hfaStatus || "",
      s.classificationOfBeneficiary || "", s.pregnant || "", s.hasYoungChildren || "",
      s.dewormed || "", s.parentConsentMilk || "", s.fourPs || "", s.sbfpPreviousYears || "",
    ];
    const letters = "ABCDEFGHIJKLMNOPQRS";
    sheetRows += `<row r="${r}">${vals.map((v, ci) => cell(`${letters[ci]}${r}`, v, 5)).join("")}</row>`;
  });

  const lastData = 13 + rows.length;
  const signRow = lastData + 2;
  sheetRows += `<row r="${lastData + 1}"/>`;
  sheetRows += `<row r="${signRow}">${cell(`B${signRow}`, "Approve by:", 3)}</row>`;
  sheetRows += `<row r="${signRow + 1}"/>`;
  sheetRows += `<row r="${signRow + 2}">${cell(`B${signRow + 2}`, "________________________", 1)}</row>`;
  sheetRows += `<row r="${signRow + 3}">${cell(`B${signRow + 3}`, "School Head", 1)}</row>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:S${signRow + 3}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetRows}</sheetData>
  <mergeCells count="${merges.length}">${mergeXml}</mergeCells>
  <pageMargins left="0" right="0" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
  <pageSetup paperSize="14" orientation="landscape" horizontalCentered="1" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><name val="Calibri"/></font>
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="8"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color auto="1"/></left>
      <right style="thin"><color auto="1"/></right>
      <top style="thin"><color auto="1"/></top>
      <bottom style="thin"><color auto="1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="6">
    <xf fontId="0" fillId="0" borderId="0"/>
    <xf fontId="1" fillId="0" borderId="0"/>
    <xf fontId="2" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf fontId="3" fillId="0" borderId="0"/>
    <xf fontId="4" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="SBFP Master List" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToUint8(contentTypes),
    "_rels/.rels": strToUint8(rels),
    "xl/workbook.xml": strToUint8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToUint8(wbRels),
    "xl/worksheets/sheet1.xml": strToUint8(sheetXml),
    "xl/styles.xml": strToUint8(stylesXml),
  };

  const blob = buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = school.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  const safePeriod = periodLabel.replace(/\s+/g, "_");
  a.href = url;
  a.download = `SBFP_Form_1A_${safeName}_${safePeriod}_SY2025-2026.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── WHO 2007 Reference Tables ──────────────────────────────────────────────────
// BMI-for-age [median, SD] age 5–19 (index 0 = age 5)
const WHO_BMI_M: [number,number][] = [[15.3,1.0],[15.3,1.1],[15.5,1.2],[15.8,1.4],[16.3,1.6],[16.8,1.9],[17.5,2.2],[18.2,2.5],[19.0,2.8],[19.8,3.0],[20.5,3.1],[21.1,3.2],[21.6,3.3],[22.0,3.4],[22.3,3.4]];
const WHO_BMI_F: [number,number][] = [[15.3,1.0],[15.3,1.1],[15.5,1.3],[16.0,1.6],[16.6,1.9],[17.3,2.2],[18.0,2.6],[18.7,2.9],[19.4,3.1],[19.9,3.2],[20.4,3.3],[20.8,3.3],[21.1,3.3],[21.3,3.4],[21.4,3.4]];
// HFA [median cm, SD] age 5–19
const WHO_HFA_M: [number,number][] = [[110.0,4.3],[116.0,4.5],[121.7,4.8],[127.3,5.1],[132.6,5.4],[137.8,5.8],[143.5,6.4],[149.8,7.2],[156.4,7.8],[162.6,7.8],[167.0,7.3],[170.0,6.9],[171.6,6.7],[172.4,6.6],[173.0,6.6]];
const WHO_HFA_F: [number,number][] = [[109.4,4.2],[115.1,4.5],[120.8,4.8],[126.3,5.2],[131.5,5.6],[136.8,5.9],[142.5,6.0],[147.6,6.0],[151.4,5.9],[153.7,5.8],[154.9,5.8],[155.6,5.7],[156.0,5.7],[156.3,5.7],[156.4,5.7]];

// ── Helper Functions ───────────────────────────────────────────────────────────
function calcBMI(w: string, h: string): string {
  const wn = parseFloat(w), hn = parseFloat(h) / 100;
  if (!wn || !hn || hn <= 0) return "";
  return (wn / (hn * hn)).toFixed(2);
}
function computeAge(dob: string): { years: string; months: string } {
  if (!dob) return { years:"", months:"" };
  const birth = new Date(dob), today = new Date();
  if (isNaN(birth.getTime()) || birth > today) return { years:"", months:"" };
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years: String(years), months: String(months) };
}
function classifyBMI(bmi: string, ageYears: string, sex: string): BMIStatus {
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
function classifyHFA(height: string, ageYears: string, sex: string): HFAStatus {
  const h = parseFloat(height), age = parseInt(ageYears);
  if (!h || !age || age < 5 || age > 19 || (sex !== "M" && sex !== "F")) return "";
  const [med, sd] = (sex === "M" ? WHO_HFA_M : WHO_HFA_F)[Math.min(age - 5, 14)];
  const z = (h - med) / sd;
  if (z < -3) return "Severely Stunted";
  if (z < -2) return "Stunted";
  if (z <= 2) return "Normal";
  return "Tall";
}

// ── Seed Data ──────────────────────────────────────────────────────────────────
const EMPTY_STUDENT = (schoolId: string, period: Period|"" = ""): Omit<Student,"id"> => ({
  schoolId, period: (period || "") as Period, sy:"2025-2026", name:"", sex:"", gradeLevel: "",
  dateOfBirth:"", dateOfWeighing:"", ageYears:"", ageMonths:"",
  weight:"", height:"", bmi:"", bmiStatus:"", hfaStatus:"",
  nutritionalStatus:"", classificationOfBeneficiary:"",
  pregnant:"", hasYoungChildren:"", dewormed:"", parentConsentMilk:"", fourPs:"", sbfpPreviousYears:"",
});
const FIRST_NAMES_M = ["Juan","Pedro","Miguel","Jose","Carlos","Antonio","Rafael","Luis","Gabriel","Andres","Mark","John","Daniel","James","Joshua","Alden","Coco","Xian","Enrique","Matteo","Diego","Paolo","Nico","Marco","Lorenzo","Francis","Christian","Ryan","Kevin","Jared"];
const FIRST_NAMES_F = ["Maria","Ana","Sofia","Liza","Chloe","Bea","Nadine","Kathryn","Angel","Marian","Julia","Anne","Kim","Maine","Sarah","Isabella","Camila","Elena","Andrea","Patricia","Angela","Christine","Nicole","Bianca","Katrina","Jasmine","Michelle","Amanda","Rosa","Carmen"];
const LAST_NAMES = ["Santos","dela Cruz","Reyes","Bautista","Garcia","Cruz","Mendoza","Gonzales","Villanueva","Perez","Alonzo","Padilla","Lustre","Reid","Bernardo","Gil","Locsin","Dantes","Rivera","Martin","Barretto","Garcia","Curtis","Navarro","Chiu","Lim","Mendoza","Richards","Geronimo","Guidicelli","Torres","Ramos","Flores","Castillo","Aquino","Lopez","Diaz","Hernandez","Morales","Santiago"];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function generateSeed(schools: School[]): Student[] {
  const students: Student[] = [];
  let idCounter = 1;
  const yesNo = (rnd: () => number, pYes = 0.7): YesNo => (rnd() < pYes ? "Yes" : "No");

  // Weighing dates per period (same school year)
  const weighingDates: Record<Period, string> = {
    Baseline: "2025-09-15",
    Midline: "2026-01-20",
    Endline: "2026-05-15",
  };

  for (const school of schools) {
    const grades = getGrades(school);
    const isHS = school.type === "High School";
    // 50–60 unique students per school (each appears in all 3 periods → 150–180 records)
    const cohortSize = 50 + Math.floor(seededRandom(school.id.charCodeAt(0) + school.id.charCodeAt(2))() * 11);
    const rnd = seededRandom(school.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0));

    for (let i = 0; i < cohortSize; i++) {
      const sex: Sex = rnd() < 0.5 ? "M" : "F";
      const grade = grades[Math.floor(rnd() * grades.length)];
      const first = sex === "M" ? pick(FIRST_NAMES_M, rnd) : pick(FIRST_NAMES_F, rnd);
      const last = pick(LAST_NAMES, rnd);
      const name = `${first} ${last}`;

      // Age roughly matching grade (at Baseline); SPED maps to same ages as regular grades
      const gradeForAge = grade.replace(/^SPED /, "");
      const baseAge = isHS
        ? (gradeForAge === "Grade 7" ? 12 : gradeForAge === "Grade 8" ? 13 : gradeForAge === "Grade 9" ? 14 : gradeForAge === "Grade 10" ? 15 : gradeForAge === "Grade 11" ? 16 : 17)
        : (gradeForAge === "Kinder" ? 5 : gradeForAge === "Grade 1" ? 6 : gradeForAge === "Grade 2" ? 7 : gradeForAge === "Grade 3" ? 8 : gradeForAge === "Grade 4" ? 9 : gradeForAge === "Grade 5" ? 10 : gradeForAge === "Grade 6" ? 11 : 8);
      const ageYearsBase = Math.max(5, Math.min(18, baseAge + Math.floor(rnd() * 3) - 1));
      const ageMonthsBase = Math.floor(rnd() * 12);

      const dobYear = 2025 - ageYearsBase - (ageMonthsBase > 8 ? 1 : 0);
      const dobMonth = String(Math.floor(rnd() * 12) + 1).padStart(2, "0");
      const dobDay = String(Math.floor(rnd() * 28) + 1).padStart(2, "0");
      const dateOfBirth = `${dobYear}-${dobMonth}-${dobDay}`;

      const pregnant: YesNo = sex === "F" && ageYearsBase >= 15 && rnd() < 0.05 ? "Yes" : "No";
      const hasYoungChildren: YesNo = sex === "F" && ageYearsBase >= 16 && rnd() < 0.08 ? "Yes" : "No";
      const dewormed = yesNo(rnd, 0.82);
      const parentConsentMilk = yesNo(rnd, 0.88);
      const fourPs = yesNo(rnd, 0.55);
      const sbfpPreviousYears = yesNo(rnd, 0.48);

      // Baseline z-scores
      // Grade 2–6: only Severely Wasted and/or Severely Stunted (program focus)
      const isGrade2to6 = ["Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "SPED Grade 2", "SPED Grade 3", "SPED Grade 4", "SPED Grade 5", "SPED Grade 6"].includes(grade);
      let zBmi: number;
      let zHfa: number;
      if (isGrade2to6) {
        // Force severe undernutrition: Severely Wasted, Severely Stunted, or both
        const mode = rnd();
        if (mode < 0.4) {
          // Severely Wasted only
          zBmi = -3.8 + rnd() * 0.75; // z < -3
          zHfa = -1.5 + rnd() * 2.5;
        } else if (mode < 0.75) {
          // Severely Stunted only
          zBmi = -1.2 + rnd() * 2.0;
          zHfa = -3.7 + rnd() * 0.65; // z < -3
        } else {
          // Both severe
          zBmi = -3.8 + rnd() * 0.75;
          zHfa = -3.7 + rnd() * 0.65;
        }
      } else {
        // Other grades: mixed distribution
        zBmi = rnd() < 0.14 ? -3.1 + rnd() * 0.9 : rnd() < 0.28 ? -2.4 + rnd() * 0.9 : rnd() < 0.72 ? -0.4 + rnd() * 1.4 : 0.7 + rnd() * 1.6;
        zHfa = rnd() < 0.12 ? -3.0 + rnd() * 0.8 : rnd() < 0.25 ? -2.3 + rnd() * 0.8 : rnd() < 0.85 ? -0.2 + rnd() * 1.5 : 1.1 + rnd() * 1.4;
      }

      // Trajectory: Grade 2–6 improve slowly (often remain severe); others improve more
      const bmiImprove = isGrade2to6
        ? (rnd() < 0.5 ? 0.08 + rnd() * 0.2 : 0)
        : (rnd() < 0.65 ? 0.25 + rnd() * 0.55 : rnd() < 0.85 ? 0 : -(0.1 + rnd() * 0.3));
      const hfaImprove = isGrade2to6
        ? (rnd() < 0.45 ? 0.05 + rnd() * 0.15 : 0)
        : (rnd() < 0.55 ? 0.15 + rnd() * 0.4 : rnd() < 0.8 ? 0 : -(0.05 + rnd() * 0.2));

      PERIODS.forEach((period, pIdx) => {
        // Age increases slightly across periods within the same SY
        const ageYears = Math.min(19, ageYearsBase + (pIdx === 2 ? 1 : 0));
        const ageMonths = pIdx === 0 ? ageMonthsBase : pIdx === 1 ? Math.min(11, ageMonthsBase + 4) : Math.min(11, ageMonthsBase + 8);

        const zB = zBmi + bmiImprove * pIdx;
        const zH = zHfa + hfaImprove * pIdx;
        const [medBmi, sdBmi] = (sex === "M" ? WHO_BMI_M : WHO_BMI_F)[Math.min(ageYears - 5, 14)] || [16, 2];
        const [medHfa, sdHfa] = (sex === "M" ? WHO_HFA_M : WHO_HFA_F)[Math.min(ageYears - 5, 14)] || [130, 6];
        const bmiVal = medBmi + zB * sdBmi;
        const heightVal = medHfa + zH * sdHfa;
        const weightVal = bmiVal * (heightVal / 100) ** 2;

        const bmi = Math.max(10, bmiVal).toFixed(2);
        const height = Math.max(90, heightVal).toFixed(1);
        const weight = Math.max(12, weightVal).toFixed(1);
        const bmiStatus = classifyBMI(bmi, String(ageYears), sex) || "Normal";
        const hfaStatus = classifyHFA(height, String(ageYears), sex) || "Normal";
        const nutritionalStatus = bmiStatus === "Normal"
          ? (hfaStatus.includes("Stunted") ? hfaStatus : "Normal")
          : bmiStatus;
        // Primary = Severely Wasted, Secondary = Severely Stunted (Grades 2–12)
        const classificationOfBeneficiary = classifyBeneficiary(grade, bmiStatus, hfaStatus);

        students.push({
          id: `s${String(idCounter++).padStart(5, "0")}`,
          schoolId: school.id,
          period,
          sy: "2025-2026",
          name,
          sex,
          gradeLevel: grade,
          dateOfBirth,
          dateOfWeighing: weighingDates[period],
          ageYears: String(ageYears),
          ageMonths: String(ageMonths),
          weight,
          height,
          bmi,
          bmiStatus,
          hfaStatus,
          nutritionalStatus,
          classificationOfBeneficiary,
          pregnant,
          hasYoungChildren,
          dewormed,
          parentConsentMilk,
          fourPs,
          sbfpPreviousYears,
        });
      });
    }
  }
  return students;
}

const SEED: Student[] = generateSeed([...INIT_ES, ...INIT_HS]);

// ── Shared UI Primitives ───────────────────────────────────────────────────────
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

function YesNoToggle({ value, onChange, t }: { value:YesNo; onChange:(v:YesNo)=>void; t:TC }) {
  return (
    <div className="flex gap-1">
      {(["Yes","No"] as YesNo[]).map(v => (
        <button key={v} onClick={() => onChange(v)} className="flex-1 py-2 text-xs rounded-sm cursor-pointer border transition-colors"
          style={value===v ? { background:v==="Yes"?t.accentBg:"#cc333315", color:v==="Yes"?t.accent:t.danger, borderColor:v==="Yes"?t.accent+"40":t.danger+"40" } : { background:t.surface2, color:t.dim, borderColor:t.border }}>
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
function Sidebar({ view, setView, selectedSchool, setSelectedSchool, themeMode, toggleTheme, schools }: {
  view:View; setView:(v:View)=>void; selectedSchool:School|null; setSelectedSchool:(s:School|null)=>void;
  themeMode:"dark"|"light"; toggleTheme:()=>void; schools:School[];
}) {
  const t = useT();
  const nav: { id:View; label:string; icon:string; requiresSchool?:boolean }[] = [
    { id:"district", label:"District Dashboard", icon:"◎" },
    { id:"schools", label:"All Schools", icon:"◉" },
    { id:"dashboard", label:"Dashboard", icon:"▦", requiresSchool:true },
    { id:"records", label:"Student Records", icon:"☰", requiresSchool:true },
    { id:"entry", label:"Data Entry", icon:"✎", requiresSchool:true },
    { id:"table", label:"Summary Table", icon:"≡", requiresSchool:true },
    { id:"analytics", label:"Analytics", icon:"↗", requiresSchool:true },
  ];
  return (
    <aside style={{ borderRight:`1px solid ${t.border}`, background:t.surface }} className="w-56 flex-shrink-0 flex flex-col h-full">
      <div className="px-5 py-5" style={{ borderBottom:`1px solid ${t.border}` }}>
        <div className="flex items-center gap-2.5 mb-0.5">
          <div className="w-6 h-6 rounded-sm flex items-center justify-center" style={{ background:t.accent }}>
            <span className="text-[9px] font-bold" style={{ color:t.accentText }}>DEP</span>
          </div>
          <span className="text-sm font-semibold" style={{ color:t.text }}>Health Monitor</span>
        </div>
        <div className="text-[10px] pl-8" style={{ color:t.dim }}>District Data System</div>
      </div>

      {selectedSchool && (
        <div className="mx-3 mt-3 p-3 rounded-sm" style={{ border:`1px solid ${t.border}`, background:t.surface2 }}>
          <div className="text-[8px] tracking-widest uppercase mb-1" style={{ color:t.dim }}>Selected School</div>
          <div className="text-[11px] leading-snug font-medium" style={{ color:t.text }}>{selectedSchool.name}</div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <Pill label={selectedSchool.type==="Elementary"?"ES":"HS"} color={selectedSchool.type==="Elementary"?"#00c9ff":"#b8ff4f"} />
            <button onClick={() => { setSelectedSchool(null); setView("schools"); }} className="text-[9px] cursor-pointer ml-auto transition-colors" style={{ color:t.dim }}
              onMouseEnter={e=>(e.currentTarget.style.color=t.sub)} onMouseLeave={e=>(e.currentTarget.style.color=t.dim)}>✕ clear</button>
          </div>
        </div>
      )}

      <nav className="flex-1 p-3 flex flex-col gap-0.5 mt-1">
        {nav.map(item => {
          const disabled = !!(item.requiresSchool && !selectedSchool);
          const active = view === item.id;
          return (
            <button key={item.id} onClick={() => !disabled && setView(item.id)} disabled={disabled}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-left text-sm transition-all"
              style={{ color: disabled ? t.faint : active ? t.accent : t.dim, background: active ? t.accentBg : "transparent", cursor: disabled ? "not-allowed" : "pointer" }}
              onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.color = t.sub; }}
              onMouseLeave={e => { if (!disabled && !active) e.currentTarget.style.color = t.dim; }}>
              <span className="w-4 text-center text-base">{item.icon}</span>{item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4" style={{ borderTop:`1px solid ${t.border}` }}>
        <button onClick={toggleTheme} className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-xs cursor-pointer transition-all mb-3"
          style={{ border:`1px solid ${t.border}`, background:t.surface2, color:t.sub }}>
          <span>{themeMode === "dark" ? "☀" : "☾"}</span>
          {themeMode === "dark" ? "Day Mode" : "Night Mode"}
        </button>
        <div className="text-[10px] leading-relaxed" style={{ color:t.faint }}>
          {schools.filter(s=>s.type==="Elementary").length} ES · {schools.filter(s=>s.type==="High School").length} HS<br />SY 2025–2026
        </div>
      </div>
    </aside>
  );
}

// ── District Dashboard ────────────────────────────────────────────────────────
function DistrictDashboard({ students, schools }: { students:Student[]; schools:School[] }) {
  const t = useT();
  const [tab, setTab] = useState<"All"|"Elementary"|"High School">("All");

  const esIds = useMemo(() => new Set(schools.filter(s=>s.type==="Elementary").map(s=>s.id)), [schools]);
  const hsIds = useMemo(() => new Set(schools.filter(s=>s.type==="High School").map(s=>s.id)), [schools]);

  const filtered = useMemo(() => tab==="All" ? students : students.filter(s => tab==="Elementary" ? esIds.has(s.schoolId) : hsIds.has(s.schoolId)), [students, tab, esIds, hsIds]);
  // One row per student (prefer Endline) so totals are not tripled by period records
  const uniqueFiltered = useMemo(() => uniqueStudents(filtered), [filtered]);

  const bmiDist = BMI_STATUSES.map(st => ({ label:st, val:uniqueFiltered.filter(s=>s.bmiStatus===st).length, color:BMI_C[st] }));
  const hfaDist = HFA_STATUSES.map(st => ({ label:st, val:uniqueFiltered.filter(s=>s.hfaStatus===st).length, color:HFA_C[st] }));
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>District Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>All Schools · SY 2025–2026</p>
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
                <span className="text-sm font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:PC[d.period] }}>{d.count}</span>
                <div className="w-full rounded-sm" style={{ height:`${(d.count/maxPeriod)*70}px`, minHeight:"2px", background:PC[d.period]+"70" }} />
                <span className="text-[9px]" style={{ color:PC[d.period] }}>{d.period}</span>
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
                  <Pill label={x.school.type==="Elementary"?"ES":"HS"} color={x.school.type==="Elementary"?"#00c9ff":"#b8ff4f"} />
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
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<SchoolType>("Elementary");

  const filtered = useMemo(() => schools.filter(
    s => (typeFilter==="All"||s.type===typeFilter) && s.name.toLowerCase().includes(search.toLowerCase())
  ), [schools, search, typeFilter]);

  const coverage = (id: string) => PERIODS.filter(p => students.some(s=>s.schoolId===id&&s.period===p));
  const count = (id: string) => uniqueCount(students.filter(s=>s.schoolId===id));

  const startEdit = (s: School) => { setEditingId(s.id); setEditingName(s.name); };
  const saveEdit = () => {
    if (editingName.trim()) setSchools(schools.map(s => s.id===editingId ? { ...s, name:editingName.trim() } : s));
    setEditingId(null);
  };
  const deleteSchool = (id: string) => {
    setSchools(schools.filter(s=>s.id!==id));
    setStudents(students.filter(s=>s.schoolId!==id));
  };
  const addSchool = () => {
    if (!newName.trim()) return;
    const id = `${newType==="Elementary"?"es":"hs"}${Date.now()}`;
    setSchools([...schools, { id, name:newName.trim(), type:newType }]);
    setNewName(""); setShowAdd(false);
  };

  const inp = { background:t.surface2, color:t.text, border:`1px solid ${t.border}` } as React.CSSProperties;

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
              <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color:PC[p] }}>{p}</div>
              <div className="text-xl font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:t.text }}>{n}<span className="text-sm" style={{ color:t.faint }}>/{schools.length}</span></div>
              <div className="text-[10px] mt-1" style={{ color:t.dim }}>schools with data</div>
              <Bar val={n} max={schools.length} color={PC[p]} t={t} />
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

      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom:`1px solid ${t.border}` }}>
              <th className="text-left px-4 py-3 text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>School</th>
              <th className="px-4 py-3 text-[9px] tracking-widest uppercase text-center" style={{ color:t.dim }}>Type</th>
              {PERIODS.map(p => <th key={p} className="px-4 py-3 text-[9px] tracking-widest uppercase text-center" style={{ color:PC[p]+"99" }}>{p}</th>)}
              <th className="px-4 py-3 text-[9px] tracking-widest uppercase text-center" style={{ color:t.dim }}>Students</th>
              <th className="px-4 py-3 w-32" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(school => {
              const cov = coverage(school.id);
              const n = count(school.id);
              const isEditing = editingId === school.id;
              return (
                <tr key={school.id} className="group transition-colors" style={{ borderBottom:`1px solid ${t.border}` }}
                  onMouseEnter={e=>(e.currentTarget.style.background=t.hover)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  <td className="px-4 py-2.5 font-medium">
                    {isEditing
                      ? <input value={editingName} onChange={e=>setEditingName(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter")saveEdit(); if(e.key==="Escape"){setEditingId(null);} }}
                          autoFocus className="text-sm px-2 py-1 rounded-sm outline-none w-full" style={{ ...inp }} />
                      : <span style={{ color:t.text }}>{school.name}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Pill label={school.type==="Elementary"?"ES":"HS"} color={school.type==="Elementary"?"#00c9ff":"#b8ff4f"} />
                  </td>
                  {PERIODS.map(p => (
                    <td key={p} className="px-4 py-2.5 text-center">
                      {cov.includes(p) ? <span style={{ color:PC[p] }}>✓</span> : <span style={{ color:t.faint }}>—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center text-xs" style={{ fontFamily:"'JetBrains Mono',monospace", color:n>0?t.sub:t.faint }}>{n}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {isEditing
                        ? <>
                            <button onClick={saveEdit} className="text-xs cursor-pointer font-semibold" style={{ color:t.accent }}>Save</button>
                            <button onClick={() => setEditingId(null)} className="text-xs cursor-pointer" style={{ color:t.dim }}>Cancel</button>
                          </>
                        : <>
                            <button onClick={() => onSelect(school)} className="text-xs px-2 py-1 rounded-sm cursor-pointer border" style={{ background:t.accentBg, color:t.accent, borderColor:t.accent+"30" }}>Open →</button>
                            <button onClick={() => startEdit(school)} className="text-xs cursor-pointer" style={{ color:t.sub }}>✏</button>
                            <button onClick={() => deleteSchool(school.id)} className="text-xs cursor-pointer transition-colors" style={{ color:t.dim }}
                              onMouseEnter={e=>(e.currentTarget.style.color=t.danger)} onMouseLeave={e=>(e.currentTarget.style.color=t.dim)}>✕</button>
                          </>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Per-School Dashboard ──────────────────────────────────────────────────────
function Dashboard({ students, school }: { students:Student[]; school:School }) {
  const t = useT();
  const [period, setPeriod] = useState<Period|"All">("All");
  const fRaw = period==="All" ? students : students.filter(s=>s.period===period);
  // Deduplicate so one student is counted once (prefer Endline when period=All)
  const f = period==="All" ? uniqueStudents(fRaw) : fRaw;
  const bmiDist = BMI_STATUSES.map(st=>({ label:st, val:f.filter(s=>s.bmiStatus===st).length, color:BMI_C[st] }));
  const hfaDist = HFA_STATUSES.map(st=>({ label:st, val:f.filter(s=>s.hfaStatus===st).length, color:HFA_C[st] }));
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
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>{school.type} · SY 2025–2026</p>
        </div>
        <div className="flex gap-1.5">
          {(["All",...PERIODS] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
              style={period===p
                ? p==="All" ? { background:t.accentBg, color:t.accent, borderColor:t.accent+"40" } : { background:PC[p as Period]+"20", color:PC[p as Period], borderColor:PC[p as Period]+"40" }
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
function DataEntry({ students, setStudents, school, setView, editingStudent, clearEditing }: {
  students:Student[]; setStudents:(s:Student[])=>void; school:School;
  setView:(v:View)=>void; editingStudent:Student|null; clearEditing:()=>void;
}) {
  const t = useT();
  const [period, setPeriod] = useState<Period|null>(editingStudent?.period ?? null);
  const [form, setForm] = useState<Omit<Student,"id">>(() =>
    editingStudent ? { ...editingStudent } : EMPTY_STUDENT(school.id, "")
  );
  const [saved, setSaved] = useState(false);
  const [periodError, setPeriodError] = useState(false);
  const periodRef = useRef<HTMLDivElement>(null);

  // Populate form when editingStudent changes
  useEffect(() => {
    if (editingStudent) {
      setForm({ ...editingStudent });
      setPeriod(editingStudent.period);
      setPeriodError(false);
    }
  }, [editingStudent?.id]);

  const grades = getGrades(school);
  const inp: React.CSSProperties = { background:t.surface2, color:t.text, border:`1px solid ${t.border}`, fontFamily:"'Outfit',sans-serif" };
  const inpMono: React.CSSProperties = { ...inp, fontFamily:"'JetBrains Mono',monospace" };
  const cls = "w-full text-sm px-3 py-2 rounded-sm outline-none";

  const set = (key: keyof Omit<Student,"id">, val: string) => {
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

      // Auto-classify BMI only when measurements / age / sex change — NOT when editing HFA status
      const bmiInputsChanged = measuresChanged || key === "dateOfBirth" || key === "sex" || key === "ageYears";
      if (bmiInputsChanged && key !== "bmiStatus") {
        next.bmiStatus = classifyBMI(next.bmi || calcBMI(weight, height), ageY, sex) || next.bmiStatus;
      }

      // Auto-classify HFA only when height / age / sex change — NOT when editing BMI status
      const hfaInputsChanged = key === "height" || key === "dateOfBirth" || key === "sex" || key === "ageYears";
      if (hfaInputsChanged && key !== "hfaStatus") {
        next.hfaStatus = classifyHFA(height, ageY, sex) || next.hfaStatus;
      }

      // Keep nutritionalStatus in sync with BMI status
      next.nutritionalStatus = next.bmiStatus || next.nutritionalStatus;

      // Beneficiary class (Kinder/G1 = Primary; G2–12 from severe status) — still editable
      if (key !== "classificationOfBeneficiary") {
        const autoClass = classifyBeneficiary(next.gradeLevel, next.bmiStatus, next.hfaStatus);
        if (autoClass) next.classificationOfBeneficiary = autoClass;
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
      setForm(EMPTY_STUDENT(school.id, ""));
    }
  };

  const handleCancel = () => { clearEditing(); setView("records"); };

  const ageYrs = parseInt(form.ageYears) || 0;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>{editingStudent ? "Edit Student" : "Data Entry"}</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>{school.name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div ref={periodRef} className="flex gap-1.5" tabIndex={-1}
            style={periodError ? { outline: `2px solid ${t.danger}`, outlineOffset: 2, borderRadius: 4, padding: 2 } : undefined}>
            {PERIODS.map(p => (
              <button key={p} onClick={() => handlePeriodChange(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
                style={period===p ? { background:PC[p]+"20", color:PC[p], borderColor:PC[p]+"40" } : { background:t.surface, color:t.dim, borderColor:t.border }}>
                {p}
              </button>
            ))}
          </div>
          {periodError && (
            <span className="text-[10px]" style={{ color: t.danger }}>Please select Baseline, Midline, or Endline</span>
          )}
          {!period && !periodError && (
            <span className="text-[10px]" style={{ color: t.dim }}>Select a period</span>
          )}
        </div>
      </div>

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
        <div className="grid grid-cols-2 gap-3">
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
            <input type="number" step="0.1" min={0} value={form.weight} onChange={e=>set("weight",e.target.value)} placeholder="e.g. 24.5" style={inp} className={cls} />
          </Field>
          <Field t={t} label="Height (cm)">
            <input type="number" step="0.1" min={0} value={form.height} onChange={e=>set("height",e.target.value)} placeholder="e.g. 118.0" style={inp} className={cls} />
          </Field>
          <Field t={t} label={`BMI ${ageYrs>=6?"(auto)":"(6 y.o.+)"}`}>
            <input value={form.bmi} readOnly={ageYrs>=6} onChange={e=>ageYrs<6&&set("bmi",e.target.value)}
              style={{ ...inpMono, color:form.bmi?t.accent:t.dim, opacity:form.bmi?1:0.5, cursor:ageYrs>=6?"default":"text" }} className={cls} placeholder="—" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field t={t} label="BMI Status (WHO 2007 — auto, editable)">
            <div className="flex gap-2 items-center">
              <select value={form.bmiStatus} onChange={e=>set("bmiStatus",e.target.value as BMIStatus)} style={{ ...inp, cursor:"pointer", flex:1, color: form.bmiStatus ? BMI_C[form.bmiStatus] : t.dim }} className={cls}>
                <option value="">— Select —</option>
                {BMI_STATUSES.map(s=><option key={s} value={s} style={{ color:BMI_C[s] }}>{s}</option>)}
              </select>
              {form.bmiStatus && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:BMI_C[form.bmiStatus] }} />}
            </div>
          </Field>
          <Field t={t} label="HFA Status (WHO 2007 — auto, editable)">
            <div className="flex gap-2 items-center">
              <select value={form.hfaStatus} onChange={e=>set("hfaStatus",e.target.value as HFAStatus)} style={{ ...inp, cursor:"pointer", flex:1, color: form.hfaStatus ? HFA_C[form.hfaStatus] : t.dim }} className={cls}>
                <option value="">— Select —</option>
                {HFA_STATUSES.map(s=><option key={s} value={s} style={{ color:HFA_C[s] }}>{s}</option>)}
              </select>
              {form.hfaStatus && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:HFA_C[form.hfaStatus] }} />}
            </div>
          </Field>
        </div>
      </div>

      {/* Classification */}
      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="p-5 flex flex-col gap-4">
        <div className="text-[9px] tracking-widest uppercase" style={{ color:t.dim }}>Beneficiary Classification</div>
        <p className="text-[10px] -mt-2" style={{ color:t.faint }}>Kinder &amp; Grade 1 = Primary · Grades 2–12: Primary = Severely Wasted · Secondary = Severely Stunted · auto, editable</p>
        <div className="flex gap-2">
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
          ] as [string, keyof Omit<Student,"id">][]).map(([label,key]) => (
            <div key={key as string}>
              <label className="block text-[9px] tracking-widest uppercase mb-1.5" style={{ color:t.dim }}>{label}</label>
              <YesNoToggle value={form[key] as YesNo} onChange={v=>set(key,v)} t={t} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <button onClick={handleSave} className="px-6 py-2.5 text-sm font-semibold rounded-sm cursor-pointer transition-colors"
          style={{ background:t.accent, color:t.accentText }}>
          {saved ? "✓ Saved" : editingStudent ? "Update Student" : "Save Student"}
        </button>
        {editingStudent
          ? <button onClick={handleCancel} className="px-4 py-2.5 text-sm cursor-pointer rounded-sm border transition-colors" style={{ borderColor:t.border, color:t.dim, background:t.surface }}>Cancel</button>
          : <button onClick={() => { setPeriod(null); setPeriodError(false); setForm(EMPTY_STUDENT(school.id, "")); }} className="px-4 py-2.5 text-sm cursor-pointer rounded-sm border" style={{ borderColor:t.border, color:t.dim }}>Clear</button>}
        <button onClick={() => setView("records")} className="text-xs ml-auto cursor-pointer" style={{ color:t.dim }}>View all records →</button>
      </div>
    </div>
  );
}

// ── Student Records ────────────────────────────────────────────────────────────
function StudentRecords({ students, setStudents, school, setView, onEdit }: {
  students:Student[]; setStudents:(s:Student[])=>void; school:School;
  setView:(v:View)=>void; onEdit:(s:Student)=>void;
}) {
  const t = useT();
  const [period, setPeriod] = useState<Period|"All">("All");
  const [search, setSearch] = useState("");
  const periodOrder: Record<Period, number> = { Baseline: 0, Midline: 1, Endline: 2 };

  const uniqueStudentCount = useMemo(() => uniqueCount(students), [students]);

  const filtered = useMemo(() => {
    const list = students.filter(
      s => (period === "All" || s.period === period) &&
        (s.name.toLowerCase().includes(search.toLowerCase()) || s.gradeLevel.toLowerCase().includes(search.toLowerCase()))
    );
    // Group same student together and order Baseline → Midline → Endline so progress is visible
    return list.sort((a, b) => {
      const keyA = studentKey(a);
      const keyB = studentKey(b);
      if (keyA !== keyB) return keyA.localeCompare(keyB);
      return periodOrder[a.period] - periodOrder[b.period];
    });
  }, [students, period, search]);

  const del = (id: string) => setStudents(students.filter(s => s.id !== id));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: t.text }}>Student Records</h1>
          <p className="text-xs mt-0.5" style={{ color: t.dim }}>
            {school.name} · {uniqueStudentCount} students · {students.length} period records
            {period === "All" && " (each student has Baseline / Midline / Endline)"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportStudentsToExcel(school, filtered, period === "All" ? "All" : period)}
            disabled={filtered.length === 0}
            className="px-4 py-2 text-sm font-semibold rounded-sm cursor-pointer border transition-colors"
            style={{
              background: filtered.length === 0 ? t.surface2 : t.surface,
              color: filtered.length === 0 ? t.faint : t.accent,
              borderColor: filtered.length === 0 ? t.border : t.accent + "60",
              cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            ↓ Export Excel
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
              ? p === "All" ? { background: t.accentBg, color: t.accent, borderColor: t.accent + "40" } : { background: PC[p as Period] + "20", color: PC[p as Period], borderColor: PC[p as Period] + "40" }
              : { background: t.surface, color: t.dim, borderColor: t.border }}>
            {p}
          </button>
        ))}
      </div>
      <div style={{ border: `1px solid ${t.border}`, background: t.surface }} className="overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr style={{ borderBottom: `1px solid ${t.border}` }}>
              {["Name", "Grade", "Sex", "Age", "Weight", "Height", "BMI", "BMI Status", "HFA Status", "Class.", "Period", ""].map(h => (
                <th key={h} className="px-3 py-3 text-left text-[9px] tracking-widest uppercase whitespace-nowrap" style={{ color: t.dim }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, idx) => {
              const prev = filtered[idx - 1];
              const isNewStudent = !prev || studentKey(prev) !== studentKey(s);
              const isGroupEnd = !filtered[idx + 1] || studentKey(filtered[idx + 1]) !== studentKey(s);
              return (
                <tr key={s.id} className="group transition-colors"
                  style={{
                    borderBottom: `1px solid ${isGroupEnd ? t.border : t.surfaceDeep}`,
                    background: period === "All" && !isNewStudent ? t.surfaceDeep : "transparent",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = t.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = period === "All" && !isNewStudent ? t.surfaceDeep : "transparent")}>
                  <td className="px-3 py-2.5 font-medium" style={{ color: isNewStudent ? t.text : t.dim }}>
                    {isNewStudent ? (s.name || <span style={{ color: t.faint }}>—</span>) : <span style={{ color: t.faint, paddingLeft: 8 }}>↳</span>}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: t.sub }}>{isNewStudent ? s.gradeLevel : ""}</td>
                  <td className="px-3 py-2.5" style={{ color: t.sub }}>{isNewStudent ? s.sex : ""}</td>
                  <td className="px-3 py-2.5" style={{ fontFamily: "'JetBrains Mono',monospace", color: t.dim }}>{s.ageYears}y {s.ageMonths}m</td>
                  <td className="px-3 py-2.5" style={{ fontFamily: "'JetBrains Mono',monospace", color: t.dim }}>{s.weight ? `${s.weight}kg` : "—"}</td>
                  <td className="px-3 py-2.5" style={{ fontFamily: "'JetBrains Mono',monospace", color: t.dim }}>{s.height ? `${s.height}cm` : "—"}</td>
                  <td className="px-3 py-2.5" style={{ fontFamily: "'JetBrains Mono',monospace", color: s.bmi ? t.accent : t.faint }}>{s.bmi || "—"}</td>
                  <td className="px-3 py-2.5">{s.bmiStatus ? <Pill label={s.bmiStatus} color={BMI_C[s.bmiStatus]} /> : <span style={{ color: t.faint }}>—</span>}</td>
                  <td className="px-3 py-2.5">{s.hfaStatus ? <Pill label={s.hfaStatus} color={HFA_C[s.hfaStatus]} /> : <span style={{ color: t.faint }}>—</span>}</td>
                  <td className="px-3 py-2.5" style={{ color: t.dim }}>{isNewStudent ? (s.classificationOfBeneficiary || "—") : ""}</td>
                  <td className="px-3 py-2.5"><Pill label={s.period} color={PC[s.period]} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { onEdit(s); setView("entry"); }} className="text-[10px] cursor-pointer transition-colors" style={{ color: t.dim }}
                        onMouseEnter={e => (e.currentTarget.style.color = t.accent)} onMouseLeave={e => (e.currentTarget.style.color = t.dim)}>Edit</button>
                      <button onClick={() => del(s.id)} className="text-[10px] cursor-pointer transition-colors" style={{ color: t.dim }}
                        onMouseEnter={e => (e.currentTarget.style.color = t.danger)} onMouseLeave={e => (e.currentTarget.style.color = t.dim)}>✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-sm" style={{ color: t.faint }}>No students found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Summary Table ─────────────────────────────────────────────────────────────
function SummaryTable({ students, school }: { students:Student[]; school:School }) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("Endline");
  const isSpedSchool = school.name === SPED_SCHOOL_NAME;
  const [cohort, setCohort] = useState<"All"|"Regular"|"SPED">("All");

  const isSpedGrade = (g: string) => g.startsWith("SPED");
  const allGrades = getGrades(school);
  const grades = !isSpedSchool || cohort === "All"
    ? allGrades
    : cohort === "SPED"
      ? allGrades.filter(isSpedGrade)
      : allGrades.filter(g => !isSpedGrade(g));

  const f = students.filter(s =>
    s.period === period &&
    (!isSpedSchool || cohort === "All"
      ? true
      : cohort === "SPED" ? isSpedGrade(s.gradeLevel) : !isSpedGrade(s.gradeLevel))
  );

  const cntBMI = (grade:GradeLevel|null, sex:Sex|null, st:BMIStatus) =>
    f.filter(s=>(grade===null||s.gradeLevel===grade)&&(sex===null||s.sex===sex)&&s.bmiStatus===st).length;
  const cntHFA = (grade:GradeLevel|null, sex:Sex|null, st:HFAStatus) =>
    f.filter(s=>(grade===null||s.gradeLevel===grade)&&(sex===null||s.sex===sex)&&s.hfaStatus===st).length;
  const cntFlag = (grade:GradeLevel|null, sex:Sex|null, field:keyof Student, val:string) =>
    f.filter(s=>(grade===null||s.gradeLevel===grade)&&(sex===null||s.sex===sex)&&s[field]===val).length;
  const N = (v:number, color?:string) => (
    <td className="px-2 py-2 text-center text-xs" style={{ fontFamily:"'JetBrains Mono',monospace", color:v===0?t.faint:(color??t.accent) }}>{v}</td>
  );
  const sx = (lbl:"M"|"F"|"Total"): Sex|null => lbl==="Total"?null:lbl;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color:t.text }}>Summary Table</h1>
          <p className="text-xs mt-0.5" style={{ color:t.dim }}>
            {school.name} — SY 2025–2026
            {isSpedSchool && cohort !== "All" ? ` · ${cohort} only` : ""}
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
          <div className="flex gap-1.5">
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border"
                style={period===p ? { background:PC[p]+"20", color:PC[p], borderColor:PC[p]+"40" } : { background:t.surface, color:t.dim, borderColor:t.border }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ border:`1px solid ${t.border}`, background:t.surface }} className="overflow-x-auto">
        <table className="text-xs min-w-[860px] w-full border-collapse">
          <thead>
            <tr style={{ borderBottom:`1px solid ${t.border}` }}>
              <th rowSpan={2} className="px-3 py-2 text-left text-[9px] tracking-widest uppercase" style={{ color:t.dim, borderRight:`1px solid ${t.border}` }}>Grade</th>
              <th rowSpan={2} className="px-2 py-2 text-[9px] tracking-widest uppercase" style={{ color:t.dim, borderRight:`1px solid ${t.border}` }}>Sex</th>
              <th colSpan={6} className="px-2 py-2 text-[9px] tracking-widest uppercase text-center" style={{ color:"#00c9ff", borderRight:`1px solid ${t.border}` }}>Body Mass Index (BMI)</th>
              <th colSpan={5} className="px-2 py-2 text-[9px] tracking-widest uppercase text-center" style={{ color:"#b8ff4f", borderRight:`1px solid ${t.border}` }}>Height-for-Age (HFA)</th>
              <th className="px-2 py-2 text-[9px] tracking-widest uppercase text-center" style={{ color:"#ff9f4b", borderRight:`1px solid ${t.border}` }}>4P's</th>
              <th className="px-2 py-2 text-[9px] tracking-widest uppercase text-center" style={{ color:"#ff9f4b" }}>SBFP</th>
            </tr>
            <tr style={{ borderBottom:`1px solid ${t.border}` }}>
              {["Sev. Wasted","Wasted","Normal","Overweight","Obese","Total","Sev. Stunted","Stunted","Normal","Tall","Total"].map((h,i) => (
                <th key={`${h}${i}`} className="px-2 py-1.5 text-[8px] tracking-widest uppercase text-center" style={{ color:t.faint, borderRight:`1px solid ${i===5||i===10?t.border:t.surfaceDeep}` }}>{h}</th>
              ))}
              <th style={{ borderRight:`1px solid ${t.border}` }} />
              <th />
            </tr>
          </thead>
          <tbody>
            {grades.map((grade,gi) =>
              (["M","F","Total"] as const).map((lbl,ri) => {
                const s = sx(lbl);
                const bmis = BMI_STATUSES.map(st=>cntBMI(grade,s,st));
                const hfas = HFA_STATUSES.map(st=>cntHFA(grade,s,st));
                const bT = bmis.reduce((a,b)=>a+b,0), hT = hfas.reduce((a,b)=>a+b,0);
                const fp = cntFlag(grade,s,"fourPs","Yes"), sb = cntFlag(grade,s,"sbfpPreviousYears","Yes");
                const isTotal = lbl==="Total";
                return (
                  <tr key={`${grade}-${ri}`} style={{ borderBottom:`1px solid ${isTotal?t.border:t.surfaceDeep}`, background:isTotal?t.surfaceDeep:"transparent" }}
                    onMouseEnter={e=>{ if(!isTotal) e.currentTarget.style.background=t.hover; }} onMouseLeave={e=>{ e.currentTarget.style.background=isTotal?t.surfaceDeep:"transparent"; }}>
                    {ri===0 && <td rowSpan={3} className="px-3 py-2 text-xs font-medium align-middle" style={{ color:t.sub, borderRight:`1px solid ${t.border}` }}>{grade}</td>}
                    <td className="px-2 py-2 text-center text-xs" style={{ color:isTotal?t.danger:t.dim, fontWeight:isTotal?600:400, borderRight:`1px solid ${t.border}` }}>{lbl}</td>
                    {bmis.map((v,i)=>N(v))}{N(bT,"#00c9ff")}
                    {hfas.map((v,i)=>N(v))}{N(hT,"#b8ff4f")}
                    {N(fp,"#ff9f4b")}{N(sb,"#ff9f4b")}
                  </tr>
                );
              })
            )}
            {(["M","F","Total"] as const).map(lbl => {
              const s = sx(lbl);
              const bmis = BMI_STATUSES.map(st=>cntBMI(null,s,st));
              const hfas = HFA_STATUSES.map(st=>cntHFA(null,s,st));
              const bT = bmis.reduce((a,b)=>a+b,0), hT = hfas.reduce((a,b)=>a+b,0);
              const fp = cntFlag(null,s,"fourPs","Yes"), sb = cntFlag(null,s,"sbfpPreviousYears","Yes");
              return (
                <tr key={`grand-${lbl}`} style={{ borderBottom:`1px solid ${t.border}`, background:t.grandBg }}>
                  {lbl==="M" && <td rowSpan={3} className="px-3 py-2 text-xs font-semibold align-middle" style={{ color:t.accent, borderRight:`1px solid ${t.border}` }}>GRAND TOTAL</td>}
                  <td className="px-2 py-2 text-center text-xs font-semibold" style={{ color:t.danger, borderRight:`1px solid ${t.border}` }}>{lbl}</td>
                  {bmis.map((v,i)=>N(v))}{N(bT,"#00c9ff")}
                  {hfas.map((v,i)=>N(v))}{N(hT,"#b8ff4f")}
                  {N(fp,"#ff9f4b")}{N(sb,"#ff9f4b")}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
      bmi: BMI_STATUSES.map(st => ({ st, n: pe.filter(s => s.bmiStatus === st).length, c: BMI_C[st] })),
      hfa: HFA_STATUSES.map(st => ({ st, n: pe.filter(s => s.hfaStatus === st).length, c: HFA_C[st] })),
    };
  });
  const maxTotal = Math.max(...periodData.map(d=>d.total),1);
  const allBMI = BMI_STATUSES.map(st=>({ label:st, val:uniqAll.filter(s=>s.bmiStatus===st).length, color:BMI_C[st] }));
  const allHFA = HFA_STATUSES.map(st=>({ label:st, val:uniqAll.filter(s=>s.hfaStatus===st).length, color:HFA_C[st] }));

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
              <span className="text-sm font-semibold" style={{ fontFamily:"'JetBrains Mono',monospace", color:PC[d.period] }}>{d.total}</span>
              <div className="w-full rounded-sm" style={{ height:`${(d.total/maxTotal)*80}px`, minHeight:"2px", background:PC[d.period]+"60" }} />
              <span className="text-[10px]" style={{ color:PC[d.period] }}>{d.period}</span>
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
              <div className="text-[9px] tracking-widest uppercase mb-3" style={{ color:PC[d.period] }}>{d.period} — BMI</div>
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
              <div className="text-[9px] tracking-widest uppercase mb-3" style={{ color:PC[d.period] }}>{d.period} — HFA</div>
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
  const [students, setStudents] = useState<Student[]>(SEED);
  const [schools, setSchools] = useState<School[]>([...INIT_ES, ...INIT_HS]);
  const [editingStudent, setEditingStudent] = useState<Student|null>(null);

  const schoolStudents = useMemo(
    () => selectedSchool ? students.filter(s=>s.schoolId===selectedSchool.id) : students,
    [students, selectedSchool]
  );

  const handleSelectSchool = (school: School) => { setSelectedSchool(school); setView("dashboard"); };
  const handleEdit = (student: Student) => { setEditingStudent(student); setView("entry"); };
  const clearEditing = () => setEditingStudent(null);

  return (
    <ThemeCtx.Provider value={t}>
      <div className="flex h-full" style={{ background:t.bg, color:t.text, fontFamily:"'Outfit',sans-serif" }}>
        <Sidebar view={view} setView={setView} selectedSchool={selectedSchool} setSelectedSchool={setSelectedSchool}
          themeMode={themeMode} toggleTheme={() => setThemeMode(m=>m==="dark"?"light":"dark")} schools={schools} />
        <main className="flex-1 overflow-y-auto p-8">
          {view==="district" && <DistrictDashboard students={students} schools={schools} />}
          {view==="schools" && <SchoolsList students={students} schools={schools} setSchools={setSchools}
            setStudents={setStudents} onSelect={handleSelectSchool} />}
          {view==="dashboard" && selectedSchool && <Dashboard students={schoolStudents} school={selectedSchool} />}
          {view==="records" && selectedSchool && <StudentRecords students={schoolStudents}
            setStudents={ss => setStudents([...students.filter(s=>s.schoolId!==selectedSchool.id),...ss])}
            school={selectedSchool} setView={setView} onEdit={handleEdit} />}
          {view==="entry" && selectedSchool && <DataEntry students={students} setStudents={setStudents}
            school={selectedSchool} setView={setView} editingStudent={editingStudent} clearEditing={clearEditing} />}
          {view==="table" && selectedSchool && <SummaryTable students={schoolStudents} school={selectedSchool} />}
          {view==="analytics" && selectedSchool && <Analytics students={schoolStudents} school={selectedSchool} />}
        </main>
      </div>
    </ThemeCtx.Provider>
  );
}
