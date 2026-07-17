// One-off: sync chart_titles_jo/chart_notes_jo/chart_bv_jo for cjo-22..30 (Hotel →
// [dimension] → Item Dist → Item 4-level drilldowns) across all 4 languages.
import fs from 'fs';

const titles = {
  'cjo-22': '🟢 Hotel → Department → Item Dist → Item',
  'cjo-23': '🟢 Hotel → Job Status → Item Dist → Item',
  'cjo-24': '🟢 Hotel → VIP/Non-VIP → Item Dist → Item',
  'cjo-25': '🟢 Hotel → On Time/Delayed → Item Dist → Item',
  'cjo-26': '🟢 Hotel → Escalation Group → Item Dist → Item',
  'cjo-27': '⏰ Hotel → 24 Hour Dist → Item Dist → Item',
  'cjo-28': '🟢 Hotel → Completion Duration Dist → Item Dist → Item',
  'cjo-29': '🟢 Hotel → Delayed by Department → Item Dist → Item',
  'cjo-30': '🟢 Hotel → Delay Rate % Dist → Item Dist → Item',
};

const dimNoun = {
  'cjo-22': 'department',
  'cjo-23': 'job status',
  'cjo-24': 'VIP vs Non-VIP guests',
  'cjo-25': 'on-time vs delayed jobs',
  'cjo-26': 'escalation group',
  'cjo-27': 'hour of day',
  'cjo-28': 'completion duration buckets',
  'cjo-29': 'the department of delayed jobs only',
  'cjo-30': "buckets of each service item's own delay rate",
};

const notes = Object.fromEntries(Object.entries(dimNoun).map(([code, noun]) => [
  code,
  `Drills from hotel into ${noun}, then a rank-grouped service-item range, down to individual items, showing Total Order, Response Time, Average Completion Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Response Time <= 15 min; Bad when Delay Rate > 30% or Response Time > 30 min.`,
]));

const bvThemes = {
  'cjo-22': '#22 · Department Drilldown',
  'cjo-23': '#23 · Status Drilldown',
  'cjo-24': '#24 · VIP Drilldown',
  'cjo-25': '#25 · Delay Drilldown',
  'cjo-26': '#26 · Escalation Drilldown',
  'cjo-27': '#27 · Time-of-Day Drilldown',
  'cjo-28': '#28 · Duration Drilldown',
  'cjo-29': '#29 · Delayed-Department Drilldown',
  'cjo-30': '#30 · Delay-Rate Drilldown',
};

const bv = Object.fromEntries(Object.entries(dimNoun).map(([code, noun]) => [
  code,
  `${bvThemes[code]} — surfaces which service items drive slow response, slow completion, and delay within each ${noun}, prioritizing where to focus operational fixes.`,
]));

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const code of Object.keys(titles)) {
    json.chart_titles_jo[code] = titles[code];
    json.chart_notes_jo[code] = notes[code];
    json.chart_bv_jo[code] = bv[code];
  }
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
