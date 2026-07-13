import { createContext, useContext, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'dravaint-logo';

interface LogoContextValue {
  logo: string | null;
  setLogo: (dataUrl: string | null) => void;
}

const LogoContext = createContext<LogoContextValue | null>(null);

export function LogoProvider({ children }: { children: ReactNode }) {
  const [logo, setLogoState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  function setLogo(dataUrl: string | null) {
    setLogoState(dataUrl);
    if (dataUrl) {
      localStorage.setItem(STORAGE_KEY, dataUrl);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return <LogoContext.Provider value={{ logo, setLogo }}>{children}</LogoContext.Provider>;
}

export function useLogo() {
  const ctx = useContext(LogoContext);
  if (!ctx) throw new Error('useLogo must be used within LogoProvider');
  return ctx;
}
