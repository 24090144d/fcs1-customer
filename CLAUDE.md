# CLAUDE.md — fcs1-customer

Primary guide for Claude Code sessions on this repository.
Read this file before touching any code. The rules here override default behaviour.

---

## Project Identity

| Key | Value |
|---|---|
| App | FCS1 Customer Dashboard |
| Version | **v1.0.31** (as of 2026-06-09) |
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
