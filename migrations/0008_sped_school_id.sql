-- The SPED center's own DepEd school ID.
--
-- Urdaneta I Central School hosts the division's SPED program, which prints
-- under its own name (URDANETA CITY SPED CENTER) on the SPED cohort's Form 1
-- and Form 2. That center has a school ID of its own, so the forms need it
-- beside the host school's ID instead of replacing it.
--
-- Kept on the same form-header row as the other printed fields, and carried
-- into the per-year archive so a closed year still prints what it printed then.
alter table sbfp_school_profiles
  add column if not exists sped_school_id_number text not null default '';

alter table sbfp_school_profiles_archive
  add column if not exists sped_school_id_number text not null default '';
