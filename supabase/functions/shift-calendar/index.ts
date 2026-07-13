import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return new Response('Missing token', { status: 400 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: worker } = await client.from('workers').select('id,first_name,last_name').eq('calendar_token', token).eq('is_active', true).single();
  if (!worker) return new Response('Not found', { status: 404 });
  const { data } = await client.from('shift_assignments').select('id,date,notes,shift_definitions(name_en,start_time,end_time),shift_schedules(department)').eq('worker_id', worker.id).order('date');
  const stamp = (value: string) => value.replace(/[-:]/g, '').replace('.000', '');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DravaInt//Shifts//EN','CALSCALE:GREGORIAN'];
  for (const row of data ?? []) {
    const shift = row.shift_definitions as unknown as { name_en: string; start_time: string; end_time: string };
    const end = new Date(`${row.date}T${shift.end_time}`); if (shift.end_time <= shift.start_time) end.setDate(end.getDate() + 1);
    lines.push('BEGIN:VEVENT',`UID:dravaint-${row.id}@calendar`,`DTSTAMP:${stamp(new Date().toISOString())}`,`DTSTART:${stamp(`${row.date}T${shift.start_time}`)}`,`DTEND:${stamp(end.toISOString().slice(0,19))}`,`SUMMARY:${shift.name_en} – ${worker.first_name} ${worker.last_name}`,`DESCRIPTION:${row.notes ?? ''}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
});
