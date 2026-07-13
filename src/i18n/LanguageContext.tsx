import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { translations, type Lang, type TranslationShape } from './translations';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TranslationShape;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'dravaint-lang';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' ? 'en' : 'hr';
  });

  const setLang = (next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo(
    () => ({ lang, setLang, t: translations[lang] }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
