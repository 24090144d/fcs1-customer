// One-off: sync chart_titles_im/chart_notes_im/chart_bv_im for cim-16..28 (Hotel →
// [dimension] → Incident Dist → Incident 4-level drilldowns) across all 4 languages.
// chart_formulas_im is left untouched (generic "Corp IM chart" placeholder, confirmed
// dead — not the live formula-display source for corp IM charts).
import fs from 'fs';

const titles = {
  'cim-16': '🟢 Hotel → Department → Incident Dist → Incident',
  'cim-17': '🟢 Hotel → VIP/Non-VIP → Incident Dist → Incident',
  'cim-18': '🟢 Hotel → Source of Complaint → Incident Dist → Incident',
  'cim-19': '🟢 Hotel → Booking Source → Incident Dist → Incident',
  'cim-20': '🟢 Hotel → Severity → Incident Dist → Incident',
  'cim-22': '⏰ Hotel → 24 Hour Distribution → Incident Dist → Incident',
  'cim-23': '🟢 Hotel → Duration Distribution → Incident Dist → Incident',
  'cim-24': '🟢 Hotel → Profile Type → Incident Dist → Incident',
  'cim-25': '🟢 Hotel → Incident Status → Incident Dist → Incident',
  'cim-26': '🟢 Hotel → Repeat Count Dist → Incident Dist → Incident',
  'cim-27': '🟢 Hotel → Monthly Trend → Incident Dist → Incident',
  'cim-28': '🟢 Hotel → Daily Trend → Incident Dist → Incident',
};

const dimNoun = {
  'cim-16': 'department',
  'cim-17': 'VIP vs Non-VIP guests',
  'cim-18': 'source of complaint',
  'cim-19': 'booking source',
  'cim-20': 'incident severity',
  'cim-22': 'hour of day',
  'cim-23': 'resolution duration buckets',
  'cim-24': 'guest profile type',
  'cim-25': 'incident status',
  'cim-26': 'buckets of how often the same room+category+item combo recurs',
  'cim-27': 'month',
  'cim-28': 'calendar day',
};

const notes = Object.fromEntries(Object.entries(dimNoun).map(([code, noun]) => [
  code,
  `Drills from hotel into ${noun}, then a rank-grouped incident-item range, down to individual incidents, showing Total Incident, Repeat Incident Rate, and Average Duration together. Benchmark: Good when repeat rate <= 15% and average duration <= 24h; Bad when repeat rate > 30% or average duration > 72h.`,
]));

const bvThemes = {
  'cim-16': '#16 · Department Drilldown',
  'cim-17': '#17 · VIP Drilldown',
  'cim-18': '#18 · Source Drilldown',
  'cim-19': '#19 · Booking Drilldown',
  'cim-20': '#20 · Severity Drilldown',
  'cim-22': '#22 · Time-of-Day Drilldown',
  'cim-23': '#23 · Duration Drilldown',
  'cim-24': '#24 · Profile Drilldown',
  'cim-25': '#25 · Status Drilldown',
  'cim-26': '#26 · Recurrence Drilldown',
  'cim-27': '#27 · Monthly Drilldown',
  'cim-28': '#28 · Daily Drilldown',
};

const bv = Object.fromEntries(Object.entries(dimNoun).map(([code, noun]) => [
  code,
  `${bvThemes[code]} — surfaces repeat-prone incident items and slow resolutions within each ${noun}, prioritizing where to focus prevention.`,
]));

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const code of Object.keys(titles)) {
    json.chart_titles_im[code] = titles[code];
    json.chart_notes_im[code] = notes[code];
    json.chart_bv_im[code] = bv[code];
  }
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
