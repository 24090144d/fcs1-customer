// One-off: sync i18n for cmo-13..22 (Hotel → [dimension] → Defect Dist → Defect
// 4-level drilldowns, cmo-13 being the 5-level Completed by Dist variant) across
// all 4 languages, in every section the config panel and live dashboard read:
//   chart_bv_mo / chart_titles_mo / chart_notes_mo   (Configuration panel)
//   cmo_chart_titles / cmo_chart_notes / cmo_chart_formulas   (live dashboard, via t())
import fs from 'fs';

const titles = {
  'cmo-13': '🟢 Hotel → Completed by Dist → Completed by → Defect Dist → Defect',
  'cmo-14': '🟢 Hotel → Category → Defect Dist → Defect',
  'cmo-15': '🟢 Hotel → Department → Defect Dist → Defect',
  'cmo-16': '🟢 Hotel → Guest/Non-Guest → Defect Dist → Defect',
  'cmo-17': '🟢 Hotel → On Time/Delayed → Defect Dist → Defect',
  'cmo-18': '🟢 Hotel → MO Type → Defect Dist → Defect',
  'cmo-19': '🟢 Hotel → Duration Dist → Defect Dist → Defect',
  'cmo-20': '⏰ Hotel → 24 Hour Dist → Defect Dist → Defect',
  'cmo-21': '🟢 Hotel → Escalation Level → Defect Dist → Defect',
  'cmo-22': '🟢 Hotel → Job Status → Defect Dist → Defect',
};

const notes = {
  'cmo-13': 'Drills from hotel into a rank-grouped range of completed-by technicians, then the technician, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-14': 'Drills from hotel into category, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-15': 'Drills from hotel into created department, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-16': 'Drills from hotel into guest-related vs non-guest-related, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-17': 'Drills from hotel into on-time vs delayed (past deadline) jobs, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-18': 'Drills from hotel into job type (MO/PM), then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-19': 'Drills from hotel into completed-duration bucket, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Uncompleted jobs count as 0h (the "< 1h" bucket). Benchmark — Good when Delay Rate <= 15%; Bad when Delay Rate > 30% or most volume sits in the 8h+/24h+ buckets.',
  'cmo-20': 'Drills from hotel into hour of creation, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-21': 'Drills from hotel into escalation level, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
  'cmo-22': 'Drills from hotel into job status, then a rank-grouped defect range, down to individual defects, showing Total Order, Completed Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Completed Duration <= 8h; Bad when Delay Rate > 30% or Completed Duration > 24h.',
};

const formulas = {
  'cmo-13': 'Level 2 = rank-ranges of COUNT(jobs) GROUP BY completed_by per hotel (width = 50 if distinct count > 500, 20 if > 200, else 10); Defect Dist = rank-ranges of COUNT(jobs) BY defect WITHIN technician; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-14': 'Level 2 = COUNT(jobs) GROUP BY category per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect (width = 50 if distinct count > 500, 20 if > 200, else 10); leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-15': 'Level 2 = COUNT(jobs) GROUP BY created_by_department per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-16': 'Level 2 = COUNT(jobs) GROUP BY guest_related per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-17': 'Level 2 = COUNT(jobs) GROUP BY (is_overdue ? Delayed : On Time) per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-18': 'Level 2 = COUNT(jobs) GROUP BY type per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO OR type = PM',
  'cmo-19': 'Level 2 = COUNT(jobs) GROUP BY completed_duration_bucket per hotel (duration = completed_datetime - created_datetime in hours, 0 when not yet Completed); Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours), Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-20': 'Level 2 = COUNT(jobs) GROUP BY HOUR(created_datetime) per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-21': 'Level 2 = COUNT(jobs) GROUP BY escalation_level per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
  'cmo-22': 'Level 2 = COUNT(jobs) GROUP BY job_status per hotel; Defect Dist = rank-ranges of COUNT(jobs) BY defect; leaf = COUNT(jobs), AVG(completed_hours) [0 when not yet Completed], Delay Rate = overdue jobs / COUNT * 100 WHERE type = MO',
};

const bvThemes = {
  'cmo-13': '#13 · Technician Drilldown',
  'cmo-14': '#14 · Category Drilldown',
  'cmo-15': '#15 · Department Drilldown',
  'cmo-16': '#16 · Guest Impact Drilldown',
  'cmo-17': '#17 · Delay Drilldown',
  'cmo-18': '#18 · MO/PM Mix Drilldown',
  'cmo-19': '#19 · Duration Drilldown',
  'cmo-20': '#20 · Time-of-Day Drilldown',
  'cmo-21': '#21 · Escalation Drilldown',
  'cmo-22': '#22 · Status Drilldown',
};
const bvNoun = {
  'cmo-13': 'each completed-by technician',
  'cmo-14': 'each category',
  'cmo-15': 'each created department',
  'cmo-16': 'guest-related vs non-guest-related work',
  'cmo-17': 'on-time vs delayed work',
  'cmo-18': 'each job type (MO/PM)',
  'cmo-19': 'each completed-duration bucket',
  'cmo-20': 'each hour of day',
  'cmo-21': 'each escalation level',
  'cmo-22': 'each job status',
};
const bv = Object.fromEntries(Object.entries(bvThemes).map(([code, theme]) => [
  code,
  `${theme} — surfaces which defects drive volume, slow completion, and delay within ${bvNoun[code]}, prioritizing where to focus maintenance staffing and parts investment.`,
]));

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
