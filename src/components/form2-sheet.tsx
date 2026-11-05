/**
 * SBFP Form 2 — the same paper sheet in the Division console and the School
 * Portal.
 *
 * The form is printed landscape: a letterhead, the school information block,
 * the Weight / Height / Secondary Target table, the signatures and the DepEd
 * note. The Weight and Height figures and the beneficiary columns are computed
 * from learner records; two Form 2 columns the records do not carry — pupils at
 * risk of dropping out and Indigenous Peoples (IPs) — are typed straight into
 * the paper, per grade and sex.
 *
 * The sheet keeps its own paper colours in both portals, so what a teacher sees
 * is exactly what the Division Office sees and what the .xlsx export prints.
 */
import { useEffect, useState, type CSSProperties } from "react";
import type { Period, School, SummaryMatrixRow } from "@/lib/sbfp-shared";
import { formatDateMDY } from "@/lib/sbfp-shared";
import { formatSchoolYear } from "@/lib/sbfp-years";

export type Form2Row = SummaryMatrixRow;
export type ExtraPatch = { atRisk?: number; ips?: number };

export const FORM2_SECONDARY = [
  "No. of Adolescent Pregnant Learners/ Learners with 0-1 year-old child/ren",
  "No. of Pupils at risk of dropping out",
  "No. of Stunted Learners",
  "No. of Indigenous Peoples (IPs)",
  "No. of Learners Dewormed",
  "No. of 4Ps Beneficiaries",
  "No. of Pupils who are beneficiaries in previous years (Repeaters)",
  "Date Feeding Started/Ended",
] as const;

export const FORM2_NOTE =
  "Note: This form shall be prepared by the school before the start of feeding and after feeding, " +
  "to be compiled by the SDO, and for the final compilation by the RO, for submission to DepEd BLSS-SHD.";

function PaperField({ text, value }: { text: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, fontSize: 11, minWidth: 0 }}>
      <span style={{ whiteSpace: "nowrap", color: "#222" }}>{text}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          borderBottom: "1px solid #444",
          paddingBottom: 1,
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value || "\u00A0"}
      </span>
    </div>
  );
}

/**
 * A hand-encoded Form 2 cell. Zero is drawn as an empty box, as on the printed
 * form, and the input accepts digits only. The parent debounces the save.
 */
function EditableCount({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : "");
  useEffect(() => {
    setText(value > 0 ? String(value) : "");
  }, [value]);

  return (
    <input
      aria-label={label}
      title={label}
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      placeholder="0"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
        setText(digits);
        onChange(digits ? Number(digits) : 0);
      }}
      style={{
        width: "100%",
        minWidth: 34,
        border: "1px solid #c8b56a",
        borderRadius: 2,
        background: "#fff9dc",
        color: "#111",
        font: "inherit",
        fontSize: 10,
        fontWeight: 600,
        textAlign: "center",
        padding: "2px 1px",
        outlineColor: "#b8860b",
      }}
    />
  );
}

export function Form2Sheet({
  school,
  period,
  cohort,
  sy,
  rows,
  onExtraChange,
}: {
  school: School;
  period: Period;
  cohort: "All" | "Regular" | "SPED";
  sy: string;
  /** Grade rows followed by the three GRAND TOTAL rows. */
  rows: Form2Row[];
  /** Omit to render the two manual columns read-only. */
  onExtraChange?: (grade: string, sex: "M" | "F", patch: ExtraPatch) => void;
}) {
  const border = "1px solid #9a9a9a";
  const th: CSSProperties = {
    border,
    padding: "4px 5px",
    fontSize: 8.5,
    fontWeight: 700,
    lineHeight: 1.25,
    textAlign: "center",
    verticalAlign: "middle",
    background: "#e9ecef",
    color: "#111",
  };
  const td: CSSProperties = {
    border,
    padding: "5px 6px",
    fontSize: 10.5,
    textAlign: "center",
    verticalAlign: "middle",
    color: "#111",
  };
  const dateStart = formatDateMDY(school.dateStartFeeding);

  const cells = (row: Form2Row) => {
    const weight = [
      row.bmi[0] ?? 0,
      row.bmi[1] ?? 0,
      row.bmi[2] ?? 0,
      (row.bmi[3] ?? 0) + (row.bmi[4] ?? 0),
    ];
    const weightTotal = weight.reduce((a, b) => a + b, 0);
    const height = [row.hfa[0] ?? 0, row.hfa[1] ?? 0, row.hfa[2] ?? 0, row.hfa[3] ?? 0];
    const heightTotal = height.reduce((a, b) => a + b, 0);
    const stunted = (row.hfa[0] ?? 0) + (row.hfa[1] ?? 0);
    const isGrand = row.grade === "GRAND TOTAL";
    const editable = !isGrand && row.sex !== "Total" && Boolean(onExtraChange);
    const change = (patch: ExtraPatch) => {
      if (editable && row.sex !== "Total") onExtraChange?.(row.grade, row.sex, patch);
    };
    return (
      <>
        {weight.map((n, i) => <td key={`w${i}`} style={td}>{n}</td>)}
        <td style={{ ...td, fontWeight: 700 }}>{weightTotal}</td>
        {height.map((n, i) => <td key={`h${i}`} style={td}>{n}</td>)}
        <td style={{ ...td, fontWeight: 700 }}>{heightTotal}</td>
        <td style={td}>{row.pregnantYoung}</td>
        <td style={{ ...td, padding: "2px 3px" }}>
          {editable ? (
            <EditableCount
              value={row.atRisk}
              label={`Pupils at risk of dropping out, ${row.grade}, ${row.sex === "M" ? "male" : "female"}`}
              onChange={(atRisk) => change({ atRisk })}
            />
          ) : (
            row.atRisk
          )}
        </td>
        <td style={td}>{stunted}</td>
        <td style={{ ...td, padding: "2px 3px" }}>
          {editable ? (
            <EditableCount
              value={row.ips}
              label={`Indigenous Peoples, ${row.grade}, ${row.sex === "M" ? "male" : "female"}`}
              onChange={(ips) => change({ ips })}
            />
          ) : (
            row.ips
          )}
        </td>
        <td style={td}>{row.dewormed}</td>
        <td style={td}>{row.fourPs}</td>
        <td style={td}>{row.sbfp}</td>
        <td style={{ ...td, fontSize: 9, whiteSpace: "nowrap" }}>{dateStart || "\u00A0"}</td>
      </>
    );
  };

  return (
    <div
      style={{
        background: "#fffdf8",
        border: "1px solid #d8d4c6",
        borderRadius: 6,
        padding: "22px 22px 18px",
        boxShadow: "0 1px 3px rgba(27,36,48,0.10)",
        color: "#111",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 10, color: "#444" }}>
        <strong>SBFP Form 2 (2026)</strong>
        <span>
          Period: {period}{cohort !== "All" ? ` · ${cohort} only` : ""}
        </span>
      </div>

      <div style={{ textAlign: "center", marginTop: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.02em" }}>Department of Education</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 7 }}>SCHOOL-BASED FEEDING PROGRAM (SBFP)</div>
        <div style={{ fontSize: 11.5, fontWeight: 700 }}>SUMMARY OF BENEFICIARIES &amp; START OF FEEDING</div>
        <div style={{ fontSize: 11, marginTop: 2 }}>(SY: {formatSchoolYear(sy)})</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "9px 26px",
          marginTop: 18,
        }}
      >
        <PaperField text="School Division Office:" value={school.division} />
        <PaperField text="City/Municipality/Barangay:" value={school.cityMunicipalityBarangay} />
        <PaperField text="Name of School / School District:" value={school.name} />
        <PaperField text="School ID Number:" value={school.schoolIdNumber} />
        <PaperField text="Date of Start of Feeding:" value={dateStart} />
        <PaperField text="Last Mile School:" value={school.lastMileSchool} />
      </div>

      {onExtraChange && (
        <p style={{ fontSize: 9.5, color: "#5c4b13", background: "#fff9dc", border: "1px solid #e4d79a", borderRadius: 3, padding: "5px 8px", marginTop: 12 }}>
          The <strong>Pupils at risk of dropping out</strong> and <strong>Indigenous Peoples (IPs)</strong> cells are
          typed in — click a yellow box to change it. Total rows add the grade rows automatically.
        </p>
      )}

      <div className="overflow-x-auto" style={{ marginTop: 14 }}>
        <table style={{ width: "100%", minWidth: 1460, borderCollapse: "collapse", fontSize: 10.5 }}>
          <thead>
            <tr>
              <th rowSpan={4} style={{ ...th, width: 165 }}>Number of School Children by Grade Level</th>
              <th rowSpan={4} style={{ ...th, width: 44 }}>Sex</th>
              <th colSpan={10} style={th}>No. of Primary Targets</th>
              <th colSpan={8} style={th}>No. of Secondary Targets</th>
            </tr>
            <tr>
              <th colSpan={10} style={th}>Nutritional Status at Start/End of Feeding*</th>
              {FORM2_SECONDARY.map((label) => (
                <th key={label} rowSpan={3} style={{ ...th, width: label.startsWith("Date") ? 92 : 110, fontSize: 8 }}>
                  {label}
                  {(label.includes("at risk") || label.includes("Indigenous")) && (
                    <span title="Typed into the Summary" style={{ color: "#8a6d00" }}> ✎</span>
                  )}
                </th>
              ))}
            </tr>
            <tr>
              <th colSpan={5} style={th}>WEIGHT</th>
              <th colSpan={5} style={th}>HEIGHT</th>
            </tr>
            <tr>
              {["Severely Wasted", "Wasted", "Normal", "Overweight + Obese", "Total", "Severely Stunted", "Stunted", "Normal", "Tall", "Total"].map((h, i) => (
                <th key={`${h}${i}`} style={{ ...th, fontSize: 8, width: i === 4 || i === 9 ? 46 : 58 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isGrand = row.grade === "GRAND TOTAL";
              const isTotal = row.sex === "Total";
              const previous = rows[idx - 1];
              const first = !isGrand && (!previous || previous.grade !== row.grade);
              return (
                <tr
                  key={`${row.grade}-${row.sex}`}
                  style={{
                    background: isGrand ? "#eaf0e6" : isTotal ? "#f4f6f1" : "#fffdf8",
                    borderTop: isGrand && idx === rows.findIndex((r) => r.grade === "GRAND TOTAL")
                      ? "2px solid #6b6b6b"
                      : undefined,
                    fontWeight: isGrand ? 700 : undefined,
                  }}
                >
                  {first && (
                    <td
                      rowSpan={3}
                      style={{ ...td, textAlign: "left", fontWeight: 600, background: "#f7f7f3", verticalAlign: "top" }}
                    >
                      {row.grade}
                    </td>
                  )}
                  {isGrand && idx === rows.findIndex((r) => r.grade === "GRAND TOTAL") && (
                    <td rowSpan={3} style={{ ...td, textAlign: "left", fontWeight: 700, background: "#eaf0e6", verticalAlign: "middle" }}>
                      GRAND TOTAL
                    </td>
                  )}
                  <td style={{ ...td, fontWeight: isTotal || isGrand ? 700 : 500 }}>{row.sex}</td>
                  {cells(row)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 36, marginTop: 26, fontSize: 10.5 }}>
        {[
          { role: "Prepared by:", name: school.focalPerson, title: "SBFP DepEd Focal" },
          { role: "Approved by:", name: school.principal, title: "School Head / Principal" },
        ].map((sig) => (
          <div key={sig.role}>
            <div style={{ fontWeight: 700 }}>{sig.role}</div>
            <div style={{ borderBottom: "1px solid #333", height: 32 }} />
            <div style={{ textAlign: "center", fontWeight: 600 }}>{sig.name || "\u00A0"}</div>
            <div style={{ textAlign: "center", color: "#444" }}>{sig.title}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 9, lineHeight: 1.5, color: "#333", marginTop: 20 }}>{FORM2_NOTE}</p>
      <p style={{ fontSize: 8.5, color: "#666", marginTop: 4 }}>
        Generated from {cohort === "SPED" ? "the School Portal" : "the SBFP Summary"} · {period} period · School Year {formatSchoolYear(sy)}
      </p>
    </div>
  );
}
