-- 0009_grant_audit_logs_select.sql
--
-- Purpose: let the Admin → System "Operation overlap enforcement" card read the warn-mode history
-- that Phase D's trigger writes to public.audit_logs (action = 'operation_overlap_warning').
--
-- Why this is needed: table privileges are checked BEFORE row-level security. audit_logs already has
-- an RLS policy (`audit_admin_read`) restricting SELECT to admin/boss, but it was deliberately left
-- OUT of the base-privileges grant loop in schema.sql (and migration 0003 only *revokes* write
-- privileges on it). With no base SELECT grant, even an admin's select returns "permission denied",
-- so the audit-warning list can't load. This grant adds only SELECT; the existing RLS policy still
-- limits the visible rows to admin/boss, and writes stay owned by the SECURITY DEFINER audit trigger.
--
-- Safe to run more than once. NOT YET APPLIED to the live database — apply in the Supabase SQL editor
-- (there is no automated migration pipeline) together with, or after, 0008.

begin;

grant select on public.audit_logs to authenticated;

commit;
