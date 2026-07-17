// One-off: sync chart_titles_jo/chart_notes_jo/chart_bv_jo.cjo-01 (Config panel
// display) with the new 4-level donut drilldown (Hotel -> Department -> Item Dist
// -> Item) across all 4 languages.
import fs from 'fs';

const title = '🟢 Hotel → Department → Item Dist → Item';
const note = 'Outer donut shows total JO volume by hotel. Click a hotel to see its departments, then a department to see a rank-grouped range of its service items, then a range to see individual items with Total Order, Response Time, Average Completion Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Response Time <= 15 min; Bad when Delay Rate > 30% or Response Time > 30 min.';
const bv = '#1 · Item-Level JO Drilldown — surfaces which departments and service items drive slow response, slow completion, and delay across the chain, prioritizing where to focus operational fixes.';

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  json.chart_titles_jo['cjo-01'] = title;
  json.chart_notes_jo['cjo-01'] = note;
  json.chart_bv_jo['cjo-01'] = bv;
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
