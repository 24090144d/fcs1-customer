// Dashboard JSON types — shared between finalize route and dashboard UI

export interface KpiDef {
  id:        string;
  label:     string;
  value:     number | null;
  unit:      string;
  fmt:       'integer' | 'pct1' | 'decimal2';
  available: boolean;
  note:      string;
  formula:   string;
  benchmark?: KpiBenchmark;
}

export interface KpiBenchmark {
  direction: 'higher' | 'lower' | 'neutral';
  good?: number;
  watch?: number;
  goodLabel: string;
  watchLabel: string;
  badLabel: string;
  neutralLabel?: string;
}

// One calendar day of aggregated data — used for client-side date-range filtering
export interface DailyBucket {
  date:         string;   // YYYY-MM-DD
  total:        number;
  completed:    number;
  cancelled:    number;
  pending:      number;
  high_crit:    number;
  severity_sum: number;
  vip:          number;   // count of VIP incidents on this day
  by_severity:  Record<string, number>;
  by_category:  Record<string, number>;
  by_status:    Record<string, number>;
}

// A single Highcharts-compatible chart definition stored in the JSON
export interface ChartDef {
  id:          string;
  title:       string;
  options:     Record<string, unknown>;
  note:        string;
  formula:     string;
  filterable:  boolean;
  height?:     number;    // override default 280px container height
}

export type DashboardSchema = 'im-v1' | 'jo-v1' | 'mo-v1' | 'co-v1';
export type MaintenanceType = 'MO' | 'PM';
export type MaintenanceScoped<T> = Partial<Record<MaintenanceType, T>>;
export type StandardDashboardSchema = 'im-v1' | 'jo-v1';

// Compact per-hotel summary used for cross-hotel comparison charts
export interface HotelSummary {
  total:         number;
  completed:     number;
  cancelled:     number;
  pending:       number;
  vip_total:     number;
  vip_completed: number;
  vip_cancelled: number;
  severity_sum:  number;
  repeat_count:  number;
  status_map:    Record<string, number>;
  dept_map:      Record<string, number>;
  category_map:  Record<string, number>;
  item_map:      Record<string, number>;
  dept_item_map: Record<string, Record<string, number>>;
  dept_category_map: Record<string, Record<string, number>>;
  week_map:      Record<string, number>;
  week_source_map: Record<string, Record<string, number>>;
  dept_source_map: Record<string, Record<string, number>>;
  status_dept_map?: Record<string, Record<string, number>>;
  status_created_dept_map?: Record<string, Record<string, number>>;
  booking_map:   Record<string, number>;
  source_map:    Record<string, number>;
  severity_map:  Record<string, number>;
  assigned_dept_map?: Record<string, number>;
  created_by_dept_map?: Record<string, number>;
  completed_by_dept_map?: Record<string, number>;
  location_map?: Record<string, number>;
}

// One hotel entry used by DashboardClient for chain comparison charts
export interface ChainEntry {
  hotel_code:   string;
  hotel_name:   string;
  country_code: string;
  kpis?:        KpiDef[];
  summary:      HotelSummary;
  raw_daily?:   DailyBucket[];
  kpis_by_type?: MaintenanceScoped<KpiDef[]>;
  raw_daily_by_type?: MaintenanceScoped<DailyBucket[]>;
  summary_by_type?: MaintenanceScoped<HotelSummary>;
}

// Full IM dashboard JSON stored in im_dashboard_json.generated_json
interface DashboardMeta<TSchema extends DashboardSchema> {
  upload_job_id: string;
  source_name:   string;
  chain_code:    string;
  hotel_code:    string;
  hotel_name:    string;
  country_code:  string;
  total_records: number;
  date_range:    { min: string | null; max: string | null };
  generated_at:  string;
  schema:        TSchema;
}

export interface ImDashboardJson {
  meta: {
    upload_job_id: string;
    source_name:   string;
    chain_code:    string;
    hotel_code:    string;
    hotel_name:    string;
    country_code:  string;
    total_records: number;
    date_range:    { min: string | null; max: string | null };
    generated_at:  string;
    schema:        StandardDashboardSchema;
  };
  kpis:       KpiDef[];
  eac:        ChartDef[];   // 6 Executive Analysis Charts
  charts:     ChartDef[];   // 24 GM Core Charts
  raw_daily:  DailyBucket[];
  summary:    HotelSummary; // compact summary for cross-hotel comparison
}

export interface MoDashboardJson {
  meta: DashboardMeta<'mo-v1'>;
  kpis:       KpiDef[];
  eac:        ChartDef[];
  charts:     ChartDef[];
  raw_daily:  DailyBucket[];
  summary:    HotelSummary;
  kpis_by_type?: MaintenanceScoped<KpiDef[]>;
  charts_by_type?: MaintenanceScoped<ChartDef[]>;
  raw_daily_by_type?: MaintenanceScoped<DailyBucket[]>;
  summary_by_type?: MaintenanceScoped<HotelSummary>;
}

export interface CoDashboardJson extends Omit<MoDashboardJson, 'meta'> {
  meta: DashboardMeta<'co-v1'>;
}

export type DashboardJson = ImDashboardJson | MoDashboardJson | CoDashboardJson;
