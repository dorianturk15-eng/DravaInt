-- Migration 0001 — "Now" tier security & schema fixes (DravaInt improvements plan, 2026-07-17)
--
-- Brings an EXISTING deployed database (created from an earlier supabase/schema.sql) up to date
-- with the security/schema fixes now baked into schema.sql. Idempotent and safe to run repeatedly
-- in the Supabase SQL editor. A fresh `schema.sql` apply already includes everything here.
--
-- Covers improvement-plan items:
--   #1  jobs.priority column (silent write failures in Supabase mode)
--   #2  audit_logs readable by every authenticated user (RLS ordering bug)
--   #3  rfid_code / calendar_token exposed to all authenticated users
--   #4  absence health data (type/notes) visible to everyone (GDPR)
--
-- NOTE (item #10, server side): validate_job_assignment() still compares `machine` by exact string
-- and only sees the zero-duration parent window of routed orders, so DB-level double-booking is not
-- enforced for routed work. A correct fix needs per-operation rows (job_operations table) and is
-- tracked under item #13; it is intentionally NOT attempted here.

begin;

-- #1 -----------------------------------------------------------------------
-- The client sends `priority` on every job insert/update; without this column those writes fail
-- with an unknown-column error, get queued offline, and retry forever while the UI says "success".
alter table public.jobs
  add column if not exists priority text not null default 'normal';
-- Add the check constraint only if it isn't already present.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_priority_check') then
    alter table public.jobs
      add constraint jobs_priority_check check (priority in ('low','normal','high','urgent'));
  end if;
end $$;

-- #2 -----------------------------------------------------------------------
-- audit_logs holds before/after row images of every table. The generic read-all loop had re-created
-- an unrestricted `authenticated_read using (true)` policy on it AFTER the admin-only restriction,
-- and policies are OR'd — so any worker could read the full audit trail. Drop the read-all policy
-- and (re)assert the admin-only one.
drop policy if exists authenticated_read on public.audit_logs;
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs
  for select to authenticated
  using (public.current_app_role() in ('admin','boss'));

-- #3 -----------------------------------------------------------------------
-- Column-level credential hardening. RLS is row-level only; PostgREST honours column privileges,
-- so revoke table-level SELECT and re-grant only the safe columns.
--   * profiles.rfid_code     — badge numbers are authentication credentials.
--   * workers.calendar_token — a capability token for the shift-calendar feed.
-- Admin/edge-function paths use the service role and bypass these grants.
revoke select on public.profiles from authenticated;
grant select (id, username, email, role, is_active, created_at, updated_at)
  on public.profiles to authenticated;
revoke select on public.workers from authenticated;
grant select (id, first_name, last_name, email, role_id, app_user_id, department_id,
              is_active, status, qualifications, deleted_at, created_at, updated_at)
  on public.workers to authenticated;

-- #4 -----------------------------------------------------------------------
-- Absence health data (GDPR): `type` (sick/maternity/…) and `notes` are sensitive. Revoke direct
-- table SELECT and expose a masking view that reveals type/notes only to planners/admin and nulls
-- them for ordinary workers (who still need worker + date range for the "today's absence" alert).
drop policy if exists authenticated_read on public.absences;
revoke select on public.absences from authenticated;
create or replace view public.absences_visible with (security_barrier=true) as
  select
    a.id,
    a.worker_id,
    a.start_date,
    a.end_date,
    case when public.current_app_role() in ('admin','boss','managers','level between admin and managers') then a.type else null end as type,
    case when public.current_app_role() in ('admin','boss','managers','level between admin and managers') then a.notes else '' end as notes,
    a.approved_by,
    a.created_at
  from public.absences a;
grant select on public.absences_visible to authenticated;

commit;
