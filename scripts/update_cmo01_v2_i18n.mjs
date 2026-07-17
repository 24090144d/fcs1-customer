// One-off: sync i18n for cmo-01's redesign to the 4-level donut drilldown
// (Hotel → Department → Defect Dist → Defect) across all 4 languages, replacing
// the prior "Hotel → Department → Top Defects" 3-level content.
import fs from 'fs';

const title = '🟢 Hotel → Department → Defect Dist → Defect';
const note = 'Drills from hotel into created department, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.';
const formula = 'Level 2 = COUNT(jobs) GROUP BY created_by_department per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect (width = 50 if distinct count > 500, 20 if > 200, else 10); leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO';
const bv = '#1 · Department Drilldown — surfaces which defects drive volume, slow completion, and delay within each created department, prioritizing where to focus maintenance staffing and parts investment.';

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  json.chart_titles_mo['cmo-01'] = title;
  json.chart_notes_mo['cmo-01'] = note;
  json.chart_bv_mo['cmo-01'] = bv;
  json.cmo_chart_titles['cmo-01'] = title;
  json.cmo_chart_notes['cmo-01'] = note;
  json.cmo_chart_formulas['cmo-01'] = formula;
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
