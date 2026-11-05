-- Remove the published demo Division Office sign-in.
--
-- The preview used to be seeded with a fixed account (`test@gmail.com`) whose
-- password was printed in the source. `ensureDemoAdmin` only seeded the
-- in-memory preview database, but the row was also created on the deployed
-- Supabase database — where a password in a public repository is a published
-- way into every school's learner records.
--
-- The seed is gone from the code; this removes the row itself from any database
-- that already has it. It is keyed on the exact email AND role, so an account
-- the Division Office owns under another address is untouched.
--
-- This deliberately leaves the database with no Division Office account: the
-- first-run card on the sign-in screen is the only way in, and it asks for a
-- password nobody has read. Claim it right after deploying this.
delete from sbfp_admin_password_resets where lower(email) = 'test@gmail.com';
delete from sbfp_accounts
  where lower(email) = 'test@gmail.com' and role = 'admin';
delete from "user" where lower("email") = 'test@gmail.com';
