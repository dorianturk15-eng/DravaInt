import { createClient } from '@supabase/supabase-js';

const rawUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL;
// The dashboard makes it easy to copy the REST endpoint (…supabase.co/rest/v1/) instead of the
// bare project URL; supabase-js appends its own /auth/v1 etc., so a service suffix 404s every
// request. Normalize to the origin rather than failing on an easy-to-make configuration slip.
const url = rawUrl?.replace(/\/+(rest|auth|storage|realtime|functions)\/v\d+\/*$/i, '').replace(/\/+$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured ? createClient(url!, anonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'dravaint-auth-session',
  },
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

/**
 * Invoke `callback` whenever a (different) user signs in. The data providers mount above the
 * login screen, so their initial fetch can fire before any session exists — it then runs as
 * `anon`, which has no table grants, and the empty result would otherwise stick until a full
 * page reload. Returns an unsubscribe function for useEffect cleanup.
 */
export function onAuthUserChange(callback: () => void): () => void {
  if (!supabase) return () => {};
  let lastUserId: string | null = null;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user?.id ?? null;
    if (userId !== null && userId !== lastUserId) {
      lastUserId = userId;
      callback();
    } else if (userId === null) {
      lastUserId = null;
    }
  });
  return () => data.subscription.unsubscribe();
}
