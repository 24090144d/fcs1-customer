// One-off: sync i18n for cmo-02 and cmo-08's redesign to 4-level donut drilldowns
// (Hotel → [dimension] → Defect Dist → Defect) across all 4 languages.
import fs from 'fs';

const titles = {
  'cmo-02': '🟢 Hotel → Guest/Non-Guest → Defect Dist → Defect',
  'cmo-08': '🟢 Hotel → On Time/Delayed → Defect Dist → Defect',
};

const notes = {
  'cmo-02': 'Drills from hotel into guest-related vs non-guest-related, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-08': 'Drills from hotel into on-time vs delayed (past deadline) jobs, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
};

const formulas = {
  'cmo-02': 'Level 2 = COUNT(jobs) GROUP BY guest_related per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect (width = 50 if distinct count > 500, 20 if > 200, else 10); leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-08': 'Level 2 = COUNT(jobs) GROUP BY (is_overdue ? Delayed : On Time) per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
};

const bv = {
  'cmo-02': '#2 · Guest Impact Drilldown — surfaces which defects drive volume, slow completion, and delay within guest-related vs non-guest-related work, prioritizing where to focus maintenance staffing and parts investment.',
  'cmo-08': '#8 · Delay Drilldown — surfaces which defects drive volume, slow completion, and delay within on-time vs delayed work, prioritizing where to focus maintenance staffing and parts investment.',
};

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const code of Object.keys(titles)) {
    json.chart_titles_mo[code] = titles[code];
    json.chart_notes_mo[code] = notes[code];
    json.chart_bv_mo[code] = bv[code];
    json.cmo_chart_titles[code] = titles[code];
    json.cmo_chart_notes[code] = notes[code];
    json.cmo_chart_formulas[code] = formulas[code];
  }
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
