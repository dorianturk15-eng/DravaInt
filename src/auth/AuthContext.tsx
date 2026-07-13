import { createContext, useContext, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'dravaint-auth';

const USERS: Record<string, string> = {
  dturk: '1234',
};

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(() =>
    sessionStorage.getItem(STORAGE_KEY),
  );

  function login(user: string, password: string): boolean {
    if (USERS[user] === password) {
      sessionStorage.setItem(STORAGE_KEY, user);
      setUsername(user);
      return true;
    }
    return false;
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setUsername(null);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!username, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
