/**
 * Sample learner data for the preview database.
 *
 * The live preview runs on the embedded PGlite database, which starts empty and
 * resets whenever the dev server restarts. This module fills it with a realistic
 * demo district — at least 500 unique learners in every school, all three
 * feeding periods, and a dedicated SPED cohort at Urdaneta I Central — so the
 * dashboard, per-school tables, exports and Form 2 all have real data to show.
 *
 * It is only wired into the PGLite fallback (`ensureSampleData` is called from
 * `sbfp-api.ts` when `dbSource === "pglite"`). A database that already holds
 * learner records is never mixed with sample rows: `seedSampleData` refuses when
 * it finds records it did not create. The `npm run seed` script can fill a
 * configured Postgres database on demand.
 *
 * Everything here is deterministic, so two runs produce the same learners and
 * measurements. Heights, weights and statuses come from the same WHO 2007
 * references the app classifies with, so the stored `bmi`/`bmiStatus` and
 * `hfaStatus` agree with each other.
 */
import type { Sql } from "./db.ts";
import {
  bmiReference,
  calcBMI,
  classifyBeneficiary,
  classifyBMI,
  classifyHFA,
  getGrades,
  hfaReference,
  type GradeLevel,
  type Period,
  type School,
  type Sex,
  type Student,
} from "./sbfp-domain.ts";
import { listSchools } from "./sbfp-schools.ts";
import { getActiveSchoolYear } from "./sbfp-years.ts";

/** Unique learners seeded into each school, before the SPED cohort. */
export const SAMPLE_LEARNERS_PER_SCHOOL = 500;
/** Learners seeded into each SPED grade at the division's SPED center. */
export const SAMPLE_SPED_LEARNERS_PER_GRADE = 15;
/** Marks the rows this module owns; also how a resume knows what to count. */
export const SAMPLE_ENCODED_BY = "sample-data";
export const SAMPLE_PERIODS: readonly Period[] = ["Baseline", "Midline", "Endline"];

const FIRST_NAMES_F = [
  "Maria", "Ana", "Angel", "Bea", "Carla", "Christine", "Divine", "Ella",
  "Faith", "Grace", "Hannah", "Irish", "Jasmine", "Joy", "Karen", "Kristine",
  "Liza", "Mae", "Nicole", "Princess", "Rachel", "Rose", "Sarah", "Sofia",
  "Trisha", "Victoria", "Alyssa", "Danica", "Erika", "Michelle", "Angelica",
  "Camille", "Charmaine", "Diana", "Elaine", "Fiona", "Geraldine", "Hazel",
  "Irene", "Jacqueline",
] as const;

const FIRST_NAMES_M = [
  "Juan", "Jose", "Mark", "Angelo", "John Paul", "Carlo", "Miguel", "Gabriel",
  "Rafael", "Daniel", "Joshua", "Christian", "Emmanuel", "Paolo", "Adrian",
  "Kenneth", "Jomar", "Jayson", "Rodel", "Arnel", "Dennis", "Rommel", "Erwin",
  "Joel", "Bryan", "Kevin", "Ryan", "Ivan", "Marco", "Luis", "Nico", "Alvin",
  "Benjie", "Crisanto", "Dominic", "Eduardo", "Ferdinand", "Gerardo", "Harvey",
  "Ian",
] as const;

const SURNAMES = [
  "Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza",
  "Torres", "Flores", "Ramos", "Aquino", "Villanueva", "Castillo", "Dela Cruz",
  "Mercado", "Pascual", "Rivera", "Gonzales", "Lopez", "Perez", "Fernandez",
  "Marquez", "Domingo", "Manalo", "Salazar", "Navarro", "Velasco", "Soriano",
  "Estrada", "Padilla", "Rosales", "Cabrera", "Agustin", "Andres", "Braganza",
  "Carino", "Dizon", "Enriquez", "Ferrer", "Galvez", "Herrera", "Ignacio",
  "Javier", "Lacson", "Macaraeg", "Nicolas", "Ordonez", "Peralta", "Quinto",
  "Rabang", "Salcedo", "Tamayo", "Ulit", "Valdez", "Yabut", "Zamora",
  "Abad", "Bernardo", "Castro", "Delos Santos",
] as const;

const MIDDLE_INITIALS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

/** The usual age for a grade, in years. SPED cohorts run a year older. */
const GRADE_BASE_AGE: Partial<Record<GradeLevel, number>> = {
  Kinder: 5,
  "Grade 1": 6,
  "Grade 2": 7,
  "Grade 3": 8,
  "Grade 4": 9,
  "Grade 5": 10,
  "Grade 6": 11,
  "Grade 7": 12,
  "Grade 8": 13,
  "Grade 9": 14,
  "Grade 10": 15,
  "Grade 11": 16,
  "Grade 12": 17,
  "SPED Kinder": 6,
  "SPED Grade 1": 7,
  "SPED Grade 2": 8,
  "SPED Grade 3": 9,
  "SPED Grade 4": 10,
  "SPED Grade 5": 11,
  "SPED Grade 6": 12,
};

type SampleRecord = Omit<Student, "schoolId">;

interface SampleLearner {
  /** Stable across periods and across reruns. */
  id: string;
  name: string;
  sex: Sex;
  gradeLevel: GradeLevel;
  dateOfBirth: string;
  baselineHeight: number;
  growthPerPeriod: number;
  /** Baseline BMI-for-age z-score; the feeding periods improve undernourished learners. */
  bmiZ: number;
  undernourished: boolean;
  dewormed: "Yes" | "No";
  parentConsentMilk: "Yes" | "No";
  fourPs: "Yes" | "No";
  sbfpPreviousYears: "Yes" | "No";
  pregnant: "Yes" | "No";
  hasYoungChildren: "Yes" | "No";
}

/** FNV-1a — a small, stable string hash so every school/learner gets its own sequence. */
function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic value in [0, 1) from an integer seed. */
function unit(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function syStartYear(sy: string): number {
  const match = /^(\d{4})-\d{4}$/.exec(sy.trim());
  return match ? Number(match[1]) : new Date().getFullYear();
}

/**
 * Weighing dates inside the active school year, matching the SBFP feeding
 * rounds (baseline before feeding, midline halfway, endline after feeding).
 */
function weighingDates(sy: string): Record<Period, string> {
  const start = syStartYear(sy);
  return {
    Baseline: `${start}-07-15`,
    Midline: `${start}-10-15`,
    Endline: `${start + 1}-02-16`,
  };
}

/** A learner's exact age on a date, the same rule the app's `computeAge` uses. */
function ageOn(dateOfBirth: string, onIso: string): { years: number; months: number } {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const on = new Date(`${onIso}T00:00:00Z`);
  let years = on.getUTCFullYear() - birth.getUTCFullYear();
  let months = on.getUTCMonth() - birth.getUTCMonth();
  if (on.getUTCDate() < birth.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months };
}

/**
 * A height-for-age z-score inside one of the WHO categories. The values sit
 * away from the cutoffs (-3, -2, 2) so a rounded centimetre cannot flip the
 * category that was intended.
 */
function hfaZFor(seed: number, sped: boolean): number {
  const roll = unit(seed);
  const severe = sped ? 0.12 : 0.07;
  const stunted = sped ? 0.28 : 0.2;
  const tall = sped ? 0.04 : 0.05;
  if (roll < severe) return -3.85 + unit(seed + 1) * 0.6; // Severely Stunted
  if (roll < severe + stunted) return -2.85 + unit(seed + 1) * 0.65; // Stunted
  if (roll > 1 - tall) return 2.2 + unit(seed + 1) * 0.7; // Tall
  return -1.6 + unit(seed + 1) * 3.2; // Normal
}

/**
 * A BMI-for-age z-score inside one of the WHO categories, again clear of every
 * cutoff (-3, -2, 1, 2). SPED cohorts carry a little more undernutrition, as
 * the program's target list usually does.
 */
function bmiZFor(seed: number, sped: boolean): number {
  const roll = unit(seed);
  const severe = sped ? 0.12 : 0.08;
  const wasted = sped ? 0.2 : 0.16;
  const overweight = 0.1;
  const obese = sped ? 0.07 : 0.06;
  if (roll < severe) return -3.9 + unit(seed + 1) * 0.7; // Severely Wasted
  if (roll < severe + wasted) return -2.85 + unit(seed + 1) * 0.7; // Wasted
  if (roll > 1 - obese) return 2.2 + unit(seed + 1) * 0.8; // Obese
  if (roll > 1 - obese - overweight) return 1.15 + unit(seed + 1) * 0.75; // Overweight
  return -1.5 + unit(seed + 1) * 2.3; // Normal
}

function makeLearner(
  school: School,
  index: number,
  tag: "regular" | "sped",
  gradeLevel: GradeLevel,
  sy: string,
  dates: Record<Period, string>,
): SampleLearner {
  const seed = hashText(`${school.id}:${sy}:${tag}:${index}`);
  const sex: Sex = index % 2 === 0 ? "F" : "M";
  const pool = sex === "F" ? FIRST_NAMES_F : FIRST_NAMES_M;
  // The regular and SPED cohorts use different parts of the name space, so a
  // SPED learner never shares a name with a regular learner in the same school.
  const nameIndex = Math.floor(index / 2) + (tag === "sped" ? 300 : 0);
  const first = pool[nameIndex % pool.length];
  const schoolSeed = hashText(school.id);
  const middle =
    MIDDLE_INITIALS[(Math.floor(nameIndex / 9) + schoolSeed) % MIDDLE_INITIALS.length];
  const last = SURNAMES[(schoolSeed + nameIndex * 7) % SURNAMES.length];

  const age = GRADE_BASE_AGE[gradeLevel] ?? 10;
  const monthsAgo = 2 + Math.floor(unit(seed + 3) * 10); // 2–11 months before the baseline
  const totalMonths = age * 12 + monthsAgo;
  const monthIndex = 6 - totalMonths; // 6 = July, the baseline month
  const birthYear = syStartYear(sy) + Math.floor(monthIndex / 12);
  const birthMonth = ((monthIndex % 12) + 12) % 12;
  const birthDay = 1 + Math.floor(unit(seed + 4) * 28);
  const dateOfBirth = new Date(Date.UTC(birthYear, birthMonth, birthDay))
    .toISOString()
    .slice(0, 10);

  const hfaZ = hfaZFor(seed + 5, tag === "sped");
  const bmiZ = bmiZFor(seed + 6, tag === "sped");
  const baselineAge = ageOn(dateOfBirth, dates.Baseline).years;
  const heightRef = hfaReference(baselineAge, sex) ?? hfaReference(10, sex);
  const baselineHeight = (heightRef?.[0] ?? 130) + hfaZ * (heightRef?.[1] ?? 5);

  return {
    id: `sample-${sy}-${school.id}-${tag}-${String(index).padStart(4, "0")}`,
    name: `${first} ${middle}. ${last}`,
    sex,
    gradeLevel,
    dateOfBirth,
    baselineHeight,
    // 2–3.6 cm per feeding period: enough for a child to keep pace with the
    // WHO median as they age, without every learner turning "Tall".
    growthPerPeriod: 2 + unit(seed + 7) * 1.6,
    bmiZ,
    undernourished: bmiZ < -2,
    dewormed: unit(seed + 10) < 0.86 ? "Yes" : "No",
    parentConsentMilk: unit(seed + 11) < 0.92 ? "Yes" : "No",
    fourPs: unit(seed + 12) < 0.38 ? "Yes" : "No",
    sbfpPreviousYears: unit(seed + 13) < 0.32 ? "Yes" : "No",
    pregnant:
      sex === "F" && age >= 12 && unit(seed + 14) < 0.015 ? "Yes" : "No",
    hasYoungChildren:
      sex === "F" && age >= 14 && unit(seed + 15) < 0.01 ? "Yes" : "No",
  };
}

function buildLearners(
  school: School,
  sy: string,
  dates: Record<Period, string>,
): SampleLearner[] {
  const grades = getGrades(school);
  const regularGrades = grades.filter((grade) => !grade.startsWith("SPED "));
  const spedGrades = grades.filter((grade) => grade.startsWith("SPED "));
  const fallback = regularGrades[0] ?? "Grade 1";
  const learners: SampleLearner[] = [];

  for (let i = 0; i < SAMPLE_LEARNERS_PER_SCHOOL; i += 1) {
    const grade =
      regularGrades[Math.floor((i * regularGrades.length) / SAMPLE_LEARNERS_PER_SCHOOL)] ??
      fallback;
    learners.push(makeLearner(school, i, "regular", grade, sy, dates));
  }

  let index = 0;
  for (const grade of spedGrades) {
    for (let i = 0; i < SAMPLE_SPED_LEARNERS_PER_GRADE; i += 1) {
      learners.push(makeLearner(school, index, "sped", grade, sy, dates));
      index += 1;
    }
  }

  return learners;
}

function recordFor(
  learner: SampleLearner,
  period: Period,
  periodIndex: number,
  sy: string,
  dates: Record<Period, string>,
): SampleRecord {
  const dateOfWeighing = dates[period];
  const age = ageOn(learner.dateOfBirth, dateOfWeighing);
  const referenceAge = Math.min(19, Math.max(5, age.years));
  const heightCm = learner.baselineHeight + periodIndex * learner.growthPerPeriod;
  const bmiRef = bmiReference(referenceAge, learner.sex) ?? bmiReference(10, learner.sex);
  // Undernourished learners improve during the feeding program; others stay
  // around the same BMI-for-age. The stored status is re-derived from the
  // rounded weight and height, never guessed.
  const improvement = learner.undernourished ? periodIndex * 0.3 : periodIndex * 0.02;
  const bmiTarget =
    (bmiRef?.[0] ?? 17) + (learner.bmiZ + improvement) * (bmiRef?.[1] ?? 2);
  const weightKg = bmiTarget * (heightCm / 100) ** 2;

  const height = round1(heightCm);
  const weight = round1(weightKg);
  const bmi = calcBMI(weight, height);
  const bmiStatus = classifyBMI(bmi, String(referenceAge), learner.sex);
  const hfaStatus = classifyHFA(height, String(referenceAge), learner.sex);

  return {
    id: `${learner.id}-${period.toLowerCase()}`,
    period,
    sy,
    name: learner.name,
    sex: learner.sex,
    gradeLevel: learner.gradeLevel,
    dateOfBirth: learner.dateOfBirth,
    dateOfWeighing,
    ageYears: String(age.years),
    ageMonths: String(age.months),
    weight,
    height,
    bmi,
    bmiStatus,
    hfaStatus,
    nutritionalStatus: bmiStatus,
    classificationOfBeneficiary: classifyBeneficiary(
      learner.gradeLevel,
      bmiStatus,
      hfaStatus,
    ),
    pregnant: learner.pregnant,
    hasYoungChildren: learner.hasYoungChildren,
    dewormed: learner.dewormed,
    parentConsentMilk: learner.parentConsentMilk,
    fourPs: learner.fourPs,
    sbfpPreviousYears: learner.sbfpPreviousYears,
  };
}

export interface SampleSeedPlan {
  schools: number;
  learners: number;
  records: number;
  spedLearners: number;
}

export interface SampleSeedResult extends SampleSeedPlan {
  /** False when the database already held data (or was already fully seeded). */
  seeded: boolean;
  /** Rows this run actually added (conflict-skipped rows are not counted). */
  inserted: number;
}

/** What a full seed of these schools adds. */
export function sampleSeedPlan(schools: readonly School[]): SampleSeedPlan {
  let learners = 0;
  let spedLearners = 0;
  for (const school of schools) {
    learners += SAMPLE_LEARNERS_PER_SCHOOL;
    const sped = getGrades(school).filter((grade) => grade.startsWith("SPED ")).length;
    const cohort = sped * SAMPLE_SPED_LEARNERS_PER_GRADE;
    if (cohort > 0) {
      learners += cohort;
      spedLearners += cohort;
    }
  }
  return { schools: schools.length, learners, records: learners * SAMPLE_PERIODS.length, spedLearners };
}

/**
 * Insert the demo rows. Safe to call repeatedly:
 *  - a fully seeded active year is a no-op;
 *  - a partially seeded one resumes because every row has a deterministic id
 *    and the insert uses `on conflict (id) do nothing`;
 *  - a database with learner records this module did not write is left alone.
 */
export async function seedSampleData(sql: Sql): Promise<SampleSeedResult> {
  const schools = await listSchools(sql);
  const plan = sampleSeedPlan(schools);
  if (plan.learners === 0) {
    return { ...plan, seeded: false, inserted: 0 };
  }

  const sy = await getActiveSchoolYear(sql);
  const counts = await sql<{ sample: number | string; any: number | string }>`
    select
      count(*) filter (where encoded_by = ${SAMPLE_ENCODED_BY} and sy = ${sy}) as sample,
      count(*) as any
    from sbfp_records
  `;
  const sample = Number(counts[0]?.sample ?? 0);
  const any = Number(counts[0]?.any ?? 0);

  if (sample >= plan.records) {
    return { ...plan, seeded: false, inserted: 0 };
  }
  if (any > 0 && sample === 0) {
    return {
      ...plan,
      schools: schools.length,
      learners: 0,
      records: 0,
      seeded: false,
      inserted: 0,
    };
  }

  const dates = weighingDates(sy);
  for (const school of schools) {
    const learners = buildLearners(school, sy, dates);
    for (let p = 0; p < SAMPLE_PERIODS.length; p += 1) {
      const period = SAMPLE_PERIODS[p] as Period;
      const records = learners.map((learner) =>
        recordFor(learner, period, p, sy, dates),
      );
      for (let i = 0; i < records.length; i += 400) {
        await insertSampleBatch(sql, school.id, records.slice(i, i + 400));
      }
    }
  }

  // Count what the active year holds now instead of assuming every attempted
  // row landed: `on conflict (id) do nothing` makes a resumed run skip rows it
  // has already written, and the log should say what actually changed.
  const afterRows = await sql<{ n: number | string }>`
    select count(*) as n from sbfp_records
    where encoded_by = ${SAMPLE_ENCODED_BY} and sy = ${sy}
  `;
  const inserted = Number(afterRows[0]?.n ?? 0) - sample;

  console.info(
    `[sample-data] ${inserted.toLocaleString()} sample rows — ` +
      `${plan.learners.toLocaleString()} learners across ${plan.schools} schools ` +
      `(including ${plan.spedLearners} SPED learners).`,
  );
  return { ...plan, seeded: true, inserted };
}

async function insertSampleBatch(
  sql: Sql,
  schoolId: string,
  records: readonly SampleRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const tuples: string[] = [];
  const params: unknown[] = [];
  let placeholder = 0;

  for (const record of records) {
    // school_id + the 23 fields on SampleRecord. `encoded_by` is a fixed
    // literal, and created_at/updated_at take their table defaults.
    const placeholders: string[] = [];
    for (let field = 0; field < 24; field += 1) {
      placeholder += 1;
      placeholders.push(`$${placeholder}`);
    }
    tuples.push(`(${placeholders.join(", ")}, '${SAMPLE_ENCODED_BY}')`);
    params.push(
      record.id,
      schoolId,
      record.period,
      record.sy,
      record.name,
      record.sex,
      record.gradeLevel,
      record.dateOfBirth,
      record.dateOfWeighing,
      record.ageYears,
      record.ageMonths,
      record.weight,
      record.height,
      record.bmi,
      record.bmiStatus,
      record.hfaStatus,
      record.nutritionalStatus,
      record.classificationOfBeneficiary,
      record.pregnant,
      record.hasYoungChildren,
      record.dewormed,
      record.parentConsentMilk,
      record.fourPs,
      record.sbfpPreviousYears,
    );
  }

  await sql.query(
    `insert into sbfp_records (
       id, school_id, period, sy, name, sex, grade_level, date_of_birth,
       date_of_weighing, age_years, age_months, weight, height, bmi,
       bmi_status, hfa_status, nutritional_status, classification_of_beneficiary,
       pregnant, has_young_children, dewormed, parent_consent_milk, four_ps,
       sbfp_previous_years, encoded_by)
     values ${tuples.join(", ")}
     on conflict (id) do nothing`,
    params,
  );
}

/**
 * Seed once per process. The promise is shared on `globalThis` so a Vite HMR
 * reload does not start a second pass over 87,000 rows; a failure clears it so
 * the next request retries.
 */
export function ensureSampleData(sql: Sql): Promise<SampleSeedResult> {
  const globalSeed = globalThis as typeof globalThis & {
    __sbfpSampleSeedPromise__?: Promise<SampleSeedResult>;
  };
  globalSeed.__sbfpSampleSeedPromise__ ??= seedSampleData(sql).catch((err) => {
    globalSeed.__sbfpSampleSeedPromise__ = undefined;
    throw err;
  });
  return globalSeed.__sbfpSampleSeedPromise__;
}
