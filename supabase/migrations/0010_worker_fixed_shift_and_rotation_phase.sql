-- 0010: A never-rotates worker group, and a rotation phase that survives roster edits.
--
-- 1) workers.fixed_shift_definition_id
--    Some workers always work the first shift and never enter the rotation. There was no way to
--    express that: generate_shift_schedule forced every selected worker through the cycle.
--
--    The unused rotation_templates table (cycle_weeks + jsonb pattern) was considered and rejected
--    for this: it is a per-DEPARTMENT template, so it cannot say "these three named people never
--    rotate" without inventing a worker<->template join that does not exist. It stays in reserve
--    for a future custom-rotation-pattern feature; this rule is per-worker, so it lives on the
--    worker. No new grants are needed — column privileges follow the existing table grants from
--    migration 0003, and the workers RLS policies already cover update by planners/admins.
--
-- 2) Rotation phase anchored to the worker's own previous week.
--    The old formula was definitions[1 + mod(worker_index - 1 + week_index, count)] — a function of
--    the worker's POSITION in p_worker_ids, which comes from UI selection order. Deselecting one
--    worker and regenerating shifted every worker after them in the array onto a different shift,
--    silently rewriting non-override assignments in already-planned future weeks. Phase now derives
--    from the worker's dominant shift in the week immediately before the generated range, stepping
--    one lane on from it; the positional formula is kept only to seed a worker with no history so a
--    brand-new roster still fans out instead of stacking everyone onto shift 1.
--
--    Mirrored exactly in TypeScript by src/shifts/rotation.ts (planRotation), which drives both the
--    offline fallback generator and the Rotation Board UI. Change the two together.

alter table public.workers
  add column if not exists fixed_shift_definition_id bigint
    references public.shift_definitions(id) on delete set null;

comment on column public.workers.fixed_shift_definition_id is
  'Pins the worker to one shift permanently; they are excluded from the weekly rotation. Null = rotates.';

create or replace function public.generate_shift_schedule(p_start_date date,p_week_count int,p_worker_ids bigint[],p_department text default 'Alatnica')
returns setof public.shift_schedules security definer set search_path = public language plpgsql as $$
declare
  week_index int; day_index int; worker_index int;
  schedule_row public.shift_schedules; definitions bigint[]; v_worker_id bigint; target_date date;
  def_count int; v_fixed bigint; v_prev bigint; v_shift bigint; v_pos int;
  rotating_index int;
  -- workerId -> shift chosen for the week currently being written.
  phase jsonb := '{}'::jsonb;
begin
  select array_agg(id order by start_time) into definitions from public.shift_definitions where is_active;
  if definitions is null or array_length(definitions,1)=0 then raise exception 'No active shift definitions'; end if;
  def_count := array_length(definitions,1);

  -- Seed each rotating worker's phase from the week BEFORE the requested range.
  rotating_index := 0;
  for worker_index in 1..coalesce(array_length(p_worker_ids,1),0) loop
    v_worker_id := p_worker_ids[worker_index];
    select w.fixed_shift_definition_id into v_fixed from public.workers w where w.id = v_worker_id;
    -- An inactive pin falls back to rotation rather than pinning to a dead lane.
    if v_fixed is not null and v_fixed = any(definitions) then
      continue;
    end if;

    -- Dominant shift in the immediately preceding week, if that week exists.
    select sa.shift_definition_id into v_prev
      from public.shift_assignments sa
      join public.shift_schedules ss on ss.id = sa.shift_schedule_id
     where sa.worker_id = v_worker_id
       and ss.department = p_department
       and sa.date >= p_start_date - 7
       and sa.date < p_start_date
     group by sa.shift_definition_id
     order by count(*) desc, array_position(definitions, sa.shift_definition_id) asc
     limit 1;

    if v_prev is not null then
      v_pos := array_position(definitions, v_prev);
      -- A worker coming off a since-retired lane rejoins at the start of the cycle.
      v_shift := case when v_pos is null then definitions[1] else definitions[1 + mod(v_pos, def_count)] end;
    else
      v_shift := definitions[1 + mod(rotating_index, def_count)];
    end if;
    phase := jsonb_set(phase, array[v_worker_id::text], to_jsonb(v_shift));
    rotating_index := rotating_index + 1;
  end loop;

  for week_index in 0..least(greatest(p_week_count,1),52)-1 loop
    target_date := p_start_date + week_index * 7;
    insert into public.shift_schedules(week_number,year,start_date,end_date,department,status,created_by,modified_by)
    values (extract(week from target_date)::int,extract(isoyear from target_date)::int,target_date,target_date+6,p_department,'draft',auth.uid(),auth.uid())
    on conflict (week_number,year,department) do update set start_date=excluded.start_date,end_date=excluded.end_date,modified_by=auth.uid()
    returning * into schedule_row;

    -- Drop stale auto rows: workers removed from the roster, or days now covered by an absence.
    -- (Unchanged from 0006.)
    delete from public.shift_assignments sa
     where sa.shift_schedule_id = schedule_row.id
       and sa.is_override = false
       and (sa.worker_id <> all(p_worker_ids)
            or exists(select 1 from public.absences a where a.worker_id = sa.worker_id and sa.date between a.start_date and a.end_date));

    -- Advance every rotating worker one lane, except in the first week where the
    -- seeded phase is already the week's shift.
    if week_index > 0 then
      for worker_index in 1..coalesce(array_length(p_worker_ids,1),0) loop
        v_worker_id := p_worker_ids[worker_index];
        if phase ? v_worker_id::text then
          v_prev := (phase ->> v_worker_id::text)::bigint;
          v_pos := array_position(definitions, v_prev);
          v_shift := case when v_pos is null then definitions[1] else definitions[1 + mod(v_pos, def_count)] end;
          phase := jsonb_set(phase, array[v_worker_id::text], to_jsonb(v_shift));
        end if;
      end loop;
    end if;

    for day_index in 0..4 loop
      for worker_index in 1..coalesce(array_length(p_worker_ids,1),0) loop
        v_worker_id := p_worker_ids[worker_index];
        if not exists(select 1 from public.absences a where a.worker_id=v_worker_id and target_date+day_index between a.start_date and a.end_date) then
          select w.fixed_shift_definition_id into v_fixed from public.workers w where w.id = v_worker_id;
          if v_fixed is not null and v_fixed = any(definitions) then
            v_shift := v_fixed;
          else
            v_shift := (phase ->> v_worker_id::text)::bigint;
          end if;
          insert into public.shift_assignments(shift_schedule_id,worker_id,shift_definition_id,date,is_override)
          values(schedule_row.id,v_worker_id,v_shift,target_date+day_index,false)
          on conflict (shift_schedule_id,worker_id,date) do update set shift_definition_id=excluded.shift_definition_id where public.shift_assignments.is_override=false;
        end if;
      end loop;
    end loop;
    return next schedule_row;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
