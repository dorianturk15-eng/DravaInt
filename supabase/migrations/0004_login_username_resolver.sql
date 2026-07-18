-- 0004: Proper pre-login username -> email resolver (idempotent; safe to run
-- even if 0002 was already applied — this supersedes it).
--
-- Username-based login must turn a typed username into the account's real sign-in
-- email *before* any session exists. public.profiles is readable only by the
-- `authenticated` role (0001 / schema.sql), so a logged-out client cannot do this
-- lookup itself; it previously fell back to guessing `<username>@dravaint.local`,
-- which fails for any account whose email doesn't follow that convention (e.g. an
-- admin created with a real mailbox). Full-email login worked, plain username did not.
--
-- This SECURITY DEFINER function runs with the definer's rights (bypassing RLS) but
-- is deliberately minimal: given one exact, active username it returns that single
-- account's email and nothing else — no other columns, no listing, no wildcard/prefix
-- search, no enumeration helper. It is the ONLY access to profiles granted to `anon`,
-- and returns exactly one text value (the email) or NULL if there is no such active
-- user. The disclosure is the minimum inherently required for username login to exist.

create or replace function public.login_email_for_username(candidate text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where trim(candidate) <> ''
    and lower(username) = lower(trim(candidate))
    and is_active
  limit 1
$$;

comment on function public.login_email_for_username(text) is
  'Pre-login (anon-callable) resolver: maps one exact, active username to its sign-in email only. Exposes no other profile data and cannot list/enumerate users.';

-- Functional index so the case-insensitive lookup is index-backed: fast, and with
-- consistent timing whether or not the username exists (minor enumeration hardening).
create index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Least privilege: drop the implicit PUBLIC execute grant, then allow only the two
-- login roles. anon is required — the caller is unauthenticated at login time.
revoke all on function public.login_email_for_username(text) from public;
grant execute on function public.login_email_for_username(text) to anon, authenticated;

-- Tell PostgREST to reload immediately so the RPC is callable without waiting for
-- the periodic schema refresh (otherwise the first calls can 404 after deploy).
notify pgrst, 'reload schema';
