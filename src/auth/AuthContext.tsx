import { createContext, useContext, useState, type ReactNode } from 'react';

const SESSION_KEY = 'dravaint-auth';
const USERS_KEY = 'dravaint-users';

export interface StoredUser {
  username: string;
  password: string;
}

const DEFAULT_USERS: StoredUser[] = [{ username: 'dturk', password: '1234' }];

function loadUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return DEFAULT_USERS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_USERS;
  } catch {
    return DEFAULT_USERS;
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  users: StoredUser[];
  login: (username: string, password: string) => boolean;
  logout: () => void;
  addUser: (username: string, password: string) => boolean;
  updateUser: (originalUsername: string, username: string, password: string) => boolean;
  deleteUser: (username: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<StoredUser[]>(() => loadUsers());
  const [username, setUsername] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_KEY),
  );

  function login(user: string, password: string): boolean {
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

  function addUser(newUsername: string, password: string): boolean {
    const trimmed = newUsername.trim();
    if (!trimmed || !password) return false;
    if (users.some((u) => u.username.toLowerCase() === trimmed.toLowerCase())) return false;
    const next = [...users, { username: trimmed, password }];
    setUsers(next);
    saveUsers(next);
    return true;
  }

  function updateUser(originalUsername: string, newUsername: string, password: string): boolean {
    const trimmed = newUsername.trim();
    if (!trimmed || !password) return false;
    const clash = users.some(
      (u) => u.username.toLowerCase() === trimmed.toLowerCase() && u.username !== originalUsername,
    );
    if (clash) return false;
    const next = users.map((u) =>
      u.username === originalUsername ? { username: trimmed, password } : u,
    );
    setUsers(next);
    saveUsers(next);
    if (username === originalUsername) {
      sessionStorage.setItem(SESSION_KEY, trimmed);
      setUsername(trimmed);
    }
    return true;
  }

  function deleteUser(targetUsername: string): boolean {
    if (users.length <= 1) return false;
    if (targetUsername === username) return false;
    const next = users.filter((u) => u.username !== targetUsername);
    setUsers(next);
    saveUsers(next);
    return true;
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!username,
        username,
        users,
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
