import en from '@/i18n/en_lang.json';
import zhCN from '@/i18n/zh-CN_lang.json';
import zhTW from '@/i18n/zh-TW_lang.json';
import ja from '@/i18n/ja_lang.json';

export type Lang = 'en' | 'zh-CN' | 'zh-TW' | 'ja';

type Dict = Record<string, unknown>;

export const dictionaries: Record<Lang, Dict> = {
  en: en as Dict,
  'zh-CN': zhCN as Dict,
  'zh-TW': zhTW as Dict,
  ja: ja as Dict,
};

export function getByPath(dict: Dict, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in (cur as Dict))) return undefined;
    cur = (cur as Dict)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

