-- 0005: Fix "column reference \"worker_id\" is ambiguous" in generate_shift_schedule.
--
-- The function declared a local plpgsql variable named `worker_id` and then used the
-- bare identifier `worker_id` inside SQL statements that also touch a table column of
-- the same name (public.absences.worker_id in the WHERE clause, and the VALUES list
-- feeding public.shift_assignments.worker_id). plpgsql.variable_conflict defaults to
-- 'error', so Postgres refuses to guess whether the bare name means the local variable
-- or the table column and raises exactly this error — reproduced live by the "Generiraj"
-- action on the shift-schedule wizard, which calls this RPC and got back an HTTP 400.
--
-- Fix: rename the local variable to v_worker_id so it can never collide with any table
-- column name, and use it in place of the old `worker_id` variable everywhere. No
-- behavioral change otherwise.

create or replace function public.generate_shift_schedule(p_start_date date,p_week_count int,p_worker_ids bigint[],p_department text default 'Alatnica')
returns setof public.shift_schedules security definer set search_path = public language plpgsql as $$
declare week_index int; day_index int; worker_index int; schedule_row public.shift_schedules; definitions bigint[]; v_worker_id bigint; target_date date;
begin
  select array_agg(id order by start_time) into definitions from public.shift_definitions where is_active;
  if definitions is null or array_length(definitions,1)=0 then raise exception 'No active shift definitions'; end if;
  for week_index in 0..least(greatest(p_week_count,1),52)-1 loop
    target_date := p_start_date + week_index * 7;
    insert into public.shift_schedules(week_number,year,start_date,end_date,department,status,created_by,modified_by)
    values (extract(week from target_date)::int,extract(year from target_date)::int,target_date,target_date+6,p_department,'draft',auth.uid(),auth.uid())
    on conflict (week_number,year,department) do update set start_date=excluded.start_date,end_date=excluded.end_date,modified_by=auth.uid()
    returning * into schedule_row;
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

-- Tell PostgREST to reload immediately so the fixed RPC is callable without waiting for
-- the periodic schema refresh.
notify pgrst, 'reload schema';
