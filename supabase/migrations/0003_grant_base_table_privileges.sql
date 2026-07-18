-- Migration 0003 — base table privileges for the `authenticated` role
--
-- Symptom: "permission denied for table machines" (SQLSTATE 42501) on the first direct
-- table write from the app, even for an active admin user.
--
-- Cause: schema.sql creates the tables and RLS policies but never GRANTs base table
-- privileges on them; it relied on the Supabase project's default privileges to give
-- `authenticated` access. On this project those defaults did not apply to the app's
-- tables, and table-privilege checks run BEFORE RLS is ever evaluated — so every direct
-- read/write against the un-granted tables fails with "permission denied", regardless of
-- role. (Login and the workers/profiles lists still worked because migration 0001
-- explicitly granted column-level SELECT on profiles/workers and on absences_visible,
-- and the shift RPC is SECURITY DEFINER.)
--
-- This grants the base privileges explicitly so RLS policies are the only gate, then
-- re-applies the column-level hardening from migration 0001 (which the blanket grant
-- would otherwise undo — order matters).
--
-- Idempotent and safe to run repeatedly in the Supabase SQL editor.

begin;

grant usage on schema public to authenticated;

-- Base privileges on every app table and view. RLS still decides which rows each user
-- can actually touch; a table with RLS enabled and no matching policy still denies all.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Identity/serial columns draw from sequences; inserts need usage on them.
grant usage, select on all sequences in schema public to authenticated;

-- Tables created by future migrations (run as this same role in the SQL editor) get the
-- same privileges automatically.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- ---------------------------------------------------------------------------
-- Re-apply the column-level hardening from migration 0001. The blanket grant above
-- re-granted full-table SELECT on tables whose sensitive columns are deliberately
-- hidden; these statements must run AFTER it.

-- profiles.rfid_code stays hidden (a badge number is an authentication credential).
revoke select on public.profiles from authenticated;
grant select (id, username, email, role, is_active, created_at, updated_at)
  on public.profiles to authenticated;

-- workers.calendar_token stays hidden (capability token for the shift-calendar feed).
revoke select on public.workers from authenticated;
grant select (id, first_name, last_name, email, role_id, app_user_id, department_id,
              is_active, status, qualifications, deleted_at, created_at, updated_at)
  on public.workers to authenticated;

-- absences: direct SELECT stays revoked; reads go through the masking view (GDPR).
revoke select on public.absences from authenticated;
grant select on public.absences_visible to authenticated;

-- audit_logs: SELECT is already RLS-restricted to admin/boss; rows are written only by
-- the SECURITY DEFINER audit trigger, so clients need no direct write privileges.
revoke insert, update, delete on public.audit_logs from authenticated;

-- Legacy plaintext table stays locked if it exists.
do $$ begin
  if to_regclass('public.app_users') is not null then
    execute 'revoke all on public.app_users from anon, authenticated';
  end if;
end $$;

commit;
