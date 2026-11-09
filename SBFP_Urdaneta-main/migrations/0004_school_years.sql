-- School years — the archive boundary for every learner record, feedback entry
-- and school information block.
--
-- A year is never deleted. Starting a new school year closes the current row in
-- `sbfp_school_years`, snapshots that year's school information into
-- `sbfp_school_profiles_archive`, and opens a new active year. Learner records
-- and feedback stay exactly where they are, stamped with the year they belong
-- to, so the archived years remain readable and exportable forever.
--
-- Teacher accounts are deliberately outside this: they carry over from year to
-- year, and a school's account is never archived.

create table if not exists sbfp_school_years (
  sy text primary key,
  started_at timestamptz not null default now(),
  closed_at timestamptz
);

-- At most one year is open. `(closed_at is null)` is true only for the active
-- row, so the partial unique index allows exactly one of them.
create unique index if not exists sbfp_school_years_one_active
  on sbfp_school_years ((closed_at is null)) where closed_at is null;

-- Start from the year the existing records already carry (the app has always
-- stamped 2025-2026), or the first year for a brand-new database.
insert into sbfp_school_years (sy)
select coalesce(
  (
    select sy from sbfp_records
    where sy <> ''
    group by sy
    order by count(*) desc, sy desc
    limit 1
  ),
  '2025-2026'
)
on conflict do nothing;

-- Feedback needs the same year stamp as learner records: its `created_at` is a
-- calendar date, not a school year, and the archive groups by school year.
alter table sbfp_feedback add column if not exists sy text not null default '2025-2026';

create index if not exists sbfp_feedback_year_idx
  on sbfp_feedback (sy, school_id, created_at desc);
create index if not exists sbfp_records_year_idx
  on sbfp_records (sy, school_id);

-- The school information block as it stood when a year closed. The live
-- `sbfp_school_profiles` row is reset for the new year (principals and focal
-- persons change), so the archived Form 1A/Form 2 exports read from here.
create table if not exists sbfp_school_profiles_archive (
  sy text not null references sbfp_school_years (sy) on delete cascade,
  school_id text not null,
  division text not null default '',
  city_municipality_barangay text not null default '',
  school_id_number text not null default '',
  principal text not null default '',
  focal_person text not null default '',
  date_start_feeding text not null default '',
  last_mile_school text not null default '',
  archived_at timestamptz not null default now(),
  primary key (sy, school_id)
);
