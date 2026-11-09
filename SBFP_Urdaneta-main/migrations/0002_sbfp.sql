-- SBFP app schema — the Division Office's accounts, and everything the schools
-- send up through the Teacher Portal.
--
-- Sign-in (Better Auth) owns identity in `0001_auth.sql`; this file owns
-- AUTHORIZATION: `sbfp_accounts` says which role an email holds and, for a
-- teacher, which of the division's 58 schools she is the account for. The
-- Division Office (the district console at `/`) issues those rows; a teacher can
-- only ever reach the school on her own row.
--
-- Rows are owned by the SCHOOL (`school_id`), not by the person: a teacher can be
-- replaced without losing the school's encoded learner records, and the Division
-- Office keeps reading them the same way.

-- ── Who may use the app ───────────────────────────────────────────────────────
-- Keyed by email: the app runs behind the Grok gate, where a signed-in viewer
-- arrives with a verified email and never types a password, and it also serves
-- teachers on plain browsers who sign in with the temporary password the
-- Division Office issued. Matching the account to the verified session email
-- covers both, and keeps one row per person rather than one per identity.
create table if not exists sbfp_accounts (
  email text primary key,
  role text not null default 'teacher' check (role in ('admin', 'teacher')),
  full_name text not null default '',
  position text not null default '',
  contact text not null default '',
  -- The school this account is for. NULL for the Division Office account.
  school_id text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  -- True while the password is still the one the Division Office generated, so
  -- the portal can tell the teacher to replace it.
  temp_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One teacher account per school (the division's rule). Partial, so the Division
-- Office account and any future non-teacher rows are unaffected.
create unique index if not exists sbfp_accounts_school_uniq
  on sbfp_accounts (school_id) where role = 'teacher' and school_id is not null;

create index if not exists sbfp_accounts_role_idx on sbfp_accounts (role, status);

-- ── The school information block on the SBFP forms ────────────────────────────
-- The printed Form 1A/Form 2 header. It belongs to the school, not to the
-- teacher who typed it, so both sides can fill it in and it survives a change of
-- account or a released school.
create table if not exists sbfp_school_profiles (
  school_id text primary key,
  division text not null default 'Urdaneta City',
  city_municipality_barangay text not null default '',
  school_id_number text not null default '',
  principal text not null default '',
  focal_person text not null default '',
  date_start_feeding text not null default '',
  last_mile_school text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

-- ── Learner records encoded through the Teacher Portal ────────────────────────
-- Every column maps 1:1 to the app's `Student`; the measurements stay TEXT
-- because that is what the form fields hold (and what the WHO classification
-- helpers read), so nothing is re-parsed on the way in or out.
create table if not exists sbfp_records (
  id text primary key,
  school_id text not null,
  period text not null default 'Baseline',
  sy text not null default '',
  name text not null default '',
  sex text not null default '',
  grade_level text not null default '',
  date_of_birth text not null default '',
  date_of_weighing text not null default '',
  age_years text not null default '',
  age_months text not null default '',
  weight text not null default '',
  height text not null default '',
  bmi text not null default '',
  bmi_status text not null default '',
  hfa_status text not null default '',
  nutritional_status text not null default '',
  classification_of_beneficiary text not null default '',
  pregnant text not null default '',
  has_young_children text not null default '',
  dewormed text not null default '',
  parent_consent_milk text not null default '',
  four_ps text not null default '',
  sbfp_previous_years text not null default '',
  encoded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sbfp_records_school_idx on sbfp_records (school_id, period);

-- ── Feedback from the schools, with the Division Office's reply on the row ────
create table if not exists sbfp_feedback (
  id text primary key,
  school_id text not null,
  author text not null default '',
  role text not null default '',
  category text not null default 'Other',
  rating integer not null default 0,
  message text not null default '',
  created_at timestamptz not null default now(),
  status text not null default 'New' check (status in ('New', 'Acknowledged', 'Resolved')),
  response text not null default '',
  origin text,
  sent_by text,
  updated_at timestamptz not null default now()
);

create index if not exists sbfp_feedback_school_idx on sbfp_feedback (school_id, created_at desc);
