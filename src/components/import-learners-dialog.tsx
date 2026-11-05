/**
 * The Admin Data Entry bulk import.
 *
 * The Division Office receives Form 1A workbooks from schools, so this dialog
 * accepts the same workbook that Student Records exports, previews exactly what
 * will be added, and only then writes the records. Invalid rows are shown but
 * never imported; learners already on file for the chosen period are skipped.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { TC } from "@/sbfp-app";
import { PERIODS, type Period, type School, type Student } from "@/lib/sbfp-domain";
import {
  SbfpImportFormatError,
  learnerImportKey,
  type ImportedLearnerRow,
  type SbfpImportResult,
} from "@/lib/sbfp-import";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ImportLearnersDialogProps {
  t: TC;
  school: School;
  sy: string;
  /** Existing records for this school, all periods; used for duplicate checks. */
  existing: Student[];
  initialPeriod: Period | null;
  onClose: () => void;
  onImported: (
    rows: Student[],
    period: Period,
    summary: { invalid: number; duplicates: number; fileName: string },
  ) => void;
}

export function ImportLearnersDialog({
  t,
  school,
  sy,
  existing,
  initialPeriod,
  onClose,
  onImported,
}: ImportLearnersDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const [period, setPeriod] = useState<Period | null>(initialPeriod);
  const [result, setResult] = useState<SbfpImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  const readFile = async (file: File) => {
    setError("");
    setResult(null);
    setFileName(file.name);

    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      setError("Choose an Excel .xlsx workbook. Older .xls files need to be saved as .xlsx first.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That workbook is over 10 MB. Split it into smaller files and import them one at a time.");
      return;
    }

    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const { readSbfpWorkbook } = await import("@/lib/sbfp-import-xlsx");
      const parsed = await readSbfpWorkbook(buffer, school);
      setResult(parsed);
      if (parsed.detectedPeriod) setPeriod(parsed.detectedPeriod);
      else if (!period) setPeriod(initialPeriod);
    } catch (err) {
      setError(
        err instanceof SbfpImportFormatError
          ? err.message
          : "That workbook could not be read. Check that it is an .xlsx file and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (file: File | undefined) => {
    if (file) void readFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    pickFile(event.dataTransfer.files[0]);
  };

  const validRows = result?.rows.length ?? 0;
  const invalidRowCount = result
    ? new Set(result.issues.map((issue) => issue.rowNumber)).size
    : 0;

  const { ready, duplicates } = useMemo(() => {
    if (!result) return { ready: [] as ImportedLearnerRow[], duplicates: [] as ImportedLearnerRow[] };
    const seen = new Set(
      period
        ? existing.filter((student) => student.period === period).map(learnerImportKey)
        : [],
    );
    const readyRows: ImportedLearnerRow[] = [];
    const duplicatesRows: ImportedLearnerRow[] = [];
    for (const row of result.rows) {
      const key = learnerImportKey(row.student);
      if (seen.has(key)) {
        duplicatesRows.push(row);
        continue;
      }
      seen.add(key);
      readyRows.push(row);
    }
    return { ready: readyRows, duplicates: duplicatesRows };
  }, [result, period, existing]);

  const canImport = Boolean(period) && ready.length > 0 && !busy;

  const doImport = () => {
    if (!period) {
      setError("Choose the measurement period for this file.");
      return;
    }
    if (ready.length === 0) return;
    const stamp = Date.now();
    const rows: Student[] = ready.map((row, index) => ({
      id: `imp-${stamp}-${index}`,
      schoolId: school.id,
      sy,
      period,
      ...row.student,
    }));
    onImported(rows, period, {
      invalid: invalidRowCount,
      duplicates: duplicates.length,
      fileName,
    });
  };

  const buttonStyle = (primary = false): CSSProperties => ({
    fontFamily: "'Outfit',sans-serif",
    fontSize: 13,
    fontWeight: primary ? 700 : 500,
    padding: "9px 16px",
    borderRadius: 4,
    cursor: "pointer",
    border: `1px solid ${primary ? t.accent : t.border}`,
    background: primary ? t.accent : t.surface,
    color: primary ? t.accentText : t.text,
  });

  const th: CSSProperties = {
    color: t.dim,
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    background: t.surfaceDeep,
    borderBottom: `1px solid ${t.border}`,
    borderRight: `1px solid ${t.border}`,
    padding: "7px 8px",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const td: CSSProperties = {
    color: t.sub,
    fontSize: 11,
    padding: "7px 8px",
    borderBottom: `1px solid ${t.surfaceDeep}`,
    borderRight: `1px solid ${t.surfaceDeep}`,
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 6, 0.68)",
        backdropFilter: "blur(3px)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{
          width: "100%",
          maxWidth: 940,
          maxHeight: "min(92dvh, 900px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 12,
          boxShadow: "0 28px 80px rgba(0,0,0,0.5)",
          fontFamily: "'Outfit',sans-serif",
          color: t.text,
        }}
      >
        <header
          className="flex items-start gap-3 px-5 py-4"
          style={{ borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              flex: "none",
              display: "grid",
              placeItems: "center",
              borderRadius: 7,
              background: t.accentBg,
              color: t.accent,
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            ↑
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] tracking-widest uppercase" style={{ color: t.accent }}>
              Admin · Data Entry
            </div>
            <h2 id={titleId} className="text-base font-semibold mt-0.5" style={{ color: t.text }}>
              Import learners from Excel
            </h2>
            <p id={descriptionId} className="text-[11px] mt-1" style={{ color: t.dim }}>
              {school.name} · SY {sy}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close import"
            onClick={onClose}
            className="cursor-pointer text-sm px-2 py-1 rounded-sm"
            style={{ color: t.dim, background: "transparent", border: "none" }}
          >
            ✕
          </button>
        </header>

        <div className="overflow-y-auto p-5 flex flex-col gap-4" style={{ flex: "1 1 auto", minHeight: 0 }}>
          <div
            className="text-[11px]"
            style={{
              color: t.sub,
              background: t.surface2,
              border: `1px solid ${t.border}`,
              borderLeft: `3px solid ${t.accent}`,
              borderRadius: 5,
              padding: "10px 12px",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: t.text }}>Use the SBFP Form 1A workbook.</strong> Export it from
            Student Records or use any sheet with the same columns; the header can start on any row.
            Import one period at a time. Age, BMI, nutritional status and beneficiary classification
            are recalculated from the measurements. Invalid rows are skipped and listed below before
            anything is saved.
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              border: `1px dashed ${dragOver ? t.accent : t.border}`,
              background: dragOver ? t.accentBg : t.surface2,
              borderRadius: 7,
              padding: "18px 16px",
              textAlign: "center",
            }}
          >
            <input
              ref={fileRef}
              type="file"
              tabIndex={-1}
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                pickFile(file);
              }}
            />
            <div className="text-lg" aria-hidden="true" style={{ color: busy ? t.dim : t.accent }}>
              {busy ? "◌" : "▦"}
            </div>
            <div className="text-sm font-semibold mt-1" style={{ color: t.text }}>
              {busy ? "Reading workbook…" : fileName || "Drop the Form 1A workbook here"}
            </div>
            <p className="text-[10px] mt-1" style={{ color: t.dim }}>
              {fileName ? "Choose another file to replace this preview." : "Excel .xlsx · up to 10 MB"}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mt-3 px-4 py-2 text-xs font-semibold rounded-sm"
              style={{
                cursor: busy ? "wait" : "pointer",
                background: t.surface,
                color: busy ? t.faint : t.accent,
                border: `1px solid ${busy ? t.border : t.accent + "66"}`,
                fontFamily: "'Outfit',sans-serif",
              }}
            >
              {busy ? "Reading…" : result ? "Choose another file" : "Choose Excel file"}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="text-xs"
              style={{
                color: t.danger,
                background: `${t.danger}12`,
                border: `1px solid ${t.danger}45`,
                borderRadius: 5,
                padding: "9px 11px",
                lineHeight: 1.55,
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Ready", value: ready.length, color: t.accent },
                  { label: "Need attention", value: invalidRowCount, color: invalidRowCount ? t.warning : t.dim },
                  { label: "Skipped duplicates", value: duplicates.length, color: duplicates.length ? t.blue : t.dim },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      border: `1px solid ${t.border}`,
                      background: t.surface2,
                      borderRadius: 5,
                      padding: "8px 10px",
                    }}
                  >
                    <div
                      className="text-lg font-semibold leading-none"
                      style={{ color: stat.color, fontFamily: "'JetBrains Mono',monospace" }}
                    >
                      {stat.value}
                    </div>
                    <div className="text-[9px] tracking-widest uppercase mt-1" style={{ color: t.dim }}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div style={{ minWidth: 0 }}>
                  <div className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>
                    Measurement period for this import
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: t.dim, lineHeight: 1.5 }}>
                    {result.detectedPeriod
                      ? `Detected “${result.detectedPeriod}” in the workbook title — change it if this file is for another period.`
                      : "This file does not name a period. Pick the one it belongs to."}
                    {" "}It does not change the Data Entry period.
                  </p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {PERIODS.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => {
                        setPeriod(candidate);
                        setError("");
                      }}
                      className="px-3 py-1.5 text-xs rounded-sm cursor-pointer border transition-colors"
                      style={
                        period === candidate
                          ? {
                              background: t.period[candidate] + "20",
                              color: t.period[candidate],
                              borderColor: t.period[candidate] + "55",
                            }
                          : { background: t.surface, color: t.dim, borderColor: t.border }
                      }
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              </div>

              {validRows > 0 && (
                <div style={{ border: `1px solid ${t.border}`, borderRadius: 5, overflow: "hidden" }}>
                  <div
                    className="flex items-center justify-between gap-3 px-3 py-2"
                    style={{ background: t.surface2, borderBottom: `1px solid ${t.border}` }}
                  >
                    <div className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>
                      Preview · {result.sheetName} · header row {result.headerRow}
                    </div>
                    {ready.length > 5 && (
                      <span className="text-[10px]" style={{ color: t.dim }}>
                        first 5 of {ready.length}
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse" style={{ minWidth: 650 }}>
                      <thead>
                        <tr>
                          {["Row", "Learner", "Sex", "Grade", "Weight", "Height", "BMI status", "HFA"].map((head) => (
                            <th key={head} style={th}>{head}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(ready.length > 0 ? ready : result.rows).slice(0, 5).map((row) => (
                          <tr key={row.rowNumber}>
                            <td style={{ ...td, color: t.dim, fontFamily: "'JetBrains Mono',monospace" }}>{row.rowNumber}</td>
                            <td style={{ ...td, color: t.text, fontWeight: 500 }}>{row.student.name}</td>
                            <td style={td}>{row.student.sex || "—"}</td>
                            <td style={td}>{row.student.gradeLevel || "—"}</td>
                            <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace" }}>{row.student.weight}</td>
                            <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace" }}>{row.student.height}</td>
                            <td style={{ ...td, color: row.student.bmiStatus ? t.bmi[row.student.bmiStatus] : t.faint }}>
                              {row.student.bmiStatus || "—"}
                            </td>
                            <td style={{ ...td, color: row.student.hfaStatus ? t.hfa[row.student.hfaStatus] : t.faint }}>
                              {row.student.hfaStatus || "—"}
                            </td>
                          </tr>
                        ))}
                        {result.rows.length === 0 && (
                          <tr>
                            <td colSpan={8} style={{ ...td, textAlign: "center", color: t.faint, whiteSpace: "normal", padding: 18 }}>
                              No valid learner rows were found in this workbook.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.issues.length > 0 && (
                <div
                  style={{
                    border: `1px solid ${t.warning}45`,
                    background: `${t.warning}0d`,
                    borderRadius: 5,
                    overflow: "hidden",
                  }}
                >
                  <div className="px-3 py-2" style={{ borderBottom: `1px solid ${t.warning}30` }}>
                    <span className="text-[9px] tracking-widest uppercase" style={{ color: t.warning }}>
                      Needs attention · {invalidRowCount} row{invalidRowCount === 1 ? "" : "s"} will be skipped
                    </span>
                  </div>
                  <div style={{ maxHeight: 170, overflowY: "auto" }}>
                    {result.issues.slice(0, 12).map((issue, index) => (
                      <div
                        key={`${issue.rowNumber}-${index}`}
                        className="px-3 py-2 text-[11px]"
                        style={{
                          color: t.sub,
                          borderBottom: index === Math.min(result.issues.length, 12) - 1 ? "none" : `1px solid ${t.surfaceDeep}`,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong style={{ color: t.text }}>Row {issue.rowNumber}</strong>
                        {issue.name ? ` · ${issue.name}` : ""} — {issue.message}
                      </div>
                    ))}
                    {result.issues.length > 12 && (
                      <div className="px-3 py-2 text-[10px]" style={{ color: t.dim }}>
                        +{result.issues.length - 12} more {result.issues.length - 12 === 1 ? "issue" : "issues"}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {duplicates.length > 0 && (
                <div
                  className="text-[11px]"
                  style={{
                    color: t.sub,
                    background: `${t.blue}0d`,
                    border: `1px solid ${t.blue}35`,
                    borderRadius: 5,
                    padding: "8px 10px",
                    lineHeight: 1.55,
                  }}
                >
                  {duplicates.length} row{duplicates.length === 1 ? " duplicates" : "s duplicate"} a learner
                  already on file for {period ?? "the chosen period"} in this school, or appears twice in
                  this file. They will not be added again.
                </div>
              )}
            </>
          )}
        </div>

        <footer
          className="flex items-center justify-between gap-3 flex-wrap px-5 py-3.5"
          style={{ borderTop: `1px solid ${t.border}`, flexShrink: 0, background: t.surface }}
        >
          <div className="text-[10px]" style={{ color: t.dim, lineHeight: 1.45 }}>
            {result && period
              ? `${ready.length} ready · ${invalidRowCount} invalid · ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`
              : "Nothing is saved until you confirm the preview."}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} style={buttonStyle()}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!canImport}
              onClick={doImport}
              style={{
                ...buttonStyle(true),
                background: canImport ? t.accent : t.surface2,
                color: canImport ? t.accentText : t.faint,
                borderColor: canImport ? t.accent : t.border,
                cursor: canImport ? "pointer" : "not-allowed",
              }}
            >
              {!period
                ? "Choose a period"
                : ready.length > 0
                  ? `Import ${ready.length} record${ready.length === 1 ? "" : "s"}`
                  : "Nothing to import"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
