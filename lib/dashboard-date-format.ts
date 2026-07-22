import type { Lang } from '@/lib/i18n';

const LOCALE_BY_LANG: Record<Lang, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  ja: 'ja-JP',
};

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDashboardDateTime(value: string, lang: Lang, timeZone = 'UTC'): string {
  const date = validDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(LOCALE_BY_LANG[lang], {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatDashboardDate(value: string, lang: Lang, timeZone = 'UTC'): string {
  const date = validDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(LOCALE_BY_LANG[lang], {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
