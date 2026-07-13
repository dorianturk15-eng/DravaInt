import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../supabase/client';

const SESSION_KEY = 'dravaint-auth';

export interface StoredUser {
  username: string;
  password: string;
}

const FALLBACK_USERS: StoredUser[] = [
  { username: 'dturk', password: '1234' },
  { username: 'kstankovic', password: 'ks741953' },
];

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  users: StoredUser[];
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  addUser: (username: string, password: string) => Promise<boolean>;
  updateUser: (originalUsername: string, username: string, password: string) => Promise<boolean>;
  deleteUser: (username: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<StoredUser[]>(FALLBACK_USERS);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [username, setUsername] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_KEY),
  );

  useEffect(() => {
    if (!supabase) return;

    async function loadUsers() {
      const { data, error } = await supabase!.from('app_users').select('username,password').order('id');
      if (!error && data) setUsers(data);
      setLoading(false);
    }
    loadUsers();

    const channel = supabase
      .channel('app_users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users' }, loadUsers)
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  async function login(user: string, password: string): Promise<boolean> {
    const found = users.find((u) => u.username === user && u.password === password);
    if (found) {
      sessionStorage.setItem(SESSION_KEY, found.username);
      setUsername(found.username);
      return true;
    }
    return false;
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    setUsername(null);
  }

  async function addUser(newUsername: string, password: string): Promise<boolean> {
    const trimmed = newUsername.trim();
    if (!trimmed || !password) return false;
    if (users.some((u) => u.username.toLowerCase() === trimmed.toLowerCase())) return false;

    if (supabase) {
      const { error } = await supabase.from('app_users').insert({ username: trimmed, password });
      if (error) return false;
    } else {
      setUsers((prev) => [...prev, { username: trimmed, password }]);
    }
    return true;
  }

  async function updateUser(
    originalUsername: string,
    newUsername: string,
    password: string,
  ): Promise<boolean> {
    const trimmed = newUsername.trim();
    if (!trimmed || !password) return false;
    const clash = users.some(
      (u) => u.username.toLowerCase() === trimmed.toLowerCase() && u.username !== originalUsername,
    );
    if (clash) return false;

    if (supabase) {
      const { error } = await supabase
        .from('app_users')
        .update({ username: trimmed, password })
        .eq('username', originalUsername);
      if (error) return false;
    } else {
      setUsers((prev) =>
        prev.map((u) => (u.username === originalUsername ? { username: trimmed, password } : u)),
      );
    }

    if (username === originalUsername) {
      sessionStorage.setItem(SESSION_KEY, trimmed);
      setUsername(trimmed);
    }
    return true;
  }

  async function deleteUser(targetUsername: string): Promise<boolean> {
    if (users.length <= 1) return false;
    if (targetUsername === username) return false;

    if (supabase) {
      const { error } = await supabase.from('app_users').delete().eq('username', targetUsername);
      if (error) return false;
    } else {
      setUsers((prev) => prev.filter((u) => u.username !== targetUsername));
    }
    return true;
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!username,
        username,
        users,
        loading,
        login,
        logout,
        addUser,
        updateUser,
        deleteUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
