# CLAUDE.md — fcs1-customer

Primary guide for Claude Code sessions on this repository.
Read this file before touching any code. The rules here override default behaviour.

**Multi-agent project.** `AGENTS.md` is the shared entry point read by every coding agent (Claude Code, Codex, Gemini CLI, etc.) — read it first. This file holds Claude-Code-specific depth (exact patterns, code snippets); keep both in sync when either changes.

---

## Project Identity

| Key | Value |
|---|---|
| App | FCS1 Customer Dashboard |
| Version | **v1.1.13** (as of 2026-07-16) |
| Stack | Next.js 14 App Router · TypeScript · Highcharts · Neon (Postgres) · Vercel |
| Branch | `main` only — no feature branches unless explicitly requested |
| Local dev | `http://localhost:3010` (`npm run dev`) |

**Local-only testing rule:** only test against localhost. Never push, deploy, or commit unless the user explicitly asks in that turn — a past approval is not standing permission.

---

## Module Map

| Code | Full Name | Hotel chart prefix | Corp chart prefix |
|---|---|---|---|
| `IM` | Incident Management | `him01`–`him39` | — |
| `JO` | Job Order | `jo_eac_01`–`jo_eac_04`, `jo_chart_01`–`jo_chart_18` | `cjo_chart_01`–`cjo_chart_22` |
| `MO` | Maintenance Order | `chart_01`–`chart_10` | `cmo_chart_01`–`cmo_chart_12` |
| `CO` | Cleaning Order / ACSR | `co_chart_01`–`co_chart_39` | `cco_chart_01`–`cco_chart_42` |

**Rule:** never reuse a hotel chart ID inside a corp view, or vice versa.

---

## Key Source Files

```
app/
  configuration/page.tsx        — Configuration panel (KPI + chart toggles, BV column)
  dashboard/DashboardClient.tsx — Main dashboard shell, module routing
  dashboard/page.tsx            — Server component, data fetch entry point

components/
  dashboard/CoDashboardView.tsx — CO hotel + corp chart definitions (buildCharts / buildCorpCharts)
  dashboard/HcChart.tsx         — Shared Highcharts wrapper (modules, theme, enhancements)
  layout/I18nProvider.tsx       — i18n context, t() hook

lib/
  dash-config-defs.ts           — MODULE_DEFS: KPI + chart ConfigItem lists, formulaPath wiring
  theme.ts                      — App theme tokens (light/dark)
  kpi-benchmarks.ts             — KPI benchmark reference values
  i18n.ts                       — i18n loader

i18n/
  en_lang.json                  — English (source of truth)
  zh-TW_lang.json               — Traditional Chinese
  zh-CN_lang.json               — Simplified Chinese
  ja_lang.json                  — Japanese
```

---

## i18n System

### Section naming convention

| Section | Purpose |
|---|---|
| `kpi_labels_XX` | KPI card labels |
| `kpi_notes_XX` | KPI tooltip notes |
| `chart_titles_XX` | Chart card header titles |
| `chart_notes_XX` | Chart footer notes |
| `chart_formulas_XX` | Chart SQL/formula strings (legacy) |
| `chart_bv_XX` | Business Value explanations (v1.0.25+) |

`XX` = module code: `jo`, `mo`, `co`, `im`

### t() usage

```ts
const { t } = useI18n();
t('chart_titles_co.cco_chart_14', fallback)
// returns i18n value if key exists, otherwise fallback
```

**Rule:** if you change a user-visible label, update **all four** language files together.
Non-English files may use English fallback text — that is acceptable and intentional.

### Emoji prefix convention (chart_titles sections only)

- 🟣 = hotel-level chart (property scope)
- 🟢 = corp-level chart (chain scope)

**Critical:** emojis belong ONLY in `chart_titles_XX` keys.
Never add them to `chart_notes_XX`, `chart_formulas_XX`, or `chart_bv_XX`.

### BV format (`chart_bv_XX`)

```
"#N · [Theme] — [explanation of business value]"
```

Example: `"#3 · Productivity — tracks attendant output to identify staffing adjustments"`

---

## Configuration Panel (`lib/dash-config-defs.ts`)

### ConfigItem

```ts
interface ConfigItem {
  id: string;           // chart/KPI id, e.g. "cco_chart_14"
  labelPath: string;    // i18n path for the label column
  notePath: string;     // i18n path for the note column
  formulaPath?: string; // i18n path for the last column (BV or Formula)
}
```

### formulaPath → BV mode

When `formulaPath` points to a `chart_bv_XX` section, the configuration panel renders the column as **Business Value** (badge + prose). When it points to `chart_formulas_XX`, it renders raw SQL.

### page.tsx — formulaLabel

```tsx
<GroupPanel formulaLabel="Business Value" ...>
```

`formulaLabel="Business Value"` is set for **all** module tabs as of v1.0.25.
Changing it back to `"Formula"` switches the column back to raw SQL display.

---

## HcChart Component (`components/dashboard/HcChart.tsx`)

### Highcharts modules loaded (in order)

`exporting` · `export-data` · `map` · `heatmap` · `drilldown` · `highcharts-more` · `funnel` · `treemap` · `sankey` · `xrange`

### applyEnhancements behaviour

The component auto-enhances chart options based on `series[0].type`:

| firstType | Enhancement applied |
|---|---|
| `pie` | Adds `dataLabels` with percentage format |
| `bar` / `column` | Top-N point labels, optional distinct colours |
| `treemap` | Top-3 tiles get `name + value` labels; all tiles get palette colours |

**Important:** enhancements run on the initial `series[]` only.
Dynamically added series (e.g. via `chart.addSeries()`) are NOT enhanced — configure them fully inline.

### Manual click-to-treemap pattern (cco_chart_21)

Highcharts' drilldown module **crashes** (`getTitlePosition` TypeError) when switching from a cartesian type (column/bar) to treemap. The correct pattern is:

```ts
plotOptions: {
  column: {
    cursor: 'pointer',
    point: {
      events: {
        click: function(this: Highcharts.Point) {
          const chart = this.series.chart;
          // 1. Hide column series + axes
          chart.series[0].setVisible(false, false);
          chart.xAxis[0].update({ visible: false }, false);
          chart.yAxis[0].update({ visible: false }, false);
          // 2. Add treemap series
          chart.addSeries({ type: 'treemap', colorByPoint: true,
            dataLabels: { enabled: true, useHTML: true, format: '...' },
            data: [...],
          } as Highcharts.SeriesOptionsType, false);
          // 3. Add Back button
          let btn: Highcharts.SVGElement;
          btn = chart.renderer.button('← Back', 10, 5, (() => {
            chart.series[chart.series.length - 1].remove(false);
            chart.series[0].setVisible(true, false);
            chart.xAxis[0].update({ visible: true }, false);
            chart.yAxis[0].update({ visible: true }, false);
            btn.destroy();
            chart.redraw();
          }) as unknown as Highcharts.EventCallbackFunction<Highcharts.SVGElement>);
          btn.attr({ zIndex: 7 }).add();
          chart.redraw();
        },
      },
    },
  },
},
```

Do NOT put `drilldown:` on the series data points when using this pattern — it will trigger the drilldown module and crash.

### Treemap dataLabels — useHTML required

```ts
dataLabels: {
  enabled: true,
  useHTML: true,   // ← required; without this <b> and <br/> render as literal text
  format: '<span style="font-size:11px"><b>{point.name}</b><br/>{point.value}</span>',
}
```

### "Daily Performance" leaf — 3-series dual-axis combo drilldown (cco-03/43/44 pattern)

For a drilldown leaf that shows **multiple metrics at once** (e.g. Total Credit + Orders as columns, Avg Duration as a spline on a secondary axis), Highcharts' single-series drilldown shorthand (`point.drilldown: 'id'` + `chart.addSeriesAsDrilldown()`) only supports **one** series per click — calling `addSeriesAsDrilldown()` a 2nd/3rd time on the same click corrupts the chart's internal drilldown state and throws `TypeError: Cannot read properties of undefined (reading 'xAxis')`.

The correct pattern is a custom `chart.events.drilldown` handler using `addSingleSeriesAsDrilldown` (register-only, no redraw) for each series, followed by one `applyDrilldown()`:

```ts
chart: {
  events: {
    drilldown: function (this: Highcharts.Chart, e: Highcharts.DrilldownEventObject) {
      if (e.seriesOptions) return; // let standard drilldown.series levels (e.g. hotel/floor) pass through
      const leafId = (e.point as unknown as { drilldown?: string }).drilldown;
      const days = leafId ? leafData[leafId] : undefined; // leafData: custom record, NOT in drilldown.series
      if (!days) return;
      const chart = this as unknown as Highcharts.Chart & {
        addSingleSeriesAsDrilldown: (point: Highcharts.Point, options: Highcharts.SeriesOptionsType) => void;
        applyDrilldown: () => void;
      };
      chart.addSingleSeriesAsDrilldown(e.point, { id: `${leafId}-credit`, type: 'column', name: 'Total Credit', color: CCO_L3, data: days.map(d => [d.date, d.credit]) } as Highcharts.SeriesOptionsType);
      chart.addSingleSeriesAsDrilldown(e.point, { id: `${leafId}-orders`, type: 'column', name: 'Orders', color: '#0E7490', data: days.map(d => [d.date, d.count]) } as Highcharts.SeriesOptionsType);
      chart.addSingleSeriesAsDrilldown(e.point, { id: `${leafId}-avgdur`, type: 'spline', name: 'Avg Duration (min)', color: '#EA580C', yAxis: 1, data: days.map(d => [d.date, d.avgDur]) } as Highcharts.SeriesOptionsType);
      chart.applyDrilldown();
    },
  },
},
yAxis: [
  { title: { text: 'Cleaning Credit' } },
  { title: { text: 'Avg Duration (min)' }, opposite: true },
],
```

The leaf level's data must be looked up in a **custom** `leafData` record keyed by drilldown id — it is deliberately excluded from the chart's own `drilldown.series` array (which only holds the registered single-series levels above it, e.g. hotel → floor → attendant/inspector). `addSingleSeriesAsDrilldown`/`applyDrilldown` aren't in the official Highcharts type defs, hence the `as unknown as ...` cast on `chart`.

---

## Section Structure: KPI / Simple Charts / Long Charts

All four modules (CO, then JO/MO/IM) render dashboards in three top-level sections, in this order:

1. **KPI** — `kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3`
2. **Simple Charts** — `chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4` (2 charts per row)
3. **Long Charts** — `chart-grid-long mt-5 grid grid-cols-1 gap-4` (1 chart per row; for deep multi-level drilldowns that read better full-width)

Each section is headed by the shared `SectionHead` component and wrapped in the same outer container:
```tsx
<div className="px-6 pt-1 pb-5 space-y-7 max-w-screen-2xl mx-auto">
  <section className="kpi-print-section">
    <SectionHead label={t('dashboard_ui.section_kpi', 'KPI')} dark={dark} />
    <div className="kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">...</div>
  </section>
  <section>
    <SectionHead label={t('dashboard_ui.section_simple_charts', 'Simple Charts')} dark={dark} />
    <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">...</div>
  </section>
  {/* Long Charts section conditionally rendered when its list is non-empty (or always, for corp views that also render a performance table there) */}
</div>
```

**`SectionHead` must include `mb-3`** on its outer div (`"print-section-head flex items-center gap-4 mb-3"`). This is the only thing separating the label/rule from the cards below it (the grid itself uses `mt-0`/`mt-5`, not a top margin against the label). `CoDashboardView.tsx` and `DashboardClient.tsx` each define their **own copy** of `SectionHead` — if you add spacing/style changes to one, mirror them in the other or the modules will visibly drift apart again (this happened once: `DashboardClient.tsx`'s copy was missing `mb-3`, causing JO/MO/IM section labels to sit flush against the cards while CO had a 12px gap).

**No other sub-section headers.** JO/MO/IM used to have additional named sub-groups inside "Simple Charts" (e.g. "Executive Charts", "Over the time charts", "Drilldown charts", "Operation Analysis", "Corp Comparison Top 10", "Chain Comparison", "Time Patterns", "Performance Gauges", "Builder Charts"). These have all been flattened — every chart array for a given scope is concatenated and rendered in one shared "Simple Charts" grid, no intermediate `SectionHead`. Do not reintroduce sub-headers; if a chart family needs visual separation, that's what "Long Charts" is for.

**Long Charts membership** is controlled by an id `Set` per module, all currently **empty** (charts move in only on an explicit "move X into Long Charts" request, one at a time — do not batch-move charts speculatively):
- CO: `LONG_CHART_IDS` in `CoDashboardView.tsx`
- MO: `MO_LONG_CHART_IDS` in `DashboardClient.tsx`, split via `splitLongCharts(charts, ids)` into `{ simple, long }`
- JO: `JO_LONG_CHART_IDS` in `DashboardClient.tsx`
- IM: `IM_LONG_CHART_IDS` in `DashboardClient.tsx`

For MO the split is a real `simple`/`long` partition of one chart array. For JO/IM (which combine several previously-separate chart arrays into one flat list), `joLongCharts`/`imLongCharts` are computed by concatenating all the source arrays and filtering by `LONG_CHART_IDS.has(c.id)` — the Simple Charts grid does not currently exclude long-flagged charts from its own map calls (harmless while the sets are empty; when moving a chart into Long, also strip it out of the Simple Charts render so it isn't shown twice).

Every hardcoded chart list-size cap (`topN(map, N)` / `.slice(0, N)`) in JO/MO/IM builder code has been normalized to **N = 24** (Simple Charts) as a baseline; charts moved into Long Charts should bump their own cap to **N = 50**, mirroring the CO precedent. Excluded from this normalization: `topN(..., 1)` single-item lookups (KPI concentration metrics, not chart lists), the `im-46` `999`-vs-`24` "show all" ternary branch, and date-string `.slice(0, 7)`/`.slice(0, 10)` calls (unrelated to list caps).

---

## Chart Data Patterns

### groupCount / topEntries (CO module)

```ts
// Group rows by a string key and count
function groupCount(rows: CoRow[], getter: (r: CoRow) => string | null | undefined): Record<string, number>

// Return top-N entries sorted by count descending
function topEntries(map: Record<string, number>, limit: number): Array<[string, number]>
```

### Treemap data format

Highcharts treemap uses `value` (not `y`):
```ts
{ name: 'Alice', value: 14 }   // ✅ correct
{ name: 'Alice', y: 14 }       // ❌ wrong for treemap
```

---

## Build & Deploy

### Local TypeScript check (authoritative)
```bash
npx tsc --noEmit
```

### Local `next build` on Windows
Fails with `EISDIR: illegal operation on a directory, readlink …_app.js` — this is a Windows webpack/symlink issue. **It does not affect Vercel** (Linux build). Use `tsc --noEmit` locally as the compile gate.

### JSON validation
```bash
node -e "['en','ja','zh-TW','zh-CN'].forEach(l => { try { JSON.parse(require('fs').readFileSync('i18n/'+l+'_lang.json','utf8')); console.log('OK',l); } catch(e) { console.log('FAIL',l,e.message); } })"
```

### Deploy checklist
1. `npx tsc --noEmit` — 0 errors
2. Validate all 4 i18n JSON files
3. `git add` any new files (`lib/dash-config-defs.ts` was untracked until v1.0.25)
4. Bump `package.json` version
5. Before pushing, note the current `HEAD` commit hash/version as the rollback point (e.g. `git log -1 --format="%h %s"`) and state it to the user — this is what `git revert` targets if the new push turns out bad.
6. `git commit && git push origin main`
7. Vercel auto-deploys; Neon needs no action for frontend-only changes
8. After confirming the push, tell the user both the new version/commit and the rollback commit, e.g.: "Pushed v1.1.9 (`1810141`). If this needs rolling back, the previous good state was v1.1.8 (`3c30c9d`) — I can `git revert 1810141` to restore it."

---

## Critical Rules (never violate)

1. **One `main` branch.** Do not create feature branches unless the user explicitly asks.
2. **Module independence.** Corp chart ids ≠ hotel chart ids. Never let one overwrite the other.
3. **i18n completeness.** Any visible label change → update all 4 lang files.
4. **Emoji in titles only.** 🟣/🟢 go in `chart_titles_XX` keys. Not in notes, formulas, or BV.
5. **Null-safe parsing.** Missing date/status/attendant/duration must not crash any dashboard.
6. **Treemap ≠ drilldown module.** Use `point.events.click` + `chart.addSeries` pattern (not `drilldown:`) for column→treemap transitions.
7. **BV vs Formula mode.** `formulaPath` pointing to `chart_bv_XX` = BV mode. Pointing to `chart_formulas_XX` = formula mode. Do not mix within a module.
8. **useHTML for treemap labels.** Always add `useHTML: true` when the format string contains HTML tags.
9. **Local-only testing.** Never push, deploy, or commit unless the user explicitly asks in the current turn — a prior approval does not carry forward.
10. **Section structure.** Every dashboard is KPI → Simple Charts → Long Charts only. No extra named sub-sections inside Simple Charts (see "Section Structure" above).
11. **Always identify the rollback point when pushing.** Every time you push to GitHub/Vercel, record and report the commit being pushed FROM (the last known-good commit hash/version) alongside the new one, so if the new version turns out broken there's an immediate, named target for `git revert` — no digging through `git log` under pressure. Prefer `git revert` (safe, non-destructive, auto-redeploys) over `git reset --hard --force` (only with explicit user confirmation).

---

## Version History (recent)

| Version | Date | Summary |
|---|---|---|
| **v1.1.13** | 2026-07-16 | Three CCO charts (cco-03, cco-43, cco-44) redesigned so their leaf drilldown level shows a multi-metric "Daily Performance" view instead of a single aggregate: **cco-03** (`Hotel → Floor → Attendant Credit → Daily Performance`), **cco-43** (`Hotel → Floor → Attendant Average Credit → Daily Performance`), **cco-44** (`Hotel → Floor → Inspector Average Credit → Daily Performance`, ⏰ prefix removed — no longer a 24-hour chart, also dropped from `CO_24H_CHART_IDS`) — each leaf shows 3 series per date (Total Credit + Orders as columns, Avg Duration as a secondary-axis spline) for the clicked attendant/inspector. New shared helpers in `CoDashboardView.tsx`: `ccoAccumulateFloorDaily()` (generic Hotel→Floor→Attendant-or-Inspector daily aggregator), `ccoBuildFloorAvgCreditDrilldown()` (builds the 3-level primary/dd/leafData structure for cco-43/44), `ccoDailyPerformanceDrilldownHandler()` (factory for the shared leaf-level drilldown handler, reused identically by cco-03/43/44). **Found and fixed a real Highcharts bug** while building this: `chart.addSeriesAsDrilldown()` — the standard single-series drilldown helper — corrupts the chart's internal drilldown state if called more than once per click, throwing `TypeError: Cannot read properties of undefined (reading 'xAxis')` on the 2nd/3rd call; fixed by switching to `chart.addSingleSeriesAsDrilldown()` (register-only) called once per series followed by a single `chart.applyDrilldown()` — see new "Daily Performance leaf" pattern documented above in this file. i18n titles/notes/BV updated across all 4 languages for cco-03/43/44; `tsc --noEmit` clean; all three charts verified live via real 4-level drilldown clicks with exact data checks (e.g. cco-44: PAR → L14 → PM Andaquig Christian79018 → 2026-07-03 showing Total Credit=2, Orders=1, Avg Duration=60min), no functional console errors (only the previously-confirmed-benign dev-mode Fast Refresh warnings). |
| **v1.1.12** | 2026-07-15 | Corp CO (CCO) charts cco-31 through cco-42 restructured from 2-level (`Dimension → Distribution`) to 3-level (`Hotel → Dimension → 24-Hour/Duration Distribution`) drilldowns: cco-31 Stay Status, cco-32 Cleaning Status, cco-33 Room Type, cco-34 On-Time/Delayed, cco-35 Cleaning Type, cco-36 Top 50 Attendants (all → 24-Hour Cleaning Distribution); cco-37–42 mirror the same six dimensions → Cleaning Duration Distribution. New shared `ccoBuildHotelDrilldown()` helper in `CoDashboardView.tsx` generates all 12 charts' 3-level series from one reusable function (replacing 12 near-duplicate 2-level chart definitions and their `ccoDim24h*`/`ccoDimDur*` precomputed arrays). Titles/notes/formulas updated in code and all 4 i18n languages, preserving existing ⏰/🟢 emoji conventions. `tsc --noEmit` clean; verified live via real drilldown clicks through all 3 levels (Hotel → Stay Status → 24-Hour, confirmed PAR → StayOver → hourly peak at 14:00). |
| **v1.1.11** | 2026-07-14 | Two IM duration-calculation fixes, both traced from a real report that cim-18/cim-19's Level 1 hotel totals didn't match the sum of their own drilldown levels (e.g. CON showed 811 at Level 1 but only 155 in the duration-bucket drilldown). (1) **Level 1/Level 2 mismatch fixed**: cim-18/cim-19's Level 1 bar previously used the hotel's full incident count (`e.summary.total`); it now sums the same duration-tagged data used by the drilldown (`hotelDurTotals`), so the two levels always agree — series renamed to "Incidents with Resolution Duration" for clarity. (2) **Duration formula given a two-tier fallback**: `investigation_updated_on_2` (close date) now falls back to `investigation_updated_on_1` when cycle 2 was never filled in, and defaults to a fixed 48h duration (24h+ bucket) when *neither* investigation timestamp is present, instead of silently dropping the record — applied consistently across all 4 places IM duration is computed: `app/api/uploads/finalize/route.ts` (bakes `im_item_duration_map`/`im_cat_item_dur_bkt_map` at upload time), `lib/dashboard-fetch.ts` (live corp override of `im_item_duration_map`, feeds cim-24), and `app/api/dashboard/im-scope/route.ts` + `im-scope-builder/route.ts` (department-scoped duration maps). Both backfill scripts updated to match via SQL `CASE`/`COALESCE`; re-run against the local dev DB — every hotel's cim-18/cim-19 totals now exactly equal their real incident counts (previously SND showed 0 duration records at all; now shows all 169, mostly in the 24h+ fallback bucket). `tsc --noEmit` clean; verified live via real drilldown clicks confirming exact sums (e.g. SND: 0+2+0+2+6+159 = 169) and no regressions on cim-24. **Production note:** the 6 production databases still have pre-fallback duration data — `scripts/backfill_im_cat_item_dur_bkt_map_all_customers.mjs` needs to be re-run against them (or a fresh CSV re-upload) to apply the same fallback there. |
| **v1.1.10** | 2026-07-14 | Renamed cim-18/cim-19 titles to drop the word "Average" — the level-4/level-2 chart already showed a bucketed count distribution (`< 1h`/`1-2h`/`2-4h`/`4-8h`/`8-24h`/`24h+`), never an average value, so "Average Resolution Duration Distribution" was a misnomer. cim-18 → `Hotel -> Incident Category -> Incident Item -> Resolution Duration Distribution`; cim-19 → `Hotel -> Resolution Duration Distribution (Hours) -> Top Incident Items`. Also fixed the matching internal drilldown series names (`Avg Resolution Duration...` → `Resolution Duration...`). No logic/data change. i18n titles updated across all 4 languages; `tsc --noEmit` clean; verified live on localhost. Also ran the `im_cat_item_dur_bkt_map` backfill (added in v1.1.9) directly against all 6 production Neon databases (CN, HK, JP, MO, MY, NEON) via a new one-off `scripts/backfill_im_cat_item_dur_bkt_map_all_customers.mjs`, so cim-18/cim-19 show real duration-distribution data in production without requiring a CSV re-upload — hotels with no `investigation_updated_on_2` (close date) filled in still render blank for those charts, which is a genuine data gap, not a bug. |
| **v1.1.9** | 2026-07-14 | Corp IM (CIM) chart redesigns and section reorganization: (1) **cim-05** redesigned from a flat "Chain — Repeat Incident Rate by Hotel" bar to a 2-level vertical-bar-drilldown `Hotel Repeat Incident Rate → Top Incident Item` (repeat rate % per hotel drills into that hotel's top incident items by count), both levels showing data-value labels. (2) **cim-18** redesigned from "Hotel x Department Matrix" (heatmap, duplicated cim-15's logic) to a 4-level vertical-bar-drilldown `Hotel → Incident Category → Incident Item → Average Resolution Duration Distribution (Hours)` — required a new data pipeline: `im_cat_item_dur_bkt_map` (category → item → resolution-duration-bucket → count, buckets `< 1h/1-2h/2-4h/4-8h/8-24h/24h+`, computed from `investigation_updated_on_2 - COALESCE(incident_datetime, created_date)`) added to `HotelSummary` (`types/dashboard.ts`) and the IM accumulator (`app/api/uploads/finalize/route.ts`), backfilled locally via new `scripts/backfill_im_cat_item_dur_bkt_map.mjs` (5 of 6 hotels had closed-with-duration records; SND had none). (3) **cim-19** redesigned from "Chain Weekly Incident Trend" to a 3-level vertical-bar-drilldown `Hotel → Average Resolution Duration Distribution (Hours) → Top Incident Items` — reuses cim-18's new `im_cat_item_dur_bkt_map` flattened across categories, no additional data pipeline needed. (4) **Section moves**: `cim-16`, `cim-18`, `cim-19`, `cim-20` all moved from Simple Charts into Long Charts (`CORP_IM_TOP_IDS`/`CORP_IM_LONG_IDS` and the corresponding `CORP_IM_TOP_MAP`/`CORP_IM_LONG_MAP` arrays updated); Simple Charts now ends at `cim-17`, Long Charts now opens with `cim-16` followed by `cim-18/19/20/22-26`. i18n title/note/BV updated across all 4 languages for cim-05/18/19; `tsc --noEmit` clean throughout; all changes verified live on localhost including real multi-level drilldown clicks through every new level and confirmed correct Simple/Long section membership. **Production note:** the new `im_cat_item_dur_bkt_map` field is local-only — production databases need `scripts/backfill_im_cat_item_dur_bkt_map.mjs` run against them, or a fresh CSV re-upload, to show real duration-distribution data instead of blank charts. |
| **v1.1.8** | 2026-07-13 | Fixed a real bug in `scripts/init-customer-db.ps1` (used by `.github/workflows/onboard-customer.yml`'s automated per-customer onboarding) that would abort onboarding for any customer whose database already has the base schema applied: the script correctly skipped `sql/schema.sql` when `upload_jobs` already existed, but then unconditionally re-ran migrations `001`-`009` regardless — none of which are `IF NOT EXISTS`-guarded — causing an immediate "already exists" failure and aborting the workflow before it reached Vercel project provisioning. Root cause: `sql/schema.sql` is a `pg_dump` snapshot that already bakes in the cumulative effect of migrations `001`-`013` (confirmed via column presence: `jo_records.vip_code`/`respond_time`/`total_minute_between_created_to_completed` from `010`-`013`; `ai_chart_definitions`/`mo_records`/`co_records` from `005`-`009`) — only migration `014_upload_jobs_hotel_identity.sql` (which IS `IF NOT EXISTS`-guarded) adds columns not yet present in the dump. Fixed by having the script apply only `014` after `schema.sql` instead of blindly re-running `001`-`009`. Found while onboarding the new `fcs1-jp` customer: `scripts/provision_fcs1_jp.mjs` (new, one-off) applied `schema.sql` + `014` directly against the freshly-created fcs1-jp Neon database (reset via `DROP SCHEMA public CASCADE` first since it had partial leftover objects from an earlier failed manual migration attempt) — verified all 17 expected tables present plus `upload_jobs`'s 5 hotel-identity columns from migration 014. |
| **v1.1.7** | 2026-07-12 | (1) **cmo-03 line series changed to smooth spline** (`type: 'spline'`) instead of straight `line` for the Average Resolution Duration series, per request — confirmed via SVG path inspection (`highcharts-spline-series` class, cubic Bézier `C` path commands). (2) **New `docs/JO.md`, `docs/MO.md`, `docs/CO.md`, `docs/IM.md` reference docs** — full KPI/Simple-Chart/Long-Chart catalogs (Name, Chart Type, Notes, Formula, Good/Bad analysis) for all 8 module scopes (JO/CJO, MO/CMO, CO/CCO, IM/CIM), plus a "Recommended: Highest Business Value" section naming the top 4 KPIs + 4 charts per module with reasoning. Compiling these surfaced several pre-existing, undocumented content bugs (documented, not fixed): hotel JO's `jo-16`/`jo-17`/`jo-21` display stale titles that don't match their actual underlying data (a leftover from an earlier chart-id reshuffle); CO's `co-08` title/note disagree with its own code-level definition; hotel IM's `im-40` has a title but blank note/formula and isn't referenced by any of the four client-side hotel chart-group arrays, so may be unreachable in the live grid. (3) **New "Performance" section** added as the last section (after Long Charts) on all four corp dashboards (CJO/CMO/CCO/CIM) — the existing per-hotel performance tables (`CorpJoPerformanceTable`, `CorpMoPerformanceTable`, `CorpCoPerformanceTable`, `CorpImPerformanceTable`) were previously rendered as a leading child *inside* the Long Charts grid/section; all four moved to their own dedicated `<section>` with a new `dashboard_ui.section_performance` i18n key ("Performance") added across all 4 languages. No new component was needed — `CorpCoPerformanceTable` already existed for CO, just misplaced (and unlike the MO Long-Charts overlap bug fixed in v1.1.6, it had no `col-span-2` so was not actively causing a layout bug, only a mis-scoped section). Verified live on all four corp dashboards: section order is now `KPI → Simple Charts → Long Charts → Performance`, `tsc --noEmit` clean throughout. |
| **v1.1.6** | 2026-07-12 | Batch of corp/hotel MO chart work since v1.1.5, all local-only until now: (1) **cmo-01** redesigned to 3-level donut-drilldown `🟢 Hotel → Department → Top Defects` (created-by department, not the generic `department` field); (2) **cmo-02** redesigned to 3-level vertical-bar-drilldown `🟢 Hotel → Guest/Non-Guest → Top Defects` — both required new `mo_created_dept_defect_map`/`mo_guest_defect_map` summary fields (finalize route), backfilled via new `scripts/backfill_mo_created_dept_guest_defect_maps.mjs`. (3) **Six new corp MO Long Charts** added: `cmo-13` (4-level `Hotel → Category → Defects → Resolution Duration Distribution`), `cmo-14`/`cmo-15` (3-level `Hotel → {Resolution/Delayed} Duration Distribution → Defects`), `cmo-16` (3-level `Hotel → 24-Hour Distribution → Defects`), `cmo-17` (3-level `Hotel → Floor → Defects`), `cmo-18` (4-level `Hotel → Type → Department → Defects`) — six new summary fields (`mo_cat_defect_dur_map`, `mo_dur_defect_map`, `mo_delay_dur_defect_map`, `mo_hour_defect_map`, `mo_floor_defect_map`, `mo_type_dept_defect_map`), backfilled via new `scripts/backfill_mo_cmo13_18_maps.mjs`; "Delayed Duration" = escalated/overdue-past-deadline duration (`deadline_variance_minutes`), "Resolution Duration" = completed duration; `CORP_MO_CHART_DISPLAY_ORDER`/`MO_LONG_CHART_IDS` extended, config panel `seq('cmo-', 1, 18)`. (4) **Found and fixed a real Long Charts grid-overlap bug**: `CorpMoPerformanceTable` was rendered as a child *inside* the single-column `chart-grid-long` grid with a `md:col-span-2` class; once cmo-13..18 populated that grid, any child requesting `span 2` on an explicitly 1-column CSS grid forces the browser to create a phantom implicit 2nd column, pulling every chart card into a 2-column auto-flow layout that stacked pairs of cards exactly on top of each other (confirmed via `getComputedStyle().gridTemplateColumns` reporting `"0px 897px"` instead of one track). Fixed by moving `CorpMoPerformanceTable` outside the grid into its own sibling wrapper, matching the already-correct JO/IM pattern. (5) **cmo-03** redesigned to dual-axis stacked-column-with-line `🟢 Hotel by Job Status vs Average Resolution Duration` (stacked job-status columns + avg resolution duration line, both with data labels); (6) **cmo-04** redesigned to 3-level donut-drilldown `🟢 Hotel → Escalation Levels → Top Defects` — new `mo_avg_resolution_hours`/`mo_esc_level_defect_map` summary fields, backfilled via new `scripts/backfill_mo_avgres_esclevel.mjs`. (7) **cjo-02** redesigned to 3-level vertical-bar-drilldown `🟢 Hotel → Escalation Rate by Service Category → Escalation Rate by Service Item` (rate %, not count) — new `jo_cat_item_escalations` summary field exposing `accumulateJoKpis()`'s previously hotel-only-scoped `catItemEscalations` map to the corp cross-hotel summary, backfilled via new `scripts/backfill_jo_cat_item_escalations.mjs`. (8) **Six new hotel-level MO Long Charts** (`mo-13..18`) mirroring cmo-13..18 one level shallower (no Hotel level, already hotel-scoped) — reused the same per-hotel summary fields from item (3) with zero new data-layer work; `HOTEL_MO_CHART_DISPLAY_ORDER`/`MO_LONG_CHART_IDS` extended, config panel `seq('mo-', 1, 18)`; i18n added to the actually-used `hmo_chart_titles`/`hmo_chart_notes`/`hmo_chart_formulas` sections (distinct from the config-panel `chart_titles_mo`/`chart_notes_mo`/`chart_bv_mo` sections, both updated). i18n updated across all 4 languages throughout; `tsc --noEmit` clean throughout; all changes verified live on localhost including real multi-level drilldown clicks and a direct DOM measurement confirming the grid-overlap fix (`gridTemplateColumns` back to a single track, 6 non-overlapping sequential card positions). **Production note:** all new summary fields (`mo_created_dept_defect_map`, `mo_guest_defect_map`, `mo_cat_defect_dur_map`, `mo_dur_defect_map`, `mo_delay_dur_defect_map`, `mo_hour_defect_map`, `mo_floor_defect_map`, `mo_type_dept_defect_map`, `mo_avg_resolution_hours`, `mo_esc_level_defect_map`, `jo_cat_item_escalations`) are local-only — production databases need the corresponding backfill scripts run against them, or a fresh CSV re-upload, to show real data instead of blank charts. |
| **v1.1.5** | 2026-07-11 | Batch of hotel/corp JO and CO chart redesigns since v1.1.4, all local-only until now: (1) **cco-04** → 4-level donut-drilldown `🟢 Hotel → Inspector → Room Attendant → Average Cleaning Duration (by Room Type)`. (2) **cco-01** → 3-level donut-drilldown `🟢 Hotel → Top Average Credit by Inspector → Top Average Credit by Attendant`; required extending the shared `CcoAttAgg` type (`CoDashboardView.tsx`) with a `credit` field, now populated in both the floor/attendant and inspector/attendant accumulation loops. (3) **cjo-01** → 3-level donut-drilldown `Hotel > Top Category > Top Service Items`, using `category_map`/`category_item_map`; fixed stale/mismatched ja and zh-TW translations found along the way (previously described an unrelated "racing bar chart" animation). (4) **cjo-02/03/04 Level-1 bars given distinct colors** (violet `#7C3AED` / rose `#BE123C` / cyan-blue `#0E7490`) to visually disambiguate the three hotel-comparison charts. (5) **jo-11 ↔ jo-04 display positions swapped** via a new id-based cross-array swap (works across the eac/operational array split regardless of which prior swap landed each chart in which array). (6) **Long Charts moves**: `cjo-22/23/24/25/26/28` + the corp JO "Hotel Performance" table, and hotel `jo-23/24/25/26`, all moved into the Long Charts section (`JO_LONG_CHART_IDS` populated for the first time); found and fixed a real scope-bleed bug where hotel-only ids leaked into the corp Long Charts view because `joLongCharts` had no `!isCorp` gate on the hotel-scoped arrays. (7) **jo-02 redesigned** to 2-level column-drilldown `🟢 Delayed Duration Distribution → Top Service Items` (7 fixed duration buckets → top service items per bucket) — new `delayDurBktItemMap`/`jo_delay_dur_bkt_item_map` accumulator field in `accumulateJoKpis()` (`finalize/route.ts`) + `HotelSummary`, backfilled locally via new `scripts/backfill_jo_delay_dur_bkt_item_map.mjs` (6 hotels, 317–2,701 delayed records each). This freed up the `chart_titles_jo.jo-02`/`chart_notes_jo.jo-02` i18n keys, which had been repurposed by an older swap-era chart (id `jo-11`, "Top Service Item Category → 24-Hour Job Distribution") still living in the jo-11 grid slot — repointed that chart to the now-free `chart_titles_jo.jo-11`/`chart_notes_jo.jo-11` keys and restored their correct text so the two charts no longer share a title. (8) **jo-04 redesigned** to dual-axis vertical-bar-with-line `🟢 Item Category vs Average Service Duration` — colorful per-category bars (job count, primary axis) + line (average resolution/service duration in minutes, secondary axis), mirroring CO's `cco-02` dual-axis pattern; new `jo_cat_res_avg` summary field (category → average resolution minutes) added alongside the existing `jo_cat_res_p90`, backfilled locally via new `scripts/backfill_jo_cat_res_avg.mjs`. i18n updated across all 4 languages for cco-04/cco-01/cjo-01/jo-02/jo-04/jo-11; `tsc --noEmit` clean throughout; all changes verified live on localhost, including real drilldown clicks for jo-02's new bucket→item drilldown. **Production note:** items (7)/(8)'s backfills (`jo_delay_dur_bkt_item_map`, `jo_cat_res_avg`) are local-only — production databases need the same backfill scripts run against them, or a fresh CSV re-upload, to get correct data instead of blank charts. |
| **v1.1.4** | 2026-07-11 | Multiple changes: (1) **Timezone conversion removed entirely for JO/MO/CO/IM (explicit user instruction, reversing v1.1.3's local↔UTC round-trip)** — `lib/timezone.ts`'s `zonedTimeToUtc()`/`localHour()`/`localDateKey()`/`localWeekday()` now read/write CSV digits verbatim via UTC getters with no shift in either direction; `tz`/`timeZone` parameters are kept on every signature for call-site compatibility but are intentionally unused. Verified: a CSV value of "01 Jan 2026 00:14" now stores as `2026-01-01T00:14:00.000Z` and reads back as hour 0 / date 2026-01-01 — identical digits at all three stages (CSV → DB → chart). (2) **cco-03 redesigned twice** — first to a 3-level Hotel→24-Hour→Duration Distribution drilldown, then per follow-up request to a 4-level `🟢 Hotel → Floor → Attendant Credit → Average Cleaning Duration` drilldown mirroring cco-43's existing pattern (credit-sum metric at levels 1–3, avg-duration-by-room-type leaf) — removed from `CO_24H_CHART_IDS` since it's no longer a time-of-day chart. (3) **im-03 redesigned** to a 3-level `⏰ 24 Hour Distribution > Department > Incident Items` drilldown mirroring im-45 exactly (dynamic x-axis titles via `withDrilldownXAxisTitles`); added to `IM_24H_CHART_IDS`. (4) **cim-04 redesigned** to a 4-level `⏰ Hotel -> Department -> Incident Category -> Incident Items` drilldown; relocated within `buildCorpImOptions` past the function's shared `topMap`/`idPart` helper declarations to avoid a temporal-dead-zone error. (5) **cjo-04 and cjo-07 swapped display positions** via the same array-position-swap pattern already used for cjo-03/cjo-27. (6) **cjo-04 redesigned** to a 4-level `⏰ Hotel → Delayed Duration Distribution → Assigned Department → Assigned To` drilldown — required a genuinely new data pipeline since no pre-aggregated 3D breakdown existed: added `delayBktDeptAssignedMap`/`inc3()` to `accumulateJoKpis()` in `finalize/route.ts`, new `jo_delay_bkt_dept_assigned_map` field in `HotelSummary` (`types/dashboard.ts`), and a new `scripts/backfill_jo_delay_bkt_dept_assigned_map.mjs` for existing data. (7) **Fixed a pre-existing, unrelated JO data-loss bug found while building (6)**: the `jo_records` INSERT in `finalize/route.ts` never populated `assigned_to_department`/`assigned_to_user`/`created_by_department`/`created_by_user`/`completed_by_department`/`reassigned_job`/`escalation_group` — columns that have existed on the table since `002_jo_schema_alignment.sql` — even though `accumulateJoKpis()` already read them from the raw row for chart aggregates; the real values were only ever recoverable from the `normalized_row` JSON fallback. Fixed the INSERT for future uploads, backfilled all 30,853 existing local `jo_records` rows' own columns from `normalized_row`, then re-ran (this was the second run — the first run had produced all-"Unknown" results because it read the then-still-empty dedicated columns instead of `normalized_row`). Verified: LGM hotel's "< 15 min" delayed-duration bucket now shows real departments (Housekeeping 1338, Concierge 399, Paiza Grand 311, Food & Beverage 97) instead of 100% "Unknown". i18n updated across all 4 languages for cco-03/im-03/cjo-04; `tsc --noEmit` clean throughout; all changes verified live on localhost via real drilldown interaction, not just static review. **Production note:** items (6)/(7)'s backfills are local-only — any production database needs the same backfill scripts run against it (or a full CSV re-upload) to get real assigned-department/user data instead of "Unknown". |
| v1.1.3 | 2026-07-10 | Two CO/CCO timezone bugs fixed (both traced from a real report of the CCO-03 24-hour chart showing an inverted "U" shape instead of the expected midday-peaked "N"/bell shape): (1) **CSV ingestion silently skipped the org-timezone conversion for all CO data.** `lib/timezone.ts`'s naive-date regex only matched 3-letter month abbreviations ("Jun"), but CO's actual CSV export uses full month names ("04 June 2026 11:39:28") — so it never matched, and every CO date fell through to JS's ambiguous native `Date` parser (server/browser-ambient-timezone-dependent) instead of being converted from local wall-clock time to true UTC. Compounding this, `lib/validation/csvSchema.ts`'s `validateCoRow` (client-side parse preview, runs before the org timezone is even known) called `buildCoRow(raw, rowNumber)` with no timezone argument — defaulting to `'UTC'` — and staged that already-(wrongly)-converted ISO string as `raw_row`; finalize's real re-parse with the correct org timezone became a no-op because an already-`Z`-suffixed string looks unambiguous and is returned as-is. Fixed by widening the regex to `{3,9}` letters + full month names in `MONTH_ABBR`, and by having `validateCoRow` preserve the untouched raw text for date fields (matching JO/MO/IM's existing pattern) so finalize's org-timezone-aware `buildCoRow` call is the only one that actually converts. Verified end-to-end via the real create-job → chunk → finalize API pipeline: "04 June 2026 11:39:28" (Asia/Macau, UTC+8) now correctly stores as `2026-06-04T03:39:28.000Z` and round-trips back to local hour 11 on display. (2) **Daily/date-trend charts and the date-range filter never applied the org timezone at all.** `CoDashboardView.tsx`'s `toDateKey()`/`matchesRow()` — used by CO-11/CCO-10 "Daily Cleaning Order Trend" and the date-range picker itself — parsed the stored UTC instant and read the calendar date off JS's ambient local `Date` getters (the viewer's own browser/OS timezone) instead of the org's configured timezone, unlike `hourFromSource()`'s already-correct `localHour(date, timeZone)` pattern for the 24-hour charts. Fixed by adding a `timeZone` parameter threaded through `toDateKey`/`matchesRow` from the existing `orgTimezone` (`data.meta.timezone`), using the already-available `localDateKey()` helper from `lib/timezone.ts` for the conversion. Verified: `tsc --noEmit` clean; PAR hotel (7,701/7,433 records) and SCL corp (15,366 records) dashboards reload with identical totals and all 40 chart titles/IDs intact. **Production note flagged to user:** fix (1) only applies to new uploads going forward — any CO data already ingested (local or production) was stored with the old, wrong (server/browser-ambient-timezone-dependent) ISO instants and needs to be **re-uploaded** to get correct 24-hour/daily trends; there is no reliable way to backfill since the original raw CSV text is gone once mis-converted. |
| **v1.1.2** | 2026-07-10 | Two changes: (1) **CO performance fix** — Hotel and Corp CO dashboards were 5-10x slower than JO/MO/IM (PAR hotel: 4.8s, SCL corp: 8.1s) because ~35 "24-hour distribution" chart definitions in `CoDashboardView.tsx` (`buildCharts`/`buildCorpCharts`) each independently rescanned the full row array 24 times (`Array.from({length:24}, hour => rows.filter(...))`), re-parsing/re-timezone-converting the same date string on every scan; the `_g1ByHour`/`_ccog1ByHour` per-dimension drilldown helpers made this an O(24n × distinct-dimension-values) blowup. New `computeHourByRow()`/`bucketRowsByHour()` helpers precompute each row's hour bucket once in a single O(n) pass; every 24-hour chart (hotel `co-04/15-20/25-33/40/42`, corp `cco-18-23/28-36`) and both `_g1ByHour`/`_ccog1ByHour` now read from that shared map. Verified on localhost: PAR hotel CO 4.8s → ~1.8s (~2.7x), SCL corp CO 8.1s → ~4.5s (~1.8x), identical KPI totals and all 40 chart titles/IDs unchanged, no regressions. (2) **Reset by Chain** — new panel in Configuration → System (`app/api/admin/reset-by-chain/route.ts`, `ResetByChainPanel` in `app/configuration/page.tsx`), positioned between the existing global Reset Database and Reset by Hotel panels: password-gated, lists distinct chain codes from dashboard meta (`generated_json->'meta'->>'chain_code'`), lets the user pick a chain + module (ALL/JO/MO/CO/IM) scope, preview the affected upload jobs and per-table row counts, then delete by `upload_job_id` — same safe pattern as Reset by Hotel, scoped one level up so one chain's data can be cleared without touching other chains sharing the same deployment. Verified end-to-end on localhost against real data (SCL chain: JO 6 jobs/88,883 rows, MO 6 jobs/9,204 rows, CO 7 jobs/15,366 rows, IM 6 jobs/6,001 rows) — preview-only, no destructive action taken during verification. `tsc --noEmit` clean for both changes. |
| v1.1.1 | 2026-07-10 | Fix CO hotels with mixed-case codes (e.g. `LGBond`, `LPBaker`) showing 0 records on their dashboard despite the upload succeeding and the data genuinely existing. Root cause: `app/onboarding/page.tsx`'s client-side filename parser never uppercased `chainCode`/`hotelCode`/`countryCode`, so a mixed-case filename segment got stored verbatim on `upload_jobs`/`co_records`/`co_dashboard_json`, while `fetchCoRows()` (and every other lookup) uppercases its search term before querying — a case-sensitive Postgres `=` never matched. This was latent before v1.0.99 (which made `finalize` trust the client-sent identity directly instead of always re-deriving it via its own uppercasing `parseFilename()`) and got exposed by that fix. Now uppercases at the source in the onboarding parser, plus defensively again in `finalize` when reading identity from the job row. Normalized the 4 already-affected local hotels' stored `hotel_code` across `co_records`/`upload_jobs`/`co_dashboard_json`. Verified all 4 (LGBAKER 1,642 · LGBOND 2,345 · LPBAKER 577 · LPBOND 362 records) plus corp aggregation (15,366 = exact sum of all 7 hotels) render correctly. `tsc --noEmit` clean, i18n valid, no console errors. **Production note:** any production database with existing mixed-case hotel codes needs the same data normalization applied. |
| v1.1.0 | 2026-07-10 | Version bump only — no functional change. Marks the accumulated line of fixes since v1.0.90 (IM/JO/MO/CO timezone handling settling on a genuine local↔UTC round-trip per the org's configured Configuration → System timezone, plus the upload hotel-mistagging fix, Compact Database, and reset-preserves-org-settings work in v1.0.99) as a minor-version milestone. |
| v1.0.99 | 2026-07-10 | Three upload/admin fixes: (1) **Upload hotel-mistagging bug** — traced a real production report (VEN CSV upload not appearing in sidebar) to `finalize/route.ts` re-deriving hotel/chain identity via a fragile `uploaded_files.file_name` lookup; when `create-job`'s file-hash dedup reused an existing file row (confirmed: the VEN and LON test fixtures were byte-identical, same SHA-256), `finalize` silently tagged the new upload's records with the *other* upload's stale hotel_code. Fixed by storing `chain_code`/`hotel_code`/`hotel_name`/`country_code`/`data_range` directly on `upload_jobs` at create-job time (new migration `sql/migrations/014_upload_jobs_hotel_identity.sql`, applied locally) — `finalize` now reads identity straight from the job row (`types/index.ts` `UploadJobRow`, `app/api/uploads/create-job/route.ts`, `app/api/uploads/finalize/route.ts`), falling back to filename-parsing only for jobs created before this migration. Verified by reproducing the exact bug (create-job reusing the same file id) and confirming the resulting record correctly lands under the new job's real hotel_code. (2) **Compact Database** — new action alongside Reset Database in Configuration → System (`app/api/admin/reset-database/route.ts` `action: 'compact'`, UI in `app/configuration/page.tsx`'s `ResetPanel`): runs `VACUUM (FULL, ANALYZE)` on the selected module scope's tables, reclaiming disk space left behind by rows deleted outside a full reset — plain `VACUUM ANALYZE` (what Reset already runs post-truncate) only marks space reusable, it doesn't shrink the file. Verified on localhost: "All modules compacted — 17/17 tables, reclaimed 4 MB." (3) **Reset Database no longer discards Configuration → System settings** — the `module=ALL` reset always had to truncate `organizations` (it's in the same table batch), then reseeded it, but the reseed previously hardcoded `timezone: 'UTC'` and env-var name/code defaults, silently wiping whatever the user had configured. Now captures the existing org row(s) — code, name, *and* timezone — before truncating and restores those exact values after, only falling back to `CUSTOMER_CODE`/`CUSTOMER_NAME`/`UTC` if no row existed at all. Verified: set org to a distinctive name/timezone, ran a real full reset, confirmed both survived unchanged. `tsc --noEmit` clean across all three fixes, i18n valid. |
| v1.0.98 | 2026-07-09 | Genuine timezone round-trip restored for JO/MO/CO/IM (hotel + corp): CSV ingestion converts naive local wall-clock strings (in the org's configured Configuration → System timezone, e.g. Asia/Hong_Kong/Macau/Shanghai) to a true UTC instant for storage, and every display path converts that UTC instant back to the org's local timezone for hour-of-day **and** day/week/month bucketing — reverses v1.0.97's "no conversion" model after confirming CSVs store local time but need a real round-trip, not verbatim-digit storage. New shared `lib/timezone.ts`: `zonedTimeToUtc()` (DST-safe via an `Intl.DateTimeFormat` round-trip, not a hardcoded ±8), `localHour()`, `localDateKey()`, `localWeekday()`, `parseCsvDate()` (auto-detects naive "DD Mon YYYY HH:mm" and naive-ISO formats; leaves already-unambiguous `Z`/offset strings alone). Ingestion: `toIso()`, `accumulate()` (IM), `accumulateJoKpis()` (JO), the MO payload builder in `app/api/uploads/finalize/route.ts`, and `buildCoRow()`/`parseCoDateTime()` in `lib/csv/coMapping.ts` all now take/thread the org's timezone; `toWeekKey()` was also quietly depending on the server's own ambient local time (`.setHours()`/`.getDay()`) and is now computed via UTC-safe arithmetic off the local calendar date. Display: `computeJoHourMaps()`/`computeMoHourMaps()`/`computeImHourMaps()` and the corp IM inline block in `lib/dashboard-fetch.ts`, `hour_map`/`toDateOnly()` in `im-scope`/`im-scope-builder` routes (tz now resolved via newly-exported `resolveLiveTimezone()`), and `hourFromSource()` in `CoDashboardView.tsx` all convert back via `localHour()`. Also: `app/api/admin/reset-database/route.ts` now re-seeds a default `organizations` row (from `CUSTOMER_CODE`/`CUSTOMER_NAME` env vars, matching the existing fallback convention in `app/api/ai/charts/generate/route.ts`) immediately after a full (`module=ALL`) reset, since that scope truncates `organizations` too and every CSV upload depends on at least one row existing there. Verified on localhost (local org set to Asia/Hong_Kong to exercise the round-trip): `jo-26` (PAR) matches its raw CSV hour distribution with zero backfill — JO's existing data was already genuine UTC; `im-44`/`cim-25` (PAR) correctly round-trip a manually re-corrected test record (`IC-13412-001`, created 10:24 local) back to hour 10 after storing it as true UTC. **Open item:** could not confirm whether CO's raw CSV source uses the same naive-local format as JO/MO/IM, or already exports true UTC — existing CO test data only exposed the post-processed value, not the original text; needs a fresh CO CSV upload to verify definitively. **Also flagged to the user:** any production JO/MO/CO/IM data ingested before this fix may need re-upload or a backfill to hold genuinely-correct UTC timestamps, same as this session's local IM test data required. |
| v1.0.97 | 2026-07-08 | JO/CJO 24-hour charts reverted back to no timezone conversion (undoes v1.0.96), and CO/CCO 24-hour charts also switched to no timezone conversion for the first time — user confirmed all four modules' CSV sources (JO/MO/CO/IM) store created/completed date-time as local wall-clock time, not UTC, so any conversion was wrong for all of them. `computeJoHourMaps()` in `lib/dashboard-fetch.ts` and `accumulateJoKpis()` in `app/api/uploads/finalize/route.ts` dropped their `tz`/`timezone` parameter and now read the hour via `getUTCHours()` again (the `localHour()`/formatter-cache helpers added in v1.0.96 were removed from both files). `CoDashboardView.tsx`'s `hourFromSource()` — used by all ~35 CO/CCO 24-hour charts across `buildCharts`/`buildCorpCharts` — now returns `date.getUTCHours()` directly instead of calling `localHour()`; the `localHour()`/formatter-cache helpers were removed from that file too (`timeZone` parameters are kept on `hourFromSource`/`buildCharts`/`buildCorpCharts` for call-site compatibility but are unused). MO and IM were already correct since v1.0.95/v1.0.94 and were not touched. Verified every module's 24-hour charts (hotel + corp) are always computed live from raw DB rows at render time — none read from a baked/stored chart definition — so this fix applies retroactively to all existing hotels immediately, with **no CSV re-upload or backfill script needed for any hotel in any module**. Confirmed on localhost: `jo-26` (PAR hotel, SCL chain) matches raw `jo_records` hour-of-day exactly with no rotation; `co-04` (WP hotel, WYNN chain) shape matches raw `co_records` with no rotation. |
| v1.0.96 | 2026-07-08 | JO/CJO 24-hour charts restored to applying the org's saved timezone (e.g. Asia/Hong_Kong/Macau/Shanghai, UTC+8) — reverses v1.0.95 for JO only, after determining JO's `created_datetime`/`acknowledged_datetime`/`completed_datetime` are genuinely UTC (unlike IM/MO, which remain untouched via `getUTCHours()`). Root cause of the original `jo-26` vs `cjo-26` mismatch report: `jo-23..jo-26` were baked once at CSV-upload time into `jo_dashboard_json`, so any hotel not re-uploaded since a hour-map fix kept stale data indefinitely, while `cjo-23..26` were already always live-recomputed — the two would only ever agree by coincidence. Fixed by (1) restoring memoized `localHour(d, tz)` in `lib/dashboard-fetch.ts` and `app/api/uploads/finalize/route.ts`, wiring the already-resolved `timezone`/`orgTimezone` into `computeJoHourMaps()` and `accumulateJoKpis()`; (2) adding `hotelJo2326Charts` in `DashboardClient.tsx` so `jo-23/24/25/26` are always rebuilt client-side from live `data.summary` (never served stale from storage) — the same pattern already used for `jo-01/02/03/06/11/27/28`. Verified on localhost (SCL chain, PAR hotel): `jo-26` position 0 (00:00 local) now holds true-UTC-hour-16 data (confirms +8 shift), peak moved to a plausible 12:00–15:00 daytime window, and matches `cjo-26`'s chain-sum peak at the same local hour. IM and MO unaffected. |
| v1.0.95 | 2026-07-08 | JO and MO 24-hour charts also stop applying timezone conversion, matching v1.0.94's IM fix — their CSV sources store created/acknowledged/completed date-time as local wall-clock time already, so shifting by org timezone was double-converting. `computeJoHourMaps()`/`computeMoHourMaps()` in `lib/dashboard-fetch.ts` (hotel + corp) and `accumulateJoKpis()`'s two hour computations plus MO's `createdHour` in `app/api/uploads/finalize/route.ts` now read the hour via `getUTCHours()`. The `localHour()`/`Intl.DateTimeFormat`-cache helper is now fully dead code in both files (no callers left across IM/JO/MO) and was removed entirely. CO is unaffected — untouched. Verified: `mo-10`'s rendered 24-hour distribution for a test hotel matched the raw stored hour exactly. |
| **v1.0.94** | 2026-07-08 | IM 24-hour charts no longer apply timezone conversion — IM's CSV source already stores created/incident date-time as local wall-clock time (unlike JO/MO), so shifting it by the org timezone was double-converting and producing wrong hours. `computeImHourMaps()` and the corp IM hour block in `lib/dashboard-fetch.ts`, `app/api/dashboard/im-scope[-builder]/route.ts`, and the CSV-upload-time accumulator in `app/api/uploads/finalize/route.ts` now read the hour via `d.getUTCHours()` directly instead of `localHour(d, tz)`; removed the now-dead timezone-resolution queries and formatter helpers from both `im-scope` routes. JO/MO unaffected — their CSVs are UTC and still convert. Configuration → System's timezone dropdown also now shows each city's live UTC offset, e.g. `Asia/Hong_Kong (UTC+8)`, `Asia/Kolkata (UTC+5:30)`, computed via `Intl.DateTimeFormat` so DST-affected zones stay correct. |
| **v1.0.93** | 2026-07-08 | 24-hour distribution charts standardized to full-period behavior (JO/MO's existing method) across CO and IM, plus ⏰ emoji labeling: CO's 18 hotel + 17 corp 24h charts (`co-04/15-20/25-33/40/42`, `cco-03/18-23/28-36/44/46`) now compute from a parallel date-unfiltered row set in `CoDashboardView.tsx` and show the `FULL PERIOD` badge (new to CO); `app/api/dashboard/im-scope[-builder]/route.ts` split `hour_map`/`hour_category_map`/`hour_dept_map`/`hour_category_item_map`/`hour_dept_item_map` onto a department-filtered-only (no date filter) row set so `im-44`/`im-45` match `im-04`'s full-period behavior instead of rescoping; `DashboardClient.tsx`'s `chartOpts()` fixed so `im-04/44/45` and `cim-25/26` correctly show `FULL PERIOD` when filtered (previously hardcoded to never show it); all 61 24-hour chart titles across JO/MO/CO/IM (hotel+corp) prefixed with ⏰ in all 4 i18n files via new idempotent `scripts/add_24h_emoji_prefix.mjs`, plus the two hardcoded corp-IM titles (`cim-25`/`cim-26`) with no i18n key; Configuration → System also gained an editable **Organization Name** field (loads from DB, saves via `POST /api/admin/system-settings`), and `app/api/uploads/create-job/route.ts`'s org-resolution fallback chain had a hardcoded per-database UUID (`DEFAULT_ORG_ID`, actually fcs1-hk's specific org id) removed in favor of the same oldest-org lookup Configuration edits, so every CSV upload reliably lands on the configured org |
| **v1.0.92** | 2026-07-08 | Timezone + CO perf fixes: all 24-hour-distribution maps (JO/MO/IM, hotel + corp) now resolve the org timezone live on every request via `resolveLiveTimezone()` in `lib/dashboard-fetch.ts` (organization_id JOIN → chain-code fallback → hard `Asia/Hong_Kong` default) instead of relying on stale values baked in at CSV upload time — a Configuration → System Settings timezone change now takes effect immediately across all four modules, no re-upload or backfill script needed; fixed a severe perf bug where Corp/Hotel CO dashboards took 30s–4.5min (or failed to load) because `localHour()` constructed a brand-new `Intl.DateTimeFormat` per call across tens of thousands of calls in `buildCharts`/`buildCorpCharts` — now memoized per timezone in `CoDashboardView.tsx`, `lib/dashboard-fetch.ts`, `app/api/dashboard/im-scope[-builder]/route.ts`, and `app/api/uploads/finalize/route.ts` (CO hotel/corp load time: 30s+ → ~3s) |
| **v1.0.90** | 2026-07-08 | IM long-drilldown follow-up release: corp IM `cim-22`..`cim-26` and hotel IM `im-41`..`im-45` now bind drilldown axis labels to the active level, use incident item names sourced from database-backed summary maps instead of blank fallback buckets, and keep 24-hour-distribution charts aligned with the configured organization timezone; CO/IM fetch/meta plumbing updated so dashboard views receive timezone context consistently; i18n refreshed in all four languages |
| **v1.0.89** | 2026-07-07 | JO/MO/IM restructured to the same KPI / Simple Charts / Long Charts section pattern CO already had (see "Section Structure" section above); sub-headers like "Executive Charts", "Drilldown charts", "Chain Comparison", "Performance Gauges", etc. removed — charts flattened into one Simple Charts grid per scope; new `MO_LONG_CHART_IDS`/`JO_LONG_CHART_IDS`/`IM_LONG_CHART_IDS` sets (all empty) + `splitLongCharts` helper in `DashboardClient.tsx`; every hardcoded chart-list cap (`topN`/`.slice(0, N)`) in JO/MO/IM builder code normalized to `N = 24`; fixed a spacing bug where `DashboardClient.tsx`'s own `SectionHead` was missing `mb-3` (present in `CoDashboardView.tsx`'s copy), which made JO/MO/IM section labels sit flush against KPI/chart cards instead of CO's ~12px gap; `AGENTS.md`/`CLAUDE.md` synced and repositioned for a Codex-primary workflow |
| **v1.0.88** | 2026-07-04 | JO chart redesigns (hotel + corp): **cjo-02** → "Hotel Job Volume → Job Status → 24-Hour Distribution" (2-level column drilldown from `status_map` + `jo_status_hour_map`); **cjo-15** → "Hotel Job Volume → Job Status → Completed Duration Distribution" (2-level drilldown; new `jo_status_dur_bkt_map` computed live from `jo_records.actual_duration` in `fetchCorpDashboard`); **cjo-27** ↔ **cjo-03** content swap — cjo-03 = "Hotel Jobs → 24-Hour Distribution → Top 10 Service Items" (3-level drilldown from `jo_hour_item_map`) shown early, cjo-27 = SLA Compliance by Hotel shown late (post-build array swap); hotel **jo-01** → "24-Hour Delayed Job Distribution → Top Service Items" (hour → top-10 delayed items drilldown; new `jo_hour_delayed_item_map` in finalize accumulator + `HotelSummary` + `scripts/backfill_jo_hour_delayed_item_map.mjs` run on local DB, 10 hotels); hotel **jo-02** = category → 24-h chart (EAC slot) and grid hour → top-items chart traded display codes only (`joGridSlotOf` + explicit `injectedJoEac` keys keep both charts in place); fix `/api/ai/charts/list` 500 — `created_at.localeCompare` crashed on pg `Date` objects, now compares via `getTime()`; i18n titles/notes/BV updated all 4 langs |
| **v1.0.87** | 2026-06-27 | Theme picker rebuilt as card layout (avatar badge + name + description + 4-color swatch row, 300px panel, accent border on active); **Color Ink Wash** replaced with **Jade & Ink** (`jade-ink`) — jade-green sidebar (`#0C4A3E`), rice-paper surfaces, jade/gold/deep-blue palette, Chinese cultural character; `AppThemeOption` type + `initials`/`description` fields + `getThemeSwatches()` helper added to `lib/theme.ts` |
| **v1.0.86** | 2026-06-27 | Two new app UI themes added to `lib/theme.ts`: **Chromatic Ink Wash** (`chromatic-ink`) — deep sumi-ink sidebar, rice-paper cream surfaces, saturated pigment palette (teal `#1F5E57`, vermillion `#C84030`, amber `#D08830`); **Color Ink Wash** (`color-ink`) — lighter paper, brighter pigments, warm dark-brown sidebar (teal `#0E7A6A`, coral `#D44C30`); both with full light + dark variants; `AppThemeName`, `APP_THEME_OPTIONS`, `getAppThemeTokens` updated |
| **v1.0.85** | 2026-06-27 | Hotel IM im-04 redesign: **im-04** → "🟣 VIP vs Non-VIP → 24-Hour Distribution" (column-drilldown: VIP and Non-VIP totals → click to 24-hour distribution per group; new `im_vip_hour_map` in `ImAcc` + `HotelSummary` + finalize route; `scripts/backfill_im_vip_hour_map.mjs` run on local DB for 5 hotels); i18n title/note/BV/formula updated all 4 langs |
| **v1.0.84** | 2026-06-26 | 24-hour distribution timezone fix: `backfill_jo_hour_maps.mjs` replaced `getHours()` (system local) with `localHour(d, orgTimezone)` mirroring finalize route; `backfill_jo_cat_hour_map.mjs` replaced hardcoded `UTC` with `AT TIME ZONE org_timezone` from `organizations.timezone`; finalize route was already correct; local DB re-backfilled (all 7 hotels, Asia/Hong_Kong) |
| **v1.0.83** | 2026-06-26 | Hotel JO jo-02 redesign: **jo-02** → "🟢 Top Service Item Category → 24-Hour Job Distribution" (column-drilldown: top 10 categories by total jobs → click to 24-hour distribution; new `jo_cat_hour_map` in finalize accumulator + `HotelSummary`; `scripts/backfill_jo_cat_hour_map.mjs` run on local DB); i18n title/note/BV updated all 4 langs |
| **v1.0.82** | 2026-06-26 | Hotel JO jo-06 redesign: **jo-06** → "🟢 Job Status by 24-Hour Job Distribution" (bar-drilldown: job statuses sorted by count → click to 24-hour distribution for that status; from `jo_status_hour_map`); i18n title/note/BV updated all 4 langs |
| **v1.0.81** | 2026-06-25 | Hotel JO chart redesigns (client-side injected, work on legacy rows): **jo-01** → "🟢 24-Hour Delayed Job Distribution" (column, x=hour 00–23, y=delayed order count, data labels) from existing `jo_hour_delayed_map`; **jo-03** → "🟢 Top Service Items → Completed Job Duration Distribution" (bar-drilldown: top 10 items by completed jobs → per-item completion duration buckets) from new `jo_item_dur_bkt_map` (item→durBucket→completed count) added to `HotelSummary` + finalize accumulator + `scripts/backfill_jo_item_dur_bkt_map.mjs` (run on local; **Neon needs backfill or new upload**); removed the v1.0.70 jo-01↔jo-05 display swap so jo-01 sits first; injected jo-01/jo-03 replace stored EAC charts in place; i18n titles/notes updated all 4 langs |
| **v1.0.80** | 2026-06-20 | JO/MO/CO chart footer notes annotated with benchmarks: appended a `Benchmark — …` line to all 255 notes per language (×4 langs) — numeric Good/Watch/Bad thresholds for measurable charts (SLA %, duration, close/completion rate, delay/escalation counts), Healthy/Warning pattern for distribution/donut/hour-of-day/trend charts; covers hotel + corp (`chart_notes_jo` hjo/jo-/cjo/cjo-, `chart_notes_co` co-/cco-, `chart_notes_mo`+`hmo_chart_notes`+`cmo_chart_notes`); applied via idempotent local `scripts/annotate_chart_benchmarks.mjs` (line-scan preserves formatting); also routes system-settings save through POST as well as PUT (Vercel blocked bare PUT with INVALID_REQUEST_METHOD) |
| **v1.0.79** | 2026-06-20 | Fix Configuration > System timezone save: removed `updated_at` from organizations UPDATE (column absent in Neon production caused empty response body) |
| **v1.0.78** | 2026-06-20 | Corp MO cmo-09/10/11 redesigned to mirror hotel mo-09/10/11 for chain data: cmo-09 "Work Order Duration Distribution (Chain)" (BUCKETS column + per-hotel drilldown), cmo-10 "24-Hour Work Order Distribution (Chain)" (00:00–23:00 column + per-hotel drilldown), cmo-11 "Top 10 Defect > 24 Hours (Chain)" (bar + per-hotel drilldown); aggregates `mo_duration_dist_map`, `mo_hour_map`, `mo_item_24h_hour_map` across `entries`; drilldown IDs prefixed `cmo09:`/`cmo10:`/`cmo11:` to avoid collision; i18n updated all 4 langs (chart_bv_mo, chart_titles_mo, chart_notes_mo, hmo_chart_titles, hmo_chart_notes, cmo_chart_titles, cmo_chart_notes, cmo_chart_formulas) |
| **v1.0.73** | 2026-06-19 | Hotel MO `mo-01`/`mo-02` redesigned as donut drilldowns: `mo-01` "Top 10 Category by Status" (top-10 category donut → drilldown to job-status via new `cat_status_map`); `mo-02` "Work Order Status by Department" (status donut → drilldown to created-by dept via existing `status_created_dept_map`); `cat_status_map` (category→status) added to `HotelSummary` + finalize summary output; `scripts/backfill_mo_cat_status_map.mjs` backfills it from `mo_records` with `mapMoStatusToIncidentStatus` normalization (matches stored `status_map`); i18n titles/notes/formulas/BV updated all 4 langs; corp `cmo-*` untouched |
| **v1.0.72** | 2026-06-19 | Hotel MO charts rebuilt: new `buildHotelMoCharts` emits real `mo-01..mo-12` client-side from the scoped summary (single-hotel mirror of corp `cmo-01..cmo-12`), replacing the legacy `im-46..im-69` charts that leaked from `buildImJson`; fixes regular hotel MO dashboard AND My Hotel (config `mo-01`/`mo-02` now match); corp `cmo-*` untouched and fully independent; world map now loads for hotel `mo-06`; `chartOpts` simplified (charts pre-filtered); removed dead `renameLegacyMoChartIds` + v1.0.71 positional fallback; hotel MO config extended to `mo-01..mo-12`; i18n `mo-11`/`mo-12` added all 4 langs |
| **v1.0.71** | 2026-06-19 | My Hotel MO charts fix: positional fallback in embed mode (mo-NN → Nth stored im-NN chart) when stored MO data has im-NN IDs; page.tsx hotel-data fallback for modules missing data on first hotel; cim-20 dual-axis column+line (Top Incident vs Completion Rate); gauge colors burnt orange + deep teal + 1px border |
| **v1.0.70** | 2026-06-13 | cjo-07 → bar-drilldown "Top Service Items → Daily Trend (Chain)": mirrors jo-11; merges `jo_item_date_map` across all hotels, top 10 items, drilldown = daily counts; jo-01↔jo-05 and jo-02↔jo-11 display-order swaps; i18n all 4 langs |
| **v1.0.69** | 2026-06-13 | cjo-07 → treemap "Top Service Items (Chain)": aggregates `item_map` across all hotels, top 30 items, tile size = total jobs; i18n updated all 4 langs |
| **v1.0.68** | 2026-06-13 | cjo-07 xAxis → `type:'category'`: drilldown X axis now shows service item names instead of inherited hotel codes |
| **v1.0.67** | 2026-06-13 | jo-11 primary xAxis → `type:'category'` (was `categories:[...]`): drilldown now replaces axis labels with date point names so Y axis shows dates correctly |
| **v1.0.66** | 2026-06-13 | jo-11 drilldown type → `bar` (horizontal): dates on Y axis, job count on X axis — "Daily Job Orders" |
| **v1.0.65** | 2026-06-13 | jo-11 in-place ordering + date filter: injected charts replace stored counterpart at original position (`injectedJoById` Map instead of filter+append); jo-11 item totals + drilldown dates respect applied date range when `jo_item_date_map` present (falls back to all-time `item_map` otherwise); `chartOpts` jo-11 special-case suppresses FULL PERIOD badge when map present; `scripts/backfill_jo_item_date_map.mjs` backfills the map into stored `jo_dashboard_json` from `jo_records` (run against local DB for all 7 hotels) |
| **v1.0.64** | 2026-06-13 | jo-11 always injected client-side: removed `if (idm)` guard; drilldown = daily trend when `jo_item_date_map` present, else dept breakdown from inverted `dept_item_map` — works immediately without re-upload |
| **v1.0.63** | 2026-06-13 | jo-11 client-side injection: `jo_item_date_map` added to `HotelSummary` type + stored in finalize summary; `DashboardClient` replaces stored jo-11 with drilldown when `jo_item_date_map` present; `injectedJoIds` dedup prevents duplicate chart rendering |
| **v1.0.62** | 2026-06-13 | jo-11 redesigned: "Top 10 Service Item Volume" → bar-drilldown "Top Service Items → Daily Trend"; primary = top 10 items by count, drilldown = daily job counts (x-axis by date); new `itemDateMap` accumulator in finalize route |
| **v1.0.61** | 2026-06-13 | cjo-07 redesigned: Reassignment Rate by Hotel → bar-drilldown "Top Service Items by Hotel" (primary: total jobs per hotel; drilldown: top 10 service items from `item_map`) |
| **v1.0.60** | 2026-06-12 | MO hotel KPI list trimmed from 12 → 10 to match hotel dashboard (`mo_unique_assets`/`mo_daily_average` removed); order aligned with dashboard (severity_index pos 5, guest_related pos 6) |
| **v1.0.59** | 2026-06-12 | MO corp KPI label fix: `dash-config-defs.ts` corp MO KPI `labelPath`/`notePath` corrected from `hmo_kpi_labels`/`hmo_kpi_notes` → `cmo_kpi_labels`/`cmo_kpi_notes`; config panel Corp KPI Group now shows "Total Work Orders" etc. instead of raw ids |
| **v1.0.58** | 2026-06-12 | IM corp KPI order: `corp_kpi_09` (Total Incident Volume) moved to position 1 → `cim_kpi_01`; `corp_kpi_01` (Corporate Risk Score) moves to position 9 → `cim_kpi_09` |
| **v1.0.57** | 2026-06-12 | Config panel (JO/MO/CO/IM tabs): "KPI Group" split into "Hotel KPI Group" + "Corp KPI Group"; sequential display codes `jo_kpi_01..N` / `cjo_kpi_01..N`; chart codes normalised to underscores `jo_01..N` / `cjo_01..N`; display-only |
| **v1.0.56** | 2026-06-12 | My Dashboard config: corp KPI codes show `cjo_kpi_01..10` / `cmo_kpi_01..10` etc. (scope-aware display via `kpiDisplayCode`); chart codes normalised to underscores `cjo_01..28` (via `chartDisplayCode`); display-only — stored keys unchanged |
| **v1.0.55** | 2026-06-12 | IM KPI alias fix: hotel KPI list in `dash-config-defs.ts` trimmed to 10 rendered ids; aliases now sequential im_kpi_01–10 (hotel) and im_kpi_11–20 (corp); `IM_HOTEL_KPI_IDS` updated to match |
| **v1.0.54** | 2026-06-12 | My Hotel/Corp date filter: "ALL" button renamed to "Reset"; Reset clears all filters (`applied = null`, blank inputs) instead of applying the full date span |
| **v1.0.53** | 2026-06-12 | My Hotel config: multi-hotel selection — checkbox chip buttons replace single `<select>`; `MyDashboardConfig.hotels: string[]` (replaces `hotel: string`); sidebar expands one link per selected hotel; old `hotel: string` configs auto-migrate to `hotels: [hotel]` |
| **v1.0.52** | 2026-06-12 | My Dashboard scope binding: My Hotel config requires a Hotel selection (new `hotel` field in `MyDashboardConfig`, dropdown from nav API hotels per chain, Save/Publish gated); My Corp stays chain-only (`hotel` always ''); sidebar hotel link carries `&hotel=` + shows hotel code; My Hotel default filter = blank date inputs + CO unscoped (chain rows) |
| **v1.0.51** | 2026-06-12 | My Hotel CO/MO fixes: CO renders without `co_dashboard_json` (`DashboardClient` accepts null data, builds CO meta shell from coRows); CO hotel-code fallback (WM → WMET/WMWT prefix match on chain rows); CO `created_date` Date-object coercion in union range + shell; legacy MO `chart_NN` ids renamed to `mo-NN` at render (`renameLegacyMoChartIds`) so config toggles + My Dash overrides match stale stored rows |
| **v1.0.50** | 2026-06-11 | My Hotel: remove hotel filter dropdown; clean up unused `useRouter` / `router` in `MyDashboardClient.tsx` |
| **v1.0.49** | 2026-06-11 | Fix My Dashboard publish reliability: `doSave` persisted localStorage inside a `setCfg` updater (impure updater — React can drop/defer the side effect, losing the publish silently); persist now runs directly in the click handler before setState |
| **v1.0.48** | 2026-06-11 | My Dashboard uniform KPI codes: display + stored config use `jo_kpi_NN`/`mo_kpi_NN`/`co_kpi_NN`/`im_kpi_NN` aliases (numbered by position in `MODULE_DEFS[mod].kpis`); `kpiAlias`/`kpiIdFromAlias` in `lib/my-dashboard-defs.ts`; saved configs auto-migrate on load; aliases resolved to native ids in `groupByModule` |
| **v1.0.47** | 2026-06-11 | My Corp pooled layout: same shared date-range bar + pooled KPI/chart grids as My Hotel; corp embed paths added (`corpImTopCharts`/`corpJoCharts`/`corpMoCharts`/CO corp); per-module corp sections removed from `/my-dashboard` |
| **v1.0.46** | 2026-06-11 | My Hotel pooled layout: one shared date-range bar (quick patterns) drives all modules; all selected KPIs in one grid, all charts in one grid; module toolbars/department filter not rendered; new `MyDashEmbed` fragment mode (`myDashEmbed` prop, early-return fragments) in Standard/MO/CO dashboard components |
| **v1.0.45** | 2026-06-11 | My Dashboard: Configuration → My Dashboard tab composes "My Hotel"/"My Corp" dashboards (max 10 KPIs + 20 charts from JO/MO/CO/IM hotel- or corp-level lists, chain-bound, drag-n-drop order); published entries appear in sidebar above Upload CSV; new `/my-dashboard` page reuses real dashboard components via `myDash` override prop; fetchers extracted to `lib/dashboard-fetch.ts`; new `lib/my-dashboard-defs.ts`; Others config tab removed; config tabs use JO/MO/CO/IM short labels |
| **v1.0.44** | 2026-06-11 | Dashboard Builder moved from sidebar to Configuration → Builder tab; sidebar "Dashboard Builder" link removed; `PlaygroundClient` dynamically imported in `app/configuration/page.tsx` |
| **v1.0.43** | 2026-06-09 | Dashboard Builder: CSV filename format `[Chain]-[Hotel]-[HotelName]-[Module]-[Country]-[DataRange].csv` parsed in API; grouped Chain › Module › Hotel in selector; `sourceLabel()` renders `WYNN · WP · WynnPalace · IM · MO · 2024Q1` as chart subtitle |
| **v1.0.42** | 2026-06-09 | Dashboard Builder: Data Source switched to original upload CSV filenames; new `/api/ai/charts/datasources` route (queries `upload_jobs` + `uploaded_files` + `organizations`); grouped Chain › Module › CSV files; selecting source sets `activeOrgId` |
| **v1.0.41** | 2026-06-09 | Dashboard Builder: Data Source selector — loads hotel+module combos from nav API; selected source auto-sets module, appears as chart subtitle in sample preview and generated charts; `DataSourceItem` type added |
| **v1.0.40** | 2026-06-09 | Dashboard Builder: 3 preview themes — Vintage (earth tones/serif), Modern (sky-blue/sans-serif), Executive (navy/corporate); `ThemeKey`, `ThemeDef`, `BUILDER_THEMES`, `applyBuilderTheme` added; theme toggle buttons in template panel; gauge/heatmap use per-theme colors |
| **v1.0.39** | 2026-06-09 | Dashboard Builder: title → "Dashboard Builder"; subtitle → "Guideline to builder custom dashboard"; field hint buttons per module (JO/MO/CO/IM) + Chart Types; JO/MO/CO field legends added |
| **v1.0.38** | 2026-06-09 | Dashboard Builder: chart type badge on Hotel/Corp templates; instant sample preview on selection (Highcharts placeholder data); Generate sends module+chart_name+chart_type to API |
| **v1.0.37** | 2026-06-09 | Dashboard Builder: reset templates into 3 groups (KPI/Hotel/Corp) per module (JO/MO/CO/IM); module toggle buttons replace flat dropdowns; all chart IDs aligned with configuration panel |
| **v1.0.36** | 2026-06-09 | cjo-13/cjo-14 redesign: bar-drilldown Completed/Timeout Status by Hotel → 24-Hour distribution; new jo_hour_timeout_map accumulator in finalize route |
| v1.0.35 | 2026-06-09 | cjo-12 redesign: bar-drilldown Delayed Status by Hotel → 24-Hour Delayed Job Distribution; new jo_hour_delayed_map accumulator in finalize route |
| v1.0.34 | 2026-06-09 | Fix config tab active indicator — overflow-x:auto was clipping margin-bottom:-3px; replaced with absolute span inside button (bottom:0, z:2, no negative margin) |
| v1.0.33 | 2026-06-09 | Force-deploy all customer Vercel projects (fcs1-hk/mo/cn/my/neon) — GitHub webhook stalled after v1.0.28; CLI redeploy to catch up to v1.0.32 changes |
| v1.0.32 | 2026-06-09 | Sidebar auto-refreshes after any DB reset — custom event fcs1:nav-refresh dispatched on reset success; AppSidebar listens and re-fetches /api/nav/dashboards |
| **v1.0.31** | 2026-06-09 | Remove leftover password hint from ResetPanel placeholder (double-space variant missed by replace_all) |
| **v1.0.30** | 2026-06-09 | Reset by Hotel fix: hotel list → dropdown (WP–Wynn Palace, WM–Wynn Macau) from dashboard meta; API uses hotel_code not org_id; password placeholder hint removed from both panels |
| **v1.0.29** | 2026-06-09 | Config tab bar: py-2.5 → py-3 (+4px height), active indicator 2px → 3px border, marginBottom -2 → -3 |
| **v1.0.28** | 2026-06-09 | Reset by Hotel — new panel: Load Hotels (password-gated), select org + module, preview upload history table + per-table row counts, confirm deletes by upload_job_id + VACUUM ANALYZE |
| **v1.0.27** | 2026-06-09 | Reset Database enhanced — per-module scope (ALL/JO/MO/CO/IM), two-step preview with row-count + disk-size summary, TRUNCATE + VACUUM ANALYZE, password eye-toggle, yymmdd hint |
| **v1.0.26** | 2026-06-09 | Corp JO KPIs fixed (buildCorpJoKpis — weighted avg of hotel JO values); jo-28/cjo-28 redesigned to Overdue Jobs by Item Category → 24-hour drilldown; hotel jo-27/jo-28 client-side injection; duplicate EXPORT PDF + dark-mode buttons removed from MO/IM/JO inline toolbars |
| **v1.0.25** | 2026-06-08 | BV config panel for all modules; `lib/dash-config-defs.ts` added to git; cco_chart_14 → Top Attendant Credit treemap; cco_chart_21 manual click-to-treemap (← Back button); emoji prefixes for JO/MO/IM i18n; chart_bv_jo/mo/im sections in all 4 lang files |
| v1.0.24 | 2026-06-07 | CO tables restored; version bump after merge conflict |
| v1.0.23 | — | CO dashboard release (hotel + corp) |
| v1.0.22 | — | Translated filters; MO locales |
