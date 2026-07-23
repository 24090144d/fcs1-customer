// ---------------------------------------------------------------------------
// "My Dashboard" definitions — user-composed cross-module dashboards.
//
// Two dashboards can be composed per browser profile:
//   - My Hotel  (hotel-level KPIs/charts only)
//   - My Corp   (corp-level KPIs/charts only)
// Items are picked from the existing JO/MO/CO-ACSR/CO-IR/IM configuration lists
// (lib/dash-config-defs.ts) and stored as ordered "mod:id" keys.
// ---------------------------------------------------------------------------

import { MODULE_DEFS, type DashboardConfigKey, type ConfigItem } from './dash-config-defs';

export type MyDashModuleKey = DashboardConfigKey;

export type MyDashScope = 'hotel' | 'corp';

export interface MyDashboardConfig {
  chain: string;        // chain code the dashboard is bound to, e.g. "WYNN"
  hotels: string[];     // hotel codes — one or more for hotel scope; always [] for corp
  published: boolean;   // true → appears in the sidebar "My Dashboard" section
  kpis: string[];       // ordered item keys "mod:id", max MAX_MYDASH_KPIS
  charts: string[];     // ordered item keys "mod:id", max MAX_MYDASH_CHARTS
}

export const MAX_MYDASH_KPIS = 10;
export const MAX_MYDASH_CHARTS = 20;

export const MYDASH_MODULES: MyDashModuleKey[] = ['jo', 'mo', 'co', 'co-ir', 'im'];

export const MYDASH_MODULE_LABELS: Record<MyDashModuleKey, string> = {
  jo: 'JO',
  mo: 'MO',
  co: 'CO-ACSR',
  'co-ir': 'CO-IR',
  im: 'IM',
};

// ---------------------------------------------------------------------------
// Item keys
// ---------------------------------------------------------------------------

export function itemKey(mod: MyDashModuleKey, id: string): string {
  return `${mod}:${id}`;
}

export function parseItemKey(key: string): { mod: MyDashModuleKey; id: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const mod = key.slice(0, idx) as MyDashModuleKey;
  if (!MYDASH_MODULES.includes(mod)) return null;
  return { mod, id: key.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// KPI code aliases
//
// Native KPI ids are inconsistent across modules (kpi_01, mo_total_orders,
// co_total_orders, hkpi_02, corp_kpi_01 …). My Dashboard displays and stores
// a uniform code per KPI — jo_kpi_01, mo_kpi_01, co_kpi_01, im_kpi_01 —
// numbered by position in MODULE_DEFS[mod].kpis. Aliases are resolved back
// to the native ids at render time (groupByModule).
// ---------------------------------------------------------------------------

const KPI_ALIAS_MAPS = (() => {
  const toAlias = Object.fromEntries(MYDASH_MODULES.map((mod) => [mod, {}])) as Record<MyDashModuleKey, Record<string, string>>;
  const fromAlias = Object.fromEntries(MYDASH_MODULES.map((mod) => [mod, {}])) as Record<MyDashModuleKey, Record<string, string>>;
  for (const mod of MYDASH_MODULES) {
    MODULE_DEFS[mod].kpis.forEach((k, i) => {
      const prefix = mod === 'co-ir' ? 'coir' : mod;
      const alias = `${prefix}_kpi_${String(i + 1).padStart(2, '0')}`;
      toAlias[mod][k.id] = alias;
      fromAlias[mod][alias] = k.id;
    });
  }
  return { toAlias, fromAlias };
})();

/** Uniform My Dashboard code for a native KPI id, e.g. ('mo','mo_total_orders') → 'mo_kpi_01'. */
export function kpiAlias(mod: MyDashModuleKey, nativeId: string): string {
  return KPI_ALIAS_MAPS.toAlias[mod][nativeId] ?? nativeId;
}

/** Native KPI id for a uniform code, e.g. ('mo','mo_kpi_01') → 'mo_total_orders'. */
export function kpiIdFromAlias(mod: MyDashModuleKey, alias: string): string {
  const normalizedAlias = mod === 'co-ir' ? alias.replace(/^co-ir_kpi_/, 'coir_kpi_') : alias;
  return KPI_ALIAS_MAPS.fromAlias[mod][normalizedAlias] ?? alias;
}

function isKpiAlias(mod: MyDashModuleKey, id: string): boolean {
  return id in KPI_ALIAS_MAPS.fromAlias[mod];
}

// Corp-scoped KPI display codes: c{mod}_kpi_01..NN — re-numbered from 01
// counting only the KPIs that are visible in corp scope (level === 'corp' | 'both').
const CORP_KPI_DISPLAY = (() => {
  const maps = Object.fromEntries(MYDASH_MODULES.map((mod) => [mod, {}])) as Record<MyDashModuleKey, Record<string, string>>;
  for (const mod of MYDASH_MODULES) {
    let n = 0;
    MODULE_DEFS[mod].kpis.forEach((k) => {
      const lv = kpiLevel(mod, k.id);
      if (lv === 'corp' || lv === 'both') {
        n++;
        const prefix = mod === 'co-ir' ? 'ccoir' : `c${mod}`;
        maps[mod][k.id] = `${prefix}_kpi_${String(n).padStart(2, '0')}`;
      }
    });
  }
  return maps;
})();

/**
 * Scope-aware display code for a KPI.
 * Hotel scope → `{mod}_kpi_01` (regular alias).
 * Corp scope  → `c{mod}_kpi_01` (re-numbered from 01 across corp-visible KPIs).
 */
export function kpiDisplayCode(mod: MyDashModuleKey, nativeId: string, scope: MyDashScope): string {
  if (scope === 'corp') return CORP_KPI_DISPLAY[mod][nativeId] ?? kpiAlias(mod, nativeId);
  return kpiAlias(mod, nativeId);
}

/** Display code for a chart — normalises hyphens to underscores: `cjo-01` → `cjo_01`. */
export function chartDisplayCode(rawId: string, mod?: MyDashModuleKey, scope?: MyDashScope): string {
  if (mod === 'co-ir' && scope === 'corp') return rawId.replace(/^coir-/, 'ccoir_');
  return rawId.replace(/-/g, '_');
}

// ---------------------------------------------------------------------------
// Hotel / corp level classification
// ---------------------------------------------------------------------------

const CORP_CHART_PREFIXES = ['cjo-', 'cmo-', 'cco-', 'cim-'];

/** Corp-level chart ids start with the c-prefixed module code. */
export function isCorpLevelChart(id: string): boolean {
  return CORP_CHART_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * KPI level by module convention:
 *  - im: hkpi_* hotel, corp_* corp
 *  - mo: cmo_kpi_* corp, mo_* hotel
 *  - jo/co: same KPI set renders on both hotel and corp dashboards
 */
export function kpiLevel(mod: MyDashModuleKey, id: string): 'hotel' | 'corp' | 'both' {
  const explicit = MODULE_DEFS[mod].kpis.find((item) => item.id === id)?.scope;
  if (explicit) return explicit;
  if (mod === 'im') return id.startsWith('corp_') ? 'corp' : 'hotel';
  if (mod === 'mo') return id.startsWith('cmo_kpi_') ? 'corp' : 'hotel';
  return 'both';
}

export interface MyDashModuleItems {
  mod: MyDashModuleKey;
  kpis: ConfigItem[];
  charts: ConfigItem[];
}

// IM hotel dashboards render exactly 10 hotel KPIs (hkpi_02/03/06/07/08/09/10/12/14/15)
// and im-01..im-35 only; the remaining config ids are legacy/removed entries that
// never appear on the live dashboard, so they are not pickable here.
const IM_HOTEL_KPI_IDS = new Set([
  'hkpi_02', 'hkpi_03', 'hkpi_06', 'hkpi_07', 'hkpi_08', 'hkpi_09', 'hkpi_10',
  'hkpi_12', 'hkpi_14', 'hkpi_15',
]);

function isRenderableImHotelChart(id: string): boolean {
  const m = id.match(/^im-(\d+)$/);
  return m !== null && Number(m[1]) >= 1 && Number(m[1]) <= 35;
}

/** Pickable items per module for one scope (hotel → hotel-level only, etc.). */
export function getMyDashItems(scope: MyDashScope): MyDashModuleItems[] {
  return MYDASH_MODULES.map((mod) => {
    const def = MODULE_DEFS[mod];
    let kpis = def.kpis.filter((k) => {
      const lvl = kpiLevel(mod, k.id);
      return lvl === 'both' || lvl === scope;
    });
    let charts = def.charts.filter((c) => {
      if (c.scope) return c.scope === 'both' || c.scope === scope;
      return (scope === 'corp') === isCorpLevelChart(c.id);
    });
    if (mod === 'im') {
      if (scope === 'hotel') {
        kpis = kpis.filter((k) => IM_HOTEL_KPI_IDS.has(k.id));
        charts = charts.filter((c) => isRenderableImHotelChart(c.id));
      }
    }
    return { mod, kpis, charts };
  });
}

// ---------------------------------------------------------------------------
// Persistence (localStorage, mirrors lib/dash-config-defs.ts behaviour)
// ---------------------------------------------------------------------------

export function getMyDashStorageKey(scope: MyDashScope): string {
  return `fcs1_my_dashboard_${scope}`;
}

export function defaultMyDashConfig(): MyDashboardConfig {
  return { chain: '', hotels: [], published: false, kpis: [], charts: [] };
}

/** Migrate a stored KPI item key to the uniform alias form ("mod:mod_kpi_NN"). */
function normalizeKpiKey(key: string): string {
  const parsed = parseItemKey(key);
  if (!parsed) return key;
  if (parsed.mod === 'co-ir' && parsed.id.startsWith('co-ir_kpi_')) {
    return itemKey(parsed.mod, parsed.id.replace(/^co-ir_kpi_/, 'coir_kpi_'));
  }
  if (isKpiAlias(parsed.mod, parsed.id)) return key;
  return itemKey(parsed.mod, kpiAlias(parsed.mod, parsed.id));
}

export function loadMyDashConfig(scope: MyDashScope): MyDashboardConfig {
  const defaults = defaultMyDashConfig();
  try {
    const raw = localStorage.getItem(getMyDashStorageKey(scope));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MyDashboardConfig>;
    // Migrate legacy single-hotel string → array
    const migratedHotels: string[] = (() => {
      if (scope !== 'hotel') return [];
      if (Array.isArray((parsed as Record<string, unknown>).hotels)) {
        return ((parsed as Record<string, unknown>).hotels as unknown[])
          .filter((h): h is string => typeof h === 'string' && h.trim() !== '');
      }
      const legacy = (parsed as Record<string, unknown>).hotel;
      return typeof legacy === 'string' && legacy.trim() ? [legacy.trim()] : [];
    })();
    return {
      chain: typeof parsed.chain === 'string' ? parsed.chain : '',
      hotels: migratedHotels,
      published: parsed.published === true,
      kpis: Array.isArray(parsed.kpis)
        ? parsed.kpis.filter((k): k is string => typeof k === 'string').map(normalizeKpiKey).slice(0, MAX_MYDASH_KPIS)
        : [],
      charts: Array.isArray(parsed.charts) ? parsed.charts.filter((c): c is string => typeof c === 'string').slice(0, MAX_MYDASH_CHARTS) : [],
    };
  } catch {
    return defaults;
  }
}

export function persistMyDashConfig(scope: MyDashScope, config: MyDashboardConfig): void {
  try {
    const key = getMyDashStorageKey(scope);
    localStorage.setItem(key, JSON.stringify(config));
    // Same-tab listeners (sidebar) don't receive native storage events.
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
    window.dispatchEvent(new CustomEvent('fcs1:mydash-refresh'));
  } catch {
    // ignore — private browsing / quota exceeded
  }
}

// ---------------------------------------------------------------------------
// Render-side helpers
// ---------------------------------------------------------------------------

/** Per-module override lists consumed by dashboard components. */
export interface MyDashOverride {
  kpis: string[];   // plain ids, in user order
  charts: string[]; // plain ids, in user order
}

/**
 * Embedded fragment mode for the My Dashboard composite page. When set, a
 * dashboard component renders ONLY its selected KPI cards or chart cards as a
 * bare fragment (no toolbar, headers, department/hotel filters, or footers),
 * so the parent page can pool all modules into shared KPI / chart grids.
 * `range` drives the module's internal date filtering from the shared bar.
 */
export interface MyDashEmbed {
  part: 'kpis' | 'charts';
  range?: { from: string; to: string } | null;
}

/**
 * Visibility filter used at dashboard render points. Without an override the
 * normal Configuration-page toggles apply; with one, only the listed ids
 * render, in the user's drag order.
 */
export function applyMyDashFilter<T extends { id: string }>(
  defs: T[],
  override: string[] | null | undefined,
  fallback: (id: string) => boolean,
): T[] {
  if (!override) return defs.filter((d) => fallback(d.id));
  return defs
    .filter((d) => override.includes(d.id))
    .sort((a, b) => override.indexOf(a.id) - override.indexOf(b.id));
}

/**
 * Group ordered "mod:id" keys into per-module override lists.
 * KPI keys store uniform aliases (mod_kpi_NN) — resolve them to native ids.
 * IM corp KPI ids are stored as corp_kpi_NN in config defs but render with
 * ids kpi_NN on the corp dashboard — strip the corp_ prefix here.
 */
export function groupByModule(config: MyDashboardConfig): Partial<Record<MyDashModuleKey, MyDashOverride>> {
  const out: Partial<Record<MyDashModuleKey, MyDashOverride>> = {};
  const ensure = (mod: MyDashModuleKey): MyDashOverride => {
    if (!out[mod]) out[mod] = { kpis: [], charts: [] };
    return out[mod]!;
  };
  for (const key of config.kpis) {
    const parsed = parseItemKey(key);
    if (!parsed) continue;
    const native = kpiIdFromAlias(parsed.mod, parsed.id);
    const id = parsed.mod === 'im' && native.startsWith('corp_') ? native.slice('corp_'.length) : native;
    ensure(parsed.mod).kpis.push(id);
  }
  for (const key of config.charts) {
    const parsed = parseItemKey(key);
    if (!parsed) continue;
    ensure(parsed.mod).charts.push(parsed.id);
  }
  return out;
}
