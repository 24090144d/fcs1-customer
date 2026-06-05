import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'app', 'dashboard', 'DashboardClient.tsx'), 'utf8');
const finalizeSource = fs.readFileSync(path.join(repoRoot, 'app', 'api', 'uploads', 'finalize', 'route.ts'), 'utf8');

test('dashboard client tracks mo module state', () => {
  assert.match(source, /const isMo = data\.meta\.schema === 'mo-v1'/);
});

test('dashboard client exposes maintenance type switcher', () => {
  assert.match(source, /useState<MaintenanceType>\('MO'\)/);
  assert.match(source, />MO<\/button>/);
  assert.match(source, />PM<\/button>/);
});

test('corp mo exposes hotel filter with ALL default', () => {
  assert.match(source, /const \[hotelFilter, setHotelFilter\] = useState\('ALL'\);/);
  assert.match(source, /const corpHotelOptions = useMemo\(\(\) => \{/);
  assert.match(source, /chainEntries\.filter\(\(entry\) => entry\.hotel_code === hotelFilter\)/);
  assert.match(source, /dashboard_ui\.hotel_filter', 'HOTEL'/);
});

test('dashboard client builds corp mo charts and renders corp mo section', () => {
  assert.match(source, /function buildCorpMoCharts\(entries: ChainEntry\[\], worldMapData\?: Record<string, unknown> \| null\): ChartDef\[\]/);
  assert.match(source, /const corpMoCharts = useMemo<ChartDef\[\]>\(\(\) => \{/);
  assert.match(source, /if \(entries\.length === 0\) return \[\];/);
  assert.match(source, /<SectionHead label=\{`Corp \$\{maintenanceType\} Benchmark Charts`\} dark=\{dark\} \/>/);
  assert.match(source, /<CorpMoPerformanceTable/);
});

test('corp mo includes world map maintenance chart and topology fetch', () => {
  assert.match(source, /make\('cmo_chart_06', 'Worldmap Maintenance by Hotel'/);
  assert.match(source, /fetch\('https:\/\/code\.highcharts\.com\/mapdata\/custom\/world\.geo\.json'\)/);
  assert.match(source, /return orderChartDefs\(buildCorpMoCharts\(activeCorpEntries, worldMapData\), CORP_MO_CHART_DISPLAY_ORDER\)\.map/);
});

test('corp jo and mo chart builders allow single-hotel filtered views', () => {
  assert.match(source, /function buildCorpJoCharts\(entries: ChainEntry\[\], worldMapData\?: Record<string, unknown> \| null\): ChartDef\[\]/);
  assert.match(source, /if \(entries\.length === 0\) return \[\];/);
  assert.match(source, /function buildCorpMoCharts\(entries: ChainEntry\[\], worldMapData\?: Record<string, unknown> \| null\): ChartDef\[\]/);
  assert.match(source, /const corpMoCharts = useMemo<ChartDef\[\]>\(\(\) => \{/);
});

test('corp mo hotel performance table uses executive index columns and risk rank', () => {
  assert.match(source, /\['Index', 'Hotel', maintenanceType === 'PM' \? 'Total PM Orders' : 'Total Orders', 'Completion %', 'Open %', 'Guest Related %', 'Severity Index', 'Top Category %', 'Top Category', 'Top Defect \/ Asset', 'Daily Avg', 'Risk Rank'\]/);
  assert.match(source, /const maxOrders = Math\.max\(1, \.\.\.entries\.map\(\(entry\) => entry\.summary\.total \?\? 0\)\);/);
  assert.match(source, /const riskRank = \(severity \* 25\) \+ \(openRate \* 0\.8\) \+ \(guestShare \* 0\.5\) \+ \(topCategoryShare \* 0\.4\) \+ volumeFactor;/);
  assert.match(source, /\.sort\(\(a, b\) => b\.riskRank - a\.riskRank \|\| b\.openRate - a\.openRate \|\| b\.orders - a\.orders\)/);
});

test('mo chart display order swaps hotel 02 with 07 and corp 03 with 12', () => {
  assert.match(source, /const HOTEL_MO_CHART_DISPLAY_ORDER = \['chart_01', 'chart_07', 'chart_03', 'chart_04', 'chart_05', 'chart_06', 'chart_02', 'chart_08', 'chart_09', 'chart_10'\];/);
  assert.match(source, /const CORP_MO_CHART_DISPLAY_ORDER = \['cmo_chart_01', 'cmo_chart_02', 'cmo_chart_12', 'cmo_chart_04', 'cmo_chart_05', 'cmo_chart_06', 'cmo_chart_07', 'cmo_chart_08', 'cmo_chart_09', 'cmo_chart_10', 'cmo_chart_11', 'cmo_chart_03'\];/);
  assert.match(source, /const scopedCharts = useMemo\(\s*\(\) => orderChartDefs\(data\.charts_by_type\?\.\[maintenanceType\] \?\? data\.charts, HOTEL_MO_CHART_DISPLAY_ORDER\),/s);
  assert.match(source, /<div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">/);
});

test('mo chart 03 is status by hotel with created department drilldown', () => {
  assert.match(finalizeSource, /id: 'chart_03', title: 'Status by Hotel', filterable: true/);
  assert.match(finalizeSource, /map\(\(\[name, y\]\) => \(\{ name, y, drilldown: name/);
  assert.match(finalizeSource, /name: `\$\{status\} Created Department`/);
  assert.match(finalizeSource, /COUNT by incident_status with drilldown COUNT by created_by_department within each status/);
  assert.match(finalizeSource, /created_by_department: toStr\(rr\.created_by_department\) \?\? null/);
  assert.match(finalizeSource, /status_created_dept_map: acc\.statusCreatedDeptMap/);
  assert.match(source, /if \(def\.id === 'chart_03' && storedOptions\.drilldown\) return \{ fullPeriod: true \};/);
});
