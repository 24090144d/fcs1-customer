import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'app', 'dashboard', 'DashboardClient.tsx'), 'utf8');

test('corp jo chart builder includes world map at chart 06', () => {
  assert.match(source, /function buildCorpJoCharts\(entries: ChainEntry\[\], worldMapData\?: Record<string, unknown> \| null\): ChartDef\[\]/);
  assert.match(source, /make\('cjo_chart_06', 'Worldmap Job Order by Hotel'/);
  assert.match(source, /return buildCorpJoCharts\(activeChainEntries, worldMapData\)\.map\(\(def\) => \(\{/);
  assert.match(source, /title: t\(`chart_titles_jo\.\$\{def\.id\}`, def\.title\)/);
  assert.match(source, /note: t\(`chart_notes_jo\.\$\{def\.id\}`, def\.note\)/);
});

test('corp dashboards expose hotel filter with ALL default', () => {
  assert.match(source, /const \[hotelFilter, setHotelFilter\] = useState\('ALL'\);/);
  assert.match(source, /const corpHotelOptions = useMemo\(\(\) => \{/);
  assert.match(source, /chainEntries\.filter\(\(entry\) => entry\.hotel_code === hotelFilter\)/);
  assert.match(source, /dashboard_ui\.hotel_filter', 'HOTEL'/);
});
