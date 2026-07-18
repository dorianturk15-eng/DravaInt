-- 0006: Two correctness fixes in generate_shift_schedule (found during deep scheduling QA, 2026-07-18).
--
-- 1) ISO week/year mismatch at year boundaries.
--    The function keyed schedules on (extract(week ...), extract(year ...)). extract(week) is the
--    ISO 8601 week number, but extract(year) is the CALENDAR year — and the two disagree in the
--    days around New Year. Example: 2025-12-29 is Monday of ISO week 1 of 2026, but the function
--    recorded it as (week 1, year 2025) — the exact unique key of the REAL week 1 of 2025
--    (2024-12-30..2025-01-05). Generating that week would "on conflict do update" a year-old
--    schedule: its start/end dates get overwritten and new assignments get upserted into it while
--    the old January assignments stay attached, corrupting both weeks. extract(isoyear) is the
--    year that belongs to the ISO week and can never produce this collision. The client computes
--    the same pair in ShiftSchedule.tsx (getIsoWeek/getIsoWeekYear), fixed in the same commit.
--
-- 2) Stale auto-generated assignments survive regeneration.
--    The function only inserts/updates (worker, date) pairs it currently wants; it never deletes.
--    So after "Generiraj" is pressed again with a worker deselected from the roster, or after an
--    absence was recorded that overlaps the week, the worker's previously generated assignments
--    silently remain in the schedule — contradicting the function's own absence-skip logic and
--    what the planner sees on screen. Before filling each week we now delete the week's
--    non-override assignments that either belong to a worker no longer in the requested roster or
--    fall on a day the worker is recorded absent. Manual overrides (is_override) are untouched.

create or replace function public.generate_shift_schedule(p_start_date date,p_week_count int,p_worker_ids bigint[],p_department text default 'Alatnica')
returns setof public.shift_schedules security definer set search_path = public language plpgsql as $$
declare week_index int; day_index int; worker_index int; schedule_row public.shift_schedules; definitions bigint[]; v_worker_id bigint; target_date date;
begin
  select array_agg(id order by start_time) into definitions from public.shift_definitions where is_active;
  if definitions is null or array_length(definitions,1)=0 then raise exception 'No active shift definitions'; end if;
  for week_index in 0..least(greatest(p_week_count,1),52)-1 loop
    target_date := p_start_date + week_index * 7;
    insert into public.shift_schedules(week_number,year,start_date,end_date,department,status,created_by,modified_by)
    values (extract(week from target_date)::int,extract(isoyear from target_date)::int,target_date,target_date+6,p_department,'draft',auth.uid(),auth.uid())
    on conflict (week_number,year,department) do update set start_date=excluded.start_date,end_date=excluded.end_date,modified_by=auth.uid()
    returning * into schedule_row;
    -- Drop stale auto rows: workers removed from the roster, or days now covered by an absence.
    delete from public.shift_assignments sa
     where sa.shift_schedule_id = schedule_row.id
       and sa.is_override = false
       and (sa.worker_id <> all(p_worker_ids)
            or exists(select 1 from public.absences a where a.worker_id = sa.worker_id and sa.date between a.start_date and a.end_date));
    for day_index in 0..4 loop
      for worker_index in 1..coalesce(array_length(p_worker_ids,1),0) loop
        v_worker_id := p_worker_ids[worker_index];
        if not exists(select 1 from public.absences a where a.worker_id=v_worker_id and target_date+day_index between a.start_date and a.end_date) then
          insert into public.shift_assignments(shift_schedule_id,worker_id,shift_definition_id,date,is_override)
          values(schedule_row.id,v_worker_id,definitions[1+mod(worker_index-1+week_index,array_length(definitions,1))],target_date+day_index,false)
          on conflict (shift_schedule_id,worker_id,date) do update set shift_definition_id=excluded.shift_definition_id where public.shift_assignments.is_override=false;
        end if;
      end loop;
    end loop;
    return next schedule_row;
  end loop;
end;
$$;

-- Tell PostgREST to reload immediately so the fixed RPC is callable without waiting for the
-- periodic schema refresh.
notify pgrst, 'reload schema';
