'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { dictionaries, getByPath, type Lang } from '@/lib/i18n';

type I18nContextType = {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('app-lang') as Lang | null;
      if (stored && dictionaries[stored]) setLangState(stored);
    } catch { /* ignore */ }
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    try { localStorage.setItem('app-lang', next); } catch { /* ignore */ }
  }

  const value = useMemo<I18nContextType>(() => ({
    lang,
    setLang,
    t: (key: string, fallback?: string) => {
      const found = getByPath(dictionaries[lang], key);
      if (found !== undefined) return found;
      const enFallback = getByPath(dictionaries.en, key);
      return enFallback ?? fallback ?? key;
    },
  }), [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return ctx;
}

