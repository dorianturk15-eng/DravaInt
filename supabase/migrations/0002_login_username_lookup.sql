-- Fixes username login in Supabase mode. profiles is only readable by the
-- `authenticated` role (0001 + schema.sql), so before login the client's
-- profiles query returns nothing and the app invented `<username>@dravaint.local`
-- as the sign-in email — which never matches a real auth user, so every
-- username login failed with "invalid login credentials".
--
-- This SECURITY DEFINER function lets the anon role resolve exactly one email
-- for an exact, active username. Narrow, deliberate disclosure: no other
-- columns, no listing, and only for usernames the caller already knows.
create or replace function public.login_email_for_username(candidate text) returns text stable security definer set search_path = public language sql as $$ select email from public.profiles where lower(username)=lower(trim(candidate)) and is_active limit 1 $$;
revoke all on function public.login_email_for_username(text) from public;
grant execute on function public.login_email_for_username(text) to anon, authenticated;
