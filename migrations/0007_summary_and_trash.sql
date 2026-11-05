-- Form 2's two manually-encoded columns, and the learner-record trash.
--
-- The printed SBFP Form 2 has two secondary-target columns the learner records
-- do not carry: pupils at risk of dropping out, and Indigenous Peoples (IPs).
-- They are entered by hand on the Summary, per grade and sex, so they live in
-- their own small table keyed by school, school year, feeding period, grade and
-- sex. The active school year is stamped by the server, exactly like a learner
-- record, so a year's figures stay with that year when it closes.

create table if not exists sbfp_summary_extras (
  school_id text not null,
  sy text not null,
  period text not null check (period in ('Baseline', 'Midline', 'Endline')),
  grade text not null,
  sex text not null check (sex in ('M', 'F')),
  at_risk integer not null default 0 check (at_risk >= 0),
  ips integer not null default 0 check (ips >= 0),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (school_id, sy, period, grade, sex)
);

create index if not exists sbfp_summary_extras_year_idx
  on sbfp_summary_extras (sy, school_id, period);

-- A deleted learner record is moved to the trash instead of being erased: the
-- row keeps all of its measurements and is only hidden from the active lists.
-- Starting a new school year empties the trash permanently (see
-- `startNewSchoolYear` in src/lib/sbfp-years.ts).
alter table sbfp_records add column if not exists deleted_at timestamptz;
alter table sbfp_records add column if not exists deleted_by text;

create index if not exists sbfp_records_trash_idx
  on sbfp_records (school_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists sbfp_records_active_idx
  on sbfp_records (school_id, sy, period)
  where deleted_at is null;
