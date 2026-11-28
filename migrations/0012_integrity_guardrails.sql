-- Database integrity guardrails.
--
-- These are deliberately NOT VALID: an old database may contain rows created
-- before the relevant school/year row, and a migration must not fail the
-- deploy while an operator repairs those. PostgreSQL still enforces every new
-- insert/update against the constraint, so the app cannot create new orphans.
-- After a one-time orphan audit, validate them with:
--   alter table ... validate constraint ...;
--
-- Keep the application guards in place as well; this is defense in depth, not
-- a replacement for the server-side authorization checks.

alter table sbfp_accounts
  add constraint sbfp_accounts_school_fk
  foreign key (school_id) references sbfp_schools (id) on delete restrict not valid;

alter table sbfp_school_profiles
  add constraint sbfp_school_profiles_school_fk
  foreign key (school_id) references sbfp_schools (id) on delete restrict not valid;

alter table sbfp_records
  add constraint sbfp_records_school_fk
  foreign key (school_id) references sbfp_schools (id) on delete restrict not valid;

alter table sbfp_feedback
  add constraint sbfp_feedback_school_fk
  foreign key (school_id) references sbfp_schools (id) on delete restrict not valid;

alter table sbfp_summary_extras
  add constraint sbfp_summary_extras_school_fk
  foreign key (school_id) references sbfp_schools (id) on delete restrict not valid;

-- Every learner, feedback and Form 2 row carries the year it belongs to. A
-- new row must point at a real year; the active year is created before any
-- write can stamp it.
alter table sbfp_records
  add constraint sbfp_records_sy_fk
  foreign key (sy) references sbfp_school_years (sy) on delete restrict not valid;

alter table sbfp_feedback
  add constraint sbfp_feedback_sy_fk
  foreign key (sy) references sbfp_school_years (sy) on delete restrict not valid;

alter table sbfp_summary_extras
  add constraint sbfp_summary_extras_sy_fk
  foreign key (sy) references sbfp_school_years (sy) on delete restrict not valid;

alter table sbfp_records
  add constraint sbfp_records_period_check
  check (period in ('Baseline', 'Midline', 'Endline')) not valid;

alter table sbfp_feedback
  add constraint sbfp_feedback_rating_check
  check (rating between 0 and 5) not valid;

-- Not unique: legacy imports may already contain repeats, and the repair must
-- happen without deleting a school's data. This index makes the future
-- duplicate audit efficient and is the shape a unique natural key would use.
create index if not exists sbfp_records_learner_key_idx
  on sbfp_records (school_id, sy, period, lower(name), date_of_birth, sex)
  where deleted_at is null;
