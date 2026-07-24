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
  label?: string;
  note?: string;
  formula?: string;
  scope?: 'hotel' | 'corp' | 'both';
}

export interface ModuleDef {
  kpis: ConfigItem[];
  charts: ConfigItem[];
  tables: ConfigItem[];
}

export interface ModuleConfig {
  kpis: Record<string, boolean>;
  charts: Record<string, boolean>;
  tables: Record<string, boolean>;
}

export type ModuleConfigKey = 'jo' | 'mo' | 'co' | 'im';
export type DashboardConfigKey = ModuleConfigKey | 'co-ir';

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

const table = (id: string, label: string, note: string, scope: 'hotel' | 'corp'): ConfigItem => ({
  id,
  labelPath: `configuration_tables.${id}.label`,
  notePath: `configuration_tables.${id}.note`,
  formulaPath: `configuration_tables.${id}.value`,
  label,
  note,
  formula: 'Live drilldown table with CSV export at every level.',
  scope,
});

export const MODULE_DEFS: Record<DashboardConfigKey, ModuleDef> = {
  // ── Job Order ──────────────────────────────────────────────────────────
  jo: {
    kpis: items(seq('kpi_', 1, 10), 'kpi_labels_jo', 'kpi_notes_jo'),
    charts: [
      // Hotel EAC charts — actual dashboard IDs jo-01..jo-04
      ...items(['jo-01', 'jo-02', 'jo-03', 'jo-04'], 'chart_titles_jo', 'chart_notes_jo', 'chart_bv_jo'),
      // Hotel operational charts — actual dashboard IDs jo-05..jo-28
      ...items(seq('jo-', 5, 28), 'chart_titles_jo', 'chart_notes_jo', 'chart_bv_jo'),
      // Corp-level charts — actual dashboard IDs cjo-01..cjo-28
      ...items(seq('cjo-', 1, 30), 'chart_titles_jo', 'chart_notes_jo', 'chart_bv_jo'),
    ],
    tables: [
      table('jot-01', 'Hotel JO Drilldown Table', 'Department → Category → Service Item → Detail', 'hotel'),
      table('jot-02', 'Daily Trend by Service Item', 'Department → Service Item Dist → Service Item → Date (Daily) → Detail', 'hotel'),
      table('cjot-01', 'Corp JO Drilldown Table', 'Hotel → Department → Category → Service Item → Detail', 'corp'),
      table('cjot-02', 'Daily Trend by Service Item', 'Hotel → Service Item Dist → Service Item → Date (Daily) → Detail', 'corp'),
    ],
  },

  // ── Maintenance Order ───────────────────────────────────────────────────
  mo: {
    kpis: [
      // Hotel MO KPIs — actual dashboard IDs
      ...items(
        [
          'mo_total_orders', 'mo_completion_rate', 'mo_open_rate', 'mo_cancelled_rate',
          'mo_severity_index', 'mo_guest_related', 'mo_peak_category', 'mo_unique_categories',
          'mo_pending_cases', 'mo_category_span',
        ],
        'hmo_kpi_labels',
        'hmo_kpi_notes',
      ),
      // Corp MO KPIs — actual dashboard IDs cmo_kpi_01..cmo_kpi_10
      ...items(seq('cmo_kpi_', 1, 10), 'cmo_kpi_labels', 'cmo_kpi_notes'),
    ],
    charts: [
      // Hotel MO charts — actual dashboard IDs mo-01..mo-18
      ...items(seq('mo-', 1, 18), 'chart_titles_mo', 'chart_notes_mo', 'chart_bv_mo'),
      // Corp MO charts — actual dashboard IDs cmo-01..cmo-22
      ...items(seq('cmo-', 1, 22), 'chart_titles_mo', 'chart_notes_mo', 'chart_bv_mo'),
    ],
    tables: [
      table('mot-01', 'Hotel MO Drilldown Table', 'Department → Category → Defect → Detail', 'hotel'),
      table('mot-02', 'Daily Trend by Defects', 'Department → Defects Dist → Defects → Date (Daily) → Detail', 'hotel'),
      table('cmot-01', 'Corp MO Drilldown Table', 'Hotel → Department → Category → Defect → Detail', 'corp'),
      table('cmot-02', 'Daily Trend by Defects', 'Hotel → Defects Dist → Defects → Date (Daily) → Detail', 'corp'),
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
      // Hotel-level charts  co-01 … co-42
      ...items(seq('co-', 1, 42), 'chart_titles_co', 'chart_notes_co', 'chart_bv_co'),
      // Corp-level charts  cco-01 … cco-46
      ...items(seq('cco-', 1, 46), 'chart_titles_co', 'chart_notes_co', 'chart_bv_co'),
    ],
    tables: [
      table('cot-01', 'Hotel Stay Status Table', 'Date → Cleaning Type → Stay Status → Attendant → Detail', 'hotel'),
      table('cot-02', 'Hotel Inspector Table', 'Date → Cleaning Type → Inspector → Attendant → Detail', 'hotel'),
      table('cot-03', 'Hotel Room Type Table', 'Date → Cleaning Type → Room Type → Attendant → Detail', 'hotel'),
      table('cot-04', 'Daily Trend by Attendant', 'Cleaning Type → Attendant Dist → Attendant → Date (Daily) → Detail', 'hotel'),
      table('ccot-01', 'Corp Stay Status Table', 'Date → Hotel → Cleaning Type → Stay Status → Attendant → Detail', 'corp'),
      table('ccot-02', 'Corp Inspector Table', 'Date → Hotel → Cleaning Type → Inspector → Attendant → Detail', 'corp'),
      table('ccot-03', 'Corp Room Type Table', 'Date → Hotel → Cleaning Type → Room Type → Attendant → Detail', 'corp'),
      table('ccot-04', 'Daily Trend by Attendant', 'Hotel → Attendant Dist → Attendant → Date (Daily) → Detail', 'corp'),
    ],
  },

  // ── Cleaning Inspection Report ─────────────────────────────────────────
  'co-ir': {
    kpis: [
      ['Total Inspections', 'COUNT(*)'],
      ['Rooms Inspected', 'COUNT(DISTINCT location)'],
      ['Pass Rate', 'Pass inspections / total inspections × 100'],
      ['Failed Inspections', "COUNT(*) WHERE inspection_result = 'Fail'"],
      ['Average Duration', 'AVG(complete_time - start_time; fallback turn_over_minutes)'],
      ['Median Duration', 'P50(inspection_duration_minutes)'],
      ['P90 Duration', 'P90(inspection_duration_minutes)'],
      ['Average Inspection Score', 'AVG(inspection_score) WHERE score IS NOT NULL'],
      ['Score Capture Rate', 'Scored inspections / total inspections × 100'],
      ['Inspections per Inspector', 'Total inspections / COUNT(DISTINCT inspector)'],
    ].map(([label, formula], index) => ({
      id: `coir-kpi-${String(index + 1).padStart(2, '0')}`,
      labelPath: `co_ir.kpi_${String(index + 1).padStart(2, '0')}`,
      notePath: `co_ir.config_kpi_note_${String(index + 1).padStart(2, '0')}`,
      label,
      note: 'Current CO-IR inspection KPI used by both Hotel and Corp dashboards.',
      formula,
      scope: 'both' as const,
    })),
    charts: [
      'Room Status → Inspector', 'Inspection Status → Inspector', 'Room Status → Cleaned By',
      'Inspection Status → Cleaned By', 'Score Dist → Inspector', 'Pass Rate Dist → Inspector',
      '24 Hour Dist → Inspector', 'Duration Dist → Inspector', 'Location Dist → Inspector',
      'Cleaned By → Inspector', 'Room Status → Inspector', 'Inspection Status → Inspector',
    ].map((label, index) => ({
      id: `coir-${String(index + 1).padStart(2, '0')}`,
      labelPath: `co_ir.config_chart_${String(index + 1).padStart(2, '0')}`,
      notePath: `co_ir.config_chart_note_${String(index + 1).padStart(2, '0')}`,
      formulaPath: `co_ir.config_chart_value_${String(index + 1).padStart(2, '0')}`,
      label,
      note: index < 10 ? 'Date-first multi-level performance drilldown.' : 'Full-width long-chart drilldown.',
      formula: 'Final level compares Total Credit, Average Duration, and Pass Rate.',
      scope: 'both' as const,
    })),
    tables: [
      table('coirt-01', 'Inspector Table for Hotel', 'Date → Room Status → Inspector → Detail', 'hotel'),
      table('coirt-02', 'Daily Trend by Inspector', 'Inspection Status → Inspector Dist → Inspector → Date (Daily) → Detail', 'hotel'),
      table('ccoirt-01', 'Inspector Table for Corp', 'Date → Hotel → Room Status → Inspector → Detail', 'corp'),
      table('ccoirt-02', 'Daily Trend by Inspector', 'Hotel → Inspector Dist → Inspector → Date (Daily) → Detail', 'corp'),
    ],
  },

  // ── Incident Management ─────────────────────────────────────────────────
  im: {
    kpis: [
      // Hotel KPIs — only the 10 KPIs actually rendered on the hotel IM dashboard
      // (hkpi_01/04/05/11/13/16–20 are legacy or removed; omitting them keeps
      //  the alias numbering sequential: hkpi_02→im_kpi_01 … hkpi_15→im_kpi_10)
      ...items(
        ['hkpi_02', 'hkpi_03', 'hkpi_06', 'hkpi_07', 'hkpi_08',
          'hkpi_09', 'hkpi_10', 'hkpi_12', 'hkpi_14', 'hkpi_15'],
        'hotel_im_kpi_labels',
        'hotel_im_kpi_notes',
        'hotel_im_kpi_formulas',
      ),
      // Corp KPIs — order determines cim_kpi_01..10 display codes.
      // kpi_09 (Total Incident Volume) placed first per display preference.
      ...['kpi_09', 'kpi_02', 'kpi_03', 'kpi_04', 'kpi_05', 'kpi_06', 'kpi_07', 'kpi_08', 'kpi_01', 'kpi_10'].map((id) => ({
        id: `corp_${id}`,
        labelPath: `corp_kpi_labels.${id}`,
        notePath: `corp_kpi_notes.${id}`,
        formulaPath: `corp_kpi_formulas.${id}`,
      })),
    ],
    charts: [
      // Current Hotel IM charts — actual dashboard IDs im-01..im-28
      ...items(seq('im-', 1, 28), 'chart_titles_im', 'chart_notes_im', 'chart_bv_im'),
      // Corp IM charts — actual dashboard IDs cim-01..cim-28.
      ...items(seq('cim-', 1, 28), 'chart_titles_im', 'chart_notes_im', 'chart_bv_im'),
    ],
    tables: [
      table('imt-01', 'Hotel IM Drilldown Table', 'Department → Category → Incident → Detail', 'hotel'),
      table('imt-02', 'Daily Trend by Incident', 'Department → Incident Dist → Incident → Date (Daily) → Detail', 'hotel'),
      table('cimt-01', 'Corp IM Drilldown Table', 'Hotel → Department → Category → Incident → Detail', 'corp'),
      table('cimt-02', 'Daily Trend by Incident', 'Hotel → Incident Dist → Incident → Date (Daily) → Detail', 'corp'),
      {
        ...table('cimt-03', 'Hotel Performance Benchmark', 'Executive hotel-level IM performance and risk ranking table', 'corp'),
        formula: 'Risk Rank = critical % × 1.2 + VIP % × 0.7 + pending % × 0.8 + SLA breach % + repeat % × 0.6 + severity factor + volume factor',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export function getStorageKey(mod: DashboardConfigKey): string {
  return `fcs1_dash_config_${mod}`;
}

export function defaultModuleConfig(mod: DashboardConfigKey): ModuleConfig {
  const def = MODULE_DEFS[mod];
  return {
    kpis: Object.fromEntries(def.kpis.map((k) => [k.id, true])),
    charts: Object.fromEntries(def.charts.map((c) => [c.id, true])),
    tables: Object.fromEntries(def.tables.map((tableItem) => [tableItem.id, true])),
  };
}

export function loadModuleConfig(mod: DashboardConfigKey): ModuleConfig {
  const defaults = defaultModuleConfig(mod);
  try {
    const raw = localStorage.getItem(getStorageKey(mod));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ModuleConfig>;
    return {
      kpis: { ...defaults.kpis, ...(parsed.kpis ?? {}) },
      charts: { ...defaults.charts, ...(parsed.charts ?? {}) },
      tables: { ...defaults.tables, ...(parsed.tables ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export function persistModuleConfig(mod: DashboardConfigKey, config: ModuleConfig): void {
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
