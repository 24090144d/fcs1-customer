# FCS1 Customer — Agent Guide

Shared instruction set for all AI coding agents (Claude Code, Codex, Gemini CLI, etc.).
Read this before writing any code. See `CLAUDE.md` for Claude Code-specific patterns and deeper technical notes.

---

## Current State

| Key | Value |
|---|---|
| Version | **v1.0.25** (released 2026-06-08, commit `bdaf91f`) |
| Branch | `main` |
| Previous version | v1.0.24 (`fd87cde`) |

---

## Start Here

- Read `CLAUDE.md` first for Claude Code sessions.
- Read `docs/co-dev-handoff.md` when resuming CO-specific work.
- Use `main` as the only release branch unless the user explicitly requests a temporary branch or worktree.

---

## Module Scope

| Code | Full Name |
|---|---|
| `IM` | Incident Management |
| `JO` | Job Order |
| `MO` | Maintenance Order |
| `CO` | Cleaning Order / ACSR |

---

## What Changed in v1.0.25

### New file tracked
- **`lib/dash-config-defs.ts`** — was previously untracked (local only). Now committed.
  Defines `MODULE_DEFS` with `ConfigItem` lists for KPIs and charts per module.
  Each `ConfigItem` has `id`, `labelPath`, `notePath`, and optional `formulaPath`.

### Configuration panel (`app/configuration/page.tsx`)
- `formulaLabel="Business Value"` applied to **all** module tabs (previously only CO).
- This switches the last column in the config table from raw SQL to BV badge + prose.

### i18n — all 4 language files updated

**New sections added:**
- `chart_bv_jo` — 40 entries (20 hotel JO + 20 corp JO ranked business value explanations)
- `chart_bv_mo` — 22 entries (10 hotel MO + 12 corp MO)
- `chart_bv_im` — 20 entries (top-20 IM hotel charts)

**Emoji prefixes applied to `chart_titles_XX` sections:**
- 🟣 = hotel-level chart (property scope)
- 🟢 = corp-level chart (chain scope)
- Applied to: `chart_titles_jo`, `chart_titles_mo`, `chart_titles_im`
- `chart_notes_XX` and `chart_formulas_XX` sections remain emoji-free

**Non-English fallback titles/notes added for:**
- JO hotel charts (`jo_eac_01`–`jo_eac_04`, `jo_chart_01`–`jo_chart_18`) in zh-TW, zh-CN, ja
- MO hotel + corp chart titles/notes in zh-TW, zh-CN, ja

**cco_chart_14 title updated in all 4 files:**
- EN: `🟢 Top Attendant Credit`
- JA: `🟢 担当者別完了実績ランキング`
- ZH-CN: `🟢 服务员完成业绩排行`
- ZH-TW: `🟢 服務員完成業績排行`

### `lib/dash-config-defs.ts` — formulaPath wiring
- JO charts: `formulaPath` → `chart_bv_jo`
- MO charts: `formulaPath` → `chart_bv_mo`
- IM charts: `formulaPath` → `chart_bv_im`
- CO charts: unchanged, still pointing to `chart_bv_co`

### CO chart changes (`components/dashboard/CoDashboardView.tsx`)

**cco_chart_14** ("Top Attendant Credit")
- Was: 24-hour completion distribution column chart
- Now: Treemap of top-20 attendants by completed cleaning order count
- Data: `topEntries(groupCount(completedRows, r => r.attendant), 20).map(([name, value]) => ({ name, value }))`
- Labels: `useHTML: true`, format `<b>{point.name}</b><br/>{point.value}`

**cco_chart_21** ("24-Hour Cleaning → Attendant")
- Was: column chart with `drilldown:` to `type: 'bar'` series (then attempted `type: 'treemap'` which crashed)
- Now: column chart using `plotOptions.column.point.events.click` for manual drill
- Click a bar → hides column series + axes, adds treemap of top-15 attendants for that hour via `chart.addSeries()`
- Back button added via `chart.renderer.button('← Back', ...)` with `zIndex: 7`
- No `drilldown:` key on series data — avoids the Highcharts drilldown module crash
- Root cause of crash: Highcharts drilldown module calls `getTitlePosition` which fails when switching from cartesian (column) to treemap type

### `components/dashboard/HcChart.tsx`
- Added `treemap`, `sankey`, `xrange` module init (they were required but not guaranteed to initialise)

---

## Core Rules

- Keep each module independent. Do not let corp-level changes overwrite hotel-level charts, labels, routes, or formulas.
- Preserve the existing architecture and UI patterns. Reuse shared layout pieces, but keep module-specific chart registries, KPI formulas, and notes separate.
- When changing dashboard logic, update both corp and hotel variants only if the module already supports both.
- Use local time for dashboard calculations and labels unless a file explicitly requires a different timezone.
- Keep parsing null-safe. Missing dates, status, duration, room number, floor, or attendant values must not crash the dashboard.
- Prefer fallback calculations and empty states over hard failures.

---

## Module Structure

- `IM`, `JO`, and `MO` remain the legacy dashboard modules.
- `CO` uses the cleaning-order ACSR model and must keep its own schema, upload parsing, KPI formulas, chart ids, and benchmark table logic.
- Corp charts must use corp-specific ids and corp data pipelines. Hotel charts must use hotel-specific ids and hotel data pipelines.
- Do not reuse hotel chart ids inside corp views, or vice versa.

---

## UI / UX Expectations

- Keep sidebar routes, breadcrumb titles, toolbar controls, filters, KPI cards, charts, notes, and export actions aligned with the active module.
- Maintain the existing 4-language i18n structure. If a visible label changes, update all four language files together.
- Dark/light mode must stay synchronized with the document class and the dashboard state.
- Keep Highcharts as the charting system for dashboard analytics.
- Treemap labels always require `useHTML: true` when the format string contains HTML tags.

---

## Highcharts Patterns

### Do NOT use drilldown module for column → treemap
The Highcharts drilldown module crashes (`TypeError: Cannot read properties of undefined (reading 'x')` in `getTitlePosition`) when the drilldown series type is `treemap` and the parent chart is cartesian. Use `plotOptions.column.point.events.click` + `chart.addSeries()` instead (see `CLAUDE.md` for the full pattern).

### Treemap data uses `value`, not `y`
```js
{ name: 'Alice', value: 14 }  // ✅
{ name: 'Alice', y: 14 }      // ❌ (y is for cartesian series)
```

---

## Data / Schema Expectations

- Treat SQL migrations in `sql/migrations/` as the source of truth for schema changes.
- Make migrations idempotent when possible.
- For CO uploads, preserve cleaning-order semantics and business-value fields such as completion rate, duration, on-time rate, re-clean rate, inspection pass rate, and productivity metrics.

---

## Validation

- After code changes, run `npx tsc --noEmit` — this is the authoritative compile check on Windows (local `next build` fails due to a Windows webpack symlink issue unrelated to code correctness).
- Validate all 4 i18n JSON files: `node -e "['en','ja','zh-TW','zh-CN'].forEach(l => { try { JSON.parse(require('fs').readFileSync('i18n/'+l+'_lang.json','utf8')); console.log('OK',l); } catch(e) { console.log('FAIL',l,e.message); } })"`
- For dashboard changes, verify module routing, empty states, KPI formulas, chart rendering, and language switching.
- For schema changes, confirm the migration applies cleanly to the target Postgres (Neon) database.
- Before claiming a release is complete, verify the intended Vercel project is linked to `main` and the target customer database matches the requested customer code.
- Before pushing, ensure `lib/dash-config-defs.ts` is tracked (`git add lib/dash-config-defs.ts` if untracked).
