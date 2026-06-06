'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Globe, Maximize2, Minimize2, Moon, Printer, Sun } from 'lucide-react';
import { useI18n } from './I18nProvider';
import { useTheme } from './ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';

const LANGS = [
  { key: 'en', label: 'EN' },
  { key: 'zh-CN', label: '简' },
  { key: 'zh-TW', label: '繁' },
  { key: 'ja', label: '日' },
] as const;

export function DashboardHeaderActions() {
  const { lang, setLang } = useI18n();
  const { theme } = useTheme();
  const [dark, setDark] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    setDark(html.classList.contains('dark'));
    const observer = new MutationObserver(() => setDark(html.classList.contains('dark')));
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    updateFullscreen();
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);

  const handleExport = () => {
    window.print();
  };

  const handleFullScreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Ignore fullscreen failures.
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex items-center rounded-xl overflow-hidden" style={{ background: tokens.dashboard.inputBg, border: `1px solid ${tokens.dashboard.inputBorder}` }}>
        <Globe size={14} style={{ position: 'absolute', left: 10, color: tokens.dashboard.inputText }} />
        <select
          value={lang}
          onChange={(event) => setLang(event.target.value as typeof lang)}
          className="appearance-none font-mono text-xs uppercase tracking-wide pl-8 pr-8 py-2 outline-none"
          style={{ background: 'transparent', color: tokens.dashboard.inputText, minWidth: '72px' }}
          aria-label="Language selector"
        >
          {LANGS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
        <ChevronDown size={12} style={{ position: 'absolute', right: 8, color: tokens.dashboard.inputText, pointerEvents: 'none' }} />
      </div>

      <button
        type="button"
        onClick={handleExport}
        className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors"
        style={{ background: tokens.dashboard.inputBg, border: `1px solid ${tokens.dashboard.inputBorder}`, color: tokens.dashboard.inputText }}
        aria-label="Export PDF"
      >
        <Printer size={14} />
      </button>

      <button
        type="button"
        onClick={() => {
          const html = document.documentElement;
          html.classList.toggle('dark');
        }}
        className="h-8 w-8 grid place-items-center transition-opacity hover:opacity-80 rounded-xl"
        style={{ border: `1px solid ${tokens.dashboard.inputBorder}`, background: tokens.dashboard.inputBg, color: tokens.dashboard.inputText }}
        aria-label="Toggle dark mode"
      >
        {dark ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      <button
        type="button"
        onClick={handleFullScreen}
        className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors"
        style={{ background: tokens.dashboard.inputBg, border: `1px solid ${tokens.dashboard.inputBorder}`, color: tokens.dashboard.inputText }}
        aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}
