'use client';

import { useI18n } from './I18nProvider';
import type { Lang } from '@/lib/i18n';

const LANGS: Array<{ key: Lang; label: string }> = [
  { key: 'en', label: 'ENG' },
  { key: 'zh-CN', label: '简' },
  { key: 'zh-TW', label: '繁' },
  { key: 'ja', label: '日' },
];

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={t('layout.language_switcher', 'Language switcher')}>
      {LANGS.map((l) => {
        const active = l.key === lang;
        const label =
          l.key === 'en'
            ? t('layout.language_en', l.label)
            : l.key === 'zh-CN'
              ? t('layout.language_zh_cn', l.label)
              : l.key === 'zh-TW'
                ? t('layout.language_zh_tw', l.label)
                : t('layout.language_ja', l.label);
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => setLang(l.key)}
            className="font-mono px-2 py-1"
            style={{
              fontSize: '0.62rem',
              letterSpacing: '0.08em',
              border: active ? '1px solid #1f5e57' : '1px solid #D9C8A8',
              color: active ? '#1f5e57' : '#6B6560',
              background: active ? 'rgba(31,94,87,0.08)' : '#FAF7F2',
            }}
            aria-pressed={active}
            aria-label={`Switch language to ${l.key}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
