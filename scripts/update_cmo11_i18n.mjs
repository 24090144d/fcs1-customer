// One-off: sync i18n for cmo-11's redesign to a 4-level donut drilldown
// (Hotel → Escalation Level → Defect Dist → Defect) across all 4 languages,
// replacing the prior "Top 10 Defect > 24 Hours (Chain)" content.
import fs from 'fs';

const title = '🟢 Hotel → Escalation Level → Defect Dist → Defect';
const note = 'Drills from hotel into escalation level, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.';
const formula = 'Level 2 = COUNT(jobs) GROUP BY escalation_level per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect (width = 50 if distinct count > 500, 20 if > 200, else 10); leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO';
const bv = '#11 · Escalation Drilldown — surfaces which defects drive volume, slow completion, and delay within each escalation level, prioritizing where to focus maintenance staffing and parts investment.';

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  json.chart_titles_mo['cmo-11'] = title;
  json.chart_notes_mo['cmo-11'] = note;
  json.chart_bv_mo['cmo-11'] = bv;
  json.cmo_chart_titles['cmo-11'] = title;
  json.cmo_chart_notes['cmo-11'] = note;
  json.cmo_chart_formulas['cmo-11'] = formula;
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
