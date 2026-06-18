# CLAUDE.md — fcs1-customer

Primary guide for Claude Code sessions on this repository.
Read this file before touching any code. The rules here override default behaviour.

---

## Project Identity

| Key | Value |
|---|---|
| App | FCS1 Customer Dashboard |
| Version | **v1.0.72** (as of 2026-06-19) |
| Stack | Next.js 14 App Router · TypeScript · Highcharts · Neon (Postgres) · Vercel |
| Branch | `main` only — no feature branches unless explicitly requested |
| Local dev | `http://localhost:3010` |

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
5. `git commit && git push origin main`
6. Vercel auto-deploys; Neon needs no action for frontend-only changes

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

---

## Version History (recent)

| Version | Date | Summary |
|---|---|---|
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
