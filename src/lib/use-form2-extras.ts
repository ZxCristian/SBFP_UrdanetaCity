/**
 * The two hand-encoded Form 2 columns, kept locally while a count is typed and
 * written to the server shortly after the last keystroke.
 *
 * The summary sheet shows a controlled input; saving on every digit would be a
 * request per key. This hook keeps the immediate value on screen, batches the
 * write for 650 ms, and adopts the server's copy again once no edit is pending.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { saveSummaryExtra, useTeacherStore } from "@/lib/sbfp-store";
import type { Period } from "@/lib/sbfp-domain";

export interface Form2Extra {
  atRisk: number;
  ips: number;
}

export type Form2ExtraMap = Record<string, Form2Extra>;

export const form2ExtraKey = (grade: string, sex: "M" | "F") => `${grade}|${sex}`;

/**
 * One Form 2 manual figure for a displayed row. A grade's "Total" row adds its
 * male and female cells; a GRAND TOTAL row (grade null) adds every grade.
 */
export function manualTotal(
  extras: Form2ExtraMap,
  grades: readonly string[],
  grade: string | null,
  sex: "M" | "F" | "Total",
  field: keyof Form2Extra,
): number {
  if (grade === null) return grades.reduce((sum, g) => sum + manualTotal(extras, grades, g, sex, field), 0);
  if (sex === "Total") {
    return manualTotal(extras, grades, grade, "M", field) + manualTotal(extras, grades, grade, "F", field);
  }
  return extras[form2ExtraKey(grade, sex)]?.[field] ?? 0;
}

export function useForm2Extras(schoolId: string, period: Period) {
  const store = useTeacherStore();
  const base = useMemo<Form2ExtraMap>(() => {
    const map: Form2ExtraMap = {};
    for (const row of store.summaryExtras) {
      if (row.schoolId !== schoolId || row.period !== period) continue;
      map[form2ExtraKey(row.grade, row.sex)] = { atRisk: row.atRisk, ips: row.ips };
    }
    return map;
  }, [store.summaryExtras, schoolId, period]);

  const [draft, setDraft] = useState<Form2ExtraMap>(base);
  const dirty = useRef(
    new Map<string, { schoolId: string; grade: string; sex: "M" | "F"; period: Period } & Form2Extra>(),
  );
  const timer = useRef<number | undefined>(undefined);
  const context = `${schoolId}|${period}`;
  const previousContext = useRef(context);

  const flush = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    const rows = Array.from(dirty.current.values());
    dirty.current.clear();
    for (const row of rows) {
      void saveSummaryExtra({
        // The row carries its own school: when a different school is opened
        // before the debounce fires, the pending edit must stay with the
        // school it was typed into.
        schoolId: row.schoolId,
        period: row.period,
        grade: row.grade,
        sex: row.sex,
        atRisk: row.atRisk,
        ips: row.ips,
      });
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Switching period or school must write the previous context's pending edit
  // under that context, then show the new context's saved figures. A server
  // refresh replaces the draft only when no local edit is waiting.
  useEffect(() => {
    if (previousContext.current !== context) {
      previousContext.current = context;
      flushRef.current();
      setDraft(base);
      return;
    }
    if (dirty.current.size === 0) setDraft(base);
  }, [base, context]);

  // Leaving the Summary must not lose the last few keystrokes.
  useEffect(() => () => flushRef.current(), []);

  const setExtra = (grade: string, sex: "M" | "F", patch: Partial<Form2Extra>) => {
    const key = form2ExtraKey(grade, sex);
    const dirtyKey = `${schoolId}|${period}|${key}`;
    setDraft((previous) => {
      const current = previous[key] ?? { atRisk: 0, ips: 0 };
      const next = { ...current, ...patch };
      dirty.current.set(dirtyKey, { schoolId, grade, sex, period, ...next });
      return { ...previous, [key]: next };
    });
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flushRef.current, 650);
  };

  return { extras: draft, setExtra };
}
