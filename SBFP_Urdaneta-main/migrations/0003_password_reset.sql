-- Password reset for the Division Office account.
--
-- There is exactly one administrator, and it is the only account that can issue
-- or repair the schools' Teacher Portal accounts — so losing its password must
-- not mean losing the deployment. "Forgot your password?" on the sign-in page
-- emails a single-use link to the account's own address; this table holds the
-- hash of that link's token, never the token itself.
--
-- One row per account: asking again replaces the earlier link, which is how a
-- stale or leaked link stops working. The row is deleted when it is used, so a
-- link cannot be replayed, and expires_at bounds how long it lives at all.
create table if not exists sbfp_admin_password_resets (
  email text primary key references sbfp_accounts (email) on delete cascade,
  -- SHA-256 of the random token that goes in the email. The token is 256 bits
  -- from the OS CSPRNG, so a fast hash is enough; it never appears in the DB.
  token_hash text not null,
  expires_at timestamptz not null,
  requested_at timestamptz not null default now()
);

create unique index if not exists sbfp_admin_password_resets_token_uniq
  on sbfp_admin_password_resets (token_hash);

create index if not exists sbfp_admin_password_resets_expiry_idx
  on sbfp_admin_password_resets (expires_at);
