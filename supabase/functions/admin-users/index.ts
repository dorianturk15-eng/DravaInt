import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } } });
  const admin = createClient(url, serviceKey);
  const { data: authData } = await caller.auth.getUser();
  if (!authData.user) return new Response('Unauthorized', { status: 401, headers });
  const { data: profile } = await admin.from('profiles').select('role').eq('id', authData.user.id).single();
  if (!['admin', 'boss'].includes(profile?.role)) return new Response('Forbidden', { status: 403, headers });

  const body = await request.json();
  let result;
  if (body.action === 'create') {
    result = await admin.auth.admin.createUser({ email: body.email, password: body.password, email_confirm: true, user_metadata: { username: body.username, role: body.role } });
  } else if (body.action === 'update') {
    result = await admin.auth.admin.updateUserById(body.id, { password: body.password, user_metadata: { username: body.username, role: body.role } });
    if (!result.error) await admin.from('profiles').update({ username: body.username, role: body.role }).eq('id', body.id);
  } else if (body.action === 'delete') {
    result = await admin.auth.admin.deleteUser(body.id);
  } else return new Response('Unknown action', { status: 400, headers });
  return new Response(JSON.stringify({ ok: !result.error, error: result.error?.message }), { status: result.error ? 400 : 200, headers: { ...headers, 'Content-Type': 'application/json' } });
});
