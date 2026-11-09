/**
 * The division's schools — the database side.
 *
 * The list is data: `sbfp_schools` holds the school's id, name and type, and a
 * left join brings in the SBFP form header the school filled in
 * (`sbfp_school_profiles`), so a read gives exactly the `School` both sites
 * render. The id is the key every other table stores, so renaming a school —
 * or moving it between elementary and high school — never orphans its accounts,
 * learners or feedback.
 *
 * Plain functions over `Sql`, like `sbfp-accounts.ts` and `sbfp-years.ts`, so
 * the rules stay testable against the real SQL. Only the Division Office may
 * add, rename or remove a school; that is enforced in `sbfp-api.ts`.
 */
import type { Sql } from "./db.ts";
import type { School, SchoolFormDetails, SchoolType } from "./sbfp-shared";

export type SchoolErrorCode =
  | "invalid_school"
  | "school_exists"
  | "school_not_found"
  | "school_in_use";

/** A refusal the School list page can explain. */
export class SchoolError extends Error {
  readonly code: SchoolErrorCode;
  constructor(code: SchoolErrorCode, message: string) {
    super(message);
    this.name = "SchoolError";
    this.code = code;
  }
}

interface SchoolDbRow {
  id: string;
  name: string;
  type: string;
  division: string | null;
  city_municipality_barangay: string | null;
  school_id_number: string | null;
  principal: string | null;
  focal_person: string | null;
  date_start_feeding: string | null;
  last_mile_school: string | null;
}

const SCHOOL_SELECT = `
  select s.id, s.name, s.type,
         p.division, p.city_municipality_barangay, p.school_id_number,
         p.principal, p.focal_person, p.date_start_feeding, p.last_mile_school
  from sbfp_schools s
  left join sbfp_school_profiles p on p.school_id = s.id
`;

function toSchool(row: SchoolDbRow): School {
  const header: SchoolFormDetails = {
    division: row.division || "Urdaneta City",
    cityMunicipalityBarangay: row.city_municipality_barangay ?? "",
    schoolIdNumber: row.school_id_number ?? "",
    principal: row.principal ?? "",
    focalPerson: row.focal_person ?? "",
    dateStartFeeding: row.date_start_feeding ?? "",
    lastMileSchool: (row.last_mile_school ?? "") as SchoolFormDetails["lastMileSchool"],
  };
  return {
    id: row.id,
    name: row.name,
    type: (row.type === "High School" ? "High School" : "Elementary") as SchoolType,
    ...header,
  };
}

/**
 * Every school the caller may see: the whole division for the Division Office,
 * only her own school for a teacher (the portal only ever shows one).
 */
export async function listSchools(
  sql: Sql,
  options: { only?: string[] } = {},
): Promise<School[]> {
  const order = "order by s.type, s.sort_order, s.name";
  const rows =
    options.only === undefined
      ? await sql.query<SchoolDbRow>(`${SCHOOL_SELECT} ${order}`)
      : options.only.length === 0
        ? []
        : await sql.query<SchoolDbRow>(
            // Placeholders rather than an array parameter: PGlite and pg agree
            // on `$1, $2, …`, and the rest of the server code already does this.
            `${SCHOOL_SELECT} where s.id in (${options.only.map((_, i) => `$${i + 1}`).join(", ")}) ${order}`,
            options.only,
          );
  return rows.map(toSchool);
}

/** The school's name, for messages and for the printed forms. */
export async function schoolName(sql: Sql, schoolId: string): Promise<string | null> {
  const rows = await sql<{ name: string }>`
    select name from sbfp_schools where id = ${schoolId}
  `;
  return rows[0]?.name ?? null;
}

export interface NewSchoolInput {
  name: string;
  type: SchoolType;
}

/**
 * Add a school. The id is derived from the type and the next free number in the
 * same series the seeded rows use (`es01…`, `hs01…`), so a school added later
 * sorts and keys exactly like the rest.
 */
export async function createSchool(sql: Sql, input: NewSchoolInput): Promise<School> {
  const name = input.name.trim();
  if (!name) throw new SchoolError("invalid_school", "Enter the school's name.");
  const type: SchoolType = input.type === "High School" ? "High School" : "Elementary";

  const clash = await sql<{ id: string }>`
    select id from sbfp_schools where lower(name) = lower(${name}) and type = ${type}
  `;
  if (clash[0]) {
    throw new SchoolError("school_exists", `${name} is already on the list.`);
  }

  const prefix = type === "Elementary" ? "es" : "hs";
  const next = await sql<{ n: number | string }>`
    select coalesce(max(substring(id from 3)::int), 0) + 1 as n
    from sbfp_schools where id like ${`${prefix}%`}
  `;
  const id = `${prefix}${String(Number(next[0]?.n ?? 1)).padStart(2, "0")}`;
  const order = await sql<{ n: number | string }>`
    select coalesce(max(sort_order), 0) + 1 as n from sbfp_schools where type = ${type}
  `;

  await sql`
    insert into sbfp_schools (id, name, type, sort_order)
    values (${id}, ${name}, ${type}, ${Number(order[0]?.n ?? 1)})
  `;
  const rows = await sql.query<SchoolDbRow>(`${SCHOOL_SELECT} where s.id = $1`, [id]);
  const created = rows[0];
  if (!created) throw new SchoolError("school_not_found", "The school could not be created.");
  return toSchool(created);
}

export interface SchoolPatch {
  name?: string;
  type?: SchoolType;
}

/** Rename a school, or move it between the elementary and high-school lists. */
export async function updateSchool(
  sql: Sql,
  id: string,
  patch: SchoolPatch,
): Promise<School> {
  const current = await sql<{ name: string; type: string }>`
    select name, type from sbfp_schools where id = ${id}
  `;
  const row = current[0];
  if (!row) throw new SchoolError("school_not_found", "That school is not on the list.");

  const name = patch.name === undefined ? row.name : patch.name.trim();
  if (!name) throw new SchoolError("invalid_school", "A school needs a name.");
  const type: SchoolType =
    patch.type === undefined ? (row.type as SchoolType) : patch.type === "High School" ? "High School" : "Elementary";

  const clash = await sql<{ id: string }>`
    select id from sbfp_schools
    where lower(name) = lower(${name}) and type = ${type} and id <> ${id}
  `;
  if (clash[0]) {
    throw new SchoolError("school_exists", `${name} is already on the list.`);
  }

  await sql`
    update sbfp_schools
    set name = ${name}, type = ${type}, updated_at = now()
    where id = ${id}
  `;
  const rows = await sql.query<SchoolDbRow>(`${SCHOOL_SELECT} where s.id = $1`, [id]);
  const updated = rows[0];
  if (!updated) throw new SchoolError("school_not_found", "That school is not on the list.");
  return toSchool(updated);
}

/**
 * Remove a school — refused while it still holds an account, learner records or
 * feedback, because those columns point at the id it is about to remove. The
 * Division Office removes the account and the rows first, which is the moment it
 * means it.
 */
export async function deleteSchool(sql: Sql, id: string): Promise<void> {
  const exists = await sql<{ id: string }>`select id from sbfp_schools where id = ${id}`;
  if (!exists[0]) throw new SchoolError("school_not_found", "That school is not on the list.");

  const held = await sql<{ records: number | string; feedback: number | string; accounts: number | string }>`
    select
      (select count(*) from sbfp_records where school_id = ${id}) as records,
      (select count(*) from sbfp_feedback where school_id = ${id}) as feedback,
      (select count(*) from sbfp_accounts where school_id = ${id}) as accounts
  `;
  const row = held[0];
  const taken = Number(row?.accounts ?? 0) + Number(row?.records ?? 0) + Number(row?.feedback ?? 0);
  if (taken > 0) {
    const parts: string[] = [];
    if (Number(row?.accounts ?? 0) > 0) parts.push("an account");
    if (Number(row?.records ?? 0) > 0) parts.push(`${Number(row?.records)} learner record(s)`);
    if (Number(row?.feedback ?? 0) > 0) parts.push(`${Number(row?.feedback)} feedback entr${Number(row?.feedback) === 1 ? "y" : "ies"}`);
    throw new SchoolError(
      "school_in_use",
      `This school still holds ${parts.join(", ")}. Remove those first.`,
    );
  }

  await sql`delete from sbfp_school_profiles where school_id = ${id}`;
  await sql`delete from sbfp_schools where id = ${id}`;
}
