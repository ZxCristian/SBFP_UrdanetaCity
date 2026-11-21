/**
 * School years — the boundary between one year's working data and its archive.
 *
 * Starting a new one closes the current row, snapshots the school information
 * block that the printed forms carry, and opens the next year. Learner records
 * and feedback are not moved or copied: each row already carries the year it
 * belongs to (`sy`), so the active-year reads simply stop seeing the old rows
 * and the archive reads them by year. Archived years older than the five-year
 * retention window are removed permanently when a new year starts.
 *
 * This module is plain functions over `Sql` (the same pattern as
 * `sbfp-accounts.ts`) so the PGlite test can exercise the real SQL. It must not
 * import `sbfp-accounts.ts`: that module imports the active-year helper here.
 */
import type { Sql } from "./db.ts";
import type {
  SchoolFormDetails,
  SchoolFeedback,
  Student,
  SummaryExtra,
} from "@/lib/sbfp-shared";

/** One row of the School Years page. */
export interface SchoolYearSummary {
  sy: string;
  startedAt: string;
  /** Null while this is the active year. */
  closedAt: string | null;
  active: boolean;
  /** All period records in the year. */
  records: number;
  /** Distinct learners (name + birth date + sex + school), not period rows. */
  learners: number;
  feedback: number;
  /** Schools with at least one learner record in the year. */
  schools: number;
}

/** A past year, read-only: its learner rows, feedback and form headers. */
export interface ArchivedSchoolYear {
  sy: string;
  records: Student[];
  feedbacks: SchoolFeedback[];
  /** The archived school information block, keyed by school id. */
  profiles: Record<string, SchoolFormDetails>;
  /** Form 2's hand-entered at-risk / IP counts for this year. */
  summaryExtras: SummaryExtra[];
}

export type SchoolYearErrorCode = "invalid_year" | "year_exists" | "year_not_found";

/** A refusal the School Years page can explain. */
export class SchoolYearError extends Error {
  readonly code: SchoolYearErrorCode;
  constructor(code: SchoolYearErrorCode, message: string) {
    super(message);
    this.name = "SchoolYearError";
    this.code = code;
  }
}

const SCHOOL_YEAR_RE = /^(\d{4})-(\d{4})$/;

/**
 * The school year the calendar is in, used only when the database has no year
 * row yet. Philippine school years open in June, so January–May still belong
 * to the year that started the previous June.
 */
export function currentSchoolYear(now = new Date()): string {
  const year = now.getFullYear();
  const start = now.getMonth() >= 5 ? year : year - 1;
  return `${start}-${start + 1}`;
}

/** "2025-2026" → "2025–2026", the way the printed forms write it. */
export function formatSchoolYear(sy: string): string {
  const match = SCHOOL_YEAR_RE.exec(sy.trim());
  return match ? `${match[1]}–${match[2]}` : sy;
}

/** The year after `sy`: "2025-2026" → "2026-2027" (empty when malformed). */
export function nextSchoolYear(sy: string): string {
  const match = SCHOOL_YEAR_RE.exec(sy.trim());
  if (!match) return "";
  return `${match[2]}-${Number(match[2]) + 1}`;
}

/** Why `sy` is not a valid school year, or null when it is. */
export function schoolYearProblem(sy: string): string | null {
  const match = SCHOOL_YEAR_RE.exec(sy.trim());
  if (!match) return "Use the school year format 2025-2026.";
  if (Number(match[2]) !== Number(match[1]) + 1) {
    return "The two years have to be consecutive, like 2025-2026.";
  }
  return null;
}

function isoOf(value: string | Date | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The year the app is working in. Falls back to the newest year in the table —
 * and, only if the table is somehow empty, to the calendar's current year — so
 * a page never renders without a year.
 */
export async function getActiveSchoolYear(sql: Sql): Promise<string> {
  const open = await sql<{ sy: string }>`
    select sy from sbfp_school_years where closed_at is null order by sy desc limit 1
  `;
  if (open[0]?.sy) return open[0].sy;
  const latest = await sql<{ sy: string }>`
    select sy from sbfp_school_years order by sy desc limit 1
  `;
  return latest[0]?.sy ?? currentSchoolYear();
}

/** How many school years of archived learner data the district keeps. */
export const ARCHIVE_RETENTION_YEARS = 5;

/**
 * Oldest school year that is still kept. The active year counts as one of the
 * five, so opening 2030-2031 keeps 2026-2027 through 2030-2031 and retires
 * 2025-2026 and anything older. Exported so the UI can say what will happen
 * before the next year starts.
 */
export function retentionCutoff(activeSy: string, keep = ARCHIVE_RETENTION_YEARS): string | null {
  const match = SCHOOL_YEAR_RE.exec(activeSy.trim());
  if (!match || keep < 1) return null;
  const start = Number(match[1]) - (keep - 1);
  return `${start}-${start + 1}`;
}

/**
 * Permanently remove archived years older than the retention window.
 *
 * This only ever touches CLOSED years; the active year and the newest archived
 * years stay readable. Deleting the year row last keeps the archive's foreign
 * key valid if a run is interrupted, and the next run can safely continue.
 */
export async function purgeExpiredSchoolYears(
  sql: Sql,
  keep = ARCHIVE_RETENTION_YEARS,
): Promise<string[]> {
  const activeSy = await getActiveSchoolYear(sql);
  const cutoff = retentionCutoff(activeSy, keep);
  if (!cutoff) return [];

  const expired = await sql<{ sy: string }>`
    select sy from sbfp_school_years
    where closed_at is not null and sy < ${cutoff}
    order by sy
  `;
  const years = expired.map((row) => row.sy);
  for (const sy of years) {
    await sql`delete from sbfp_records where sy = ${sy}`;
    await sql`delete from sbfp_feedback where sy = ${sy}`;
    await sql`delete from sbfp_summary_extras where sy = ${sy}`;
    await sql`delete from sbfp_school_profiles_archive where sy = ${sy}`;
    await sql`delete from sbfp_school_years where sy = ${sy}`;
  }
  return years;
}

/** Every year, newest first, with the counts the School Years page shows. */
export async function listSchoolYears(sql: Sql): Promise<SchoolYearSummary[]> {
  const rows = await sql.query<{
    sy: string;
    started_at: string | Date;
    closed_at: string | Date | null;
    records: number | string;
    learners: number | string;
    feedback: number | string;
    schools: number | string;
  }>(
    `select y.sy, y.started_at, y.closed_at,
       (select count(*) from sbfp_records r
          where r.deleted_at is null and r.sy = y.sy) as records,
       (select count(distinct (r.school_id, r.name, r.date_of_birth, r.sex))
          from sbfp_records r where r.deleted_at is null and r.sy = y.sy) as learners,
       (select count(*) from sbfp_feedback f where f.sy = y.sy) as feedback,
       (select count(distinct r.school_id) from sbfp_records r
          where r.deleted_at is null and r.sy = y.sy) as schools
     from sbfp_school_years y
     order by y.sy desc`,
  );
  return rows.map((row) => ({
    sy: row.sy,
    startedAt: isoOf(row.started_at),
    closedAt: row.closed_at ? isoOf(row.closed_at) : null,
    active: !row.closed_at,
    records: Number(row.records ?? 0),
    learners: Number(row.learners ?? 0),
    feedback: Number(row.feedback ?? 0),
    schools: Number(row.schools ?? 0),
  }));
}

/**
 * Close the active year and open `requested`.
 *
 * The current school information is copied into the archive first, then the
 * live rows are cleared — "everything except accounts" resets for the new year.
 * Learner records and feedback are left untouched; their `sy` stamp is what
 * keeps them in the old year.
 */
export async function startNewSchoolYear(
  sql: Sql,
  requested: string,
): Promise<{ sy: string; closedSy: string }> {
  const sy = requested.trim();
  const problem = schoolYearProblem(sy);
  if (problem) throw new SchoolYearError("invalid_year", problem);

  const closedSy = await getActiveSchoolYear(sql);
  const existing = await sql<{ sy: string }>`
    select sy from sbfp_school_years where sy = ${sy}
  `;
  if (existing[0]) {
    throw new SchoolYearError(
      "year_exists",
      `${formatSchoolYear(sy)} has already been opened once.`,
    );
  }
  if (sy <= closedSy) {
    throw new SchoolYearError(
      "invalid_year",
      `The new school year has to come after ${formatSchoolYear(closedSy)}.`,
    );
  }

  // Snapshot this year's form headers before the live block is cleared.
  await sql`
    insert into sbfp_school_profiles_archive
      (sy, school_id, division, city_municipality_barangay, school_id_number,
       sped_school_id_number, principal, focal_person, date_start_feeding,
       last_mile_school, archived_at)
    select ${closedSy}, school_id, division, city_municipality_barangay, school_id_number,
           sped_school_id_number, principal, focal_person, date_start_feeding,
           last_mile_school, now()
    from sbfp_school_profiles
    on conflict (sy, school_id) do update set
      division = excluded.division,
      city_municipality_barangay = excluded.city_municipality_barangay,
      school_id_number = excluded.school_id_number,
      sped_school_id_number = excluded.sped_school_id_number,
      principal = excluded.principal,
      focal_person = excluded.focal_person,
      date_start_feeding = excluded.date_start_feeding,
      last_mile_school = excluded.last_mile_school,
      archived_at = now()
  `;

  await sql`
    update sbfp_school_years set closed_at = now()
    where sy = ${closedSy} and closed_at is null
  `;
  try {
    await sql`insert into sbfp_school_years (sy) values (${sy})`;
  } catch {
    // Put the old year back rather than leaving the app with no active year.
    // The guard keeps the partial unique index happy if another request has
    // already opened a year in the meantime.
    await sql`
      update sbfp_school_years set closed_at = null
      where sy = ${closedSy}
        and not exists (select 1 from sbfp_school_years where closed_at is null)
    `.catch(() => undefined);
    throw new SchoolYearError(
      "year_exists",
      `${formatSchoolYear(sy)} could not be opened. Try again.`,
    );
  }

  // The trash is emptied when a new school year opens: a deleted record is
  // recoverable for the rest of the year it was deleted in, and permanently
  // gone once the school moves to the next year. This happens only after the
  // new year is open, so a refused year never destroys anything.
  await sql`delete from sbfp_records where deleted_at is not null`;

  // "Everything except accounts": the new year starts with blank school
  // information, re-entered by each school. The snapshot above keeps the old
  // one with the archive.
  await sql`delete from sbfp_school_profiles`;

  // Archived years beyond the five-year window are retired now, while the year
  // boundary is already being written. This is intentionally best-effort: the
  // school year has opened successfully, and a failed cleanup must not make the
  // caller think the new year did not start. A later year start retries it.
  await purgeExpiredSchoolYears(sql).catch((err) => {
    console.error("[school-years] archive retention cleanup failed", err);
  });

  return { sy, closedSy };
}
