-- One-off cleanup: the disposable "ZZ SBFP Load Test" school used for the
-- all-schools load test. The app intentionally refuses to delete a school that
-- still holds records or feedback, so these rows are removed here first.
--
-- The name guard means a real school that ever reuses the `es46` id is left
-- untouched. Every statement is safe to run when the test school is already
-- gone.

delete from sbfp_feedback
where school_id = 'es46'
  and exists (
    select 1 from sbfp_schools
    where id = 'es46' and name = 'ZZ SBFP Load Test'
  );

delete from sbfp_records
where school_id = 'es46'
  and exists (
    select 1 from sbfp_schools
    where id = 'es46' and name = 'ZZ SBFP Load Test'
  );

delete from sbfp_summary_extras
where school_id = 'es46'
  and exists (
    select 1 from sbfp_schools
    where id = 'es46' and name = 'ZZ SBFP Load Test'
  );

delete from sbfp_school_profiles_archive
where school_id = 'es46'
  and exists (
    select 1 from sbfp_schools
    where id = 'es46' and name = 'ZZ SBFP Load Test'
  );

delete from sbfp_school_profiles
where school_id = 'es46'
  and exists (
    select 1 from sbfp_schools
    where id = 'es46' and name = 'ZZ SBFP Load Test'
  );

delete from sbfp_accounts
where school_id = 'es46'
  and exists (
    select 1 from sbfp_schools
    where id = 'es46' and name = 'ZZ SBFP Load Test'
  );

delete from sbfp_schools
where id = 'es46' and name = 'ZZ SBFP Load Test';
