import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'dravaint-logo';
const DEFAULT_FAVICON =
  document.querySelector<HTMLLinkElement>("link[rel='icon']")?.getAttribute('href') ?? '/favicon.svg';

interface LogoContextValue {
  logo: string | null;
  setLogo: (dataUrl: string | null) => void;
}

const LogoContext = createContext<LogoContextValue | null>(null);

function applyFavicon(dataUrl: string | null) {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link) {
    link.href = dataUrl || DEFAULT_FAVICON;
  }
}

export function LogoProvider({ children }: { children: ReactNode }) {
  const [logo, setLogoState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    applyFavicon(logo);
  }, [logo]);

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
