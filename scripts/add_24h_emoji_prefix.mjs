// Prepends the ⏰ emoji to every 24-hour-of-day distribution chart's title,
// across all four i18n language files. Idempotent — skips titles that already
// start with ⏰.
//
// Usage: node scripts/add_24h_emoji_prefix.mjs

import { readFileSync, writeFileSync } from 'fs';

const CHART_IDS = {
  chart_titles_jo: [
    'jo-01', 'jo-02', 'jo-06', 'jo-27', 'jo-28',
    'cjo-02', 'cjo-03', 'cjo-12', 'cjo-13', 'cjo-14', 'cjo-22',
    'cjo-23', 'cjo-24', 'cjo-25', 'cjo-26', 'cjo-28',
  ],
  chart_titles_mo: ['mo-10', 'mo-11', 'cmo-10', 'cmo-11'],
  chart_titles_co: [
    'co-04', 'co-15', 'co-16', 'co-17', 'co-18', 'co-19', 'co-20',
    'co-25', 'co-26', 'co-27', 'co-28', 'co-29', 'co-30', 'co-31', 'co-32', 'co-33',
    'co-40', 'co-42',
    'cco-03', 'cco-18', 'cco-19', 'cco-20', 'cco-21', 'cco-22', 'cco-23',
    'cco-28', 'cco-29', 'cco-30', 'cco-31', 'cco-32', 'cco-33', 'cco-34', 'cco-35', 'cco-36',
    'cco-44', 'cco-46',
  ],
  chart_titles_im: ['im-04', 'im-44', 'im-45', 'cim-25', 'cim-26'],
};

const LANGS = ['en', 'ja', 'zh-TW', 'zh-CN'];

for (const lang of LANGS) {
  const path = `i18n/${lang}_lang.json`;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  let changed = 0;
  let missing = 0;

  for (const [section, ids] of Object.entries(CHART_IDS)) {
    const dict = json[section];
    if (!dict) { console.log(`[${lang}] section ${section} not found — skipping`); continue; }
    for (const id of ids) {
      const current = dict[id];
      if (current === undefined) { missing++; console.log(`[${lang}] ${section}.${id} — key missing, skipped`); continue; }
      if (current.startsWith('⏰')) continue; // idempotent
      dict[id] = `⏰ ${current}`;
      changed++;
    }
  }

  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`[${lang}] updated ${changed} titles, ${missing} missing keys`);
}

console.log('\nDone.');
