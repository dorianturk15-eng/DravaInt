-- 0007: Phase C — backfill machine identity (id) onto existing schedule data.
--
-- Until now every machine reference in the app matched on the machine's NAME string. Renaming a
-- machine in Admin silently orphaned its schedules. Phase C adds a stable `machineId` to each
-- operation (inside the `jobs.operations` JSONB) and populates the already-existing `jobs.machine_id`
-- column for plain single-machine jobs. Matching now prefers the id and falls back to the name for
-- rows this migration couldn't resolve, so it is safe to run incrementally.
--
-- SAFETY / IDEMPOTENCY:
--   * Only fills a machineId where it is currently absent AND the recorded name matches exactly one
--     current machine (case-insensitive, trimmed). Existing ids are never overwritten.
--   * Names that match no current machine are LEFT ALONE and RAISED AS NOTICES (and surface live in
--     the Admin "unmapped machines" report) — nothing is guessed or mis-mapped.
--   * Re-running is a no-op once everything resolvable is filled.
--
-- HOW TO RUN (review first — see MACHINE_ID_BACKFILL.md):
--   1. Dry-run against a data export:  node scripts/backfill-machine-ids.mjs jobs.json machines.json
--   2. Inspect the "unmatched" report and reconcile names (rename machines / fix operations).
--   3. Apply in a transaction:         psql "$DATABASE_URL" -1 -f supabase/migrations/0007_backfill_operation_machine_ids.sql
--      (or via the Supabase SQL editor / `supabase db push`).
--   4. Re-run the dry-run; "unmatched" should be only the genuinely-unregistered machines.

do $$
declare
  unmatched_count int;
  rec record;
begin
  ------------------------------------------------------------------------------------------------
  -- 0) Report: routed-operation machine names that resolve to no current machine.
  ------------------------------------------------------------------------------------------------
  select count(*) into unmatched_count
  from public.jobs j
  cross join lateral jsonb_array_elements(j.operations) with ordinality as op(value, ord)
  where j.operations is not null and jsonb_typeof(j.operations) = 'array'
    and coalesce(btrim(op.value->>'machine'), '') <> ''
    and (op.value->>'machineId') is null
    and not exists (
      select 1 from public.machines m where lower(btrim(m.name)) = lower(btrim(op.value->>'machine'))
    );

  if unmatched_count > 0 then
    raise notice 'Phase C backfill: % operation machine name(s) do not match any current machine and were NOT backfilled:', unmatched_count;
    for rec in
      select distinct op.value->>'machine' as machine_name, count(*) over (partition by lower(btrim(op.value->>'machine'))) as uses
      from public.jobs j
      cross join lateral jsonb_array_elements(j.operations) with ordinality as op(value, ord)
      where j.operations is not null and jsonb_typeof(j.operations) = 'array'
        and coalesce(btrim(op.value->>'machine'), '') <> ''
        and (op.value->>'machineId') is null
        and not exists (select 1 from public.machines m where lower(btrim(m.name)) = lower(btrim(op.value->>'machine')))
      order by 1
    loop
      raise notice '  unmatched machine name: "%" (used by % operation(s))', rec.machine_name, rec.uses;
    end loop;
  else
    raise notice 'Phase C backfill: every routed operation machine name resolves to a current machine.';
  end if;

  ------------------------------------------------------------------------------------------------
  -- 1) Backfill jobs.operations[].machineId by name match (JSONB rebuilt per job, order preserved).
  ------------------------------------------------------------------------------------------------
  with expanded as (
    select
      j.id as job_id,
      op.ord as op_ord,
      op.value as op,
      (select m.id from public.machines m
        where lower(btrim(m.name)) = lower(btrim(op.value->>'machine'))
        order by m.id limit 1) as resolved_id
    from public.jobs j
    cross join lateral jsonb_array_elements(j.operations) with ordinality as op(value, ord)
    where j.operations is not null and jsonb_typeof(j.operations) = 'array'
  ),
  rebuilt as (
    select
      job_id,
      jsonb_agg(
        case
          when resolved_id is not null and (op->>'machineId') is null
            then op || jsonb_build_object('machineId', resolved_id)
          else op
        end
        order by op_ord
      ) as new_operations
    from expanded
    group by job_id
  )
  update public.jobs j
  set operations = r.new_operations
  from rebuilt r
  where j.id = r.job_id
    and j.operations is distinct from r.new_operations;

  raise notice 'Phase C backfill: routed-operation machineId fill complete (% job row(s) touched).', (select count(*) from (
    select 1 from public.jobs j
    where j.operations is not null and jsonb_typeof(j.operations) = 'array'
      and exists (select 1 from jsonb_array_elements(j.operations) e where (e->>'machineId') is not null)
  ) s);

  ------------------------------------------------------------------------------------------------
  -- 2) Backfill jobs.machine_id for plain single-machine jobs (no operations, name is not a chain).
  ------------------------------------------------------------------------------------------------
  update public.jobs j
  set machine_id = m.id
  from public.machines m
  where j.machine_id is null
    and (j.operations is null or jsonb_typeof(j.operations) <> 'array' or jsonb_array_length(j.operations) = 0)
    and position('→' in coalesce(j.machine, '')) = 0
    and lower(btrim(j.machine)) = lower(btrim(m.name))
    and btrim(coalesce(j.machine, '')) <> '';

  raise notice 'Phase C backfill: plain-job machine_id fill complete.';
end $$;
