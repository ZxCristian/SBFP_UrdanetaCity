/**
 * Aggregate reads for large school years.
 *
 * The Division Office used to download every learner row just to draw the
 * dashboard. At 20,000 learners (three feeding periods each) that is both a
 * large response and a lot of work for the browser. These queries compute the
 * same figures in Postgres, so the console can show the district totals without
 * holding every row in memory. Raw records are then loaded one school at a time,
 * only when the Division Office opens that school.
 */
import type { Sql } from "./db.ts";
import { currentSchoolYear } from "./sbfp-years.ts";
import {
  BMI_STATUSES,
  HFA_STATUSES,
  PERIODS,
  type DivisionSummary,
  type DivisionSummarySlice,
  type Period,
  type SchoolRecordStats,
} from "./sbfp-domain.ts";

const ACTIVE_YEAR = `coalesce(
  (select sy from sbfp_school_years where closed_at is null order by sy desc limit 1),
  (select sy from sbfp_school_years order by sy desc limit 1),
  '${currentSchoolYear()}'
)`;

/** One unique learner, choosing the latest feeding period they have. */
const UNIQUE_LEARNERS = `
  with ranked as (
    select r.*,
      row_number() over (
        partition by r.school_id, r.name, r.date_of_birth, r.sex
        order by case r.period
          when 'Endline' then 0
          when 'Midline' then 1
          else 2
        end, r.updated_at desc
      ) as rn
    from sbfp_records r
    where r.deleted_at is null and r.sy = ${ACTIVE_YEAR}
  ),
  learners as (
    select ranked.*, s.type as school_type
    from ranked
    left join sbfp_schools s on s.id = ranked.school_id
    where ranked.rn = 1
  )
`;

function emptySlice(): DivisionSummarySlice {
  return {
    learners: 0,
    schoolsWithData: 0,
    bmi: Object.fromEntries(BMI_STATUSES.map((status) => [status, 0])),
    hfa: Object.fromEntries(HFA_STATUSES.map((status) => [status, 0])),
    periods: PERIODS.map((period) => ({ period, learners: 0 })),
    topSchools: [],
  };
}

function addStatus(target: Record<string, number>, status: string, count: number) {
  if (!status) return;
  target[status] = (target[status] ?? 0) + count;
}

/**
 * Per-school active-year totals. `records` counts period rows; `learners`
 * deduplicates the same person across Baseline/Midline/Endline.
 */
export async function schoolRecordStats(sql: Sql): Promise<SchoolRecordStats[]> {
  const rows = await sql.query<{
    school_id: string;
    records: number | string;
    learners: number | string;
    periods: string[] | null;
  }>(
    `select school_id,
       count(*)::int as records,
       count(distinct (name, date_of_birth, sex))::int as learners,
       array_agg(distinct period) as periods
     from sbfp_records
     where deleted_at is null and sy = ${ACTIVE_YEAR}
     group by school_id
     order by school_id`,
  );
  return rows.map((row) => ({
    schoolId: row.school_id,
    records: Number(row.records ?? 0),
    learners: Number(row.learners ?? 0),
    periods: (row.periods ?? []).filter((p): p is Period =>
      (PERIODS as string[]).includes(p),
    ),
  }));
}

/**
 * The dashboard's figures, in three slices (all, elementary, high school).
 * Unique learners are the same people counted by the live dashboard: one row
 * per school/name/birth date/sex, preferring Endline, then Midline, Baseline.
 */
export async function divisionSummary(sql: Sql): Promise<DivisionSummary> {
  const [statusRows, schoolRows, periodRows] = await Promise.all([
    sql.query<{
      school_type: string;
      bmi_status: string | null;
      hfa_status: string | null;
      n: number | string;
    }>(
      `${UNIQUE_LEARNERS}
       select school_type, bmi_status, hfa_status, count(*)::int as n
       from learners
       group by school_type, bmi_status, hfa_status`,
    ),
    sql.query<{
      school_type: string;
      schools: number | string;
      learners: number | string;
    }>(
      `${UNIQUE_LEARNERS}
       select school_type, count(distinct school_id)::int as schools,
              count(*)::int as learners
       from learners
       group by school_type`,
    ),
    sql.query<{
      school_type: string;
      period: string;
      learners: number | string;
    }>(
      `select s.type as school_type, r.period,
         count(distinct (r.school_id, r.name, r.date_of_birth, r.sex))::int as learners
       from sbfp_records r
       left join sbfp_schools s on s.id = r.school_id
       where r.deleted_at is null and r.sy = ${ACTIVE_YEAR}
       group by s.type, r.period`,
    ),
  ]);

  const slices: Record<string, DivisionSummarySlice> = {
    all: emptySlice(),
    Elementary: emptySlice(),
    "High School": emptySlice(),
  };
  const addTo = (slice: DivisionSummarySlice, row: {
    school_type: string;
    bmi_status: string | null;
    hfa_status: string | null;
    n: number | string;
  }) => {
    const n = Number(row.n ?? 0);
    slice.learners += n;
    addStatus(slice.bmi, row.bmi_status ?? "", n);
    addStatus(slice.hfa, row.hfa_status ?? "", n);
  };

  for (const row of statusRows) {
    addTo(slices.all, row);
    if (row.school_type === "High School") addTo(slices["High School"], row);
    else addTo(slices.Elementary, row);
  }

  for (const row of schoolRows) {
    const slice = row.school_type === "High School" ? slices["High School"] : slices.Elementary;
    const count = Number(row.schools ?? 0);
    slice.schoolsWithData = count;
    slices.all.schoolsWithData += count;
  }

  for (const row of periodRows) {
    const period = row.period as Period;
    if (!PERIODS.includes(period)) continue;
    const n = Number(row.learners ?? 0);
    const add = (slice: DivisionSummarySlice) => {
      const found = slice.periods.find((entry) => entry.period === period);
      if (found) found.learners += n;
    };
    add(slices.all);
    add(row.school_type === "High School" ? slices["High School"] : slices.Elementary);
  }

  const topRows = await sql.query<{
    school_id: string;
    school_type: string;
    learners: number | string;
    at_risk: number | string;
  }>(
    `${UNIQUE_LEARNERS},
     grouped as (
       select school_id, school_type, count(*)::int as learners,
         count(*) filter (where bmi_status in ('Severely Wasted', 'Wasted'))::int as at_risk
       from learners
       group by school_id, school_type
     ),
     ranked_schools as (
       select school_id, school_type, learners, at_risk,
         row_number() over (
           partition by school_type
           order by at_risk desc, learners desc, school_id
         ) as rn
       from grouped
     )
     select school_id, school_type, learners, at_risk
     from ranked_schools
     where rn <= 8
     order by school_type, at_risk desc, learners desc, school_id`,
  );
  for (const row of topRows) {
    const entry = {
      schoolId: row.school_id,
      learners: Number(row.learners ?? 0),
      atRisk: Number(row.at_risk ?? 0),
    };
    slices.all.topSchools.push(entry);
    if (row.school_type === "High School") slices["High School"].topSchools.push(entry);
    else slices.Elementary.topSchools.push(entry);
  }
  slices.all.topSchools = slices.all.topSchools.slice(0, 8);
  slices.Elementary.topSchools = slices.Elementary.topSchools.slice(0, 8);
  slices["High School"].topSchools = slices["High School"].topSchools.slice(0, 8);

  return {
    all: slices.all,
    elementary: slices.Elementary,
    highSchool: slices["High School"],
    elementaryLearners: slices.Elementary.learners,
    highSchoolLearners: slices["High School"].learners,
  };
}
