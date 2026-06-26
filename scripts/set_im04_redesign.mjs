import { readFileSync, writeFileSync } from 'node:fs';

const TITLE_NEW = '\u{1F7E3} VIP vs Non-VIP → 24-Hour Distribution';
const NOTE_NEW  = 'VIP and Non-VIP incident totals (column). Click either bar to drill into its 24-hour distribution. Benchmark — Good: VIP share ≤6% and 24-h spread is even; Watch: VIP > 8% or a sharp peak hour; Bad: VIP > 10% concentrated in a narrow window (service pressure on premium guests).';

for (const lang of ['zh-TW', 'zh-CN', 'ja']) {
  const p = `i18n/${lang}_lang.json`;
  const obj = JSON.parse(readFileSync(p, 'utf8'));

  if (obj.chart_titles_im) obj.chart_titles_im['im-04'] = TITLE_NEW;
  if (obj.chart_notes_im)  obj.chart_notes_im['im-04']  = NOTE_NEW;

  writeFileSync(p, JSON.stringify(obj, null, 2));
  console.log(`${lang}: updated -> valid JSON`);
}
