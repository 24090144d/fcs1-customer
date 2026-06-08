// ---------------------------------------------------------------------------
// Dashboard configuration definitions
// Each module declares its KPI list and chart list with i18n key paths so
// the configuration page can render translated labels, notes, and formulas
// without importing the full dictionary directly.
// ---------------------------------------------------------------------------

export interface ConfigItem {
  id: string;
  labelPath: string;
  notePath: string;
  formulaPath?: string;
}

export interface ModuleDef {
  kpis: ConfigItem[];
  charts: ConfigItem[];
}

export interface ModuleConfig {
  kpis: Record<string, boolean>;
  charts: Record<string, boolean>;
}

export type ModuleConfigKey = 'jo' | 'mo' | 'co' | 'im';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate zero-padded sequential ID strings: seq('hjo', 1, 3) → ['hjo01','hjo02','hjo03'] */
function seq(prefix: string, from: number, to: number, pad = 2): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) =>
    `${prefix}${String(from + i).padStart(pad, '0')}`,
  );
}

/** Map an array of IDs to ConfigItem objects referencing i18n sections */
function items(
  ids: string[],
  labelSection: string,
  noteSection: string,
  formulaSection?: string,
): ConfigItem[] {
  return ids.map((id) => ({
    id,
    labelPath: `${labelSection}.${id}`,
    notePath: `${noteSection}.${id}`,
    ...(formulaSection ? { formulaPath: `${formulaSection}.${id}` } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Module definitions
// ---------------------------------------------------------------------------

export const MODULE_DEFS: Record<ModuleConfigKey, ModuleDef> = {
  // ── Job Order ──────────────────────────────────────────────────────────
  jo: {
    kpis: items(seq('kpi_', 1, 10), 'kpi_labels_jo', 'kpi_notes_jo'),
    charts: [
      // Hotel EAC charts — actual dashboard IDs jo-01..jo-04
      ...items(['jo-01', 'jo-02', 'jo-03', 'jo-04'], 'chart_titles_jo', 'chart_notes_jo', 'chart_bv_jo'),
      // Hotel operational charts — actual dashboard IDs jo-05..jo-22
      ...items(seq('jo-', 5, 22), 'chart_titles_jo', 'chart_notes_jo', 'chart_bv_jo'),
      // Corp-level charts — actual dashboard IDs cjo-01..cjo-22
      ...items(seq('cjo-', 1, 22), 'chart_titles_jo', 'chart_notes_jo', 'chart_bv_jo'),
    ],
  },

  // ── Maintenance Order ───────────────────────────────────────────────────
  mo: {
    kpis: [
      // Hotel MO KPIs — actual dashboard IDs
      ...items(
        [
          'mo_total_orders', 'mo_completion_rate', 'mo_open_rate', 'mo_cancelled_rate',
          'mo_guest_related', 'mo_severity_index', 'mo_peak_category', 'mo_unique_categories',
          'mo_unique_assets', 'mo_daily_average', 'mo_pending_cases', 'mo_category_span',
        ],
        'hmo_kpi_labels',
        'hmo_kpi_notes',
      ),
      // Corp MO KPIs — actual dashboard IDs cmo_kpi_01..cmo_kpi_10
      ...items(seq('cmo_kpi_', 1, 10), 'hmo_kpi_labels', 'hmo_kpi_notes'),
    ],
    charts: [
      // Hotel MO charts — actual dashboard IDs mo-01..mo-10
      ...items(seq('mo-', 1, 10), 'chart_titles_mo', 'chart_notes_mo', 'chart_bv_mo'),
      // Corp MO charts — actual dashboard IDs cmo-01..cmo-12
      ...items(seq('cmo-', 1, 12), 'chart_titles_mo', 'chart_notes_mo', 'chart_bv_mo'),
    ],
  },

  // ── Cleaning Order ──────────────────────────────────────────────────────
  co: {
    kpis: items(
      [
        'co_total_orders', 'co_completed_orders', 'co_completion_rate', 'co_avg_duration',
        'co_median_duration', 'co_on_time_rate', 'co_delayed_orders', 'co_reclean_rate',
        'co_inspection_pass_rate', 'co_productivity_score',
      ],
      'kpi_labels_co',
      'kpi_notes_co',
    ),
    charts: [
      // Hotel-level charts  co-01 … co-39
      ...items(seq('co-', 1, 39), 'chart_titles_co', 'chart_notes_co', 'chart_bv_co'),
      // Corp-level charts  cco-01 … cco-42
      ...items(seq('cco-', 1, 42), 'chart_titles_co', 'chart_notes_co', 'chart_bv_co'),
    ],
  },

  // ── Incident Management ─────────────────────────────────────────────────
  im: {
    kpis: [
      // Hotel KPIs  hkpi_01 … hkpi_20
      ...items(
        seq('hkpi_', 1, 20),
        'hotel_im_kpi_labels',
        'hotel_im_kpi_notes',
        'hotel_im_kpi_formulas',
      ),
      // Corp KPIs  corp_kpi_01 … corp_kpi_10 (prefixed to avoid collision)
      ...seq('kpi_', 1, 10).map((id) => ({
        id: `corp_${id}`,
        labelPath: `corp_kpi_labels.${id}`,
        notePath: `corp_kpi_notes.${id}`,
        formulaPath: `corp_kpi_formulas.${id}`,
      })),
    ],
    charts: [
      // EAC charts — actual dashboard IDs im-40..im-45
      ...items(['im-40', 'im-41', 'im-42', 'im-43', 'im-44', 'im-45'], 'chart_titles_im', 'chart_notes_im', 'chart_bv_im'),
      // Basic hotel IM charts — actual dashboard IDs im-46..im-69
      ...items(seq('im-', 46, 69), 'chart_titles_im', 'chart_notes_im', 'chart_bv_im'),
      // im-scope-builder charts — actual dashboard IDs im-01..im-39
      ...items(seq('im-', 1, 39), 'chart_titles_im', 'chart_notes_im', 'chart_bv_im'),
      // Corp IM charts — actual dashboard IDs cim-01..cim-20
      ...items(seq('cim-', 1, 20), 'chart_titles_im', 'chart_notes_im', 'chart_bv_im'),
    ],
  },
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export function getStorageKey(mod: ModuleConfigKey): string {
  return `fcs1_dash_config_${mod}`;
}

export function defaultModuleConfig(mod: ModuleConfigKey): ModuleConfig {
  const def = MODULE_DEFS[mod];
  return {
    kpis: Object.fromEntries(def.kpis.map((k) => [k.id, true])),
    charts: Object.fromEntries(def.charts.map((c) => [c.id, true])),
  };
}

export function loadModuleConfig(mod: ModuleConfigKey): ModuleConfig {
  const defaults = defaultModuleConfig(mod);
  try {
    const raw = localStorage.getItem(getStorageKey(mod));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ModuleConfig>;
    return {
      kpis: { ...defaults.kpis, ...(parsed.kpis ?? {}) },
      charts: { ...defaults.charts, ...(parsed.charts ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export function persistModuleConfig(mod: ModuleConfigKey, config: ModuleConfig): void {
  try {
    const key = getStorageKey(mod);
    localStorage.setItem(key, JSON.stringify(config));
    // Browsers don't fire 'storage' events for changes made in the same tab.
    // Dispatch a synthetic one so any mounted dashboard panels update immediately.
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  } catch {
    // ignore – private browsing / quota exceeded
  }
}
