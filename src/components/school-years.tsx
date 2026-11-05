/**
 * School Years — the Division Office's year archive.
 *
 * The active year is the one every dashboard, table and teacher form works in.
 * Starting a new year closes it, keeps its learner records and feedback in the
 * archive, and resets the live school information (teacher accounts carry over).
 * Nothing is deleted: the page below reads a past year's rows by their `sy`
 * stamp and can export any school's Form 1A from the year's own form header.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  fetchSchoolYearArchive,
  fetchSchoolYears,
  startSchoolYear,
} from "@/lib/sbfp-api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatSchoolYear, nextSchoolYear, schoolYearProblem } from "@/lib/sbfp-years";
import type { ArchivedSchoolYear, SchoolYearSummary } from "@/lib/sbfp-years";
import type { Period, School, TC } from "@/sbfp-app";

const font = "'Outfit', sans-serif";
const mono = "'JetBrains Mono', monospace";

const fmt = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1] ?? m[2]} ${m[3]}, ${m[1]}`;
};

/** A learner is one person across Baseline/Midline/Endline. */
const learnerKey = (r: { schoolId: string; name: string; dateOfBirth: string; sex: string }) =>
  `${r.schoolId}|${r.name}|${r.dateOfBirth}|${r.sex}`;

function Stat({ label, value, accent, t }: { label: string; value: number; accent?: boolean; t: TC }) {
  return (
    <div style={{ border: `1px solid ${t.border}`, background: t.surface }} className="p-4">
      <div className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>{label}</div>
      <div
        className="text-xl font-semibold mt-1"
        style={{ fontFamily: mono, color: accent ? t.accent : t.text }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-sm whitespace-nowrap"
      style={{ background: color + "20", color, border: `1px solid ${color}40` }}
    >
      {label}
    </span>
  );
}

export default function SchoolYears({
  theme: t,
  schools,
  activeSy,
  onChanged,
}: {
  theme: TC;
  schools: School[];
  activeSy: string;
  onChanged: () => void;
}) {
  const [years, setYears] = useState<SchoolYearSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [openSy, setOpenSy] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchivedSchoolYear | null>(null);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [period, setPeriod] = useState<Period | "All">("All");
  const [schoolFocus, setSchoolFocus] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);
  const [nextSy, setNextSy] = useState(() => nextSchoolYear(activeSy));
  const [starting, setStarting] = useState(false);
  /** The final confirmation before a year is closed — this is not undoable. */
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadYears = async () => {
    try {
      const result = await fetchSchoolYears();
      setYears(result.years);
      setListError("");
    } catch (err) {
      setListError(err instanceof Error ? err.message : "The school years could not be loaded.");
    }
  };

  useEffect(() => {
    void loadYears();
  }, []);

  useEffect(() => {
    setNextSy(nextSchoolYear(activeSy));
  }, [activeSy]);

  const openYear = async (sy: string) => {
    setOpenSy(sy);
    setArchive(null);
    setSchoolFocus(null);
    setPeriod("All");
    setError("");
    setLoadingArchive(true);
    try {
      const result = await fetchSchoolYearArchive({ data: { sy } });
      if (result.ok) setArchive(result.archive);
      else setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That year's archive could not be opened.");
    } finally {
      setLoadingArchive(false);
    }
  };

  const startYear = async () => {
    setError("");
    setNotice("");
    const problem = schoolYearProblem(nextSy);
    if (problem) {
      setError(problem);
      return;
    }
    setStarting(true);
    try {
      const result = await startSchoolYear({ data: { sy: nextSy.trim() } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setShowStart(false);
      setConfirming(false);
      setOpenSy(null);
      setArchive(null);
      setSchoolFocus(null);
      setNotice(
        `${formatSchoolYear(result.sy)} is now the active school year. ` +
          `${formatSchoolYear(result.closedSy)} is archived and read-only.`,
      );
      await loadYears();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The new school year could not be started.");
    } finally {
      setStarting(false);
    }
  };

  /** The open year's totals — what the confirmation is about to archive. */
  const activeYear = useMemo(() => years?.find((year) => year.active) ?? null, [years]);

  const archivedLearners = useMemo(() => {
    if (!archive) return 0;
    return new Set(archive.records.map(learnerKey)).size;
  }, [archive]);

  const schoolRows = useMemo(() => {
    if (!archive) return [];
    return schools
      .map((school) => {
        const records = archive.records.filter((r) => r.schoolId === school.id);
        return {
          school,
          records: records.length,
          learners: new Set(records.map(learnerKey)).size,
          feedback: archive.feedbacks.filter((f) => f.schoolId === school.id).length,
        };
      })
      .filter((row) => row.records > 0 || row.feedback > 0)
      .sort((a, b) => b.learners - a.learners || a.school.name.localeCompare(b.school.name));
  }, [archive, schools]);

  const learnerRows = useMemo(() => {
    if (!archive || !schoolFocus) return [];
    return archive.records
      .filter((r) => r.schoolId === schoolFocus && (period === "All" || r.period === period))
      .sort(
        (a, b) =>
          a.gradeLevel.localeCompare(b.gradeLevel) ||
          a.name.localeCompare(b.name) ||
          a.period.localeCompare(b.period),
      );
  }, [archive, schoolFocus, period]);

  const exportSchool = async (schoolId: string) => {
    if (!archive) return;
    const rows = archive.records.filter(
      (r) => r.schoolId === schoolId && (period === "All" || r.period === period),
    );
    if (rows.length === 0) {
      setError("That school has no learner records in this period.");
      return;
    }
    const school = schools.find((s) => s.id === schoolId);
    const form = archive.profiles[schoolId];
    const info = {
      name: school?.name ?? schoolId,
      type: school?.type ?? "",
      division: form?.division ?? "Urdaneta City",
      cityMunicipalityBarangay: form?.cityMunicipalityBarangay ?? "",
      schoolIdNumber: form?.schoolIdNumber ?? "",
      principal: form?.principal ?? "",
      focalPerson: form?.focalPerson ?? "",
      dateStartFeeding: form?.dateStartFeeding ?? "",
      lastMileSchool: form?.lastMileSchool ?? "",
    };
    try {
      const { exportStudentsToExcel } = await import("@/lib/sbfp-export");
      await exportStudentsToExcel(info, rows, period, archive.sy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export could not be built.");
    }
  };

  const inp: CSSProperties = {
    background: t.surface2,
    color: t.text,
    border: `1px solid ${t.border}`,
    fontFamily: font,
  };
  const panel: CSSProperties = { border: `1px solid ${t.border}`, background: t.surface };
  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: t.text }}>School Years</h1>
          <p className="text-xs mt-1 max-w-2xl leading-relaxed" style={{ color: t.dim }}>
            The archive of every school year. Starting a new year keeps the old one here, read-only,
            and resets the working data for the new one.
          </p>
        </div>
        <button
          onClick={() => {
            setShowStart((v) => !v);
            setError("");
            setNotice("");
          }}
          className="px-3 py-1.5 text-xs rounded-sm cursor-pointer font-semibold border transition-colors"
          style={
            showStart
              ? { background: t.surface2, color: t.sub, borderColor: t.border }
              : { background: t.accent, color: t.accentText, borderColor: t.accent }
          }
        >
          {showStart ? "Cancel" : "Start new school year"}
        </button>
      </div>

      {notice && (
        <div className="p-4" style={{ border: `1px solid ${t.accent}40`, background: t.accentBg }}>
          <p className="text-xs leading-relaxed" style={{ color: t.accent }}>{notice}</p>
        </div>
      )}
      {error && (
        <div className="p-4" style={{ border: `1px solid ${t.danger}40`, background: t.danger + "14" }}>
          <p className="text-xs leading-relaxed" style={{ color: t.danger }}>{error}</p>
        </div>
      )}
      {listError && (
        <div className="p-4" style={{ border: `1px solid ${t.danger}40`, background: t.danger + "14" }}>
          <p className="text-xs leading-relaxed" style={{ color: t.danger }}>{listError}</p>
        </div>
      )}

      {showStart && (
        <div className="p-5 flex flex-col gap-4" style={{ border: `1px solid ${t.accent}40`, background: t.surface }}>
          <div>
            <div className="text-[9px] tracking-widest uppercase" style={{ color: t.accent }}>
              Close {formatSchoolYear(activeSy)} and open the next year
            </div>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: t.sub }}>
              This year's learners, feedback and school information move into the archive and become
              read-only. Teacher accounts, passwords and the school list are kept. The new year starts
              with no learner records, no feedback and blank school information, so each school fills
              its form header in again.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 max-w-xs">
            <span className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>
              New school year
            </span>
            <input
              value={nextSy}
              onChange={(e) => setNextSy(e.target.value)}
              placeholder="2026-2027"
              className="text-sm px-3 py-2 rounded-sm outline-none"
              style={inp}
            />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                // The year field is prefilled and one click used to start it.
                // Show exactly what this closes before anything is written.
                const problem = schoolYearProblem(nextSy);
                if (problem) {
                  setError(problem);
                  return;
                }
                setError("");
                setConfirming(true);
              }}
              disabled={starting}
              className="px-4 py-2 text-xs rounded-sm font-semibold border"
              style={{
                background: starting ? t.surface2 : t.accent,
                color: starting ? t.faint : t.accentText,
                borderColor: t.accent,
                cursor: starting ? "wait" : "pointer",
              }}
            >
              {starting ? "Starting…" : `Start ${formatSchoolYear(nextSy) || "the new year"}`}
            </button>
            <span className="text-[10px]" style={{ color: t.dim }}>
              Nothing is deleted. The current year stays in the archive below.
            </span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Start ${formatSchoolYear(nextSy) || "the new school year"}?`}
        confirmLabel={`Start ${formatSchoolYear(nextSy) || "the new year"}`}
        cancelLabel="Keep working in this year"
        palette={{
          surface: t.surface,
          surface2: t.surface2,
          border: t.border,
          text: t.text,
          sub: t.sub,
          danger: t.warning,
          dangerSoft: `${t.warning}22`,
          dangerText: t.isDark ? "#0b0b0b" : "#ffffff",
          font,
        }}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void startYear()}
      >
        <div className="flex flex-col gap-2">
          <p>
            <strong style={{ color: t.text }}>{formatSchoolYear(activeSy)}</strong> closes and{" "}
            <strong style={{ color: t.text }}>{formatSchoolYear(nextSy)}</strong> becomes the working year.
          </p>
          <p>
            Into the {formatSchoolYear(activeSy)} archive:{" "}
            <strong style={{ color: t.text }}>
              {(activeYear?.records ?? 0).toLocaleString()} learner record{(activeYear?.records ?? 0) === 1 ? "" : "s"}
            </strong>{" "}
            from {activeYear?.schools ?? 0} school{(activeYear?.schools ?? 0) === 1 ? "" : "s"}, and{" "}
            <strong style={{ color: t.text }}>
              {(activeYear?.feedback ?? 0).toLocaleString()} feedback entr{(activeYear?.feedback ?? 0) === 1 ? "y" : "ies"}
            </strong>.
          </p>
          <p>
            Every school's form header (principal, focal person, school ID) is snapshotted
            and cleared, so each school fills it in again. Teacher accounts, passwords and the
            school list are kept. Nothing is deleted, and the archive stays readable and
            exportable.
          </p>
          {starting && <p style={{ color: t.warning }}>Starting the new year…</p>}
        </div>
      </ConfirmDialog>

      {years === null ? (
        <p className="text-xs" style={{ color: t.dim }}>Loading school years…</p>
      ) : years.length === 0 ? (
        <div className="p-6" style={{ ...panel, borderStyle: "dashed" }}>
          <p className="text-sm" style={{ color: t.sub }}>No school year is set up yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {years.map((year) => (
            <article
              key={year.sy}
              style={{
                ...panel,
                borderColor: year.active ? t.accent + "70" : t.border,
                background: year.active ? t.accentBg : t.surface,
              }}
              className="p-5 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>
                    School year
                  </div>
                  <div className="text-xl font-semibold mt-1" style={{ color: t.text, fontFamily: mono }}>
                    {formatSchoolYear(year.sy)}
                  </div>
                </div>
                <Pill
                  label={year.active ? "Active" : "Archived"}
                  color={year.active ? t.accent : t.dim}
                />
              </div>

              <div className="grid grid-cols-3 gap-px" style={{ background: t.border }}>
                {[
                  ["Learners", year.learners],
                  ["Records", year.records],
                  ["Feedback", year.feedback],
                ].map(([label, value]) => (
                  <div key={String(label)} className="p-2.5" style={{ background: t.surface }}>
                    <div className="text-[8px] tracking-widest uppercase" style={{ color: t.dim }}>{label}</div>
                    <div className="text-sm mt-0.5" style={{ fontFamily: mono, color: t.text }}>
                      {Number(value).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px]" style={{ color: t.dim }}>
                  {year.active
                    ? `Started ${fmt(year.startedAt)}`
                    : year.closedAt
                      ? `Closed ${fmt(year.closedAt)}`
                      : "Archived"}
                </span>
                <button
                  onClick={() => void openYear(year.sy)}
                  className="px-3 py-1.5 text-[11px] rounded-sm cursor-pointer border transition-colors"
                  style={{ color: t.text, borderColor: t.border, background: t.surface2 }}
                >
                  {openSy === year.sy ? "Reload archive" : year.active ? "View current data" : "Open archive"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {openSy && (
        <div style={panel} className="p-5 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>
                {openSy === activeSy ? "Current year" : "Archived year"} · read-only
              </div>
              <div className="text-lg font-semibold mt-1" style={{ color: t.text }}>
                SY {formatSchoolYear(openSy)}
              </div>
            </div>
            <button
              onClick={() => {
                setOpenSy(null);
                setArchive(null);
                setSchoolFocus(null);
              }}
              className="text-[11px] cursor-pointer"
              style={{ color: t.dim }}
            >
              ✕ close
            </button>
          </div>

          {loadingArchive && <p className="text-xs" style={{ color: t.dim }}>Loading the archive…</p>}

          {archive && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Learners" value={archivedLearners} accent t={t} />
                <Stat label="Period records" value={archive.records.length} t={t} />
                <Stat label="Schools with data" value={schoolRows.length} t={t} />
                <Stat label="Feedback" value={archive.feedbacks.length} t={t} />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>Period</span>
                {(["All", "Baseline", "Midline", "Endline"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="px-3 py-1.5 text-[11px] rounded-sm cursor-pointer border"
                    style={
                      period === p
                        ? { background: t.accentBg, color: t.accent, borderColor: t.accent + "40" }
                        : { background: t.surface, color: t.dim, borderColor: t.border }
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>

              {schoolRows.length === 0 ? (
                <div className="p-6 text-center" style={{ border: `1px dashed ${t.border}` }}>
                  <p className="text-sm" style={{ color: t.sub }}>No learner records were encoded this year.</p>
                  <p className="text-xs mt-1" style={{ color: t.dim }}>
                    {archive.feedbacks.length > 0
                      ? "The feedback below was still sent up."
                      : "Nothing was submitted through the School Portal."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto" style={{ border: `1px solid ${t.border}` }}>
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.border}`, background: t.surfaceDeep }}>
                        {["School", "Learners", "Records", "Feedback", ""].map((h) => (
                          <th
                            key={h}
                            className={`px-4 py-2.5 text-[9px] tracking-widest uppercase ${h === "School" ? "text-left" : "text-center"}`}
                            style={{ color: t.dim }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {schoolRows.map((row) => (
                        <tr key={row.school.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <Pill
                                label={row.school.type === "Elementary" ? "ES" : "HS"}
                                color={row.school.type === "Elementary" ? t.blue : t.lime}
                              />
                              <span style={{ color: t.text }}>{row.school.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center" style={{ fontFamily: mono, color: t.text }}>
                            {row.learners}
                          </td>
                          <td className="px-4 py-2.5 text-center" style={{ fontFamily: mono, color: t.sub }}>
                            {row.records}
                          </td>
                          <td className="px-4 py-2.5 text-center" style={{ fontFamily: mono, color: t.sub }}>
                            {row.feedback}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setSchoolFocus(schoolFocus === row.school.id ? null : row.school.id)}
                                className="px-2.5 py-1 text-[10px] rounded-sm cursor-pointer border"
                                style={{ color: t.text, borderColor: t.border, background: t.surface2 }}
                              >
                                {schoolFocus === row.school.id ? "Hide learners" : "View learners"}
                              </button>
                              <button
                                onClick={() => void exportSchool(row.school.id)}
                                className="px-2.5 py-1 text-[10px] rounded-sm cursor-pointer border"
                                style={{ color: t.accent, borderColor: t.accent + "40", background: t.accentBg }}
                              >
                                ↓ Export
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {schoolFocus && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-[9px] tracking-widest uppercase" style={{ color: t.dim }}>
                        Archived learners
                      </div>
                      <div className="text-sm mt-1" style={{ color: t.text }}>
                        {schoolName(schoolFocus)} · {learnerRows.length} {period === "All" ? "period " : ""}records
                      </div>
                    </div>
                    <button
                      onClick={() => setSchoolFocus(null)}
                      className="text-[11px] cursor-pointer"
                      style={{ color: t.dim }}
                    >
                      ✕ hide
                    </button>
                  </div>
                  {learnerRows.length === 0 ? (
                    <p className="text-xs" style={{ color: t.dim }}>No records in this period.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto" style={{ border: `1px solid ${t.border}` }}>
                      <table className="w-full text-xs min-w-[640px]">
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${t.border}`, background: t.surfaceDeep }}>
                            {["Learner", "Grade", "Sex", "Period", "BMI", "HFA", "Status"].map((h) => (
                              <th
                                key={h}
                                className={`px-3 py-2 text-[8px] tracking-widest uppercase ${h === "Learner" ? "text-left" : "text-center"}`}
                                style={{ color: t.dim }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {learnerRows.map((r) => (
                            <tr key={r.id} style={{ borderBottom: `1px solid ${t.surfaceDeep}` }}>
                              <td className="px-3 py-2" style={{ color: t.text }}>{r.name || "—"}</td>
                              <td className="px-3 py-2 text-center" style={{ color: t.sub }}>{r.gradeLevel || "—"}</td>
                              <td className="px-3 py-2 text-center" style={{ color: t.sub }}>{r.sex || "—"}</td>
                              <td className="px-3 py-2 text-center" style={{ color: t.period[r.period] ?? t.sub }}>{r.period}</td>
                              <td className="px-3 py-2 text-center" style={{ fontFamily: mono, color: t.sub }}>{r.bmi || "—"}</td>
                              <td className="px-3 py-2 text-center" style={{ fontFamily: mono, color: t.sub }}>{r.hfaStatus || "—"}</td>
                              <td className="px-3 py-2 text-center" style={{ color: t.sub }}>{r.nutritionalStatus || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="text-[9px] tracking-widest uppercase mb-3" style={{ color: t.dim }}>
                  Feedback sent up that year
                </div>
                {archive.feedbacks.length === 0 ? (
                  <p className="text-xs" style={{ color: t.dim }}>No feedback was recorded this year.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {archive.feedbacks.slice(0, 8).map((f) => (
                      <div key={f.id} className="p-3.5" style={{ border: `1px solid ${t.border}`, background: t.surface2 }}>
                        <div className="flex items-center gap-2 flex-wrap text-[10px]" style={{ color: t.dim }}>
                          <span className="text-xs font-medium" style={{ color: t.text }}>{schoolName(f.schoolId)}</span>
                          <Pill label={f.category} color={t.blue} />
                          <Pill label={f.status} color={f.status === "Resolved" ? t.accent : f.status === "New" ? t.orange : t.blue} />
                          <span className="ml-auto" style={{ color: t.faint }}>{fmt(f.createdAt)}</span>
                        </div>
                        <p className="text-xs mt-2 leading-relaxed" style={{ color: t.sub }}>{f.message}</p>
                        <p className="text-[10px] mt-1.5" style={{ color: t.faint }}>{f.author}{f.role ? ` · ${f.role}` : ""}</p>
                        {f.response && (
                          <p className="text-[11px] mt-2 pl-2 leading-relaxed" style={{ color: t.accent, borderLeft: `2px solid ${t.accent}` }}>
                            {f.response}
                          </p>
                        )}
                      </div>
                    ))}
                    {archive.feedbacks.length > 8 && (
                      <p className="text-[10px]" style={{ color: t.dim }}>
                        Showing the 8 most recent of {archive.feedbacks.length}.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <p className="text-[10px] leading-relaxed" style={{ color: t.faint }}>
                Exports use the school information block as it stood in SY {formatSchoolYear(archive.sy)}.
                The current school profile is always the one on the console's All Schools page.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
