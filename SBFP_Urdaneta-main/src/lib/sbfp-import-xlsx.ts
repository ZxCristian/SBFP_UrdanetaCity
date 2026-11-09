/**
 * The ExcelJS edge of the SBFP Excel import.
 *
 * Kept apart from `sbfp-import.ts` so the rules stay testable without a
 * spreadsheet engine, and loaded only when the Division Office picks a file so
 * ExcelJS never enters the console's initial bundle.
 */
import { Workbook } from "exceljs";
import type { School } from "./sbfp-domain.ts";
import {
  SbfpImportFormatError,
  parseSbfpImport,
  type ImportCell,
  type ImportGrid,
  type SbfpImportResult,
} from "./sbfp-import.ts";

/** Unwrap ExcelJS's rich-text / formula / hyperlink cell objects. */
function toImportCell(value: unknown): ImportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const cell = value as {
      result?: unknown;
      text?: unknown;
      richText?: { text?: string }[];
      error?: unknown;
    };
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => part.text ?? "").join("");
    }
    if (typeof cell.text === "string") return cell.text;
    if (cell.result !== undefined) return toImportCell(cell.result);
    if (typeof cell.error === "string") return cell.error;
  }
  return null;
}

function worksheetGrid(sheetName: string, sheet: {
  rowCount: number;
  columnCount: number;
  getCell: (row: number, column: number) => { value: unknown };
}): ImportGrid {
  // A formatted but empty sheet can report a huge used range; cap both axes so
  // a stray fill in row 50,000 cannot freeze the preview.
  const rowCount = Math.min(Math.max(sheet.rowCount, 0), 5000);
  const columnCount = Math.min(Math.max(sheet.columnCount, 0), 40);
  const cells: ImportCell[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row: ImportCell[] = [];
    for (let c = 1; c <= columnCount; c++) {
      row.push(toImportCell(sheet.getCell(r, c).value));
    }
    cells.push(row);
  }
  return { sheetName, cells };
}

/**
 * Read every plausible sheet and choose the one with the most learner rows.
 * Workbooks often carry a title or instructions sheet beside the Master List,
 * so "first sheet" is not a safe assumption.
 */
export async function readSbfpWorkbook(
  buffer: ArrayBuffer,
  school: School,
): Promise<SbfpImportResult> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer);

  if (workbook.worksheets.length === 0) {
    throw new SbfpImportFormatError("This workbook has no worksheets.");
  }

  const sheets = [...workbook.worksheets].sort((a, b) => {
    const aMaster = /master|form\s*1|learner/i.test(a.name) ? 0 : 1;
    const bMaster = /master|form\s*1|learner/i.test(b.name) ? 0 : 1;
    return aMaster - bMaster;
  });

  let best: SbfpImportResult | null = null;
  let firstFormatError: SbfpImportFormatError | null = null;
  for (const sheet of sheets) {
    try {
      const parsed = parseSbfpImport(
        worksheetGrid(sheet.name, {
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          getCell: (row, column) => sheet.getCell(row, column),
        }),
        school,
      );
      if (!best || parsed.rows.length > best.rows.length) best = parsed;
    } catch (error) {
      // A Form 2 / cover sheet has no learner table; try the next one. Keep the
      // first explanation (usually the Master List) so a file exported for All
      // Periods says why it cannot be imported instead of a generic error.
      if (error instanceof SbfpImportFormatError) {
        firstFormatError ??= error;
      } else if (!best) {
        throw error;
      }
    }
  }

  if (!best) {
    throw firstFormatError ?? new SbfpImportFormatError(
      "No SBFP Form 1A learner table was found in this workbook. Export the Master List from Student Records, then import that file.",
    );
  }
  return best;
}
