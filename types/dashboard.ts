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
  category_item_map?: Record<string, Record<string, number>>;
  dept_item_map: Record<string, Record<string, number>>;
  dept_category_map: Record<string, Record<string, number>>;
  im_hour_category_map?: Record<string, Record<string, number>>; // hour -> category -> count
  im_hour_dept_map?: Record<string, Record<string, number>>; // hour -> department -> count
  im_hour_category_item_map?: Record<string, Record<string, Record<string, number>>>; // hour -> category -> item -> count
  im_hour_dept_item_map?: Record<string, Record<string, Record<string, number>>>; // hour -> department -> item -> count
  week_map:      Record<string, number>;
  week_source_map: Record<string, Record<string, number>>;
  dept_source_map: Record<string, Record<string, number>>;
  status_dept_map?: Record<string, Record<string, number>>;
  status_created_dept_map?: Record<string, Record<string, number>>;
  cat_status_map?: Record<string, Record<string, number>>; // category → status → count (mo-01 drilldown)
  mo_item_date_map?: Record<string, Record<string, number>>; // defect/item → date → count (mo-04 drilldown)
  mo_item_duration_map?: Record<string, number>;             // defect/item → avg resolution hours (mo-05)
  mo_duration_dist_map?: Record<string, number>;             // bucket ("< 1h","1-2h",...) → count (mo-09)
  mo_hour_map?: Record<string, number>;                      // hour "0"-"23" → count (mo-10)
  mo_cat_duration_map?: Record<string, number>;              // category → avg resolution hours (mo-06)
  mo_item_24h_hour_map?: Record<string, Record<string, number>>; // defect → hour "0"-"23" → count (24h+ only, mo-11)
  mo_created_dept_defect_map?: Record<string, Record<string, number>>; // created-by department → defect → count (cmo-01/mo-01)
  mo_guest_defect_map?: Record<string, Record<string, number>>; // 'Guest Related'|'Non Guest Related' → defect → count (cmo-02/mo-02)
  mo_cat_defect_dur_map?: Record<string, Record<string, Record<string, number>>>; // category → defect → resolution duration bucket → count (cmo-13)
  mo_dur_defect_map?: Record<string, Record<string, number>>; // resolution duration bucket → defect → count (cmo-14)
  mo_delay_dur_defect_map?: Record<string, Record<string, number>>; // delayed (escalated/overdue) duration bucket → defect → count (cmo-15)
  mo_hour_defect_map?: Record<string, Record<string, number>>; // hour "0"-"23" → defect → count, all jobs (cmo-16)
  mo_floor_defect_map?: Record<string, Record<string, number>>; // floor → defect → count (cmo-17)
  mo_type_dept_defect_map?: Record<string, Record<string, Record<string, number>>>; // type (MO/PM) → created-by department → defect → count (cmo-18)
  mo_avg_resolution_hours?: number; // hotel-level average resolution (completed) duration, in hours (cmo-03)
  mo_esc_level_defect_map?: Record<string, Record<string, number>>; // escalation level ("Level N") → defect → count (cmo-04)
  // cmo-14..22: dimension ('category'|'department'|'guest'|'ontime'|'type'|'durbkt'|
  // 'hour'|'esclevel'|'status') → dimension value → defect → { count, avgDurationHours,
  // delayRate }. avgDurationHours uses the "Duration = 0 when not yet Completed" rule
  // (an uncompleted job contributes 0 hours rather than being excluded), so count reflects
  // every job in that dimension value, not just completed ones.
  mo_dim_defect_stats_map?: Record<string, Record<string, Record<string, { count: number; avgDurationHours: number; delayRate: number }>>>;
  // cmo-13: completed-by person → defect → { count, avgDurationHours, delayRate } (same stats shape/rule as above)
  mo_completedby_defect_stats_map?: Record<string, Record<string, { count: number; avgDurationHours: number; delayRate: number }>>;
  booking_map:   Record<string, number>;
  source_map:    Record<string, number>;
  severity_map:  Record<string, number>;
  assigned_dept_map?: Record<string, number>;
  created_by_dept_map?: Record<string, number>;
  completed_by_dept_map?: Record<string, number>;
  location_map?: Record<string, number>;
  // JO-specific: duration distributions and SLA-by-category for cross-hotel corp drilldown
  jo_completion_dur_map?: Record<string, number>;
  jo_response_dur_map?: Record<string, number>;
  jo_escalated_dur_map?: Record<string, number>;
  jo_delay_bkt_dept_assigned_map?: Record<string, Record<string, Record<string, number>>>; // duration bucket → assigned dept → assigned to (user) → count
  jo_delay_dur_bkt_item_map?: Record<string, Record<string, number>>; // duration bucket → service item → count
  jo_sla_cat_map?: Record<string, number>;   // category → SLA-compliant completed count
  jo_sla_cat_total?: Record<string, number>; // category → total completed count
  jo_cat_res_p90?: Record<string, number>;   // category → P90 resolution minutes
  jo_cat_res_avg?: Record<string, number>;   // category → average resolution minutes (jo-04)
  jo_cat_item_escalations?: Record<string, Record<string, number>>; // category → item → escalated count (cjo-02)
  // cjo-01: department (Unacknowledged Orders falls back to assigned department) →
  // service item → { count, avgResponseMins (created→acknowledged), avgCompletionMins
  // (created→completed), delayRate (delay_duration > 0 share, %) }. Computed live
  // from raw jo_records, not baked at upload time.
  jo_dept_item_stats_map?: Record<string, Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }>>;
  // cjo-21: same shape as jo_dept_item_stats_map, keyed by service_item_category
  // instead of department. Computed live from raw jo_records, not baked at upload time.
  jo_cat_item_stats_map?: Record<string, Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }>>;
  // cjo-22..29: generic dimension → dimension-value → item accumulator, one slice
  // per dimension key (status/vip/ontime/escgroup/hour/compbkt/delayeddept). Same
  // { count, avgResponseMins, avgCompletionMins, delayRate } shape as above.
  jo_dim_item_stats_map?: Record<string, Record<string, Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }>>>;
  // cjo-30: item's own aggregate stats (no dimension), used to bucket items by
  // their own delay rate.
  jo_item_stats_map?: Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }>;
  jo_vip_hour_map?: Record<string, number>;  // hour → VIP job count
  jo_vip_hour_item_map?: Record<string, Record<string, number>>; // hour → item → VIP count
  jo_hour_item_map?: Record<string, Record<string, number>>;     // hour → item → all-job count
  // 24-hour drilldown data for cjo-23..cjo-26
  jo_hour_comp_map?:           Record<string, number>;                        // hour → completed count
  jo_hour_comp_bkt_map?:       Record<string, Record<string, number>>;        // hour → dur-bucket → count
  jo_hour_resp_bkt_map?:       Record<string, Record<string, number>>;        // hour → resp-bucket → count
  jo_hour_esc_map?:            Record<string, number>;                        // hour → escalated count
  jo_hour_esc_bkt_map?:        Record<string, Record<string, number>>;        // hour → overdue-bucket → count
  jo_hour_sla_total_map?:      Record<string, number>;                        // hour → SLA eligible count
  jo_hour_sla_comp_map?:       Record<string, number>;                        // hour → SLA compliant count
  jo_hour_sla_cat_total_map?:  Record<string, Record<string, number>>;        // hour → cat → eligible count
  jo_hour_sla_cat_comp_map?:   Record<string, Record<string, number>>;        // hour → cat → compliant count
  // jo-02: all jobs → item category → hour → count
  jo_cat_hour_map?:      Record<string, Record<string, number>>;
  // jo-27/cjo-27: job status → hour → count
  jo_status_hour_map?:   Record<string, Record<string, number>>;
  // cjo-15: job status → duration bucket → completed count (live from jo_records)
  jo_status_dur_bkt_map?: Record<string, Record<string, number>>;
  // jo-28/cjo-28 (legacy): escalation group → hour → count (field empty in current data)
  jo_escgroup_hour_map?: Record<string, Record<string, number>>;
  // jo-28/cjo-28: overdue jobs (delay > 0) → item category → hour → count
  jo_overdue_cat_hour_map?: Record<string, Record<string, number>>;
  // cjo-12: delayed jobs (delay > 0) → hour → count (per hotel, for 24-h drilldown)
  jo_hour_delayed_map?:     Record<string, number>;
  // jo-01: delayed jobs (delay > 0) → hour → service item → count
  jo_hour_delayed_item_map?: Record<string, Record<string, number>>;
  // cjo-14: timeout jobs → hour → count (per hotel, for 24-h drilldown)
  jo_hour_timeout_map?:     Record<string, number>;
  // jo-11: service item → date (YYYY-MM-DD) → count
  jo_item_date_map?:        Record<string, Record<string, number>>;
  // jo-03: service item → completion duration bucket → completed count
  jo_item_dur_bkt_map?:     Record<string, Record<string, number>>;
  // im-03: incident item → date (YYYY-MM-DD) → count
  im_item_date_map?:        Record<string, Record<string, number>>;
  // incident item → avg resolution days
  im_item_duration_map?:    Record<string, number>;
  // cim-20: incident item → completed count (for completion rate line)
  im_item_completed_map?:   Record<string, number>;
  // im-04: all incidents → hour "0"-"23" → count (24-hour total, for Non-VIP derivation)
  im_hour_map?:             Record<string, number>;
  // im-04: VIP incidents → hour "0"-"23" → count (24-hour VIP distribution)
  im_vip_hour_map?:         Record<string, number>;
  // cim-18: incident category → incident item → resolution duration bucket → count
  im_cat_item_dur_bkt_map?: Record<string, Record<string, Record<string, number>>>;
  // cim-15: incident category → incident item → { count, repeat (room+category+item
  // combos occurring 2+ times, same definition as the hotel-level repeat_count KPI),
  // avgDurationHours }. Computed live from raw im_records, not baked at upload time.
  im_cat_item_stats_map?:   Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number }>>;
  // cim-16..28: generic dimension → dimension-value → incident item → { count, repeat,
  // avgDurationHours }, one slice per dimension key (dept, vip, source, booking,
  // severity, hour, durbkt, profile, status, repeatbkt, month, day). Same repeat/
  // duration definitions as im_cat_item_stats_map, just grouped by a different
  // first-level dimension instead of incident category. Computed live from raw
  // im_records, not baked at upload time.
  im_dim_item_stats_map?:   Record<string, Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number }>>>;
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
  timezone?:     string;
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
    timezone?:     string;
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
