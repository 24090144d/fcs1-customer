// One-off: sync chart_titles_jo/chart_notes_jo/chart_bv_jo.cjo-21 (Config panel
// display) with the new 5-level vertical-bar drilldown (Hotel -> Category Dist ->
// Category -> Item Dist -> Item) across all 4 languages.
import fs from 'fs';

const title = '🟢 Hotel → Category Dist → Category → Item Dist → Item';
const note = 'Drills from hotel into a rank-grouped service category range, then the individual category, then a rank-grouped service-item range, down to individual items, showing Total Order, Response Time, Average Completion Duration, and Delay Rate together. Benchmark — Good when Delay Rate <= 15% and Response Time <= 15 min; Bad when Delay Rate > 30% or Response Time > 30 min.';
const bv = '#21 · Item-Level JO Drilldown — surfaces which service categories and items drive slow response, slow completion, and delay across the chain, prioritizing where to focus operational fixes.';

const files = ['en_lang.json', 'ja_lang.json', 'zh-TW_lang.json', 'zh-CN_lang.json'];

for (const file of files) {
  const path = `i18n/${file}`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  json.chart_titles_jo['cjo-21'] = title;
  json.chart_notes_jo['cjo-21'] = note;
  json.chart_bv_jo['cjo-21'] = bv;
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Updated', file);
}
