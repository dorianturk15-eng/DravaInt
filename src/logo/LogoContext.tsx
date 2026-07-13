import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

const LOGO_KEY = 'logo';
const FALLBACK_STORAGE_KEY = 'dravaint-logo-fallback';
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
  const [logo, setLogoState] = useState<string | null>(() =>
    supabase ? null : localStorage.getItem(FALLBACK_STORAGE_KEY),
  );

  useEffect(() => {
    applyFavicon(logo);
  }, [logo]);

  useEffect(() => {
    if (!supabase) return;

    async function loadLogo() {
      const { data } = await supabase!.from('app_settings').select('value').eq('key', LOGO_KEY).maybeSingle();
      setLogoState(data?.value ?? null);
    }
    loadLogo();

    const channel = supabase
      .channel('app_settings-logo-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, loadLogo)
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  async function setLogo(dataUrl: string | null) {
    setLogoState(dataUrl);
    if (supabase) {
      await supabase.from('app_settings').upsert({ key: LOGO_KEY, value: dataUrl });
    } else if (dataUrl) {
      localStorage.setItem(FALLBACK_STORAGE_KEY, dataUrl);
    } else {
      localStorage.removeItem(FALLBACK_STORAGE_KEY);
    }
  }

  return <LogoContext.Provider value={{ logo, setLogo }}>{children}</LogoContext.Provider>;
}

export function useLogo() {
  const ctx = useContext(LogoContext);
  if (!ctx) throw new Error('useLogo must be used within LogoProvider');
  return ctx;
}
