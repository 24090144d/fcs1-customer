'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { APP_THEME_OPTIONS, type AppThemeName } from '@/lib/theme';

type ThemeContextType = {
  theme: AppThemeName;
  setTheme: (next: AppThemeName) => void;
  options: typeof APP_THEME_OPTIONS;
};

const STORAGE_KEY = 'fcs1-theme';

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppThemeName>('chromatic-ink');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as AppThemeName | null;
      if (stored && APP_THEME_OPTIONS.some((option) => option.value === stored)) {
        setThemeState(stored);
      }
    } catch {
      // Ignore localStorage access failures.
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage access failures.
    }
  }, [theme]);

  const value = useMemo<ThemeContextType>(() => ({
    theme,
    setTheme: setThemeState,
    options: APP_THEME_OPTIONS,
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
