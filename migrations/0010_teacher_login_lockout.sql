-- Teacher sign-in lockout state.
--
-- A teacher gets a one-minute cooldown after five wrong passwords, then a
-- longer cooldown for each further failure. The tenth failure puts the account
-- on hold; the Division Office lifts it from School Accounts.
alter table sbfp_accounts
  add column if not exists failed_login_count integer not null default 0;

alter table sbfp_accounts
  add column if not exists lockout_until timestamptz;

create index if not exists sbfp_accounts_login_lock_idx
  on sbfp_accounts (lower(email))
  where role = 'teacher';
