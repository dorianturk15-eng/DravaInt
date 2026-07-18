import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { isSupabaseConfigured, supabase } from '../supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const SESSION_KEY = 'dravaint-offline-auth';
const FALLBACK_STORAGE_KEY = 'dravaint-offline-users-v2';

export interface StoredUser {
  id?: string;
  username: string;
  email: string;
  password: string;
  role: string | null;
  rfid?: string;
}

const FALLBACK_USERS: StoredUser[] = [
  { username: 'admin', email: 'admin@dravaint.local', password: 'DravaInt!2026', role: 'admin', rfid: '10001' },
  { username: 'supervisor', email: 'supervisor@dravaint.local', password: 'Workshop!2026', role: 'managers', rfid: '10002' },
];

function loadFallbackUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as StoredUser[] : FALLBACK_USERS;
    return Array.isArray(parsed) && parsed.length ? parsed : FALLBACK_USERS;
  } catch {
    return FALLBACK_USERS;
  }
}

function saveFallbackUsers(users: StoredUser[]) {
  localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(users));
}

const LAST_LOGIN_KEY = 'dravaint-last-logins';

/** Per-workstation last-login registry shown in Administration. */
export function recordLogin(username: string) {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_LOGIN_KEY) || '{}') as Record<string, string>;
    map[username] = new Date().toISOString();
    localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify(map));
  } catch {
    // A corrupt registry must never block sign-in.
  }
}

export function getLastLogins(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_LOGIN_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function isStrongPassword(value: string) {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

/**
 * Resolves the Supabase sign-in email for a typed login identifier. An identifier containing '@' is
 * already an email and used as-is; a plain username is mapped to its real email by the server-side
 * `login_email_for_username` RPC (passed here as `resolvedEmail`). The deterministic
 * `<username>@dravaint.local` convention is only a last resort — used when the RPC returns no match
 * (unknown username) or is unreachable — so accounts whose email doesn't follow that convention
 * still log in by username.
 */
export function loginEmailFor(identifier: string, resolvedEmail: string | null | undefined): string {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.includes('@')) return normalized;
  const resolved = resolvedEmail?.trim();
  return resolved || `${normalized}@dravaint.local`;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  users: StoredUser[];
  loading: boolean;
  /**
   * True while the signed-in user's profile (and therefore their real role) has not yet been
   * resolved: the session exists but the authenticated `profiles` fetch is still in flight. Route
   * guards must treat the role as unknown — not the default 'workers' — during this window, or an
   * admin gets bounced off /admin on a direct load/refresh before their profile arrives.
   */
  roleResolving: boolean;
  secureMode: boolean;
  login: (identifier: string, password: string) => Promise<boolean>;
  loginWithRfid: (badge: string) => Promise<boolean>;
  loginWithSso: () => Promise<boolean>;
  logout: () => Promise<void>;
  addUser: (username: string, password: string, role: string | null) => Promise<boolean>;
  updateUser: (originalUsername: string, username: string, password: string, role: string | null) => Promise<boolean>;
  deleteUser: (username: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [fallbackUsers, setFallbackUsers] = useState<StoredUser[]>(loadFallbackUsers);
  const [sessionLoading, setSessionLoading] = useState(isSupabaseConfigured);
  const [username, setUsername] = useState<string | null>(() => isSupabaseConfigured ? null : sessionStorage.getItem(SESSION_KEY));
  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      // rfid_code is intentionally NOT selected: it is an authentication credential and is column-
      // revoked from the `authenticated` role in schema.sql. RFID login is disabled in Supabase mode
      // anyway (loginWithRfid short-circuits), so the client never needs badge numbers here.
      const { data, error } = await supabase!.from('profiles').select('id,username,email,role').order('username');
      if (error) throw error;
      return data.map((profile): StoredUser => ({ id: profile.id, username: profile.username, email: profile.email ?? '', role: profile.role ?? 'workers', password: '' }));
    },
  });
  const users = supabase ? (profilesQuery.data ?? []) : fallbackUsers;
  const loading = isSupabaseConfigured ? sessionLoading || profilesQuery.isLoading : false;
  // The signed-in user's role is unknown until their own profile row is present in `users`. Use
  // isFetching (not isLoading) because the pre-login anon fetch errors out — after login isLoading is
  // already false while the authenticated refetch is still running, so isLoading would clear too early.
  // sessionLoading alone (regardless of username) must also count as resolving: on a hard reload,
  // getSession() hasn't resolved yet, so username is still null and Boolean(username) would be false,
  // letting the route guard fire with the default 'workers' role before the real session is known.
  const currentUserResolved = users.some((user) => user.username.toLowerCase() === (username ?? '').toLowerCase());
  const roleResolving = Boolean(supabase) && (sessionLoading || (Boolean(username) && !currentUserResolved && profilesQuery.isFetching));

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    void client.auth.getSession().then((sessionResult) => {
      const user = sessionResult.data.session?.user;
      if (user) setUsername(String(user.user_metadata.username ?? user.email?.split('@')[0] ?? 'user'));
      setSessionLoading(false);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setUsername(user ? String(user.user_metadata.username ?? user.email?.split('@')[0] ?? 'user') : null);
      if (user) void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setSessionLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, [queryClient]);

  async function login(identifier: string, password: string) {
    const normalized = identifier.trim().toLowerCase();
    if (!normalized || !password) return false;
    if (supabase) {
      // A plain username must be resolved to its real email before any session exists. profiles is
      // authenticated-only, so its client cache is empty pre-login — resolve server-side via the
      // anon-callable login_email_for_username RPC (migration 0004) instead. loginEmailFor uses the
      // <username>@dravaint.local convention only when the RPC has no answer or is unreachable.
      let resolved: string | null = null;
      if (!normalized.includes('@')) {
        const { data } = await supabase.rpc('login_email_for_username', { candidate: normalized });
        resolved = typeof data === 'string' ? data : null;
      }
      const email = loginEmailFor(normalized, resolved);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) recordLogin(normalized);
      return !error;
    }
    const found = users.find((user) => (user.username.toLowerCase() === normalized || user.email.toLowerCase() === normalized) && user.password === password);
    if (!found) return false;
    sessionStorage.setItem(SESSION_KEY, found.username);
    setUsername(found.username);
    recordLogin(found.username);
    return true;
  }

  async function loginWithRfid(badge: string) {
    const profile = users.find((user) => user.rfid?.toLowerCase() === badge.trim().toLowerCase());
    if (!profile || supabase) return false;
    sessionStorage.setItem(SESSION_KEY, profile.username);
    setUsername(profile.username);
    recordLogin(profile.username);
    return true;
  }

  async function loginWithSso() {
    if (!supabase) return false;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'azure', options: { redirectTo: window.location.origin } });
    return !error;
  }

  async function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('dravaint-session-locked');
    if (supabase) await supabase.auth.signOut();
    setUsername(null);
  }

  async function invokeAdmin(action: string, payload: Record<string, unknown>) {
    if (!supabase) return false;
    const { error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
    if (!error) await queryClient.invalidateQueries({ queryKey: ['profiles'] });
    return !error;
  }

  async function addUser(newUsername: string, password: string, role: string | null) {
    const trimmed = newUsername.trim();
    if (!trimmed || !isStrongPassword(password) || users.some((user) => user.username.toLowerCase() === trimmed.toLowerCase())) return false;
    if (supabase) return invokeAdmin('create', { username: trimmed, email: `${trimmed}@dravaint.local`, password, role: role ?? 'workers' });
    const next = [...users, { username: trimmed, email: `${trimmed}@dravaint.local`, password, role: role ?? 'workers' }];
    setFallbackUsers(next);
    saveFallbackUsers(next);
    return true;
  }

  async function updateUser(originalUsername: string, nextUsername: string, password: string, role: string | null) {
    const trimmed = nextUsername.trim();
    const original = users.find((user) => user.username === originalUsername);
    if (!original || !trimmed || (password && !isStrongPassword(password))) return false;
    if (users.some((user) => user.username.toLowerCase() === trimmed.toLowerCase() && user.username !== originalUsername)) return false;
    if (supabase) return invokeAdmin('update', { id: original.id, username: trimmed, password: password || undefined, role: role ?? 'workers' });
    const next = users.map((user) => user.username === originalUsername ? { ...user, username: trimmed, email: `${trimmed}@dravaint.local`, password: password || user.password, role } : user);
    setFallbackUsers(next);
    saveFallbackUsers(next);
    if (username === originalUsername) { sessionStorage.setItem(SESSION_KEY, trimmed); setUsername(trimmed); }
    return true;
  }

  async function deleteUser(targetUsername: string) {
    if (targetUsername === username || users.length <= 1) return false;
    const target = users.find((user) => user.username === targetUsername);
    if (!target) return false;
    if (supabase) return invokeAdmin('delete', { id: target.id });
    const next = users.filter((user) => user.username !== targetUsername);
    setFallbackUsers(next);
    saveFallbackUsers(next);
    return true;
  }

  const value: AuthContextValue = { isAuthenticated: Boolean(username), username, users, loading, roleResolving, secureMode: isSupabaseConfigured, login, loginWithRfid, loginWithSso, logout, addUser, updateUser, deleteUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
