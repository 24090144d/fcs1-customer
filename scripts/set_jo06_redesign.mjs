import { readFileSync, writeFileSync } from 'node:fs';

const titleOld = '"jo-06": "\u{1F7E3} JO Closing Rate vs Jobs Trend"';
const titleNew = '"jo-06": "\u{1F7E2} Job Status by 24-Hour Job Distribution"';

const noteOld = '"jo-06": "Weekly workload versus closure efficiency in ascending week order. Benchmark — Good: close rate ≥ 90% and stable as volume rises; Watch: 75–90%; Bad: close rate falling while weekly volume climbs."';
const noteNew = '"jo-06": "Job statuses ranked by total count (bar). Click a status to drill into its 24-hour distribution. Benchmark — Good: most jobs in completed/closed status and 24-h spread is flat; Watch: timeout or delayed count > 10% of total; Bad: a growing open/pending share or timeout spike in specific hours."';

const bvOld  = '"jo-06": "#6 · Closure Efficiency — weekly workload versus closure rate trend exposes backlog build-up weeks requiring capacity intervention."';
const bvNew  = '"jo-06": "#6 · Operations — reveals peak-hour demand by job status to plan staffing shifts and reduce timeout concentration."';

for (const L of ['en', 'zh-TW', 'zh-CN', 'ja']) {
  const p = `i18n/${L}_lang.json`;
  let s = readFileSync(p, 'utf8');
  const hasT = s.includes(titleOld);
  const hasN = s.includes(noteOld);
  const hasB = s.includes(bvOld);
  s = s.replace(titleOld, titleNew).replace(noteOld, noteNew).replace(bvOld, bvNew);
  writeFileSync(p, s);
  JSON.parse(readFileSync(p, 'utf8'));
  console.log(`${L}: title=${hasT} note=${hasN} bv=${hasB} -> valid JSON`);
}
