import { readFileSync, writeFileSync } from 'node:fs';

const titleOld = '"jo-02": "\u{1F7E3} SLA vs Jobs by Week"';
const titleNew = '"jo-02": "\u{1F7E2} Top Service Item Category → 24-Hour Job Distribution"';

const noteOld = '"jo-02": "Week-ascending workload bars with SLA compliance line. Benchmark — Good: SLA compliance ≥ 95%; Watch: 85–95%; Bad: < 85%, especially when SLA dips on high-volume weeks."';
const noteNew = '"jo-02": "Top 10 service item categories ranked by total job count (column). Click a category to drill into its 24-hour distribution. Benchmark — Good: top category ≤ 30% of total jobs and 24-h spread is even; Watch: one category dominates > 40%; Bad: a single category > 50% with a sharp peak hour (staffing gap)."';

const bvOld  = '"jo-02": "#2 \xB7 SLA Health — tracks SLA compliance against weekly volume to expose bottlenecks during surge weeks before breaches compound."';
const bvNew  = '"jo-02": "#2 \xB7 Demand Mix — shows which service categories drive the most volume and when, enabling category-specific staffing and shift planning."';

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
