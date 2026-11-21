-- Scale and retention hardening.
--
-- The dashboard is computed from the active school year, and the Division
-- Office opens one school at a time. These indexes match those reads (including
-- the live-update signature, which counts and timestamps the same rows), so
-- 10,000+ learner records per year do not turn into sequential scans.
create index if not exists sbfp_records_active_year_school_idx
  on sbfp_records (sy, school_id, period, name)
  where deleted_at is null;

-- Opening one school reads its rows newest first (see `getSchoolRecords`).
create index if not exists sbfp_records_active_year_school_created_idx
  on sbfp_records (sy, school_id, created_at desc)
  where deleted_at is null;

create index if not exists sbfp_records_active_year_created_idx
  on sbfp_records (sy, created_at desc)
  where deleted_at is null;

create index if not exists sbfp_records_school_name_idx
  on sbfp_records (school_id, lower(name))
  where deleted_at is null;

create index if not exists sbfp_feedback_year_status_idx
  on sbfp_feedback (sy, status, created_at desc);

create index if not exists sbfp_accounts_role_school_idx
  on sbfp_accounts (role, school_id);
