'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Sun, Moon, Printer, CalendarDays, X } from 'lucide-react';
import Highcharts from 'highcharts';
import { KpiCard }  from '@/components/dashboard/KpiCard';
import type { DashboardJson, ImDashboardJson, MoDashboardJson, CoDashboardJson, MaintenanceType, DailyBucket, KpiDef, KpiBenchmark, ChartDef, ChainEntry, HotelSummary } from '@/types/dashboard';
import type { CoRow } from '@/types/csv';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { joBenchmarkFor, moBenchmarkFor } from '@/lib/kpi-benchmarks';
import { CoDashboardView } from '@/components/dashboard/CoDashboardView';
import { loadModuleConfig, defaultModuleConfig, type ModuleConfig } from '@/lib/dash-config-defs';
import { applyMyDashFilter, type MyDashOverride, type MyDashEmbed } from '@/lib/my-dashboard-defs';

const HcChart = dynamic(() => import('@/components/dashboard/HcChart').then(m => m.HcChart), { ssr: false });

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAIN_CHARTS = new Set(['im-57', 'im-58', 'im-59', 'im-60', 'im-61', 'im-62', 'im-63', 'im-65']);
const GAUGE_CHARTS = new Set(['im-67', 'im-68', 'im-69', 'im-09', 'im-10', 'im-35']);
const CORP_IM_TOP_IDS = new Set(['cim-01', 'cim-02', 'cim-03', 'cim-04', 'cim-05', 'cim-06', 'cim-07', 'cim-08', 'cim-09', 'cim-10', 'cim-11', 'cim-12', 'cim-13', 'cim-14', 'cim-15', 'cim-16', 'cim-17', 'cim-18', 'cim-19', 'cim-20']);
const CORP_IM_LONG_IDS = new Set(['cim-22', 'cim-23', 'cim-24', 'cim-25', 'cim-26']);
const JO_EAC_ORDER = ['jo-01', 'jo-02', 'jo-03', 'jo-04'];
const JO_CHART_ORDER = ['jo-05', 'jo-06', 'jo-07', 'jo-08', 'jo-09', 'jo-10', 'jo-11', 'jo-12', 'jo-13', 'jo-14', 'jo-15', 'jo-16', 'jo-17', 'jo-18', 'jo-19', 'jo-20', 'jo-21', 'jo-22', 'jo-23', 'jo-24', 'jo-25', 'jo-26', 'jo-27', 'jo-28'];
const HOTEL_MO_CHART_DISPLAY_ORDER = ['mo-01', 'mo-02', 'mo-03', 'mo-04', 'mo-05', 'mo-06', 'mo-07', 'mo-08', 'mo-09', 'mo-10', 'mo-11', 'mo-12'];
const CORP_MO_CHART_DISPLAY_ORDER = ['cmo-01', 'cmo-02', 'cmo-12', 'cmo-04', 'cmo-05', 'cmo-06', 'cmo-07', 'cmo-08', 'cmo-09', 'cmo-10', 'cmo-11', 'cmo-03'];

// Multi-level drilldown charts rendered full-width (1 per row) in the "Long Charts" section.
// Membership is opt-in per chart id, moved in only when explicitly requested.
const MO_LONG_CHART_IDS = new Set<string>([]);
const JO_LONG_CHART_IDS = new Set<string>([]);
const IM_LONG_CHART_IDS = new Set<string>(['im-41', 'im-42', 'im-43', 'im-44', 'im-45']);

function splitLongCharts<T extends { id: string }>(charts: T[], longIds: Set<string>): { simple: T[]; long: T[] } {
  const simple: T[] = [];
  const long: T[] = [];
  for (const c of charts) {
    (longIds.has(c.id) ? long : simple).push(c);
  }
  return { simple, long };
}
const CORP_IM_TOP_MAP: Array<{ code: string; id: string; title: string; note: string; formula: string }> = [
  { code: 'cim-01', id: 'cim-01', title: 'Hotel Incident -> Top 10 Incident Item', note: 'Shows each hotel total then top 10 incident items for drilldown prioritization. Benchmark: Good when top 3 items <= 45% of hotel incidents; Bad when top 3 items > 60% (concentration risk).', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = TOP 10 COUNT(incident_case) GROUP BY incident_item_name per hotel' },
  { code: 'cim-02', id: 'cim-02', title: 'Total Incident vs Status by Hotel', note: 'Compares hotel volume and status mix to detect closure imbalance. Benchmark: Good when Completed >= 95% and Pending <= 5%; Bad when Pending > 10%.', formula: 'COUNT(incident_case) GROUP BY hotel_code, incident_status' },
  { code: 'cim-03', id: 'cim-03', title: 'VIP Closure Rate vs VIP Incident by Hotel', note: 'Dual-axis chart for premium guest risk and recovery effectiveness. Benchmark: Good VIP Closure >= 95%; Bad < 90%.', formula: 'VIP Incidents = COUNT(vip_code valid) GROUP BY hotel; VIP Closure % = VIP Completed / VIP Incidents * 100' },
  { code: 'cim-04', id: 'cim-04', title: 'Hotel Incident -> Top 10 Incident Category', note: 'Drilldown from hotel totals to top 10 categories for root-cause governance. Benchmark: Good when top category <= 20%; Bad when top category > 35%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = TOP 10 COUNT(incident_case) GROUP BY incident_category per hotel' },
  { code: 'cim-05', id: 'cim-05', title: 'Chain — Repeat Incident Rate by Hotel', note: 'Shows recurrence pressure by hotel to flag unresolved systemic issues. Benchmark: Good <= 15%; Watch 15–25%; Bad > 25%.', formula: 'Repeat Rate % = repeat_count / total_cases * 100 per hotel' },
  { code: 'cim-06', id: 'cim-06', title: 'Worldmap Incident by Hotel', note: 'Country-level map with hotel-level labels for cross-region executive visibility. Benchmark: Good when no single country exceeds 50% of chain incidents; Bad when one country > 70%.', formula: 'Country Value = SUM(total_cases) GROUP BY country_code; Label = CONCAT(hotel_code, incident_count) list per country' },
  { code: 'cim-07', id: 'cim-07', title: 'Hotel -> Department', note: 'Hotel-to-department drilldown for operational ownership alignment. Benchmark: Good when no department exceeds 25% of hotel incidents; Bad > 40%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = COUNT(incident_case) GROUP BY department per hotel' },
  { code: 'cim-08', id: 'cim-08', title: 'Hotel -> Source of Complaint', note: 'Hotel-to-source drilldown for channel quality control. Benchmark: Good when Unknown Source <= 5%; Bad > 15%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = COUNT(incident_case) GROUP BY source_of_complaint per hotel' },
  { code: 'cim-09', id: 'cim-09', title: 'VIP vs Non-VIP by Hotel', note: 'Stacked comparison of VIP and non-VIP load by hotel. Benchmark: Good VIP Share <= 6%; Watch 6–10%; Bad > 10%.', formula: 'VIP = COUNT(vip_code valid); Non-VIP = total_cases - VIP; GROUP BY hotel_code' },
  { code: 'cim-10', id: 'cim-10', title: 'Hotel -> Booking Source', note: 'Drilldown from hotel totals to booking source composition for commercial insights. Benchmark: Good when Unknown booking <= 5%; Bad > 15%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = COUNT(incident_case) GROUP BY booking_source per hotel' },
  { code: 'cim-11', id: 'cim-11', title: 'Multi-Hotel Benchmark Scorecard', note: 'Executive matrix comparing risk, critical, VIP, SLA, and trend in one panel. Benchmark: Good risk score <= 60; Watch 60–100; Bad > 100.', formula: 'Risk Score = (Critical*5) + (High*3) + (VIP*4) + (SLA Breach*3) + (Open*2) + volume_adjust' },
  { code: 'cim-12', id: 'cim-12', title: 'Hotel Risk Ranking', note: 'Ranks hotels by weighted risk for intervention priority. Benchmark: Good when high-risk hotel count reduces period-over-period; Bad when top hotel risk grows >10% WoW.', formula: 'Hotel Risk = Severity Score + (VIP*4) + (Open*2) + (SLA*3)' },
  { code: 'cim-13', id: 'cim-13', title: 'Severity vs Volume Quadrant', note: 'Bubble quadrant for strategic risk classification (high volume + high severity = immediate focus). Benchmark: Good when no hotel in top-right high-risk quadrant; Bad when multiple hotels cluster there.', formula: 'X=COUNT(cases), Y=AVG(severity score), Bubble=VIP cases, Color=country/region' },
  { code: 'cim-14', id: 'cim-14', title: 'Regional Risk Heatmap', note: 'Region matrix compares critical, VIP, SLA breach and trend intensity. Benchmark: Good when all risk cells trend down or stay green; Bad when >=2 metrics red in same region.', formula: 'Regional KPI = AVG(metric by hotel in region); Regional Risk = aggregate of weighted KPI intensities' },
  { code: 'cim-15', id: 'cim-15', title: 'Department Risk Heatmap', note: 'Shows department risk intensity by hotel to target governance actions. Benchmark: Good when top department risk <= 20% of hotel total; Bad > 35%.', formula: 'Department Risk Proxy = COUNT(cases) by hotel_code + department (or weighted severity where available)' },
  { code: 'cim-16', id: 'cim-16', title: 'Root Cause Pareto Chart', note: 'Ranks root causes and cumulative contribution for improvement prioritization. Benchmark: Good when top 5 causes <= 45%; Bad when top 5 > 60%.', formula: 'Bars = COUNT(incident_category/item); Cumulative % = running_total / total_cases * 100' },
  { code: 'cim-17', id: 'cim-17', title: '🟣 Top Incident → Daily Trend (Chain)', note: 'Ranks the most reported incident items across all chain hotels. Click a bar to see its daily count trend.', formula: 'COUNT by incident_item_name (chain); drilldown: COUNT by created_date' },
  { code: 'cim-18', id: 'cim-18', title: 'Hotel x Department Matrix', note: 'Cross-hotel department matrix for fast benchmarking and imbalance detection. Benchmark: Good when cross-hotel variance is balanced; Bad when one department dominates across multiple hotels.', formula: 'Matrix Cell = COUNT(incident_case) GROUP BY hotel_code, department' },
  { code: 'cim-19', id: 'cim-19', title: 'Chain Weekly Incident Trend', note: 'Weekly chain-level incident trend with 4-week moving average for momentum and trajectory monitoring. Benchmark: Good when moving average is flat or declining; Bad when rising >10% WoW.', formula: 'Weekly Incidents = SUM(total) GROUP BY ISO_WEEK; Moving Avg = 4-week rolling average' },
  { code: 'cim-20', id: 'cim-20', title: '🟣 Top Incident vs Completion Rate (Chain)', note: 'Top 10 incident items by volume (bars, left axis) with completion rate % per item (line, right axis). Shows both workload and resolution effectiveness.', formula: 'Bars: COUNT by incident_item_name (chain); Line: completed / total × 100% per item' },
];

const CORP_IM_LONG_MAP: Array<{ code: string; id: string; title: string; note: string; formula: string }> = [
  { code: 'cim-22', id: 'cim-22', title: 'Hotel -> Incident Category -> Incident Items', note: 'Three-level hotel drilldown from total incident volume to category and item detail for deep root-cause review.', formula: 'Level 1 = COUNT(incident_case) BY hotel_code; Level 2 = COUNT(incident_case) BY category per hotel; Level 3 = COUNT(incident_case) BY item per category' },
  { code: 'cim-23', id: 'cim-23', title: 'Hotel -> Department -> Incident Category -> Incident Items', note: 'Four-level hotel drilldown from incident volume to department, category, and item detail for ownership tracing.', formula: 'Level 1 = COUNT(incident_case) BY hotel_code; Level 2 = COUNT(incident_case) BY department per hotel; Level 3 = COUNT(incident_case) BY category per department; Level 4 = COUNT(incident_case) BY item per category' },
  { code: 'cim-24', id: 'cim-24', title: 'Hotel -> Incident Category -> Top Average Completed Duration (Hour) by Incident Item', note: 'Three-level hotel drilldown focused on item-level completed duration in hours to expose slow items inside each category.', formula: 'Level 1 = COUNT(incident_case) BY hotel_code; Level 2 = COUNT(incident_case) BY category per hotel; Level 3 = AVG(completed_duration_hours) BY incident_item_name per category' },
  { code: 'cim-25', id: 'cim-25', title: 'Hotel -> 24 Hour Distribution -> Incident Category -> Incident Items', note: 'Four-level hotel drilldown combining time-of-day demand with category and item detail for operational hotspots.', formula: 'Level 1 = COUNT(incident_case) BY hotel_code; Level 2 = COUNT(incident_case) BY hour per hotel; Level 3 = COUNT(incident_case) BY category per hour; Level 4 = COUNT(incident_case) BY item per category' },
  { code: 'cim-26', id: 'cim-26', title: 'Hotel -> 24 Hour Distribution -> Department -> Incident Items', note: 'Four-level hotel drilldown combining time-of-day demand with department and item detail for staffing review.', formula: 'Level 1 = COUNT(incident_case) BY hotel_code; Level 2 = COUNT(incident_case) BY hour per hotel; Level 3 = COUNT(incident_case) BY department per hour; Level 4 = COUNT(incident_case) BY item per department' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergeRecords(maps: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function r1(n: number) { return Math.round(n * 10) / 10; }
function r2(n: number) { return Math.round(n * 100) / 100; }
function topN(map: Record<string, number>, n: number): [string, number][] {
  return Object.entries(map).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, n);
}

function decorateBenchmarkLabels(kpis: KpiDef[]): KpiDef[] {
  return kpis;
}

function getChainKpiValue(entry: ChainEntry, id: string): number | null {
  const raw = entry.kpis?.find((k) => k.id === id)?.value;
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function joCodeById(id: string, isCorp: boolean): string {
  const prefix = isCorp ? 'cjo' : 'hjo';
  const eacIdx = JO_EAC_ORDER.indexOf(id);
  if (eacIdx >= 0) return `${prefix}${String(eacIdx + 1).padStart(2, '0')}`;
  const chartIdx = JO_CHART_ORDER.indexOf(id);
  if (chartIdx >= 0) return `${prefix}${String(JO_EAC_ORDER.length + chartIdx + 1).padStart(2, '0')}`;
  return id;
}

function hotelImKpiEmoji(id: string, value: number | null, available: boolean): string {
  if (!available || value === null) return '';
  const v = Number(value);
  if (!Number.isFinite(v)) return '';

  // Lower is better
  if (id === 'hkpi_07') return v <= 1 ? 'GOOD' : (v <= 2 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Critical Incident Rate
  if (id === 'hkpi_10') return v <= 6 ? 'GOOD' : (v <= 10 ? 'NEEDS IMPROVEMENT' : 'BAD'); // VIP Guest Incident Rate
  if (id === 'hkpi_12') return v <= 30 ? 'GOOD' : (v <= 45 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Department Incident Distribution
  if (id === 'hkpi_14') return v <= 15 ? 'GOOD' : (v <= 25 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Repeat Incident Rate
  if (id === 'hkpi_15') return v <= 35 ? 'GOOD' : (v <= 50 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Complaint Source Analysis
  if (id === 'hkpi_16') return v <= 5 ? 'GOOD' : (v <= 10 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Open Backlog Rate
  if (id === 'hkpi_19') return v <= 30 ? 'GOOD' : (v <= 60 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Avg First Response (min)

  // Higher is better
  if (id === 'hkpi_03') return v >= 95 ? 'GOOD' : (v >= 90 ? 'NEEDS IMPROVEMENT' : 'BAD'); // SLA Compliance
  if (id === 'hkpi_06') return v >= 95 ? 'GOOD' : (v >= 90 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Closure Rate
  if (id === 'hkpi_09') return v >= 95 ? 'GOOD' : (v >= 90 ? 'NEEDS IMPROVEMENT' : 'BAD'); // VIP Closure Rate

  // Mid/other metrics with broad practical defaults
  if (id === 'hkpi_08') return v <= 1.8 ? 'GOOD' : (v <= 2.4 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Severity Index
  if (id === 'hkpi_20') return v <= 10 ? 'GOOD' : (v <= 25 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Cancelled cases absolute (fallback)

  // Context KPIs (volume, pending, peak hour) are neutral
  return 'INFO';
}

function corpImKpiEmoji(id: string, value: number | null, available: boolean): string {
  if (!available || value === null) return '';
  const v = Number(value);
  if (!Number.isFinite(v)) return '';

  // Higher is better
  if (id === 'kpi_01') return v >= 85 ? 'GOOD' : (v >= 70 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Corporate Risk Score
  if (id === 'kpi_03') return v >= 85 ? 'GOOD' : (v >= 75 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Hotel Benchmark Index
  if (id === 'kpi_06') return v >= 95 ? 'GOOD' : (v >= 90 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Closure Rate
  if (id === 'kpi_07') return v >= 95 ? 'GOOD' : (v >= 90 ? 'NEEDS IMPROVEMENT' : 'BAD'); // VIP Closure Rate

  // Lower is better
  if (id === 'kpi_02') return v <= 1 ? 'GOOD' : (v <= 2 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Critical Incident Rate
  if (id === 'kpi_04') return v <= 6 ? 'GOOD' : (v <= 10 ? 'NEEDS IMPROVEMENT' : 'BAD'); // VIP Incident Exposure
  if (id === 'kpi_05') return v <= 3 ? 'GOOD' : (v <= 5 ? 'NEEDS IMPROVEMENT' : 'BAD'); // SLA Breach Rate
  if (id === 'kpi_08') return v <= 15 ? 'GOOD' : (v <= 25 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Repeat Guest Complaint Rate
  if (id === 'kpi_10') return v <= 45 ? 'GOOD' : (v <= 60 ? 'NEEDS IMPROVEMENT' : 'BAD'); // Root Cause Concentration

  // Total Incident Volume depends heavily on property scale
  if (id === 'kpi_09') return v <= 800 ? 'GOOD' : (v <= 1200 ? 'NEEDS IMPROVEMENT' : 'BAD');

  return 'INFO';
}

const SEV_WEIGHTS: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
const SEV_ORDER   = ['Critical', 'High', 'Medium', 'Low'] as const;
const SEV_COLORS  = { Critical: '#dc3545', High: '#fd7e14', Medium: '#ffc107', Low: '#28a745' };
const STAT_COLORS: Record<string, string> = { Completed: '#22c55e', Cancelled: '#94a3b8' };

// ── Client-side re-aggregation from raw_daily ─────────────────────────────────

interface FilteredData {
  total: number; completed: number; cancelled: number; pending: number;
  high_crit: number; severity_sum: number; vip: number;
  byStatus:   Record<string, number>;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  weekdayMap: Record<number, number>;
  monthMap:   Record<string, number>;
  weekMap:    Record<string, number>;
  days:       DailyBucket[];
}

interface DeptScopedSummary {
  total: number;
  completed: number;
  cancelled: number;
  pending: number;
  vip_total: number;
  vip_completed: number;
  vip_cancelled: number;
  severity_sum: number;
  repeat_count: number;
  status_map: Record<string, number>;
  severity_map: Record<string, number>;
  category_map: Record<string, number>;
  item_map: Record<string, number>;
  source_map: Record<string, number>;
  booking_map?: Record<string, number>;
  dept_map: Record<string, number>;
  room_map?: Record<string, number>;
  location_map?: Record<string, number>;
  dept_category_map?: Record<string, Record<string, number>>;
  category_item_map?: Record<string, Record<string, number>>;
  item_location_map?: Record<string, Record<string, number>>;
  room_item_map?: Record<string, Record<string, number>>;
  status_dept_map?: Record<string, Record<string, number>>;
  source_dept_map?: Record<string, Record<string, number>>;
  location_dept_map?: Record<string, Record<string, number>>;
  dept_category_item_map?: Record<string, Record<string, Record<string, number>>>;
  severity_category_map?: Record<string, Record<string, number>>;
  category_status_map?: Record<string, Record<string, number>>;
  vip_item_map?: Record<string, Record<string, number>>;
  vip_category_map?: Record<string, Record<string, number>>;
  category_duration_map?: Record<string, number>;
  category_item_duration_map?: Record<string, Record<string, number>>;
  avg_first_response: number | null;
  peak_hour: number;
  peak_hour_share: number;
  hour_map?: Record<number, number>;
  hour_category_map?: Record<string, Record<string, number>>;
  hour_dept_map?: Record<string, Record<string, number>>;
  hour_category_item_map?: Record<string, Record<string, Record<string, number>>>;
  hour_dept_item_map?: Record<string, Record<string, Record<string, number>>>;
  raw_daily?: DailyBucket[];
}

function dateToWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function reAggregate(buckets: DailyBucket[], from: string, to: string): FilteredData {
  const days = buckets.filter(b => b.date >= from && b.date <= to);
  const total        = days.reduce((s, b) => s + b.total, 0);
  const completed    = days.reduce((s, b) => s + b.completed, 0);
  const cancelled    = days.reduce((s, b) => s + b.cancelled, 0);
  const pending      = days.reduce((s, b) => s + b.pending, 0);
  const high_crit    = days.reduce((s, b) => s + b.high_crit, 0);
  const severity_sum = days.reduce((s, b) => s + b.severity_sum, 0);
  const vip          = days.reduce((s, b) => s + (b.vip ?? 0), 0);
  const byStatus     = mergeRecords(days.map(b => b.by_status));
  const bySeverity   = mergeRecords(days.map(b => b.by_severity));
  const byCategory   = mergeRecords(days.map(b => b.by_category));

  const weekdayMap: Record<number, number> = {};
  const monthMap:   Record<string, number>  = {};
  const weekMap:    Record<string, number>  = {};
  for (const b of days) {
    const d  = new Date(b.date);
    const wd = d.getDay();
    weekdayMap[wd] = (weekdayMap[wd] ?? 0) + b.total;
    const mk = b.date.slice(0, 7);
    monthMap[mk] = (monthMap[mk] ?? 0) + b.total;
    const wk = dateToWeekKey(b.date);
    weekMap[wk] = (weekMap[wk] ?? 0) + b.total;
  }
  return { total, completed, cancelled, pending, high_crit, severity_sum, vip, byStatus, bySeverity, byCategory, weekdayMap, monthMap, weekMap, days };
}

function summaryFromFilteredData(fd: FilteredData, base: ChainEntry['summary']): ChainEntry['summary'] {
  return {
    ...base,
    total: fd.total,
    completed: fd.completed,
    cancelled: fd.cancelled,
    pending: fd.pending,
    vip_total: fd.vip,
    // Keep full-period VIP completion split when day-level split is unavailable.
    vip_completed: base.vip_completed,
    vip_cancelled: base.vip_cancelled,
    severity_sum: fd.severity_sum,
    // Keep full-period repeat count when day-level repeat split is unavailable.
    repeat_count: base.repeat_count,
    status_map: fd.byStatus,
    category_map: fd.byCategory,
    severity_map: fd.bySeverity,
    week_map: fd.weekMap,
  };
}

function mergeChainSummaries(entries: ChainEntry[]): ChainEntry['summary'] {
  const out: ChainEntry['summary'] = {
    total: 0,
    completed: 0,
    cancelled: 0,
    pending: 0,
    vip_total: 0,
    vip_completed: 0,
    vip_cancelled: 0,
    severity_sum: 0,
    repeat_count: 0,
    status_map: {},
    dept_map: {},
    category_map: {},
    item_map: {},
    dept_item_map: {},
    dept_category_map: {},
    week_map: {},
    week_source_map: {},
    dept_source_map: {},
    booking_map: {},
    source_map: {},
    severity_map: {},
  };
  for (const e of entries) {
    const s = e.summary;
    out.total += s.total;
    out.completed += s.completed;
    out.cancelled += s.cancelled;
    out.pending += s.pending;
    out.vip_total += s.vip_total;
    out.vip_completed += s.vip_completed;
    out.vip_cancelled += s.vip_cancelled;
    out.severity_sum += s.severity_sum;
    out.repeat_count += s.repeat_count;
    for (const [k, v] of Object.entries(s.status_map ?? {})) out.status_map[k] = (out.status_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.dept_map ?? {})) out.dept_map[k] = (out.dept_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.category_map ?? {})) out.category_map[k] = (out.category_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.item_map ?? {})) out.item_map[k] = (out.item_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.week_map ?? {})) out.week_map[k] = (out.week_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.booking_map ?? {})) out.booking_map[k] = (out.booking_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.source_map ?? {})) out.source_map[k] = (out.source_map[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.severity_map ?? {})) out.severity_map[k] = (out.severity_map[k] ?? 0) + v;
  }
  return out;
}

function recomputeKpis(base: KpiDef[], fd: FilteredData): KpiDef[] {
  const { total, completed, cancelled, pending, severity_sum, vip } = fd;
  const closureRate = total > 0 ? (completed / total) * 100 : 0;
  const backlogRate = total > 0 ? (pending   / total) * 100 : 0;
  const avgSev      = total > 0 ? severity_sum / total       : 0;
  const hasVip      = vip > 0;
  return base.map(k => {
    if (k.id === 'kpi_01') return { ...k, value: total };
    if (k.id === 'kpi_02') return { ...k, value: r1(closureRate) };
    if (k.id === 'kpi_03') return { ...k, value: r1(backlogRate) };
    if (k.id === 'kpi_04') return { ...k, value: pending };
    if (k.id === 'kpi_05') return { ...k, value: cancelled };
    if (k.id === 'kpi_06') return { ...k, available: hasVip, value: hasVip ? r1((vip / total) * 100) : null };
    if (k.id === 'kpi_10') return { ...k, value: r2(avgSev) };
    // kpi_07 (VIP closure), kpi_08 (repeat rate), kpi_09 (avg first response) — full-period only
    return k;
  });
}

function hcOpts(o: Record<string, unknown>): Highcharts.Options {
  return o as unknown as Highcharts.Options;
}

type DrillAxisChart = Highcharts.Chart & { fcsAxisTitleStack?: string[] };
type DrilldownAxisEvent = {
  seriesOptions?: {
    custom?: {
      xAxisTitle?: string;
    };
  };
};

function withDrilldownXAxisTitles(options: Highcharts.Options, rootTitle: string): Highcharts.Options {
  const chartOptions = options.chart ?? {};
  return {
    ...options,
    chart: {
      ...chartOptions,
      events: {
        ...(chartOptions.events ?? {}),
        drilldown: function (this: Highcharts.Chart, event: DrilldownAxisEvent) {
          const chart = this as DrillAxisChart;
          const currentTitle = (chart.xAxis?.[0] as unknown as { axisTitle?: { textStr?: string } } | undefined)?.axisTitle?.textStr ?? rootTitle;
          chart.fcsAxisTitleStack = [...(chart.fcsAxisTitleStack ?? []), currentTitle];
          const nextTitle = event.seriesOptions?.custom?.xAxisTitle ?? currentTitle;
          chart.xAxis?.[0]?.setTitle({ text: nextTitle }, false);
          chart.redraw();
        },
        drillup: function (this: Highcharts.Chart) {
          const chart = this as DrillAxisChart;
          const stack = chart.fcsAxisTitleStack ?? [];
          const previousTitle = stack.pop() ?? rootTitle;
          chart.fcsAxisTitleStack = stack;
          chart.xAxis?.[0]?.setTitle({ text: previousTitle }, false);
          chart.redraw();
        },
        drillupall: function (this: Highcharts.Chart) {
          const chart = this as DrillAxisChart;
          chart.fcsAxisTitleStack = [];
          chart.xAxis?.[0]?.setTitle({ text: rootTitle }, false);
          chart.redraw();
        },
      },
    },
  };
}

function buildBuilderOverride(def: ChartDef, fd: FilteredData | null, deptSummary: DeptScopedSummary | null): Highcharts.Options | undefined {
  if (!fd && !deptSummary) return undefined;
  const savedOptions = (def.options ?? {}) as Record<string, unknown>;
  const savedChartType = String(((savedOptions.chart as Record<string, unknown> | undefined)?.type ?? '')).toLowerCase();
  const hasSavedDrilldown = !!savedOptions.drilldown;
  // Respect builder-authored chart type/config when pie/donut/drilldown was explicitly saved.
  if (hasSavedDrilldown || savedChartType === 'pie') return undefined;
  const title = (def.title ?? '').toLowerCase();
  if (title.includes('monthly') && title.includes('severity') && fd) {
    const monthMap = new Map<string, Record<string, number>>();
    for (const d of fd.days) {
      const m = d.date.slice(0, 7);
      if (!monthMap.has(m)) monthMap.set(m, {});
      const row = monthMap.get(m)!;
      for (const [sev, n] of Object.entries(d.by_severity ?? {})) row[sev] = (row[sev] ?? 0) + Number(n);
    }
    const months = Array.from(monthMap.keys()).sort();
    const sevKeys = Array.from(new Set(months.flatMap((m) => Object.keys(monthMap.get(m) ?? {}))));
    return {
      chart: { type: 'column' },
      xAxis: { categories: months },
      yAxis: { title: { text: 'Count' } },
      series: sevKeys.map((sev) => ({ type: 'column', name: sev, data: months.map((m) => Number(monthMap.get(m)?.[sev] ?? 0)) })),
      plotOptions: { column: { dataLabels: { enabled: true } } },
    } as Highcharts.Options;
  }
  if (title.includes('department')) {
    const depMap = deptSummary?.dept_map ?? {};
    const rows = Object.entries(depMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const categories = rows.map(([k]) => k);
    const values = rows.map(([, v]) => Number(v));
    if (categories.length === 0) return undefined;
    return {
      chart: { type: 'bar' },
      xAxis: { categories },
      yAxis: { title: { text: 'Count' } },
      series: [{ type: 'bar', name: 'Count', data: values }],
      plotOptions: { bar: { dataLabels: { enabled: true } } },
    } as Highcharts.Options;
  }
  return undefined;
}

function builderIndexFromId(id: string): number | null {
  const m = id.match(/builder_chart_(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ── Filterable chart rebuilder ────────────────────────────────────────────────

function buildFilteredOptions(def: ChartDef, fd: FilteredData): Highcharts.Options | undefined {
  const { days, byStatus, bySeverity, byCategory, weekdayMap, monthMap, weekMap } = fd;
  const sortedDays   = days.map(d => d.date);
  const sortedMonths = Object.keys(monthMap).sort();
  const sortedWeeks  = Object.keys(weekMap).sort();
  const tickIv       = Math.max(1, Math.floor(sortedDays.length / 10));
  const topCats      = Object.entries(byCategory).sort(([,a],[,b]) => b-a).map(([k]) => k);

  const catDailyMap: Record<string, Record<string, number>> = {};
  for (const b of days) for (const [cat, cnt] of Object.entries(b.by_category)) {
    if (!catDailyMap[cat]) catDailyMap[cat] = {};
    catDailyMap[cat][b.date] = (catDailyMap[cat][b.date] ?? 0) + cnt;
  }
  const sevDailyMap: Record<string, Record<string, number>> = {};
  for (const b of days) for (const [sev, cnt] of Object.entries(b.by_severity)) {
    if (!sevDailyMap[sev]) sevDailyMap[sev] = {};
    sevDailyMap[sev][b.date] = (sevDailyMap[sev][b.date] ?? 0) + cnt;
  }
  const top5 = topCats.slice(0, 5);
  const top10 = topCats.slice(0, 24);

  function catClosureRates(cats: string[]) {
    const statusDailyMap: Record<string, Record<string, number>> = {};
    for (const b of days) for (const [st, cnt] of Object.entries(b.by_status)) {
      if (!statusDailyMap[st]) statusDailyMap[st] = {};
      for (const [cat] of Object.entries(b.by_category)) {
        // approximate: distribute status counts proportionally by day
        statusDailyMap[st][cat] = (statusDailyMap[st][cat] ?? 0) + cnt;
      }
    }
    // Use byCategory from filtered days + proportional completion
    const total = Object.values(byCategory).reduce((s,v)=>s+v,0);
    if (total === 0) return cats.map(() => 0);
    const completedTotal = fd.completed;
    return cats.map(cat => {
      const catTotal = byCategory[cat] ?? 0;
      if (catTotal === 0) return 0;
      const estCompleted = catDailyMap[cat] ? Object.values(catDailyMap[cat]).reduce((s,v)=>s+v,0) : 0;
      // We can't know per-cat status in filtered data, fall back to overall closure rate
      return r1((completedTotal / Math.max(total, 1)) * 100);
    });
  }

  switch (def.id) {
    case 'im-40': return hcOpts({
      chart: { type: 'pie' },
      series: [{ name: 'Status', type: 'pie', innerSize: '45%',
        data: Object.entries(byStatus).sort(([,a],[,b])=>b-a).map(([name,y])=>({
          name, y, drilldown: name, ...(STAT_COLORS[name]?{color:STAT_COLORS[name]}:{})
        })) }],
      // drilldown data is full-period from stored JSON — dept breakdown always reflects all records
      drilldown: (def.options as Record<string, unknown>).drilldown,
      plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' } } },
      tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} incidents ({point.percentage:.1f}%)' },
    });
    case 'im-48': return hcOpts({
      chart: { type: 'pie' },
      series: [{ name: 'Incidents', type: 'pie', innerSize: '45%',
        data: Object.entries(byStatus).sort(([,a],[,b])=>b-a).map(([name,y])=>({ name,y,...(STAT_COLORS[name]?{color:STAT_COLORS[name]}:{}) })) }],
      plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' } } },
    });
    case 'im-41': case 'im-47': return hcOpts({
      chart: { type: def.id === 'im-41' ? 'column' : 'pie' },
      ...(def.id === 'im-41'
        ? { xAxis: { categories: SEV_ORDER.filter(s => bySeverity[s]) }, series: [{ name: 'Count', data: SEV_ORDER.filter(s=>bySeverity[s]).map(s=>({ y: bySeverity[s]??0, color: SEV_COLORS[s as keyof typeof SEV_COLORS] })) }] }
        : { series: [{ name:'Incidents', type:'pie', innerSize:'50%', data: SEV_ORDER.filter(s=>bySeverity[s]).map(s=>({ name:s, y:bySeverity[s], color:SEV_COLORS[s as keyof typeof SEV_COLORS] })) }] }),
      plotOptions: def.id === 'im-41'
        ? { column: { dataLabels: { enabled: true } } }
        : { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%' } } },
    });
    case 'im-42': case 'im-49': return hcOpts({
      chart: { type: def.id === 'im-42' ? 'areaspline' : 'spline' },
      xAxis: { categories: sortedDays, tickInterval: tickIv },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      series: [{ name: 'Incidents', data: days.map(d => d.total), ...(def.id === 'im-42' ? { fillOpacity: 0.15 } : {}) }],
      tooltip: { shared: true },
    });
    case 'im-43': case 'im-46': {
      const cats = topCats.slice(0, def.id === 'im-46' ? 999 : 24);
      return hcOpts({
        chart: { type: def.id === 'im-43' ? 'bar' : 'column' },
        xAxis: { categories: cats },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: cats.map(c=>byCategory[c]??0) }],
        plotOptions: { [def.id === 'im-43' ? 'bar' : 'column']: { dataLabels: { enabled: true } } },
      });
    }
    case 'im-50': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: sortedMonths },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: 'Incidents', data: sortedMonths.map(m => monthMap[m] ?? 0) }],
      plotOptions: { column: { dataLabels: { enabled: true } } },
    });
    case 'im-56': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: top10 },
      yAxis: { title: { text: 'Closure Rate (%)' }, min: 0, max: 100 },
      series: [{ name: 'Closure Rate %', data: catClosureRates(top10) }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      tooltip: { pointFormat: 'Closure Rate: <b>{point.y:.1f}%</b>' },
    });
    case 'cim-03': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: sortedWeeks, tickInterval: Math.max(1, Math.floor(sortedWeeks.length / 8)) },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: 'Incidents', data: sortedWeeks.map(w => weekMap[w] ?? 0) }],
      plotOptions: { column: { dataLabels: { enabled: sortedWeeks.length <= 16 } } },
    });
    default: return undefined;
  }
}

// ── Chain chart builder (multi-hotel comparison) ──────────────────────────────

function buildChainOptions(id: string, entries: ChainEntry[]): Highcharts.Options | undefined {
  if (entries.length < 2) return undefined; // use single-hotel fallback
  const codes = entries.map(e => e.hotel_code);

  switch (id) {
    case 'im-57': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: 'Total Incidents', data: entries.map(e => e.summary.total) }],
      plotOptions: { column: { dataLabels: { enabled: true } } },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
    case 'im-58': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'Closure Rate (%)' }, min: 0, max: 100 },
      series: [{
        name: 'Closure Rate %', color: '#22c55e',
        data: entries.map(e => {
          const { total, completed } = e.summary;
          return total > 0 ? r1((completed / total) * 100) : 0;
        }),
      }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
    });
    case 'im-59': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'VIP Share (%)' }, min: 0, max: 100 },
      series: [{
        name: 'VIP Share %', color: '#f59e0b',
        data: entries.map(e => {
          const { total, vip_total } = e.summary;
          return total > 0 ? r1((vip_total / total) * 100) : 0;
        }),
      }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
    });
    case 'im-60': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'Avg Severity (1–4)' }, min: 0, max: 4 },
      series: [{
        name: 'Avg Severity', color: '#ef4444',
        data: entries.map(e => {
          const { total, severity_sum } = e.summary;
          return total > 0 ? r2(severity_sum / total) : 0;
        }),
      }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.2f}' } } },
    });
    case 'im-61': {
      // Collect all category keys across hotels, take top-6
      const allCatMap: Record<string, number> = {};
      for (const e of entries) for (const [k, v] of Object.entries(e.summary.category_map)) allCatMap[k] = (allCatMap[k] ?? 0) + v;
      const topCats = Object.entries(allCatMap).sort(([,a],[,b])=>b-a).slice(0,24).map(([k])=>k);
      return hcOpts({
        chart: { type: 'column' },
        xAxis: { categories: codes },
        yAxis: { title: { text: 'Share (%)' }, min: 0, max: 100 },
        series: topCats.map(cat => ({
          name: cat,
          data: entries.map(e => {
            const t = e.summary.total;
            return t > 0 ? r1(((e.summary.category_map[cat] ?? 0) / t) * 100) : 0;
          }),
        })),
        plotOptions: { column: { stacking: 'normal' } },
        tooltip: { pointFormat: '<b>{series.name}</b>: {point.y:.1f}%<br/>' },
      });
    }
    case 'im-62': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'Pending Rate (%)' }, min: 0, max: 100 },
      series: [{
        name: 'Pending Rate %', color: '#f97316',
        data: entries.map(e => {
          const { total, pending } = e.summary;
          return total > 0 ? r1((pending / total) * 100) : 0;
        }),
      }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
    });
    case 'cim-02': {
      // Top-5 depts across chain → stacked bar per hotel
      const allDeptMap: Record<string, number> = {};
      for (const e of entries) for (const [k, v] of Object.entries(e.summary.dept_map)) allDeptMap[k] = (allDeptMap[k] ?? 0) + v;
      const topDepts = Object.entries(allDeptMap).sort(([,a],[,b])=>b-a).slice(0,24).map(([k])=>k);
      if (topDepts.length === 0) return undefined;
      return hcOpts({
        chart: { type: 'column' },
        xAxis: { categories: codes },
        yAxis: { title: { text: 'Incidents' } },
        series: topDepts.map(dept => ({
          name: dept,
          data: entries.map(e => e.summary.dept_map[dept] ?? 0),
        })),
        plotOptions: { column: { stacking: 'normal' } },
        tooltip: { pointFormat: '<b>{series.name}</b>: {point.y}<br/>' },
      });
    }
    case 'cim-09': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'Repeat Rate (%)' }, min: 0, max: 100 },
      series: [{
        name: 'Repeat Rate %', color: '#f59e0b',
        data: entries.map(e => {
          const { total, repeat_count } = e.summary;
          return total > 0 ? r1((repeat_count / total) * 100) : 0;
        }),
      }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
    });
    default: return undefined;
  }
}

function recomputeJoKpis(base: KpiDef[], fd: FilteredData): KpiDef[] {
  const { total, completed, pending, cancelled } = fd;
  const completionRate = total > 0 ? (completed / total) * 100 : 0;
  const timeoutRate = total > 0 ? (pending / total) * 100 : 0;
  const escalationRate = total > 0 ? (cancelled / total) * 100 : 0;
  return base.map((k) => {
    if (k.id === 'kpi_01') return { ...k, value: total };
    if (k.id === 'kpi_02') return { ...k, value: r1(completionRate) };
    if (k.id === 'kpi_04') return { ...k, value: r1(timeoutRate) };
    if (k.id === 'kpi_05') return { ...k, value: r1(escalationRate) };
    return k;
  });
}

function buildDepartmentScopedOptions(def: ChartDef, department: string, summary: ChainEntry['summary'], scoped: DeptScopedSummary | null): Highcharts.Options | undefined {
  const deptCategoryMap = scoped?.category_map ?? summary.dept_category_map?.[department] ?? {};
  const deptItemMap = scoped?.item_map ?? summary.dept_item_map?.[department] ?? {};
  const topCats = Object.entries(deptCategoryMap).sort(([, a], [, b]) => b - a).map(([k]) => k);
  const topItems = Object.entries(deptItemMap).sort(([, a], [, b]) => b - a).slice(0, 24).map(([k]) => k);

  if (def.id === 'im-43' || def.id === 'im-46') {
    const cats = topCats.slice(0, def.id === 'im-46' ? 999 : 24);
    return hcOpts({
      chart: { type: def.id === 'im-43' ? 'bar' : 'column' },
      xAxis: { categories: cats },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: `${department} Incidents`, data: cats.map((c) => deptCategoryMap[c] ?? 0) }],
      plotOptions: { [def.id === 'im-43' ? 'bar' : 'column']: { dataLabels: { enabled: true } } },
    });
  }

  if (def.id === 'im-52') {
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { categories: topItems },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: `${department} Items`, data: topItems.map((k) => deptItemMap[k] ?? 0) }],
      plotOptions: { bar: { dataLabels: { enabled: true } } },
    });
  }

  if (def.id === 'cim-02') {
    const cats = Object.entries(deptCategoryMap).sort(([, a], [, b]) => b - a).slice(0, 24).map(([k]) => k);
    const data = cats.map((cat, y) => [0, y, deptCategoryMap[cat] ?? 0]);
    return hcOpts({
      chart: { type: 'heatmap' },
      xAxis: { categories: [department], title: { text: 'Department' } },
      yAxis: { categories: cats, title: { text: 'Category' }, reversed: true },
      colorAxis: { min: 0, minColor: '#F5E7D3', maxColor: '#C55A10' },
      series: [{ type: 'heatmap', name: 'Incidents', borderWidth: 1, data }],
      tooltip: { pointFormat: `<b>${department}</b><br/>{point.value} incidents` },
    });
  }

  return undefined;
}

function buildCorpImOptions(id: string, entries: ChainEntry[], worldMapData?: Record<string, unknown> | null): Highcharts.Options | undefined {
  if (entries.length < 2) return undefined;
  const codes = entries.map(e => e.hotel_code);
  const safePct = (n: number, d: number) => d > 0 ? (n / d) * 100 : 0;
  const riskScore = (e: ChainEntry) => {
    const total = Math.max(e.summary.total, 1);
    const critical = e.summary.severity_map?.Critical ?? 0;
    const high = e.summary.severity_map?.High ?? 0;
    const vip = e.summary.vip_total ?? 0;
    const sla = Object.entries(e.summary.status_map ?? {})
      .filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k))
      .reduce((s, [, v]) => s + v, 0);
    const open = e.summary.pending ?? 0;
    return (critical * 5) + (high * 3) + (vip * 4) + (sla * 3) + (open * 2) + total * 0.01;
  };
  const statusKeys = Array.from(
    new Set(entries.flatMap((e) => Object.keys(e.summary.status_map ?? {}))),
  ).sort((a, b) => {
    const rank = (k: string) => (k === 'Completed' ? 0 : k === 'Pending' ? 1 : k === 'Cancelled' ? 2 : 3);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  if (id === 'cim-02') {
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { categories: codes },
      yAxis: { min: 0, title: { text: 'Incidents' } },
      plotOptions: { series: { stacking: 'normal' } },
      series: statusKeys.map((status) => ({
        type: 'bar',
        name: status,
        data: entries.map((e) => e.summary.status_map[status] ?? 0),
      })),
      tooltip: { shared: true },
    });
  }

  if (id === 'cim-03') {
    return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: [
        { title: { text: 'VIP Incidents' }, min: 0 },
        { title: { text: 'VIP Closure Rate (%)' }, opposite: true, min: 0, max: 100 },
      ],
      series: [
        {
          type: 'column',
          name: 'VIP Incidents',
          data: entries.map((e) => e.summary.vip_total),
          color: '#0E7470',
        },
        {
          type: 'spline',
          name: 'VIP Closure Rate %',
          yAxis: 1,
          data: entries.map((e) => {
            const total = e.summary.vip_total;
            return total > 0 ? r1((e.summary.vip_completed / total) * 100) : 0;
          }),
          color: '#C55A10',
        },
      ],
      tooltip: { shared: true },
    });
  }

  if (id === 'cim-09') {
    return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { min: 0, max: 100, title: { text: 'Share (%)' } },
      plotOptions: { series: { stacking: 'normal', dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      series: [
        {
          type: 'column',
          name: 'VIP',
          data: entries.map((e) => {
            const total = e.summary.total || 0;
            return total > 0 ? Math.round((e.summary.vip_total / total) * 1000) / 10 : 0;
          }),
          color: '#0E7470',
        },
        {
          type: 'column',
          name: 'Non-VIP',
          data: entries.map((e) => {
            const total = e.summary.total || 0;
            const vip = e.summary.vip_total || 0;
            return total > 0 ? Math.round(((total - vip) / total) * 1000) / 10 : 0;
          }),
          color: '#C55A10',
        }
      ],
      tooltip: { shared: true, pointFormat: '<span style="color:{series.color}">{series.name}</span>: <b>{point.y:.1f}%</b><br/>' },
    });
  }

  if (id === 'cim-05') return buildChainOptions('cim-09', entries); // Repeat rate
  if (id === 'cim-01') {
    const topLevel = entries.map((e) => ({
      name: e.hotel_code,
      y: e.summary.total,
      drilldown: e.hotel_code,
    }));
    const drillSeries = entries.map((e) => ({
      id: e.hotel_code,
      name: `${e.hotel_code} Top 10`,
      type: 'pie' as const,
      innerSize: '45%',
      data: Object.entries(((e.summary as { item_map?: Record<string, number> }).item_map) ?? e.summary.category_map ?? {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 24)
        .map(([name, y]) => ({ name, y })),
    }));
    return hcOpts({
      chart: { type: 'pie' },
      series: [{
        name: 'Hotel Incidents',
        type: 'pie',
        innerSize: '45%',
        data: topLevel,
      }],
      drilldown: { series: drillSeries },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
  }
  if (id === 'cim-06') {
    if (!worldMapData) return undefined;
    const countryAgg = new Map<string, { total: number; hotels: string[] }>();
    for (const e of entries) {
      const code = String(e.country_code ?? '').trim().toLowerCase();
      if (!code) continue;
      const prev = countryAgg.get(code) ?? { total: 0, hotels: [] };
      prev.total += e.summary.total;
      prev.hotels.push(`${e.hotel_code} ${e.summary.total}`);
      countryAgg.set(code, prev);
    }
    const mapDataPoints = Array.from(countryAgg.entries()).map(([code, agg]) => ({
      'hc-key': code,
      value: agg.total,
      labelrank: agg.total,
      custom: {
        hotels: agg.hotels.join(', '),
        countryCode: code.toUpperCase(),
      },
    }));
    return hcOpts({
      chart: { type: 'map' },
      mapNavigation: { enabled: true },
      colorAxis: {
        min: 0,
        minColor: '#E6F4F1',
        maxColor: '#0E7470',
      },
      series: [{
        type: 'map',
        name: 'Hotel Incidents',
        mapData: worldMapData,
        data: mapDataPoints.map((p) => ({
          code: (p.custom.countryCode ?? '').toUpperCase(),
          value: p.value,
          custom: p.custom,
        })),
        joinBy: ['iso-a2', 'code'],
        borderColor: '#B9A88A',
        nullColor: '#F4EEE4',
        states: { hover: { color: '#C55A10' } },
        dataLabels: {
          enabled: true,
          allowOverlap: false,
          crop: false,
          overflow: 'allow',
          padding: 2,
          useHTML: true,
          formatter: function (this: { point?: { options?: { custom?: { hotels?: string } }; series?: { chart?: { fullscreen?: { isOpen?: boolean } } } } }) {
            const hotels = this.point?.options?.custom?.hotels ?? '';
            const isFullscreen = this.point?.series?.chart?.fullscreen?.isOpen === true;
            const size = isFullscreen ? 16 : 8;
            return `<span style="font-size:${size}px;line-height:1.2;font-weight:700">${hotels}</span>`;
          },
          style: {
            fontSize: '8px',
            fontWeight: '600',
            textOutline: 'none',
          },
        },
      } as unknown as Highcharts.SeriesOptionsType],
      tooltip: {
        useHTML: true,
        pointFormatter: function (this: Highcharts.Point) {
          const hotels = (this.options as { custom?: { hotels?: string } }).custom?.hotels ?? '';
          const cc = (this.options as { custom?: { countryCode?: string } }).custom?.countryCode ?? this.name;
          return `<b>${cc}</b><br/>Hotels: ${hotels || '-'}`;
        },
      },
    });
  }
  if (id === 'cim-07') {
    const topLevel = entries.map((e) => ({
      name: e.hotel_code,
      y: e.summary.total,
      drilldown: `hotel:${e.hotel_code}`,
    }));
    const drillSeries: Array<{
      id: string;
      name: string;
      type: 'column';
      data: Array<{ name: string; y: number; drilldown?: string }>;
    }> = [];

    for (const e of entries) {
      const hotel = e.hotel_code;
      const topDepts = Object.entries(e.summary.dept_map ?? {})
        .sort(([, a], [, b]) => b - a);

      drillSeries.push({
        id: `hotel:${hotel}`,
        name: `${hotel} Departments`,
        type: 'column',
        data: topDepts.map(([dept, total]) => ({ name: dept, y: total })),
      });
    }

    return hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category' },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      series: [{
        name: 'Incidents',
        type: 'column',
        data: topLevel,
      }],
      drilldown: { series: drillSeries },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
  }
  if (id === 'cim-08') {
    const topHotels = entries
      .map((e) => ({ hotel: e.hotel_code, total: e.summary.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 24);
    if (topHotels.length === 0) return undefined;

    const drillSeries: Array<{
      id: string;
      name: string;
      type: 'pie';
      innerSize: string;
      data: Array<{ name: string; y: number }>;
    }> = topHotels.map((h) => {
      const entry = entries.find((e) => e.hotel_code === h.hotel);
      const rows = Object.entries(entry?.summary.source_map ?? {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 24)
        .map(([name, y]) => ({ name, y }));
      return {
        id: `h:${h.hotel}`,
        name: `${h.hotel} Source of Complaint`,
        type: 'pie',
        innerSize: '45%',
        data: rows.length > 0 ? rows : [{ name: 'Unknown', y: 0 }],
      };
    });

    return hcOpts({
      chart: { type: 'pie' },
      series: [{
        name: 'Incidents',
        type: 'pie',
        innerSize: '45%',
        data: topHotels.map((h) => ({ name: h.hotel, y: h.total, drilldown: `h:${h.hotel}` })),
      }],
      drilldown: {
        series: drillSeries,
      },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
  }
  if (id === 'cim-04') {
    const topLevel = entries.map((e) => ({
      name: e.hotel_code,
      y: e.summary.total,
      drilldown: e.hotel_code,
    }));
    const drillSeries = entries.map((e) => ({
      id: e.hotel_code,
      name: `${e.hotel_code} Top 10`,
      type: 'pie' as const,
      innerSize: '45%',
      data: Object.entries(e.summary.category_map ?? {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 24)
        .map(([name, y]) => ({ name, y })),
    }));
    return hcOpts({
      chart: { type: 'pie' },
      series: [{
        name: 'Incidents',
        type: 'pie',
        innerSize: '45%',
        data: topLevel,
      }],
      drilldown: { series: drillSeries },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
  }
  if (id === 'cim-10') {
    const topHotels = entries
      .map((e) => ({ hotel: e.hotel_code, total: e.summary.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 24);
    if (topHotels.length === 0) return undefined;
    return hcOpts({
      chart: { type: 'pie' },
      series: [{
        name: 'Incidents',
        type: 'pie',
        innerSize: '45%',
        data: topHotels.map((h) => ({ name: h.hotel, y: h.total, drilldown: h.hotel })),
      }],
      drilldown: {
        series: topHotels.map((h) => {
          const entry = entries.find((e) => e.hotel_code === h.hotel);
          const booking = (entry?.summary as { booking_map?: Record<string, number> } | undefined)?.booking_map ?? {};
          const primaryRows = Object.entries(booking)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 24)
            .map(([name, y]) => ({ name, y }));
          const sourceFallback = Object.entries(entry?.summary.source_map ?? {})
            .sort(([, a], [, b]) => b - a)
            .slice(0, 24)
            .map(([name, y]) => ({ name, y }));
          const rows = primaryRows.length > 0
            ? primaryRows
            : (sourceFallback.length > 0 ? sourceFallback : [{ name: 'Unknown', y: entry?.summary.total ?? 0 }]);
          return {
            id: h.hotel,
            name: `${h.hotel} Booking Source`,
            type: 'pie' as const,
            innerSize: '45%',
            data: rows,
          };
        }),
      },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
  }

  if (id === 'cim-11') {
    const metrics = ['Risk Score', 'Critical %', 'VIP Cases', 'SLA Breach %', 'Trend %'];
    const byHotel = entries.map((e) => {
      const t = Math.max(e.summary.total, 1);
      const criticalPct = safePct(e.summary.severity_map?.Critical ?? 0, t);
      const breach = Object.entries(e.summary.status_map ?? {})
        .filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k))
        .reduce((s, [, v]) => s + v, 0);
      const slaPct = safePct(breach, t);
      const weeks = Object.entries(e.summary.week_map ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
      const half = Math.floor(weeks.length / 2);
      const w1 = half > 0 ? weeks.slice(0, half).reduce((s, v) => s + v, 0) / half : 0;
      const w2 = weeks.length - half > 0 ? weeks.slice(half).reduce((s, v) => s + v, 0) / (weeks.length - half) : 0;
      const trend = w1 > 0 ? ((w2 - w1) / w1) * 100 : 0;
      return [riskScore(e), criticalPct, e.summary.vip_total, slaPct, trend];
    });
    const data: Array<[number, number, number]> = [];
    metrics.forEach((_, r) => entries.forEach((_, c) => data.push([c, r, byHotel[c][r] ?? 0])));
    return hcOpts({
      chart: { type: 'heatmap' },
      xAxis: { categories: entries.map((e) => e.hotel_code) },
      yAxis: { categories: metrics, title: { text: null }, reversed: true },
      colorAxis: { min: 0, minColor: '#E6F4F1', maxColor: '#C55A10' },
      series: [{ type: 'heatmap', name: 'Scorecard', data, dataLabels: { enabled: true, formatter: function (this: { point?: { value?: number } }) { return `${r1(Number(this.point?.value ?? 0))}`; } } }],
      tooltip: { pointFormatter: function (this: Highcharts.Point) { const v = Number((this as unknown as { value?: number }).value ?? 0); return `<b>${metrics[this.y ?? 0]}</b><br/>${entries[this.x ?? 0].hotel_code}: ${r1(v)}`; } },
    });
  }

  if (id === 'cim-12') {
    const ranked = [...entries]
      .map((e) => ({ hotel: e.hotel_code, risk: riskScore(e) }))
      .sort((a, b) => b.risk - a.risk);
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { categories: ranked.map((r) => r.hotel) },
      yAxis: { min: 0, title: { text: 'Risk Score' } },
      series: [{ type: 'bar', name: 'Risk Score', data: ranked.map((r) => r.risk) }],
      plotOptions: { bar: { dataLabels: { enabled: true, formatter: function (this: { point?: { y?: number } }) { return `${r1(Number(this.point?.y ?? 0))}`; } } } },
    });
  }

  if (id === 'cim-13') {
    return hcOpts({
      chart: { type: 'bubble' },
      xAxis: { title: { text: 'Incident Volume' } },
      yAxis: { title: { text: 'Avg Severity Score' }, min: 0, max: 4 },
      series: [{
        type: 'bubble',
        name: 'Hotels',
        data: entries.map((e) => ({
          name: e.hotel_code,
          x: e.summary.total,
          y: e.summary.total > 0 ? e.summary.severity_sum / e.summary.total : 0,
          z: e.summary.vip_total,
          custom: { cc: e.country_code },
        })),
      }],
      tooltip: { pointFormatter: function () { const p = this as unknown as { name?: string; x?: number; y?: number; z?: number; custom?: { cc?: string } }; return `<b>${p.name}</b> (${p.custom?.cc ?? '-'})<br/>Volume: ${p.x}<br/>Avg Severity: ${r2(Number(p.y ?? 0))}<br/>VIP: ${p.z}`; } },
    });
  }

  if (id === 'cim-14') {
    const byRegion = new Map<string, { critical: number; vip: number; sla: number; trend: number; count: number }>();
    for (const e of entries) {
      const key = e.country_code || 'UNK';
      const cur = byRegion.get(key) ?? { critical: 0, vip: 0, sla: 0, trend: 0, count: 0 };
      const t = Math.max(e.summary.total, 1);
      cur.critical += safePct(e.summary.severity_map?.Critical ?? 0, t);
      cur.vip += safePct(e.summary.vip_total ?? 0, t);
      const breach = Object.entries(e.summary.status_map ?? {}).filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k)).reduce((s, [, v]) => s + v, 0);
      cur.sla += safePct(breach, t);
      const weeks = Object.values(e.summary.week_map ?? {});
      cur.trend += weeks.length >= 2 ? weeks[weeks.length - 1] - weeks[0] : 0;
      cur.count += 1;
      byRegion.set(key, cur);
    }
    const regions = Array.from(byRegion.keys()).sort();
    const metrics = ['Critical %', 'VIP %', 'SLA Breach %', 'Trend'];
    const data: Array<[number, number, number]> = [];
    regions.forEach((rg, x) => {
      const v = byRegion.get(rg)!;
      const arr = [v.critical / v.count, v.vip / v.count, v.sla / v.count, v.trend / v.count];
      arr.forEach((n, y) => data.push([x, y, n]));
    });
    return hcOpts({
      chart: { type: 'heatmap' },
      xAxis: { categories: regions },
      yAxis: { categories: metrics, title: { text: null }, reversed: true },
      colorAxis: { min: 0, minColor: '#E6F4F1', maxColor: '#C55A10' },
      series: [{ type: 'heatmap', name: 'Regional Risk', data, dataLabels: { enabled: true, formatter: function (this: { point?: { value?: number } }) { return `${r1(Number(this.point?.value ?? 0))}`; } } }],
    });
  }

  if (id === 'cim-19') {
    const weekAgg: Record<string, number> = {};
    for (const e of entries) for (const [w, v] of Object.entries(e.summary.week_map ?? {})) weekAgg[w] = (weekAgg[w] ?? 0) + v;
    let weeks = Object.keys(weekAgg).sort();
    let raw = weeks.map((w) => weekAgg[w] ?? 0);
    // Fallback when weekly buckets are not present in legacy corp summaries.
    if (weeks.length === 0) {
      weeks = entries.map((e) => e.hotel_code);
      raw = entries.map((e) => e.summary.total);
    }
    const ma = raw.map((_, i) => {
      const s = Math.max(0, i - 3);
      const slice = raw.slice(s, i + 1);
      return slice.reduce((a, b) => a + b, 0) / Math.max(slice.length, 1);
    });
    return hcOpts({
      chart: { type: 'line' },
      xAxis: { categories: weeks },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      series: [
        { type: 'line', name: 'Weekly Incidents', data: raw, color: '#0E7470' },
        { type: 'line', name: 'Moving Average', data: ma.map((v) => r1(v)), color: '#C55A10', dashStyle: 'ShortDot' },
      ],
    });
  }

  if (id === 'cim-15' || id === 'cim-18') {
    const depts = Array.from(new Set(entries.flatMap((e) => Object.keys(e.summary.dept_map ?? {}))))
      .sort((a, b) => (entries.reduce((s, e) => s + (e.summary.dept_map[b] ?? 0), 0)) - (entries.reduce((s, e) => s + (e.summary.dept_map[a] ?? 0), 0)))
      .slice(0, 24);
    const data: Array<[number, number, number]> = [];
    entries.forEach((e, x) => depts.forEach((d, y) => data.push([x, y, e.summary.dept_map[d] ?? 0])));
    return hcOpts({
      chart: { type: 'heatmap' },
      xAxis: { categories: entries.map((e) => e.hotel_code) },
      yAxis: { categories: depts, title: { text: null }, reversed: true },
      colorAxis: { min: 0, minColor: '#E6F4F1', maxColor: '#0E7470' },
      series: [{ type: 'heatmap', name: id === 'cim-15' ? 'Department Risk' : 'Department Cases', data, dataLabels: { enabled: true } }],
    });
  }

  if (id === 'cim-16') {
    const root: Record<string, number> = {};
    for (const e of entries) for (const [k, v] of Object.entries(e.summary.item_map ?? e.summary.category_map ?? {})) root[k] = (root[k] ?? 0) + v;
    const top = Object.entries(root).sort(([, a], [, b]) => b - a).slice(0, 24);
    const cats = top.map(([k]) => k);
    const vals = top.map(([, v]) => v);
    const total = vals.reduce((s, v) => s + v, 0);
    let running = 0;
    const cum = vals.map((v) => { running += v; return total > 0 ? (running / total) * 100 : 0; });
    return hcOpts({
      chart: { zoomType: 'xy' },
      xAxis: [{ categories: cats }],
      yAxis: [{ title: { text: 'Incidents' } }, { title: { text: 'Cumulative %' }, opposite: true, max: 100 }],
      series: [
        { type: 'column', name: 'Incidents', data: vals, color: '#0E7470' },
        { type: 'line', name: 'Cumulative %', data: cum.map((v) => r1(v)), yAxis: 1, color: '#C55A10' },
      ],
    });
  }

  if (id === 'cim-17') {
    const GREEN  = '#0F766E';
    const ORANGE = '#C2410C';
    // Always aggregate totals from item_map across ALL hotels
    const allItemTotals: Record<string, number> = {};
    for (const e of entries) for (const [k, v] of Object.entries(e.summary.item_map ?? {})) allItemTotals[k] = (allItemTotals[k] ?? 0) + Number(v);
    const topItems: Array<[string, number]> = Object.entries(allItemTotals).sort(([, a], [, b]) => b - a).slice(0, 24);
    // Merge im_item_date_map from hotels that have it (for drilldown)
    const mergedIdm: Record<string, Record<string, number>> = {};
    let hasIdm = false;
    for (const e of entries) {
      const idm = e.summary.im_item_date_map;
      if (idm) {
        hasIdm = true;
        for (const [item, dm] of Object.entries(idm)) {
          if (!mergedIdm[item]) mergedIdm[item] = {};
          for (const [date, cnt] of Object.entries(dm)) {
            mergedIdm[item][date] = (mergedIdm[item][date] ?? 0) + cnt;
          }
        }
      }
    }
    const allDates = hasIdm
      ? Array.from(new Set(topItems.flatMap(([k]) => Object.keys(mergedIdm[k] ?? {})))).sort()
      : [];
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { type: 'category' },
      yAxis: { min: 0, title: { text: 'Incidents' } },
      series: [{
        type: 'bar', name: 'Incidents', color: GREEN,
        data: topItems.map(([k, v]) => ({ name: k, y: v, drilldown: hasIdm ? `cim17d:${k}` : undefined })),
        dataLabels: { enabled: true },
      }],
      plotOptions: { bar: { dataLabels: { enabled: true } } },
      ...(hasIdm && allDates.length > 0 ? {
        drilldown: {
          series: topItems.map(([k]) => ({
            id: `cim17d:${k}`,
            name: `${k} — Daily Trend`,
            type: 'bar', color: ORANGE,
            dataLabels: { enabled: true },
            data: allDates.map((date) => ({ name: date, y: mergedIdm[k]?.[date] ?? 0 })),
          })),
        },
      } : {}),
    });
  }

  if (id === 'cim-20') {
    // Merge item totals and completed counts across all chain hotels
    const allItemTotals: Record<string, number> = {};
    const allItemCompleted: Record<string, number> = {};
    for (const e of entries) {
      for (const [k, v] of Object.entries(e.summary.item_map ?? {})) allItemTotals[k] = (allItemTotals[k] ?? 0) + Number(v);
      for (const [k, v] of Object.entries(e.summary.im_item_completed_map ?? {})) allItemCompleted[k] = (allItemCompleted[k] ?? 0) + Number(v);
    }
    const topItems = Object.entries(allItemTotals).sort(([, a], [, b]) => b - a).slice(0, 24);
    const hasCompleted = Object.keys(allItemCompleted).length > 0;
    return hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category' },
      yAxis: [
        { min: 0, title: { text: 'Incidents' } },
        { min: 0, max: 100, title: { text: 'Completion Rate (%)' }, opposite: true },
      ],
      series: [
        {
          type: 'column', name: 'Incidents', color: '#0F766E', yAxis: 0,
          data: topItems.map(([k, v]) => ({ name: k, y: v })),
          dataLabels: { enabled: true },
        },
        ...(hasCompleted ? [{
          type: 'line' as const, name: 'Completion Rate (%)', color: '#C2410C', yAxis: 1,
          data: topItems.map(([k, v]) => {
            const comp = allItemCompleted[k] ?? 0;
            return { name: k, y: Math.round((comp / v) * 1000) / 10 };
          }),
          dataLabels: { enabled: true, format: '{point.y:.1f}%' },
          marker: { enabled: true, radius: 4 },
        }] : []),
      ],
      plotOptions: { column: { dataLabels: { enabled: true } } },
      tooltip: { shared: true, pointFormat: '<span style="color:{series.color}">{series.name}</span>: <b>{point.y}</b><br/>' },
    });
  }

  const topMap = (map: Record<string, number>, limit = 50) => Object.entries(map ?? {})
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, limit);
  const idPart = (value: string) => encodeURIComponent(value);
  const categoryItemRows = (summary: HotelSummary, category: string) => {
    const exactRows = topMap(summary.category_item_map?.[category] ?? {}, 50);
    return exactRows.length > 0 ? exactRows : topMap(summary.item_map ?? {}, 50);
  };
  const deptCategoryItemRows = (summary: DeptScopedSummary, dept: string, category: string) => {
    const exactRows = topMap(summary.dept_category_item_map?.[dept]?.[category] ?? {}, 50);
    if (exactRows.length > 0) return exactRows;
    const catRows = topMap(summary.category_item_map?.[category] ?? {}, 50);
    return catRows.length > 0 ? catRows : topMap(summary.item_map ?? {}, 50);
  };
  const categoryDurationRows = (summary: DeptScopedSummary, category: string) => {
    return topMap(summary.category_item_duration_map?.[category] ?? {}, 50);
  };
  const hourCategoryRows = (summary: DeptScopedSummary, hour: string) => {
    return topMap(summary.hour_category_map?.[hour] ?? {}, 50);
  };
  const hourDeptRows = (summary: DeptScopedSummary, hour: string) => {
    return topMap(summary.hour_dept_map?.[hour] ?? {}, 50);
  };
  const hourCategoryItemRows = (summary: DeptScopedSummary, hour: string, category: string) => {
    return topMap(summary.hour_category_item_map?.[hour]?.[category] ?? {}, 50);
  };
  const hourDeptItemRows = (summary: DeptScopedSummary, hour: string, dept: string) => {
    return topMap(summary.hour_dept_item_map?.[hour]?.[dept] ?? {}, 50);
  };

  if (id === 'cim-22') {
    const hotelSeries = entries.map((e) => ({ name: e.hotel_code, y: e.summary.total, drilldown: `cim22h:${idPart(e.hotel_code)}` }));
    const drillSeries: Highcharts.SeriesOptionsType[] = [];
    for (const e of entries) {
      const hKey = idPart(e.hotel_code);
      const catTop = topMap(e.summary.category_map ?? {}, 50);
      drillSeries.push({
        type: 'column',
        id: `cim22h:${hKey}`,
        name: `${e.hotel_code} Categories`,
        custom: { xAxisTitle: 'Incident Category' },
        color: '#C55A10',
        dataLabels: { enabled: true, format: '{point.y}' },
        data: catTop.map(([cat, total]) => ({ name: cat, y: total, drilldown: `cim22c:${hKey}:${idPart(cat)}` })),
      } as Highcharts.SeriesOptionsType);
      for (const [cat] of catTop) {
        const rows = categoryItemRows(e.summary, cat).map(([item, total]) => ({ name: item, y: total }));
        drillSeries.push({
          type: 'column',
          id: `cim22c:${hKey}:${idPart(cat)}`,
          name: `${e.hotel_code} ${cat} Items`,
          custom: { xAxisTitle: 'Incident Items' },
          color: '#0E7470',
          dataLabels: { enabled: true, format: '{point.y}' },
          data: rows.length > 0 ? rows : [{ name: 'No Items', y: 0 }],
        } as Highcharts.SeriesOptionsType);
      }
    }
    return withDrilldownXAxisTitles(hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category', title: { text: 'Hotel' } },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      series: [{
        type: 'column',
        name: 'Incidents',
        color: '#0F766E',
        data: hotelSeries,
      }],
      drilldown: { series: drillSeries },
      tooltip: { shared: true },
    }), 'Hotel');
  }

  if (id === 'cim-23') {
    const hotelSeries = entries.map((e) => ({ name: e.hotel_code, y: e.summary.total, drilldown: `cim23h:${idPart(e.hotel_code)}` }));
    const drillSeries: Highcharts.SeriesOptionsType[] = [];
    for (const e of entries) {
      const hKey = idPart(e.hotel_code);
      const deptTop = topMap(e.summary.dept_map ?? {}, 50);
      const deptCatMap = e.summary.dept_category_map ?? {};
      drillSeries.push({
        type: 'column',
        id: `cim23h:${hKey}`,
        name: `${e.hotel_code} Departments`,
        custom: { xAxisTitle: 'Department' },
        color: '#C55A10',
        dataLabels: { enabled: true, format: '{point.y}' },
        data: deptTop.map(([dept, total]) => ({ name: dept, y: total, drilldown: `cim23d:${hKey}:${idPart(dept)}` })),
      } as Highcharts.SeriesOptionsType);
      for (const [dept] of deptTop) {
        const catTop = topMap(deptCatMap[dept] ?? {}, 50);
        drillSeries.push({
          type: 'column',
          id: `cim23d:${hKey}:${idPart(dept)}`,
          name: `${e.hotel_code} ${dept} Categories`,
          custom: { xAxisTitle: 'Incident Category' },
          color: '#0E7470',
          dataLabels: { enabled: true, format: '{point.y}' },
          data: catTop.map(([cat, total]) => ({ name: cat, y: total, drilldown: `cim23c:${hKey}:${idPart(dept)}:${idPart(cat)}` })),
        } as Highcharts.SeriesOptionsType);
        for (const [cat] of catTop) {
          const rows = categoryItemRows(e.summary, cat).map(([item, total]) => ({ name: item, y: total }));
          drillSeries.push({
            type: 'column',
            id: `cim23c:${hKey}:${idPart(dept)}:${idPart(cat)}`,
            name: `${e.hotel_code} ${dept} ${cat} Items`,
            custom: { xAxisTitle: 'Incident Items' },
            color: '#1D4ED8',
            dataLabels: { enabled: true, format: '{point.y}' },
            data: rows.length > 0 ? rows : [{ name: 'No Items', y: 0 }],
          } as Highcharts.SeriesOptionsType);
        }
      }
    }
    return withDrilldownXAxisTitles(hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category', title: { text: 'Hotel' } },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      series: [{
        type: 'column',
        name: 'Incidents',
        color: '#0F766E',
        data: hotelSeries,
      }],
      drilldown: { series: drillSeries },
      tooltip: { shared: true },
    }), 'Hotel');
  }

  if (id === 'cim-24') {
    const hotelSeries = entries.map((e) => ({ name: e.hotel_code, y: e.summary.total, drilldown: `cim24h:${idPart(e.hotel_code)}` }));
    const drillSeries: Highcharts.SeriesOptionsType[] = [];
    for (const e of entries) {
      const hKey = idPart(e.hotel_code);
      const catTop = topMap(e.summary.category_map ?? {}, 50);
      const durMap = e.summary.im_item_duration_map ?? {};
      drillSeries.push({
        type: 'column',
        id: `cim24h:${hKey}`,
        name: `${e.hotel_code} Categories`,
        custom: { xAxisTitle: 'Incident Category' },
        color: '#C55A10',
        dataLabels: { enabled: true, format: '{point.y}' },
        data: catTop.map(([cat, total]) => ({ name: cat, y: total, drilldown: `cim24c:${hKey}:${idPart(cat)}` })),
      } as Highcharts.SeriesOptionsType);
      for (const [cat] of catTop) {
        const rows = categoryItemRows(e.summary, cat)
          .map(([item, total]) => ({ name: item, y: durMap[item] ?? total }))
          .sort((a, b) => b.y - a.y)
          .slice(0, 50);
        drillSeries.push({
          type: 'column',
          id: `cim24c:${hKey}:${idPart(cat)}`,
          name: `${e.hotel_code} ${cat} Avg Duration`,
          custom: { xAxisTitle: 'Incident Items' },
          color: '#0E7470',
          dataLabels: { enabled: true, format: '{point.y:.1f}' },
          data: rows.length > 0 ? rows : [{ name: 'No Items', y: 0 }],
        } as Highcharts.SeriesOptionsType);
      }
    }
    return withDrilldownXAxisTitles(hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category', title: { text: 'Hotel' } },
      yAxis: { title: { text: 'Incidents / Avg Completed Duration' }, min: 0 },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      series: [{
        type: 'column',
        name: 'Incidents',
        color: '#0F766E',
        data: hotelSeries,
      }],
      drilldown: { series: drillSeries },
      tooltip: { shared: true },
    }), 'Hotel');
  }

  if (id === 'cim-25') {
    const hotelSeries = entries.map((e) => ({ name: e.hotel_code, y: e.summary.total, drilldown: `cim25h:${idPart(e.hotel_code)}` }));
    const drillSeries: Highcharts.SeriesOptionsType[] = [];
    for (const e of entries) {
      const hKey = idPart(e.hotel_code);
      const hourMap = e.summary.im_hour_category_map ?? {};
      const hourCatItemMap = e.summary.im_hour_category_item_map ?? {};
      drillSeries.push({
        type: 'column',
        id: `cim25h:${hKey}`,
        name: `${e.hotel_code} 24 Hour Distribution`,
        custom: { xAxisTitle: '24 Hour Distribution' },
        color: '#C55A10',
        dataLabels: { enabled: true, format: '{point.y}' },
        data: Array.from({ length: 24 }, (_, hour) => {
          const h = String(hour);
          return { name: `${String(hour).padStart(2, '0')}:00`, y: Number((e.summary.im_hour_map ?? {})[h] ?? 0), drilldown: `cim25hr:${hKey}:${h}` };
        }),
      } as Highcharts.SeriesOptionsType);
      for (let hour = 0; hour < 24; hour++) {
        const h = String(hour);
        const catTop = topMap(hourMap[h] ?? {}, 50);
        drillSeries.push({
          type: 'column',
          id: `cim25hr:${hKey}:${h}`,
          name: `${e.hotel_code} ${String(hour).padStart(2, '0')}:00 Categories`,
          custom: { xAxisTitle: 'Incident Category' },
          color: '#0E7470',
          dataLabels: { enabled: true, format: '{point.y}' },
          data: catTop.map(([cat, total]) => ({ name: cat, y: total, drilldown: `cim25c:${hKey}:${h}:${idPart(cat)}` })),
        } as Highcharts.SeriesOptionsType);
        for (const [cat] of catTop) {
          const rows = topMap(hourCatItemMap?.[h]?.[cat] ?? {}, 50).map(([item, total]) => ({ name: item, y: total }));
          drillSeries.push({
            type: 'column',
            id: `cim25c:${hKey}:${h}:${idPart(cat)}`,
            name: `${e.hotel_code} ${String(hour).padStart(2, '0')}:00 ${cat} Items`,
            custom: { xAxisTitle: 'Incident Items' },
            color: '#1D4ED8',
            dataLabels: { enabled: true, format: '{point.y}' },
            data: rows.length > 0 ? rows : [{ name: 'No Items', y: 0 }],
          } as Highcharts.SeriesOptionsType);
        }
      }
    }
    return withDrilldownXAxisTitles(hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category', title: { text: 'Hotel' } },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      series: [{
        type: 'column',
        name: 'Incidents',
        color: '#0F766E',
        data: hotelSeries,
      }],
      drilldown: { series: drillSeries },
      tooltip: { shared: true },
    }), 'Hotel');
  }

  if (id === 'cim-26') {
    const hotelSeries = entries.map((e) => ({ name: e.hotel_code, y: e.summary.total, drilldown: `cim26h:${idPart(e.hotel_code)}` }));
    const drillSeries: Highcharts.SeriesOptionsType[] = [];
    for (const e of entries) {
      const hKey = idPart(e.hotel_code);
      const hourMap = e.summary.im_hour_dept_map ?? {};
      const hourDeptItemMap = e.summary.im_hour_dept_item_map ?? {};
      drillSeries.push({
        type: 'column',
        id: `cim26h:${hKey}`,
        name: `${e.hotel_code} 24 Hour Distribution`,
        custom: { xAxisTitle: '24 Hour Distribution' },
        color: '#C55A10',
        dataLabels: { enabled: true, format: '{point.y}' },
        data: Array.from({ length: 24 }, (_, hour) => {
          const h = String(hour);
          return { name: `${String(hour).padStart(2, '0')}:00`, y: Number((e.summary.im_hour_map ?? {})[h] ?? 0), drilldown: `cim26hr:${hKey}:${h}` };
        }),
      } as Highcharts.SeriesOptionsType);
      for (let hour = 0; hour < 24; hour++) {
        const h = String(hour);
        const deptTop = topMap(hourMap[h] ?? {}, 50);
        drillSeries.push({
          type: 'column',
          id: `cim26hr:${hKey}:${h}`,
          name: `${e.hotel_code} ${String(hour).padStart(2, '0')}:00 Departments`,
          custom: { xAxisTitle: 'Department' },
          color: '#0E7470',
          dataLabels: { enabled: true, format: '{point.y}' },
          data: deptTop.map(([dept, total]) => ({ name: dept, y: total, drilldown: `cim26d:${hKey}:${h}:${idPart(dept)}` })),
        } as Highcharts.SeriesOptionsType);
        for (const [dept] of deptTop) {
          const rows = topMap(hourDeptItemMap?.[h]?.[dept] ?? {}, 50).map(([item, total]) => ({ name: item, y: total }));
          drillSeries.push({
            type: 'column',
            id: `cim26d:${hKey}:${h}:${idPart(dept)}`,
            name: `${e.hotel_code} ${String(hour).padStart(2, '0')}:00 ${dept} Items`,
            custom: { xAxisTitle: 'Incident Items' },
            color: '#1D4ED8',
            dataLabels: { enabled: true, format: '{point.y}' },
            data: rows.length > 0 ? rows : [{ name: 'No Items', y: 0 }],
          } as Highcharts.SeriesOptionsType);
        }
      }
    }
    return withDrilldownXAxisTitles(hcOpts({
      chart: { type: 'column' },
      xAxis: { type: 'category', title: { text: 'Hotel' } },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      series: [{
        type: 'column',
        name: 'Incidents',
        color: '#0F766E',
        data: hotelSeries,
      }],
      drilldown: { series: drillSeries },
      tooltip: { shared: true },
    }), 'Hotel');
  }

  return undefined;
}

function buildCorpJoCharts(entries: ChainEntry[], worldMapData?: Record<string, unknown> | null): ChartDef[] {
  if (entries.length === 0) return [];
  const hotelCodes = entries.map((e) => e.hotel_code);
  const statusKeys = Array.from(new Set(entries.flatMap((e) => Object.keys(e.summary.status_map ?? {})))).sort();
  const allCategories: Record<string, number> = {};
  const allItems: Record<string, number> = {};
  const allDepts: Record<string, number> = {};
  const allAssignedDepts: Record<string, number> = {};
  const allCreatedByDepts: Record<string, number> = {};
  const allCompletedByDepts: Record<string, number> = {};
  const weeklyTotals: Record<string, number> = {};

  for (const entry of entries) {
    for (const [k, v] of Object.entries(entry.summary.category_map ?? {})) allCategories[k] = (allCategories[k] ?? 0) + Number(v);
    for (const [k, v] of Object.entries(entry.summary.item_map ?? {})) allItems[k] = (allItems[k] ?? 0) + Number(v);
    for (const [k, v] of Object.entries(entry.summary.dept_map ?? {})) allDepts[k] = (allDepts[k] ?? 0) + Number(v);
    for (const [k, v] of Object.entries(entry.summary.week_map ?? {})) weeklyTotals[k] = (weeklyTotals[k] ?? 0) + Number(v);
    const assignedMap = entry.summary.assigned_dept_map ?? {};
    for (const [k, v] of Object.entries(assignedMap)) allAssignedDepts[k] = (allAssignedDepts[k] ?? 0) + Number(v);
    const createdByMap = entry.summary.created_by_dept_map ?? {};
    for (const [k, v] of Object.entries(createdByMap)) allCreatedByDepts[k] = (allCreatedByDepts[k] ?? 0) + Number(v);
    const completedByMap = entry.summary.completed_by_dept_map ?? {};
    for (const [k, v] of Object.entries(completedByMap)) allCompletedByDepts[k] = (allCompletedByDepts[k] ?? 0) + Number(v);
  }

  const topCategories = topN(allCategories, 24).map(([k]) => k);
  const topItems = topN(allItems, 24).map(([k]) => k);
  const topDepts = topN(allDepts, 24).map(([k]) => k);
  const topAssigned = topN(allAssignedDepts, 24).map(([k]) => k);
  const topCreatedBy = topN(allCreatedByDepts, 24).map(([k]) => k);
  const topCompletedBy = topN(allCompletedByDepts, 24).map(([k]) => k);
  const weeks = Object.keys(weeklyTotals).sort();

  const make = (id: string, title: string, note: string, formula: string, options: Record<string, unknown>): ChartDef => ({
    id,
    title,
    note,
    formula,
    filterable: false,
    options,
  });

  const totalByHotel = entries.map((e) => e.summary.total ?? 0);
  const completionRate = entries.map((e) => getChainKpiValue(e, 'kpi_02') ?? (e.summary.total > 0 ? r1((e.summary.completed / e.summary.total) * 100) : 0));
  const slaRate = entries.map((e) => getChainKpiValue(e, 'kpi_03') ?? 0);
  const timeoutRate = entries.map((e) => getChainKpiValue(e, 'kpi_04') ?? (e.summary.total > 0 ? r1((e.summary.pending / e.summary.total) * 100) : 0));
  const escalationRate = entries.map((e) => getChainKpiValue(e, 'kpi_05') ?? (e.summary.total > 0 ? r1((e.summary.cancelled / e.summary.total) * 100) : 0));
  const reassignmentRate = entries.map((e) => getChainKpiValue(e, 'kpi_06') ?? 0);
  const avgResponse = entries.map((e) => getChainKpiValue(e, 'kpi_07') ?? 0);
  const p90Response = entries.map((e) => getChainKpiValue(e, 'kpi_08') ?? 0);
  const avgResolution = entries.map((e) => getChainKpiValue(e, 'kpi_09') ?? 0);
  const totalQuantity = entries.map((e) => getChainKpiValue(e, 'kpi_10') ?? 0);

  const weeklyCompletion = weeks.map((wk) => {
    const daySet = entries.flatMap((e) => (e.raw_daily ?? []).filter((d) => dateToWeekKey(d.date) === wk));
    const total = daySet.reduce((sum, d) => sum + d.total, 0);
    const completed = daySet.reduce((sum, d) => sum + d.completed, 0);
    return total > 0 ? r1((completed / total) * 100) : 0;
  });
  const weeklyTimeout = weeks.map((wk) => {
    const daySet = entries.flatMap((e) => (e.raw_daily ?? []).filter((d) => dateToWeekKey(d.date) === wk));
    const total = daySet.reduce((sum, d) => sum + d.total, 0);
    const pending = daySet.reduce((sum, d) => sum + d.pending, 0);
    return total > 0 ? r1((pending / total) * 100) : 0;
  });

  const charts: ChartDef[] = [
    make('cjo-01', 'Total Jobs by Hotel -> Top Service Category', 'Outer donut shows total JO volume by hotel. Click a hotel slice to drill into its top service categories.', 'COUNT(*) BY hotel_code, then TOP service_item_category BY hotel_code', {
      chart: { type: 'pie' },
      series: [{
        type: 'pie',
        name: 'Jobs',
        innerSize: '45%',
        data: entries.map((e) => ({ name: e.hotel_code, y: e.summary.total ?? 0, drilldown: `hotel-cat:${e.hotel_code}` })),
      }],
      drilldown: {
        series: entries.map((e) => ({
          id: `hotel-cat:${e.hotel_code}`,
          type: 'pie',
          name: `${e.hotel_code} Top Service Categories`,
          innerSize: '45%',
          data: topN(e.summary.category_map ?? {}, 24).map(([name, y]) => ({ name, y })),
        })),
      },
    }),
    make('cjo-02', '🟢 Hotel Job Volume → Job Status → 24-Hour Distribution',
      'Columns show total job volume per hotel. Click a hotel to drill into its job status breakdown, then click a status to see the 24-hour job distribution.',
      'COUNT(*) BY hotel_code; COUNT(*) BY job_status per hotel; COUNT(*) BY hour per status', (() => {
      const GREEN  = '#0F766E';
      const ORANGE = '#C2410C';
      const BLUE   = '#1D4ED8';
      const hours24 = Array.from({ length: 24 }, (_, i) => i);
      const hl = (h: number) => `${String(h).padStart(2, '0')}:00`;
      const sorted = [...entries].sort((a, b) => (b.summary.total ?? 0) - (a.summary.total ?? 0));
      const ddSeries: Highcharts.SeriesOptionsType[] = [];
      for (const e of sorted) {
        const statuses = Object.entries(e.summary.status_map ?? {}).sort(([, a], [, b]) => Number(b) - Number(a));
        const shm = (e.summary.jo_status_hour_map ?? {}) as Record<string, Record<string, number>>;
        ddSeries.push({
          id: `cjo02h:${e.hotel_code}`,
          type: 'column',
          name: `${e.hotel_code} — Job Status`,
          color: ORANGE,
          dataLabels: { enabled: true },
          data: statuses.map(([status, cnt]) => ({
            name: status,
            y: Number(cnt),
            drilldown: shm[status] ? `cjo02s:${e.hotel_code}:${status}` : undefined,
          })),
        } as Highcharts.SeriesOptionsType);
        for (const [status, hm] of Object.entries(shm)) {
          ddSeries.push({
            id: `cjo02s:${e.hotel_code}:${status}`,
            type: 'column',
            name: `${e.hotel_code} ${status} — 24-Hour`,
            color: BLUE,
            dataLabels: { enabled: true },
            data: hours24.map((h) => ({ name: hl(h), y: (hm as Record<string, number>)[String(h)] ?? 0 })),
          } as Highcharts.SeriesOptionsType);
        }
      }
      return {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Total Jobs' } },
        plotOptions: { column: { dataLabels: { enabled: true } } },
        series: [{
          type: 'column',
          name: 'Total Jobs',
          color: GREEN,
          dataLabels: { enabled: true },
          data: sorted.map((e) => ({ name: e.hotel_code, y: e.summary.total ?? 0, drilldown: `cjo02h:${e.hotel_code}` })),
        }],
        drilldown: { series: ddSeries },
      };
    })()),
    make('cjo-27', 'SLA Compliance by Hotel', 'Hotel-level SLA compliance comparison.', 'sla_compliant_completed / completed_jobs * 100 BY hotel_code', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, yAxis: { max: 100, title: { text: 'SLA %' } }, series: [{ type: 'column', name: 'SLA %', data: slaRate }],
    }),
    // cjo-07: Top Service Items → Daily Trend (chain aggregate, mirrors jo-11)
    make('cjo-07', '🟢 Top Service Items → Daily Trend (Chain)',
      'Ranks the most requested service items across all chain hotels. Click an item bar to see its daily job count trend.',
      'COUNT(*) by service_item (chain); drilldown: COUNT(*) by created_date', (() => {
      const GREEN  = '#0F766E';
      const ORANGE = '#C2410C';
      // Merge jo_item_date_map across all chain entries
      const mergedIdm: Record<string, Record<string, number>> = {};
      let hasIdm = false;
      for (const e of entries) {
        const idm = e.summary.jo_item_date_map as Record<string, Record<string, number>> | undefined;
        if (idm) {
          hasIdm = true;
          for (const [item, dm] of Object.entries(idm)) {
            if (!mergedIdm[item]) mergedIdm[item] = {};
            for (const [date, cnt] of Object.entries(dm)) {
              mergedIdm[item][date] = (mergedIdm[item][date] ?? 0) + cnt;
            }
          }
        }
      }
      // Compute top-10 items; fall back to item_map when no date map available
      const topItems: Array<[string, number]> = hasIdm
        ? Object.entries(mergedIdm)
            .map(([item, dm]): [string, number] => [item, Object.values(dm).reduce((a, c) => a + c, 0)])
            .sort(([, a], [, b]) => b - a).slice(0, 24)
        : (() => {
            const m: Record<string, number> = {};
            for (const e of entries) {
              for (const [item, cnt] of Object.entries(e.summary.item_map ?? {})) {
                m[item] = (m[item] ?? 0) + (cnt as number);
              }
            }
            return Object.entries(m).sort(([, a], [, b]) => b - a).slice(0, 24);
          })();
      const allDates = hasIdm
        ? Array.from(new Set(topItems.flatMap(([k]) => Object.keys(mergedIdm[k] ?? {})))).sort()
        : [];
      return {
        chart: { type: 'bar' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Total Jobs' } },
        series: [{
          type: 'bar', name: 'Total Jobs', color: GREEN,
          data: topItems.map(([k, v]) => ({ name: k, y: v, drilldown: hasIdm ? `cjo07d:${k}` : undefined })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { bar: { dataLabels: { enabled: true } } },
        ...(hasIdm && allDates.length > 0 ? {
          drilldown: {
            series: topItems.map(([k]) => ({
              id: `cjo07d:${k}`,
              name: `${k} — Daily Trend`,
              type: 'bar', color: ORANGE,
              dataLabels: { enabled: true },
              data: allDates.map((date) => ({ name: date, y: mergedIdm[k]?.[date] ?? 0 })),
            })),
          },
        } : {}),
      };
    })()),
    make('cjo-05', 'Escalation Rate by Hotel', 'Escalation comparison for service stability review.', 'escalated_jobs / total_jobs * 100 BY hotel_code', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, yAxis: { max: 100, title: { text: 'Escalation %' } }, series: [{ type: 'column', name: 'Escalation %', data: escalationRate }],
    }),
    make('cjo-06', 'Worldmap Job Order by Hotel', 'Country-level map with hotel labels for chain-wide JO visibility.', 'Country Value = SUM(total_jobs) GROUP BY country_code; Label = CONCAT(hotel_code, total_jobs) list per country', {
      chart: { type: 'map' },
      mapNavigation: { enabled: true },
      colorAxis: { min: 0, minColor: '#E6F4F1', maxColor: '#0E7470' },
      series: worldMapData ? [{
        type: 'map',
        name: 'Job Orders',
        mapData: worldMapData,
        data: Array.from(
          entries.reduce((acc, entry) => {
            const code = String(entry.country_code ?? '').trim().toUpperCase();
            if (!code) return acc;
            const prev = acc.get(code) ?? { total: 0, hotels: [] as string[] };
            prev.total += entry.summary.total ?? 0;
            prev.hotels.push(`${entry.hotel_code} ${entry.summary.total ?? 0}`);
            acc.set(code, prev);
            return acc;
          }, new Map<string, { total: number; hotels: string[] }>()),
        ).map(([code, agg]) => ({
          code,
          value: agg.total,
          custom: { hotels: agg.hotels.join(', '), countryCode: code },
        })),
        joinBy: ['iso-a2', 'code'],
        borderColor: '#B9A88A',
        nullColor: '#F4EEE4',
        states: { hover: { color: '#C55A10' } },
        dataLabels: {
          enabled: true,
          allowOverlap: false,
          crop: false,
          overflow: 'allow',
          padding: 2,
          useHTML: true,
          formatter: function (this: { point?: { options?: { custom?: { hotels?: string } }; series?: { chart?: { fullscreen?: { isOpen?: boolean } } } } }) {
            const hotels = this.point?.options?.custom?.hotels ?? '';
            const isFullscreen = this.point?.series?.chart?.fullscreen?.isOpen === true;
            const size = isFullscreen ? 16 : 8;
            return `<span style="font-size:${size}px;line-height:1.2;font-weight:700">${hotels}</span>`;
          },
          style: { fontSize: '8px', fontWeight: '600', textOutline: 'none' },
        },
        tooltip: {
          pointFormatter: function (this: Highcharts.Point) {
            const custom = (this as unknown as { custom?: { countryCode?: string; hotels?: string } }).custom;
            const value = (this as unknown as { value?: number }).value ?? 0;
            return `<b>${custom?.countryCode ?? ''}</b><br/>Jobs: ${value}<br/>${custom?.hotels ?? ''}`;
          },
        },
      }] : [],
    }),
    make('cjo-04', 'Timeout Rate by Hotel', 'Highlights hotels with higher timeout pressure.', 'timeout_jobs / total_jobs * 100 BY hotel_code', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, yAxis: { max: 100, title: { text: 'Timeout %' } }, series: [{ type: 'column', name: 'Timeout %', data: timeoutRate }],
    }),
    make('cjo-08', 'Avg Response Minutes by Hotel', 'Average create-to-acknowledge latency by hotel.', 'AVG(response_min) BY hotel_code', {
      chart: { type: 'bar' }, xAxis: { categories: hotelCodes }, series: [{ type: 'bar', name: 'Avg Response (min)', data: avgResponse }],
    }),
    make('cjo-09', 'P90 Response Minutes by Hotel', 'Tail response time comparison by hotel.', 'P90(response_min) BY hotel_code', {
      chart: { type: 'bar' }, xAxis: { categories: hotelCodes }, series: [{ type: 'bar', name: 'P90 Response (min)', data: p90Response }],
    }),
    make('cjo-10', 'Avg Resolution Minutes by Hotel', 'Average create-to-complete duration by hotel.', 'AVG(resolution_min) BY hotel_code', {
      chart: { type: 'bar' }, xAxis: { categories: hotelCodes }, series: [{ type: 'bar', name: 'Avg Resolution (min)', data: avgResolution }],
    }),
    make('cjo-11', 'Total Quantity by Hotel', 'Compares requested quantity load across hotels.', 'SUM(quantity) BY hotel_code', {
      chart: { type: 'bar' }, xAxis: { categories: hotelCodes }, series: [{ type: 'bar', name: 'Total Quantity', data: totalQuantity }],
    }),
    // cjo-12: Delayed Status by Hotel → 24-Hour Delayed Job Distribution
    make('cjo-12', 'Delayed Status by Hotel → 24-Hour Delayed Job Distribution', 'Delayed job count (delay_duration > 0) per hotel. Click a hotel bar to see its 24-hour delayed job distribution.', 'COUNT(delay > 0) BY hotel_code; drilldown: COUNT(*) BY created_hour', (() => {
      const GREEN  = '#0F766E';
      const ORANGE = '#C2410C';
      const hours24 = Array.from({ length: 24 }, (_, i) => i);
      // derive per-hotel hour→count from jo_overdue_cat_hour_map (available in stored summaries)
      const getDelayHourMap = (e: typeof entries[0]): Record<string, number> => {
        const catMap = e.summary.jo_overdue_cat_hour_map ?? {};
        const result: Record<string, number> = {};
        for (const hm of Object.values(catMap)) {
          for (const [h, v] of Object.entries(hm)) {
            result[h] = (result[h] ?? 0) + (v as number);
          }
        }
        return result;
      };
      const delayedPerHotel = entries.map((e) => Object.values(getDelayHourMap(e)).reduce((s, v) => s + v, 0));
      return {
        chart: { type: 'column' },
        xAxis: { categories: hotelCodes },
        yAxis: { min: 0, title: { text: 'Delayed Jobs' } },
        series: [{
          type: 'column', name: 'Delayed Jobs', color: GREEN,
          data: entries.map((e, i) => ({ name: e.hotel_code, y: delayedPerHotel[i], drilldown: `cjo12:${e.hotel_code}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: entries.map((e) => {
            const hm = getDelayHourMap(e);
            return {
              id: `cjo12:${e.hotel_code}`,
              name: `${e.hotel_code} — Delayed by Hour`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: hours24.map((h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: hm[String(h)] ?? 0 })),
            };
          }),
        },
      };
    })()),
    make('cjo-13', 'Completed Status by Hotel → 24-Hour Completed Job Distribution', 'Completed job count per hotel. Click a bar to see its 24-hour completed job distribution.', '', (() => {
      const GREEN  = '#0F766E';
      const ORANGE = '#C2410C';
      const hours24 = Array.from({ length: 24 }, (_, i) => i);
      const compPerHotel = entries.map((e) => {
        const hm = e.summary.jo_hour_comp_map ?? {};
        return Object.values(hm).reduce((s, v) => s + (v as number), 0);
      });
      return {
        chart: { type: 'column' },
        xAxis: { categories: hotelCodes },
        yAxis: { min: 0, title: { text: 'Completed Jobs' } },
        series: [{ type: 'column', name: 'Completed Jobs', color: GREEN,
          data: entries.map((e, i) => ({ name: e.hotel_code, y: compPerHotel[i], drilldown: `cjo13:${e.hotel_code}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: entries.map((e) => {
            const hm = e.summary.jo_hour_comp_map ?? {};
            return {
              id: `cjo13:${e.hotel_code}`,
              name: `${e.hotel_code} — Completed by Hour`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: hours24.map((h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: (hm[String(h)] ?? 0) as number })),
            };
          }),
        },
      };
    })()),
    make('cjo-14', 'Timeout Status by Hotel → 24-Hour Timeout Job Distribution', 'Timeout job count per hotel. Click a bar to see its 24-hour timeout job distribution.', '', (() => {
      const GREEN  = '#0F766E';
      const ORANGE = '#C2410C';
      const hours24 = Array.from({ length: 24 }, (_, i) => i);
      // derive per-hotel hour→count from jo_status_hour_map (timeout statuses)
      const getTimeoutHourMap = (e: typeof entries[0]): Record<string, number> => {
        const sm = e.summary.jo_status_hour_map ?? {};
        const result: Record<string, number> = {};
        for (const [status, hm] of Object.entries(sm)) {
          if (status.toLowerCase().includes('timeout')) {
            for (const [h, v] of Object.entries(hm)) {
              result[h] = (result[h] ?? 0) + (v as number);
            }
          }
        }
        return result;
      };
      const timeoutPerHotel = entries.map((e) => Object.values(getTimeoutHourMap(e)).reduce((s, v) => s + v, 0));
      return {
        chart: { type: 'column' },
        xAxis: { categories: hotelCodes },
        yAxis: { min: 0, title: { text: 'Timeout Jobs' } },
        series: [{ type: 'column', name: 'Timeout Jobs', color: GREEN,
          data: entries.map((e, i) => ({ name: e.hotel_code, y: timeoutPerHotel[i], drilldown: `cjo14:${e.hotel_code}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: entries.map((e) => {
            const hm = getTimeoutHourMap(e);
            return {
              id: `cjo14:${e.hotel_code}`,
              name: `${e.hotel_code} — Timeout by Hour`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: hours24.map((h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: hm[String(h)] ?? 0 })),
            };
          }),
        },
      };
    })()),
    make('cjo-15', '🟢 Hotel Job Volume → Job Status → Completed Duration Distribution',
      'Columns show total job volume per hotel. Click a hotel to drill into its job status breakdown, then click a status to see the completion duration distribution.',
      'COUNT(*) BY hotel_code; COUNT(*) BY job_status per hotel; COUNT(*) BY dur_bucket per status', (() => {
      const GREEN  = '#0F766E';
      const ORANGE = '#C2410C';
      const BLUE   = '#1D4ED8';
      const DUR_ORDER = ['< 15 min', '15–30 min', '30–60 min', '1–2 h', '2–4 h', '4–8 h', '8+ h'];
      const sorted = [...entries].sort((a, b) => (b.summary.total ?? 0) - (a.summary.total ?? 0));
      const ddSeries: Highcharts.SeriesOptionsType[] = [];
      for (const e of sorted) {
        const statuses = Object.entries(e.summary.status_map ?? {}).sort(([, a], [, b]) => Number(b) - Number(a));
        const sdm = (e.summary.jo_status_dur_bkt_map ?? {}) as Record<string, Record<string, number>>;
        ddSeries.push({
          id: `cjo15h:${e.hotel_code}`,
          type: 'column',
          name: `${e.hotel_code} — Job Status`,
          color: ORANGE,
          dataLabels: { enabled: true },
          data: statuses.map(([status, cnt]) => ({
            name: status,
            y: Number(cnt),
            drilldown: sdm[status] ? `cjo15s:${e.hotel_code}:${status}` : undefined,
          })),
        } as Highcharts.SeriesOptionsType);
        for (const [status, bktMap] of Object.entries(sdm)) {
          ddSeries.push({
            id: `cjo15s:${e.hotel_code}:${status}`,
            type: 'column',
            name: `${e.hotel_code} ${status} — Duration`,
            color: BLUE,
            dataLabels: { enabled: true },
            data: DUR_ORDER.map((bkt) => ({ name: bkt, y: (bktMap as Record<string, number>)[bkt] ?? 0 })),
          } as Highcharts.SeriesOptionsType);
        }
      }
      return {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Total Jobs' } },
        plotOptions: { column: { dataLabels: { enabled: true } } },
        series: [{
          type: 'column',
          name: 'Total Jobs',
          color: GREEN,
          dataLabels: { enabled: true },
          data: sorted.map((e) => ({ name: e.hotel_code, y: e.summary.total ?? 0, drilldown: `cjo15h:${e.hotel_code}` })),
        }],
        drilldown: { series: ddSeries },
      };
    })()),
    make('cjo-16', 'Top Service Categories by Hotel', 'Compares top JO categories across hotels.', 'COUNT(*) BY hotel_code, service_item_category', {
      chart: { type: 'bar' }, xAxis: { categories: hotelCodes }, plotOptions: { bar: { stacking: 'normal' } }, series: topCategories.map((cat) => ({ type: 'bar', name: cat, data: entries.map((e) => e.summary.category_map?.[cat] ?? 0) })),
    }),
    make('cjo-17', 'Top Service Items by Hotel', 'Compares top JO items across hotels.', 'COUNT(*) BY hotel_code, service_item', {
      chart: { type: 'bar' }, xAxis: { categories: hotelCodes }, plotOptions: { bar: { stacking: 'normal' } }, series: topItems.slice(0, 24).map((item) => ({ type: 'bar', name: item, data: entries.map((e) => e.summary.item_map?.[item] ?? 0) })),
    }),
    make('cjo-18', 'Department Load by Hotel', 'Department-origin JO load by hotel.', 'COUNT(*) BY hotel_code, department_name', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, plotOptions: { column: { stacking: 'normal' } }, series: topDepts.slice(0, 24).map((dept) => ({ type: 'column', name: dept, data: entries.map((e) => e.summary.dept_map?.[dept] ?? 0) })),
    }),
    make('cjo-19', 'Assigned Department Load by Hotel', 'Assigned department comparison across hotels.', 'COUNT(*) BY hotel_code, assigned_to_department', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, plotOptions: { column: { stacking: 'normal' } }, series: topAssigned.slice(0, 24).map((dept) => ({ type: 'column', name: dept, data: entries.map((e) => e.summary.assigned_dept_map?.[dept] ?? 0) })),
    }),
    make('cjo-20', 'Created By Department Demand by Hotel', 'Source department demand comparison across hotels.', 'COUNT(*) BY hotel_code, created_by_department', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, plotOptions: { column: { stacking: 'normal' } }, series: topCreatedBy.slice(0, 24).map((dept) => ({ type: 'column', name: dept, data: entries.map((e) => e.summary.created_by_dept_map?.[dept] ?? 0) })),
    }),
    make('cjo-21', 'Completed By Department Throughput by Hotel', 'Completion ownership comparison across hotels.', 'COUNT(*) BY hotel_code, completed_by_department', {
      chart: { type: 'column' }, xAxis: { categories: hotelCodes }, plotOptions: { column: { stacking: 'normal' } }, series: topCompletedBy.slice(0, 24).map((dept) => ({ type: 'column', name: dept, data: entries.map((e) => e.summary.completed_by_dept_map?.[dept] ?? 0) })),
    }),
    // cjo-22: 24-Hour VIP Jobs distribution → Top Service Items
    make('cjo-22', '24-Hour VIP Jobs Distribution → Top Service Items', 'VIP job volume by hour of day across the chain. Click a bar to drill into the top service items requested by VIP guests at that hour.', 'COUNT(*) WHERE is_vip BY created_hour; drilldown: COUNT(*) BY service_item', (() => {
      const GREEN  = '#0F766E'; // deep teal — primary bars
      const ORANGE = '#C2410C'; // burnt orange — drilldown bars
      const hours24 = Array.from({ length: 24 }, (_, i) => i);
      const hourLabels = hours24.map((h) => `${String(h).padStart(2, '0')}:00`);

      // Aggregate VIP-only hour→item maps across all chain hotels
      const chainHourItem: Record<number, Record<string, number>> = {};
      for (const e of entries) {
        const hourItemMap = e.summary.jo_vip_hour_item_map ?? {};
        for (const [hStr, itemMap] of Object.entries(hourItemMap)) {
          const h = Number(hStr);
          if (!chainHourItem[h]) chainHourItem[h] = {};
          for (const [itm, cnt] of Object.entries(itemMap)) {
            chainHourItem[h][itm] = (chainHourItem[h][itm] ?? 0) + cnt;
          }
        }
      }

      return {
        chart: { type: 'column' },
        // type:'category' lets both levels use point.name as the x-axis label —
        // avoids the parent hourLabels array bleeding into the drilldown view.
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'VIP Jobs' } },
        series: [{ type: 'column', name: 'VIP Jobs', color: GREEN,
          data: hours24.map((h) => ({
            name: hourLabels[h],   // "00:00" … "23:00"
            y: Object.values(chainHourItem[h] ?? {}).reduce((s, v) => s + v, 0),
            drilldown: `cjo22h:${h}`,
          })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: hours24.map((h) => {
            const topItems = Object.entries(chainHourItem[h] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 24);
            return {
              id: `cjo22h:${h}`,
              name: `${String(h).padStart(2, '0')}:00 — Top Service Items (VIP)`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              // {name, y} format → Highcharts uses name as x-axis category label
              data: topItems.map(([itm, cnt]) => ({ name: itm, y: cnt })),
            };
          }),
        },
      };
    })()),
    // ── cjo-23..26: 24-hour primary bar → drilldown per hour ──────────────────
    ...(() => {
      const GREEN  = '#0F766E'; // deep teal — primary bars
      const ORANGE = '#C2410C'; // burnt orange — drilldown bars
      const DUR = ['< 15 min', '15–30 min', '30–60 min', '1–2 h', '2–4 h', '4–8 h', '8+ h'] as const;
      const hours24 = Array.from({ length: 24 }, (_, i) => i);

      // ── Aggregate each hour-level map chain-wide ───────────────────────────
      function sumHour(key: keyof typeof entries[0]['summary']): Record<number, number> {
        const out: Record<number, number> = {};
        for (const e of entries) {
          const m = e.summary[key] as Record<string, number> | undefined ?? {};
          for (const [h, v] of Object.entries(m)) out[+h] = (out[+h] ?? 0) + (v as number);
        }
        return out;
      }
      function sumHourBkt(key: keyof typeof entries[0]['summary']): Record<number, Record<string, number>> {
        const out: Record<number, Record<string, number>> = {};
        for (const e of entries) {
          const m = e.summary[key] as Record<string, Record<string, number>> | undefined ?? {};
          for (const [h, inner] of Object.entries(m)) {
            if (!out[+h]) out[+h] = {};
            for (const [bkt, cnt] of Object.entries(inner)) out[+h][bkt] = (out[+h][bkt] ?? 0) + cnt;
          }
        }
        return out;
      }

      const chainCompH    = sumHour('jo_hour_comp_map');
      const chainCompBkt  = sumHourBkt('jo_hour_comp_bkt_map');
      const chainRespBkt  = sumHourBkt('jo_hour_resp_bkt_map');
      const chainEscH     = sumHour('jo_hour_esc_map');
      const chainEscBkt   = sumHourBkt('jo_hour_esc_bkt_map');
      const chainSlaTot   = sumHour('jo_hour_sla_total_map');
      const chainSlaComp  = sumHour('jo_hour_sla_comp_map');
      const chainCatTot   = sumHourBkt('jo_hour_sla_cat_total_map');
      const chainCatComp  = sumHourBkt('jo_hour_sla_cat_comp_map');

      const mkHourData = (vals: Record<number, number>, id: string) =>
        hours24.map((h) => ({
          name: `${String(h).padStart(2, '0')}:00`,
          y: vals[h] ?? 0,
          drilldown: `${id}:${h}`,
        }));

      // cjo-23: 24-Hour Completed Jobs → Completion Duration Range distribution
      const cjo23 = make('cjo-23', '24-Hour Completed Jobs → Completion Duration Range', 'Completed job volume by hour across the chain. Click a bar to see the completion duration (mins) range distribution for that hour.', 'COUNT(completed) BY created_hour; drilldown: COUNT(*) BY duration_bucket', {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Completed Jobs' } },
        series: [{ type: 'column', name: 'Completed Jobs', color: GREEN,
          data: mkHourData(chainCompH, 'cjo23h'),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: hours24.map((h) => ({
            id: `cjo23h:${h}`,
            name: `${String(h).padStart(2, '0')}:00 — Completion Duration`,
            type: 'column', color: ORANGE,
            dataLabels: { enabled: true },
            data: DUR.map((b) => ({ name: b, y: chainCompBkt[h]?.[b] ?? 0 })),
          })),
        },
      });

      // cjo-24: 24-Hour Acknowledged Jobs → Response Time distribution
      const cjo24 = make('cjo-24', '24-Hour Acknowledged Jobs → Response Time Distribution', 'Acknowledged job volume by hour across the chain. Click a bar to see the response time (mins) range distribution for that hour.', 'COUNT(acknowledged) BY created_hour; drilldown: COUNT(*) BY response_bucket', {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Acknowledged Jobs' } },
        series: [{ type: 'column', name: 'Acknowledged Jobs', color: GREEN,
          data: hours24.map((h) => ({
            name: `${String(h).padStart(2, '0')}:00`,
            y: Object.values(chainRespBkt[h] ?? {}).reduce((s, v) => s + v, 0),
            drilldown: `cjo24h:${h}`,
          })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: hours24.map((h) => ({
            id: `cjo24h:${h}`,
            name: `${String(h).padStart(2, '0')}:00 — Response Time`,
            type: 'column', color: ORANGE,
            dataLabels: { enabled: true },
            data: DUR.map((b) => ({ name: b, y: chainRespBkt[h]?.[b] ?? 0 })),
          })),
        },
      });

      // cjo-25: 24-Hour Escalated Jobs → Overdue Duration distribution
      const cjo25 = make('cjo-25', '24-Hour Escalated Jobs → Overdue Duration Distribution', 'Escalated job volume by hour across the chain. Click a bar to see the overdue duration (mins) range distribution for that hour.', 'COUNT(escalated) BY created_hour; drilldown: COUNT(*) BY overdue_bucket', {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Escalated Jobs' } },
        series: [{ type: 'column', name: 'Escalated Jobs', color: GREEN,
          data: mkHourData(chainEscH, 'cjo25h'),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: hours24.map((h) => ({
            id: `cjo25h:${h}`,
            name: `${String(h).padStart(2, '0')}:00 — Overdue Duration`,
            type: 'column', color: ORANGE,
            dataLabels: { enabled: true },
            data: DUR.map((b) => ({ name: b, y: chainEscBkt[h]?.[b] ?? 0 })),
          })),
        },
      });

      // cjo-26: 24-Hour Jobs Distribution → Top Item Category
      const cjo26 = make('cjo-26', '24-Hour Jobs Distribution → Top Item Category', 'Total job volume by hour across the chain. Click a bar to see the top service item categories for that hour.', 'COUNT(*) BY created_hour; drilldown: COUNT(*) BY service_item_category', {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Jobs' } },
        series: [{ type: 'column', name: 'Jobs', color: GREEN,
          data: hours24.map((h) => ({
            name: `${String(h).padStart(2, '0')}:00`,
            y: chainSlaTot[h] ?? 0,
            drilldown: `cjo26h:${h}`,
          })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: hours24.map((h) => {
            const catTot = chainCatTot[h] ?? {};
            const cats = Object.keys(catTot).sort((a, b) => (catTot[b] ?? 0) - (catTot[a] ?? 0));
            return {
              id: `cjo26h:${h}`,
              name: `${String(h).padStart(2, '0')}:00 — Top Item Category`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: cats.map((cat) => ({ name: cat, y: catTot[cat] ?? 0 })),
            };
          }),
        },
      });

      // cjo-27: Hotel Jobs → 24-Hour Distribution → Top 10 Service Items (3-level)
      const sortedForCjo27 = [...entries].sort((a, b) => (b.summary.total ?? 0) - (a.summary.total ?? 0));
      const cjo27DdSeries: Highcharts.SeriesOptionsType[] = [];
      for (const e of sortedForCjo27) {
        const him = (e.summary.jo_hour_item_map ?? {}) as Record<string, Record<string, number>>;
        // Level 1: 24-hour distribution for this hotel
        cjo27DdSeries.push({
          id: `cjo27e:${e.hotel_code}`,
          type: 'column',
          name: `${e.hotel_code} — 24-Hour`,
          color: ORANGE,
          dataLabels: { enabled: true },
          data: hours24.map((h) => ({
            name: `${String(h).padStart(2, '0')}:00`,
            y: Object.values((him[String(h)] ?? {})).reduce((a, b) => a + b, 0),
            drilldown: `cjo27i:${e.hotel_code}:${h}`,
          })),
        } as Highcharts.SeriesOptionsType);
        // Level 2: Top 10 service items for each hour of this hotel
        for (const h of hours24) {
          const im = him[String(h)] ?? {};
          const top10 = Object.entries(im).sort(([, a], [, b]) => b - a).slice(0, 24);
          if (top10.length === 0) continue;
          cjo27DdSeries.push({
            id: `cjo27i:${e.hotel_code}:${h}`,
            type: 'column',
            name: `${e.hotel_code} ${String(h).padStart(2, '0')}:00 — Items`,
            color: '#1D4ED8',
            dataLabels: { enabled: true },
            data: top10.map(([item, cnt]) => ({ name: item, y: cnt })),
          } as Highcharts.SeriesOptionsType);
        }
      }
      const cjo27 = make('cjo-03', '🟢 Hotel Jobs → 24-Hour Distribution → Top 10 Service Items', 'Columns show total jobs per hotel. Click a hotel to drill into its 24-hour job distribution, then click an hour to see the top 10 service items for that hour.', 'COUNT(*) BY hotel_code; drilldown: COUNT(*) BY created_hour; drilldown: TOP 10 COUNT(*) BY service_item', {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Jobs' } },
        series: [{ type: 'column', name: 'Jobs', color: GREEN,
          data: sortedForCjo27.map((e) => ({ name: e.hotel_code, y: e.summary.total ?? 0, drilldown: `cjo27e:${e.hotel_code}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: { series: cjo27DdSeries },
      });

      // cjo-28: Overdue Jobs by Item Category → 24-Hour distribution
      // (escalation_group is empty in this data; group overdue jobs by item category instead)
      const chainOverdueCatHour: Record<string, Record<number, number>> = {};
      for (const e of entries) {
        const m = e.summary.jo_overdue_cat_hour_map ?? {};
        for (const [c, hm] of Object.entries(m)) {
          if (!chainOverdueCatHour[c]) chainOverdueCatHour[c] = {};
          for (const [h, v] of Object.entries(hm)) chainOverdueCatHour[c][+h] = (chainOverdueCatHour[c][+h] ?? 0) + v;
        }
      }
      const cjo28 = make('cjo-28', 'Overdue Jobs by Item Category → 24-Hour Jobs Distribution', 'Overdue job count (delay > 0) by service item category across the chain. Click a category bar to see its 24-hour distribution.', 'COUNT(delay > 0) BY service_item_category; drilldown: COUNT(*) BY created_hour', {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Overdue Jobs' } },
        series: [{ type: 'column', name: 'Overdue Jobs', color: GREEN,
          data: Object.entries(chainOverdueCatHour)
            .map(([c, hm]) => ({ name: c, y: Object.values(hm).reduce((a, b) => a + b, 0), drilldown: `cjo28:${c}` }))
            .sort((a, b) => b.y - a.y),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: Object.entries(chainOverdueCatHour).map(([c, hm]) => ({
            id: `cjo28:${c}`,
            name: `${c} — 24-Hour Distribution`,
            type: 'column', color: ORANGE,
            dataLabels: { enabled: true },
            data: hours24.map((h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: hm[h] ?? 0 })),
          })),
        },
      });

      return [cjo23, cjo24, cjo25, cjo26, cjo27, cjo28];
    })(),
  ];
  // Swap display positions of cjo-03 and cjo-27 (chart contents live in opposite slots)
  const i03 = charts.findIndex((c) => c.id === 'cjo-03');
  const i27 = charts.findIndex((c) => c.id === 'cjo-27');
  if (i03 >= 0 && i27 >= 0) {
    const tmp = charts[i03];
    charts[i03] = charts[i27];
    charts[i27] = tmp;
  }
  return charts;
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionHead({ label, dark }: { label: string; dark: boolean }) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  return (
    <div className="print-section-head flex items-center gap-4 mb-3">
      <span
        className="font-mono uppercase shrink-0"
        style={{
          fontSize:      '0.625rem',
          letterSpacing: '0.18em',
          color: tokens.dashboard.sectionLabel,
        }}
      >
        {label}
      </span>
      <div
        className="flex-1 h-px"
        style={{ background: tokens.dashboard.sectionRule }}
        aria-hidden
      />
    </div>
  );
}

function CorpJoPerformanceTable({
  entries,
  dark,
  index,
}: {
  entries: ChainEntry[];
  dark: boolean;
  index: number;
}) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const rows = [...entries]
    .sort((a, b) => a.hotel_code.localeCompare(b.hotel_code))
    .map((entry) => ({
      hotel: entry.hotel_code,
      jobs: entry.summary.total ?? 0,
      completion: getChainKpiValue(entry, 'kpi_02') ?? (entry.summary.total > 0 ? r1((entry.summary.completed / entry.summary.total) * 100) : 0),
      sla: getChainKpiValue(entry, 'kpi_03') ?? 0,
      timeout: getChainKpiValue(entry, 'kpi_04') ?? (entry.summary.total > 0 ? r1((entry.summary.pending / entry.summary.total) * 100) : 0),
      escalation: getChainKpiValue(entry, 'kpi_05') ?? (entry.summary.total > 0 ? r1((entry.summary.cancelled / entry.summary.total) * 100) : 0),
      response: getChainKpiValue(entry, 'kpi_07') ?? 0,
      resolution: getChainKpiValue(entry, 'kpi_09') ?? 0,
    }));

  const cardBg = tokens.chart.cardBg;
  const cardBorder = tokens.chart.cardBorder;
  const accent = tokens.chart.cardAccent;
  const titleText = tokens.chart.titleText;
  const codeBg = tokens.chart.codeBg;
  const rule = tokens.chart.footerBorder;
  const muted = tokens.chart.footerMuted;
  const headBg = tokens.dashboard.toolbarBg;

  return (
    <div
      className="chart-card flex flex-col overflow-hidden md:col-span-2"
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: '12px',
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-3 shrink-0">
        <h3
          className="font-serif font-semibold leading-snug flex items-center gap-2"
          style={{ fontSize: '0.9rem', color: titleText }}
        >
          <span
            className="font-mono shrink-0"
            style={{
              fontSize: '0.62rem',
              letterSpacing: '0.04em',
              fontWeight: 700,
              color: accent,
              background: codeBg,
              border: `1px solid ${accent}40`,
              padding: '1px 5px',
              lineHeight: 1.4,
            }}
          >
            {String(index).padStart(2, '0')}
          </span>
          Hotel Performance
        </h3>
      </div>

      <div className="px-4 pb-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Hotel', 'Jobs', 'Completion %', 'SLA %', 'Timeout %', 'Escalation %', 'Avg Response', 'Avg Resolution'].map((label) => (
                <th
                  key={label}
                  className="text-left font-mono"
                  style={{
                    fontSize: '0.62rem',
                    letterSpacing: '0.06em',
                    color: muted,
                    background: headBg,
                    borderBottom: `1px solid ${rule}`,
                    padding: '8px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hotel}>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.78rem', fontWeight: 700 }}>{row.hotel}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.jobs.toLocaleString()}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{r1(row.completion).toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{r1(row.sla).toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{r1(row.timeout).toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{r1(row.escalation).toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{r2(row.response).toFixed(2)}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{r2(row.resolution).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="px-4 pt-2.5 pb-3.5 space-y-1 shrink-0"
        style={{ borderTop: `1px solid ${rule}` }}
      >
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Note</span>
          {' '}Executive hotel-level JO performance table for cross-hotel operational benchmarking.
        </p>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Formula</span>
          {' '}
          <code
            className="font-mono"
            style={{ fontSize: '0.6rem', padding: '1px 5px', background: codeBg, color: accent, borderRadius: '2px' }}
          >
            GROUP BY hotel_code with JO KPI aggregates and hotel-level response/resolution metrics
          </code>
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function buildCorpMoKpis(summary: HotelSummary): KpiDef[] {
  const total = summary.total ?? 0;
  const completed = summary.completed ?? 0;
  const cancelled = summary.cancelled ?? 0;
  const open = Math.max(total - completed - cancelled, 0);
  const completionRate = total > 0 ? (completed / total) * 100 : 0;
  const openRate = total > 0 ? (open / total) * 100 : 0;
  const cancelledRate = total > 0 ? (cancelled / total) * 100 : 0;
  const guestShare = total > 0 ? ((summary.vip_total ?? 0) / total) * 100 : 0;
  const severityIndex = total > 0 ? (summary.severity_sum ?? 0) / total : 0;
  const topCategory = topN(summary.category_map ?? {}, 1)[0];
  const topCategoryShare = total > 0 ? ((topCategory?.[1] ?? 0) / total) * 100 : 0;
  const activeCategories = Object.keys(summary.category_map ?? {}).length;
  const touchedAssets = Object.keys(summary.item_map ?? {}).length;
  const activeWeeks = Math.max(1, Object.keys(summary.week_map ?? {}).length);
  const dailyAverage = total / activeWeeks / 7;

  return decorateBenchmarkLabels([
    { id: 'cmo_kpi_01', label: 'Total Work Orders', value: total, unit: 'orders', fmt: 'integer', available: true, note: 'Total MO work orders across all hotels in the chain.', formula: 'COUNT(*) WHERE type = MO GROUP BY chain', benchmark: moBenchmarkFor('cmo_kpi_01') },
    { id: 'cmo_kpi_02', label: 'Completion Rate', value: r1(completionRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of MO orders completed across the chain.', formula: 'completed / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_02') },
    { id: 'cmo_kpi_03', label: 'Open Work Order Rate', value: r1(openRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of MO orders still open across the chain.', formula: 'open / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_03') },
    { id: 'cmo_kpi_04', label: 'Cancelled Order Rate', value: r1(cancelledRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of MO orders cancelled across the chain.', formula: 'cancelled / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_04') },
    { id: 'cmo_kpi_05', label: 'Guest Related Share', value: r1(guestShare), unit: '%', fmt: 'pct1', available: true, note: 'Share of guest-related MO orders across the chain.', formula: 'guest_related_orders / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_05') },
    { id: 'cmo_kpi_06', label: 'Severity Index', value: r2(severityIndex), unit: 'pts', fmt: 'decimal2', available: true, note: 'Average severity proxy across chain work orders.', formula: 'AVG(severity_weight) WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_06') },
    { id: 'cmo_kpi_07', label: 'Top Category Share', value: r1(topCategoryShare), unit: '%', fmt: 'pct1', available: true, note: 'Share contributed by the largest maintenance category.', formula: 'MAX(category_count) / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_07') },
    { id: 'cmo_kpi_08', label: 'Active Categories', value: activeCategories, unit: 'cats', fmt: 'integer', available: true, note: 'Distinct maintenance categories active across the chain.', formula: 'COUNT(DISTINCT category) WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_08') },
    { id: 'cmo_kpi_09', label: 'Touched Assets', value: touchedAssets, unit: 'items', fmt: 'integer', available: true, note: 'Distinct defect or asset combinations touched across the chain.', formula: 'COUNT(DISTINCT defect_or_asset) WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_09') },
    { id: 'cmo_kpi_10', label: 'Daily Average Orders', value: r2(dailyAverage), unit: 'orders', fmt: 'decimal2', available: true, note: 'Average daily MO volume across the selected period.', formula: 'COUNT(*) / active_days WHERE type = MO', benchmark: moBenchmarkFor('cmo_kpi_10') },
  ]);
}

function buildCorpMoCharts(entries: ChainEntry[], worldMapData?: Record<string, unknown> | null): ChartDef[] {
  if (entries.length === 0) return [];
  const hotelCodes = entries.map((e) => e.hotel_code);
  const topCategories = topN(mergeRecords(entries.map((e) => e.summary.category_map ?? {})), 24).map(([k]) => k);
  const topItems = topN(mergeRecords(entries.map((e) => e.summary.item_map ?? {})), 24);
  const allLocations = topN(
    mergeRecords(entries.map((e) => e.summary.location_map ?? {})),
    24,
  ).map(([k]) => k);
  const statusKeys = Array.from(new Set(entries.flatMap((e) => Object.keys(e.summary.status_map ?? {})))).sort();
  const allDates = Array.from(new Set(entries.flatMap((e) => (e.raw_daily ?? []).map((d) => d.date)))).sort();

  const make = (id: string, title: string, note: string, formula: string, options: Record<string, unknown>): ChartDef => ({
    id,
    title,
    note,
    formula,
    filterable: false,
    options,
  });

  return [
    make('cmo-01', 'Total Work Orders by Hotel -> Top Category', 'Outer donut shows total MO work orders by hotel. Click a hotel slice to drill into its top maintenance categories.', 'COUNT(*) BY hotel_code, then TOP category BY hotel_code WHERE type = MO', {
      chart: { type: 'pie' },
      series: [{ type: 'pie', innerSize: '45%', name: 'Orders', data: entries.map((e) => ({ name: e.hotel_code, y: e.summary.total ?? 0, drilldown: `cmo-cat:${e.hotel_code}` })) }],
      drilldown: { series: entries.map((e) => ({ id: `cmo-cat:${e.hotel_code}`, type: 'pie', innerSize: '45%', name: `${e.hotel_code} Top Categories`, data: topN(e.summary.category_map ?? {}, 24).map(([name, y]) => ({ name, y })) })) },
    }),
    make('cmo-02', 'Total Work Orders by Hotel -> Job Status', 'Outer donut shows total MO work orders by hotel. Click a hotel slice to drill into its status mix.', 'COUNT(*) BY hotel_code, then COUNT(*) BY job_status WITHIN hotel_code WHERE type = MO', {
      chart: { type: 'pie' },
      series: [{ type: 'pie', innerSize: '45%', name: 'Orders', data: entries.map((e) => ({ name: e.hotel_code, y: e.summary.total ?? 0, drilldown: `cmo-status:${e.hotel_code}` })) }],
      drilldown: { series: entries.map((e) => ({ id: `cmo-status:${e.hotel_code}`, type: 'pie', innerSize: '45%', name: `${e.hotel_code} Job Status`, data: Object.entries(e.summary.status_map ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).map(([name, y]) => ({ name, y: Number(y) })) })) },
    }),
    make('cmo-03', 'Daily Work Order Trend by Hotel', 'Daily MO volume trend split by hotel for chain-level comparison.', 'COUNT(*) BY created_date, hotel_code WHERE type = MO', {
      chart: { type: 'line' },
      xAxis: { categories: allDates },
      series: entries.map((e) => ({
        type: 'line',
        name: e.hotel_code,
        data: allDates.map((date) => (e.raw_daily ?? []).find((d) => d.date === date)?.total ?? 0),
      })),
    }),
    make('cmo-04', 'Completion Rate by Hotel', 'Hotel-level completion comparison for maintenance execution health.', 'completed_orders / total_orders * 100 BY hotel_code WHERE type = MO', {
      chart: { type: 'column' },
      xAxis: { categories: hotelCodes },
      yAxis: { max: 100, title: { text: 'Completion %' } },
      series: [{ type: 'column', name: 'Completion %', data: entries.map((e) => e.summary.total > 0 ? r1((e.summary.completed / e.summary.total) * 100) : 0) }],
    }),
    make('cmo-05', 'Open Work Order Rate by Hotel', 'Compares open-order pressure by hotel.', 'open_orders / total_orders * 100 BY hotel_code WHERE type = MO', {
      chart: { type: 'column' },
      xAxis: { categories: hotelCodes },
      yAxis: { max: 100, title: { text: 'Open %' } },
      series: [{ type: 'column', name: 'Open %', data: entries.map((e) => e.summary.total > 0 ? r1((Math.max(e.summary.total - e.summary.completed - e.summary.cancelled, 0) / e.summary.total) * 100) : 0) }],
    }),
    make('cmo-06', 'Worldmap Maintenance by Hotel', 'Country-level map with hotel labels for chain-wide maintenance visibility.', 'Country Value = SUM(total_orders) GROUP BY country_code; Label = CONCAT(hotel_code, total_orders) list per country WHERE type = MO', {
      chart: { type: 'map' },
      mapNavigation: { enabled: true },
      colorAxis: { min: 0, minColor: '#E6F4F1', maxColor: '#0E7470' },
      series: worldMapData ? [{
        type: 'map',
        name: 'Maintenance Orders',
        mapData: worldMapData,
        data: Array.from(
          entries.reduce((acc, entry) => {
            const code = String(entry.country_code ?? '').trim().toUpperCase();
            if (!code) return acc;
            const prev = acc.get(code) ?? { total: 0, hotels: [] as string[] };
            prev.total += entry.summary.total ?? 0;
            prev.hotels.push(`${entry.hotel_code} ${entry.summary.total ?? 0}`);
            acc.set(code, prev);
            return acc;
          }, new Map<string, { total: number; hotels: string[] }>()),
        ).map(([code, agg]) => ({
          code,
          value: agg.total,
          custom: { hotels: agg.hotels.join(', '), countryCode: code },
        })),
        joinBy: ['iso-a2', 'code'],
        borderColor: '#B9A88A',
        nullColor: '#F4EEE4',
        states: { hover: { color: '#C55A10' } },
        dataLabels: {
          enabled: true,
          allowOverlap: false,
          crop: false,
          overflow: 'allow',
          padding: 2,
          useHTML: true,
          formatter: function (this: { point?: { options?: { custom?: { hotels?: string } }; series?: { chart?: { fullscreen?: { isOpen?: boolean } } } } }) {
            const hotels = this.point?.options?.custom?.hotels ?? '';
            const isFullscreen = this.point?.series?.chart?.fullscreen?.isOpen === true;
            const size = isFullscreen ? 16 : 8;
            return `<span style="font-size:${size}px;line-height:1.2;font-weight:700">${hotels}</span>`;
          },
          style: {
            fontSize: '8px',
            fontWeight: '600',
            textOutline: 'none',
          },
        },
        tooltip: {
          pointFormatter: function (this: Highcharts.Point) {
            const custom = (this as unknown as { custom?: { countryCode?: string; hotels?: string } }).custom;
            const value = (this as unknown as { value?: number }).value ?? 0;
            return `<b>${custom?.countryCode ?? ''}</b><br/>Orders: ${value}<br/>${custom?.hotels ?? ''}`;
          },
        },
      }] : [],
    }),
    make('cmo-07', 'Guest Related Orders by Hotel', 'Compares guest-related and non-guest-related MO demand by hotel.', 'COUNT(*) guest_related vs non_guest_related BY hotel_code WHERE type = MO', {
      chart: { type: 'bar' },
      xAxis: { categories: hotelCodes },
      plotOptions: { bar: { stacking: 'normal' } },
      series: [
        { type: 'bar', name: 'Guest Related', data: entries.map((e) => e.summary.vip_total ?? 0) },
        { type: 'bar', name: 'Non Guest Related', data: entries.map((e) => Math.max((e.summary.total ?? 0) - (e.summary.vip_total ?? 0), 0)) },
      ],
    }),
    make('cmo-08', 'Severity Index by Hotel', 'Average severity comparison across hotels.', 'AVG(severity_weight) BY hotel_code WHERE type = MO', {
      chart: { type: 'column' },
      xAxis: { categories: hotelCodes },
      series: [{ type: 'column', name: 'Severity Index', data: entries.map((e) => e.summary.total > 0 ? r2((e.summary.severity_sum ?? 0) / e.summary.total) : 0) }],
    }),
    // cmo-09: Work Order Duration Distribution (Chain) — drilldown to per-hotel count
    make('cmo-09', 'Work Order Duration Distribution (Chain)', 'Chain-wide distribution of work orders by resolution time. Click a bucket to see per-hotel breakdown.', 'COUNT(*) BY duration_bucket WHERE type = MO DRILLDOWN COUNT(*) BY hotel_code WITHIN bucket', (() => {
      const BUCKETS = ['< 1h', '1-2h', '2-4h', '4-8h', '8-24h', '24h+'];
      const chainTotals = BUCKETS.map((b) => entries.reduce((s, e) => s + (e.summary.mo_duration_dist_map?.[b] ?? 0), 0));
      return {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { title: { text: 'Work Orders' }, min: 0 },
        series: [{
          type: 'column', name: 'Work Orders', colorByPoint: true,
          data: BUCKETS.map((b, i) => ({ name: b, y: chainTotals[i], drilldown: `cmo09:${b}` })),
          dataLabels: { enabled: true, format: '{point.y}' },
        }],
        drilldown: {
          series: BUCKETS.map((b) => ({
            id: `cmo09:${b}`, type: 'column', name: `${b} — By Hotel`,
            dataLabels: { enabled: true, format: '{point.y}' },
            data: entries
              .map((e) => ({ name: e.hotel_code, y: e.summary.mo_duration_dist_map?.[b] ?? 0 }))
              .filter((p) => p.y > 0)
              .sort((a, bb) => bb.y - a.y),
          })),
        },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} orders' },
      };
    })()),
    // cmo-10: 24-Hour Work Order Distribution (Chain) — drilldown to per-hotel count
    make('cmo-10', '24-Hour Work Order Distribution (Chain)', 'Chain-wide 24-hour work order distribution. Click an hour to see per-hotel breakdown.', 'COUNT(*) BY HOUR(created_datetime) WHERE type = MO DRILLDOWN COUNT(*) BY hotel_code WITHIN hour', (() => {
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const chainTotals = hours.map((h) => entries.reduce((s, e) => s + (e.summary.mo_hour_map?.[String(h)] ?? 0), 0));
      return {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { title: { text: 'Work Orders' }, min: 0 },
        series: [{
          type: 'column', name: 'Work Orders', colorByPoint: true,
          data: hours.map((h, i) => ({ name: String(h).padStart(2, '0') + ':00', y: chainTotals[i], drilldown: `cmo10:${h}` })),
          dataLabels: { enabled: true, format: '{point.y}' },
        }],
        drilldown: {
          series: hours.map((h) => ({
            id: `cmo10:${h}`, type: 'column', name: `${String(h).padStart(2, '0')}:00 — By Hotel`,
            dataLabels: { enabled: true, format: '{point.y}' },
            data: entries
              .map((e) => ({ name: e.hotel_code, y: e.summary.mo_hour_map?.[String(h)] ?? 0 }))
              .filter((p) => p.y > 0)
              .sort((a, bb) => bb.y - a.y),
          })),
        },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} orders' },
      };
    })()),
    // cmo-11: Top 10 Defect > 24h (Chain) — drilldown to per-hotel count
    make('cmo-11', 'Top 10 Defect > 24 Hours (Chain)', 'Top 10 defects with resolution > 24 hours across the chain. Click a bar to see per-hotel breakdown.', 'COUNT(*) BY defect WHERE resolution_minutes >= 1440 AND type = MO DRILLDOWN COUNT(*) BY hotel_code WITHIN defect', (() => {
      const chainDefectTotals: Record<string, number> = {};
      for (const e of entries) {
        for (const [defect, hm] of Object.entries(e.summary.mo_item_24h_hour_map ?? {})) {
          const total = Object.values(hm as Record<string, number>).reduce((a, c) => a + c, 0);
          chainDefectTotals[defect] = (chainDefectTotals[defect] ?? 0) + total;
        }
      }
      const top10 = topN(chainDefectTotals, 24);
      return {
        chart: { type: 'bar' },
        xAxis: { type: 'category', title: { text: null } },
        yAxis: { title: { text: 'Work Orders (> 24h)' }, min: 0 },
        series: [{
          type: 'bar', name: 'Work Orders (> 24h)', colorByPoint: true,
          data: top10.map(([name, y]) => ({ name, y, drilldown: `cmo11:${name}` })),
          dataLabels: { enabled: true, format: '{point.y}' },
        }],
        drilldown: {
          series: top10.map(([defect]) => ({
            id: `cmo11:${defect}`, type: 'column', name: `${defect} — By Hotel`,
            dataLabels: { enabled: true, format: '{point.y}' },
            data: entries
              .map((e) => ({
                name: e.hotel_code,
                y: Object.values(e.summary.mo_item_24h_hour_map?.[defect] ?? {}).reduce((a, c) => a + (c as number), 0),
              }))
              .filter((p) => p.y > 0)
              .sort((a, bb) => bb.y - a.y),
          })),
        },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} orders' },
      };
    })()),
    make('cmo-12', 'Top Assets / Defects Across Chain', 'Treemap of the most frequent maintenance assets or defects across the chain.', 'COUNT(*) BY defect_or_asset WHERE type = MO', {
      chart: { type: 'treemap' },
      series: [{ type: 'treemap', layoutAlgorithm: 'squarified', data: topItems.map(([name, value]) => ({ name, value })) }],
    }),
  ];
}

// Hotel-level MO charts mo-01..mo-12 — single-hotel counterparts of the corp
// cmo-01..cmo-12 charts. Built client-side from the stored summary + raw_daily
// so existing uploads render correct MO charts without re-upload (the legacy
// im-46..im-69 charts in stored MO JSON are ignored). Fully independent from
// buildCorpMoCharts: different ids (mo-* vs cmo-*), single-hotel scope.
// Titles/notes/formulas are localized by the caller via hmo_chart_* i18n keys.
function buildHotelMoCharts(
  summary: HotelSummary,
  rawDaily: DailyBucket[],
  worldMapData: Record<string, unknown> | null | undefined,
  countryCode: string,
  hotelCode: string,
): ChartDef[] {
  const total = summary.total ?? 0;
  const completed = summary.completed ?? 0;
  const cancelled = summary.cancelled ?? 0;
  const open = Math.max(total - completed - cancelled, 0);
  const categoryMap = summary.category_map ?? {};
  const statusMap = summary.status_map ?? {};
  const severityMap = summary.severity_map ?? {};
  const locationMap = summary.location_map ?? {};
  const itemMap = summary.item_map ?? {};
  const catStatusMap = summary.cat_status_map ?? {};
  const statusCreatedDeptMap = summary.status_created_dept_map ?? {};
  const guestRelated = summary.vip_total ?? 0;
  const dates = (rawDaily ?? []).map((d) => d.date);
  const topCats = topN(categoryMap, 24);
  const topLocations = topN(locationMap, 24);
  const moItemDateMap = summary.mo_item_date_map ?? {};
  const moItemDurationMap = summary.mo_item_duration_map ?? {};
  const moDurDistMap = summary.mo_duration_dist_map ?? {};
  const moHourMap = summary.mo_hour_map ?? {};
  const moCatDurationMap = summary.mo_cat_duration_map ?? {};
  const moItem24hHourMap = summary.mo_item_24h_hour_map ?? {};
  const topItems = topN(itemMap, 24);

  const make = (id: string, options: Record<string, unknown>): ChartDef => ({
    id, title: id, note: '', formula: '', filterable: false, options,
  });

  // Semi-donut gauge (pie, no extra module): value arc burnt orange, track deep teal.
  const gauge = (id: string, value: number): ChartDef => make(id, {
    chart: { type: 'pie', margin: [0, 0, 0, 0] },
    plotOptions: {
      pie: {
        startAngle: -90, endAngle: 90, center: ['50%', '70%'], size: '120%', innerSize: '70%',
        borderWidth: 1, borderColor: '#FAF7F2',
        dataLabels: { enabled: true, format: `<b>{point.y:.1f}%</b>`, distance: -38, style: { fontSize: '20px' } },
      },
    },
    series: [{
      type: 'pie', name: 'Rate', data: [
        { name: '', y: r1(value), color: '#C2410C', borderColor: '#FAF7F2', borderWidth: 1 },
        { name: '', y: r1(Math.max(100 - value, 0)), color: '#0F766E', borderColor: '#FAF7F2', borderWidth: 1, dataLabels: { enabled: false } },
      ],
    }],
    tooltip: { enabled: false },
  });

  return [
    // mo-01 — Top 10 Category by Status (donut → drilldown to job status)
    make('mo-01', (() => {
      // Lookup helper: try exact key, then trimmed key (guards against TRIM mismatch in backfilled data)
      const catStatusLookup = (name: string) =>
        catStatusMap[name] ?? catStatusMap[name.trim()] ?? catStatusMap[name.trim() || 'Uncategorized'] ?? {};
      return {
        chart: { type: 'pie' },
        series: [{
          type: 'pie', innerSize: '45%', name: 'Work Orders',
          data: topCats.map(([name, y]) => ({ name, y, drilldown: `mo01:${name}` })),
        }],
        drilldown: {
          series: topCats.map(([name]) => ({
            id: `mo01:${name}`, type: 'pie', innerSize: '45%', name: `${name} — Status`,
            data: Object.entries(catStatusLookup(name)).sort(([, a], [, b]) => Number(b) - Number(a))
              .map(([s, y]) => ({ name: s, y: Number(y), ...(STAT_COLORS[s] ? { color: STAT_COLORS[s] } : {}) })),
          })),
        },
        plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.y} ({point.percentage:.1f}%)' } } },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} ({point.percentage:.1f}%)' },
      };
    })()),
    // mo-02 — Work Order Status by Created-by Department (donut → drilldown to dept)
    make('mo-02', {
      chart: { type: 'pie' },
      series: [{
        type: 'pie', innerSize: '45%', name: 'Status',
        data: Object.entries(statusMap).sort(([, a], [, b]) => Number(b) - Number(a))
          .map(([name, y]) => ({ name, y: Number(y), drilldown: `mo02:${name}`, ...(STAT_COLORS[name] ? { color: STAT_COLORS[name] } : {}) })),
      }],
      drilldown: {
        series: Object.keys(statusMap).map((status) => ({
          id: `mo02:${status}`, type: 'pie', innerSize: '45%', name: `${status} — Created Dept`,
          data: Object.entries(statusCreatedDeptMap[status] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a))
            .map(([d, y]) => ({ name: d, y: Number(y) })),
        })),
      },
      plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%' } } },
    }),
    // mo-03 — Daily Work Order Trend
    make('mo-03', {
      chart: { type: 'spline' },
      xAxis: { categories: dates, tickInterval: Math.max(1, Math.floor(dates.length / 10)) },
      yAxis: { title: { text: 'Work Orders' }, min: 0 },
      series: [{ type: 'spline', name: 'Work Orders', data: (rawDaily ?? []).map((d) => d.total ?? 0) }],
      tooltip: { shared: true },
    }),
    // mo-04 — Top 10 Defect by Daily Trend (bar → drilldown to dates)
    make('mo-04', (() => {
      // Lookup helper: guards against TRIM/null mismatch in backfilled data
      const itemDateLookup = (name: string) =>
        moItemDateMap[name] ?? moItemDateMap[name.trim()] ?? moItemDateMap[name.trim() || 'Unknown'] ?? {};
      // Collect all dates across all top items for consistent drilldown x-axis
      const allItemDates = Array.from(
        new Set(topItems.flatMap(([name]) => Object.keys(itemDateLookup(name)))),
      ).sort();
      return {
        chart: { type: 'bar' },
        xAxis: { type: 'category', title: { text: null } },
        yAxis: { title: { text: 'Work Orders' }, min: 0 },
        series: [{
          type: 'bar', name: 'Work Orders', colorByPoint: true,
          data: topItems.map(([name, y]) => ({ name, y, drilldown: `mo04:${name}` })),
          dataLabels: { enabled: true },
        }],
        drilldown: {
          series: topItems.map(([name]) => {
            const dm = itemDateLookup(name);
            return {
              id: `mo04:${name}`, type: 'bar', name: `${name} — Daily Trend`, color: '#C2410C',
              dataLabels: { enabled: true },
              data: allItemDates.map((d) => ({ name: d, y: dm[d] ?? 0 })),
            };
          }),
        },
        plotOptions: { bar: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} orders' },
      };
    })()),
    // mo-05 — Top 10 Defect vs Resolution Hours (dual-axis bar + line)
    (() => {
      const items = topItems.map(([name, y]) => ({ name, y }));
      const hours = topItems.map(([name]) => r2(moItemDurationMap[name] ?? 0));
      return make('mo-05', {
        chart: { type: 'column' },
        xAxis: { type: 'category', categories: items.map((i) => i.name) },
        yAxis: [
          { title: { text: 'Work Orders' }, min: 0 },
          { title: { text: 'Avg Hours' }, opposite: true, min: 0 },
        ],
        series: [
          {
            type: 'column', name: 'Work Orders', yAxis: 0,
            data: items.map((i) => i.y),
            dataLabels: { enabled: true, format: '{y}' },
          },
          {
            type: 'line', name: 'Avg Resolution Hours', yAxis: 1,
            data: hours,
            dataLabels: { enabled: true, format: '{y:.1f}h' },
            color: '#C2410C', marker: { enabled: true },
          },
        ],
        tooltip: { shared: true },
      });
    })(),
    // mo-06 — Top 10 Category vs Resolution Hours (dual-axis column + line)
    make('mo-06', (() => {
      const catDurLookup = (name: string) =>
        moCatDurationMap[name] ?? moCatDurationMap[name.trim()] ?? 0;
      const cats = topCats.map(([name, y]) => ({ name, y }));
      const hours = topCats.map(([name]) => r2(catDurLookup(name)));
      return {
        chart: { type: 'column' },
        xAxis: { type: 'category', categories: cats.map((c) => c.name) },
        yAxis: [
          { title: { text: 'Work Orders' }, min: 0 },
          { title: { text: 'Avg Hours' }, opposite: true, min: 0 },
        ],
        series: [
          { type: 'column', name: 'Work Orders', yAxis: 0, data: cats.map((c) => c.y),
            dataLabels: { enabled: true, format: '{y}' } },
          { type: 'line', name: 'Avg Resolution Hours', yAxis: 1, data: hours,
            dataLabels: { enabled: true, format: '{y:.1f}h' }, color: '#C2410C', marker: { enabled: true } },
        ],
        tooltip: { shared: true },
      };
    })()),
    // mo-07 — Guest Related Orders
    make('mo-07', {
      chart: { type: 'pie' },
      series: [{ type: 'pie', innerSize: '45%', name: 'Orders', data: [
        { name: 'Guest Related', y: guestRelated, color: '#C2410C' },
        { name: 'Non Guest Related', y: Math.max(total - guestRelated, 0), color: '#0F766E' },
      ] }],
      plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.y} ({point.percentage:.1f}%)' } } },
    }),
    // mo-08 — Severity Index (severity distribution column)
    make('mo-08', {
      chart: { type: 'column' },
      xAxis: { categories: SEV_ORDER.filter((s) => severityMap[s]) as unknown as string[] },
      yAxis: { title: { text: 'Work Orders' } },
      series: [{ type: 'column', name: 'Work Orders', colorByPoint: true,
        data: SEV_ORDER.filter((s) => severityMap[s]).map((s) => ({ y: severityMap[s] ?? 0, color: SEV_COLORS[s as keyof typeof SEV_COLORS] })) }],
      plotOptions: { column: { dataLabels: { enabled: true } } },
    }),
    // mo-09 — Work Order Duration Distribution
    make('mo-09', (() => {
      const DUR_BUCKETS = ['< 1h', '1-2h', '2-4h', '4-8h', '8-24h', '24h+'];
      const counts = DUR_BUCKETS.map((b) => moDurDistMap[b] ?? 0);
      return {
        chart: { type: 'column' },
        xAxis: { categories: DUR_BUCKETS, title: { text: 'Duration Range' } },
        yAxis: { title: { text: 'Work Orders' }, min: 0 },
        series: [{ type: 'column', name: 'Work Orders', colorByPoint: true, data: counts }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{y}' } } },
        tooltip: { pointFormat: '<b>{point.category}</b>: {point.y} orders' },
      };
    })()),
    // mo-10 — Work Order 24-Hour Distribution
    make('mo-10', (() => {
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const labels = hours.map((h) => `${String(h).padStart(2, '0')}:00`);
      const counts = hours.map((h) => moHourMap[String(h)] ?? 0);
      return {
        chart: { type: 'column' },
        xAxis: { categories: labels, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Work Orders' }, min: 0 },
        series: [{ type: 'column', name: 'Work Orders', colorByPoint: false, color: '#0E7470', data: counts }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{y}' } } },
        tooltip: { pointFormat: '<b>{point.category}</b>: {point.y} orders' },
      };
    })()),
    // mo-11 — Top 10 Defect > 24 Hours (bar drilldown to 24-hour distribution)
    make('mo-11', (() => {
      const hours = Array.from({ length: 24 }, (_, i) => String(i));
      const top24h: Array<[string, number]> = Object.entries(moItem24hHourMap)
        .map(([name, hm]): [string, number] => [name, Object.values(hm).reduce((a, c) => a + c, 0)])
        .sort(([, a], [, b]) => b - a)
        .slice(0, 24);
      return {
        chart: { type: 'bar' },
        xAxis: { type: 'category', title: { text: null } },
        yAxis: { title: { text: 'Work Orders (> 24h)' }, min: 0 },
        series: [{
          type: 'bar', name: 'Work Orders (> 24h)', colorByPoint: true,
          data: top24h.map(([name, y]) => ({ name, y, drilldown: `mo11:${name}` })),
          dataLabels: { enabled: true, format: '{point.y}' },
        }],
        drilldown: {
          series: top24h.map(([name]) => ({
            id: `mo11:${name}`, type: 'column', name: `${name} — 24h Distribution`,
            color: '#C2410C',
            dataLabels: { enabled: true, format: '{point.y}' },
            data: hours.map((h) => ({ name: `${h.padStart(2, '0')}:00`, y: moItem24hHourMap[name]?.[h] ?? 0 })),
          })),
        },
        plotOptions: { bar: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} orders' },
      };
    })()),
    // mo-12 — Top Assets / Defects (treemap)
    make('mo-12', {
      chart: { type: 'treemap' },
      series: [{ type: 'treemap', layoutAlgorithm: 'squarified', data: topN(itemMap, 24).map(([name, value]) => ({ name, value })) }],
    }),
  ];
}

function CorpMoPerformanceTable({
  entries,
  dark,
  index,
  maintenanceType,
}: {
  entries: ChainEntry[];
  dark: boolean;
  index: number;
  maintenanceType: MaintenanceType;
}) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const maxOrders = Math.max(1, ...entries.map((entry) => entry.summary.total ?? 0));
  const rows = [...entries]
    .map((entry) => {
      const total = entry.summary.total ?? 0;
      const completed = entry.summary.completed ?? 0;
      const cancelled = entry.summary.cancelled ?? 0;
      const open = Math.max(total - completed - cancelled, 0);
      const topCategory = topN(entry.summary.category_map ?? {}, 1)[0] ?? ['-', 0];
      const topItem = topN(entry.summary.item_map ?? {}, 1)[0] ?? ['-', 0];
      const activeDays = Math.max(1, (entry.raw_daily ?? []).length);
      const completion = total > 0 ? r1((completed / total) * 100) : 0;
      const openRate = total > 0 ? r1((open / total) * 100) : 0;
      const guestShare = total > 0 ? r1(((entry.summary.vip_total ?? 0) / total) * 100) : 0;
      const severity = total > 0 ? r2((entry.summary.severity_sum ?? 0) / total) : 0;
      const topCategoryShare = total > 0 ? r1((topCategory[1] / total) * 100) : 0;
      const dailyAverage = r2(total / activeDays);
      const volumeFactor = Math.min((total / maxOrders) * 20, 20);
      const riskRank = (severity * 25) + (openRate * 0.8) + (guestShare * 0.5) + (topCategoryShare * 0.4) + volumeFactor;
      return {
        hotel: entry.hotel_code,
        hotelLabel: entry.hotel_name ? `${entry.hotel_name} (${entry.hotel_code})` : entry.hotel_code,
        orders: total,
        completion,
        openRate,
        guestShare,
        severity,
        topCategoryShare,
        topCategory: topCategory[0],
        topItem: topItem[0],
        dailyAverage,
        riskRank: r2(riskRank),
      };
    })
    .sort((a, b) => b.riskRank - a.riskRank || b.openRate - a.openRate || b.orders - a.orders);

  const cardBg = tokens.chart.cardBg;
  const cardBorder = tokens.chart.cardBorder;
  const accent = tokens.chart.cardAccent;
  const titleText = tokens.chart.titleText;
  const codeBg = tokens.chart.codeBg;
  const rule = tokens.chart.footerBorder;
  const muted = tokens.chart.footerMuted;
  const headBg = tokens.dashboard.toolbarBg;

  return (
    <div
      className="chart-card flex flex-col overflow-hidden md:col-span-2"
      style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderLeft: `4px solid ${accent}`, borderRadius: '12px' }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-3 shrink-0">
        <h3 className="font-serif font-semibold leading-snug flex items-center gap-2" style={{ fontSize: '0.9rem', color: titleText }}>
          <span className="font-mono shrink-0" style={{ fontSize: '0.62rem', letterSpacing: '0.04em', fontWeight: 700, color: accent, background: codeBg, border: `1px solid ${accent}40`, padding: '1px 5px', lineHeight: 1.4 }}>
            {String(index).padStart(2, '0')}
          </span>
          Hotel Performance
        </h3>
      </div>

      <div className="px-4 pb-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Index', 'Hotel', maintenanceType === 'PM' ? 'Total PM Orders' : 'Total Orders', 'Completion %', 'Open %', 'Guest Related %', 'Severity Index', 'Top Category %', 'Top Category', 'Top Defect / Asset', 'Daily Avg', 'Risk Rank'].map((label) => (
                <th
                  key={label}
                  className="text-left font-mono"
                  style={{ fontSize: '0.62rem', letterSpacing: '0.06em', color: muted, background: headBg, borderBottom: `1px solid ${rule}`, padding: '8px 10px', whiteSpace: 'nowrap' }}
                >
                  {label.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.hotel}>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: accent, fontSize: '0.75rem', fontWeight: 700 }}>{String(rowIndex + 1).padStart(2, '0')}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.78rem', fontWeight: 700 }}>{row.hotelLabel}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.orders.toLocaleString()}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.completion.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.openRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.guestShare.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.severity.toFixed(2)}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.topCategoryShare.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.topCategory}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.topItem}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.dailyAverage.toFixed(2)}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem', fontWeight: 700 }}>{row.riskRank.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 pt-2.5 pb-3.5 space-y-1 shrink-0" style={{ borderTop: `1px solid ${rule}` }}>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Note</span>
          {' '}Executive hotel-level {maintenanceType} performance table for cross-hotel {maintenanceType === 'PM' ? 'preventive maintenance' : 'maintenance'} benchmarking.
        </p>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Formula</span>
          {' '}
          <code className="font-mono" style={{ fontSize: '0.6rem', padding: '1px 5px', background: codeBg, color: accent, borderRadius: '2px' }}>
            Risk Rank = (Severity Index x 25) + (Open % x 0.8) + (Guest Related % x 0.5) + (Top Category % x 0.4) + volume factor
          </code>
        </p>
      </div>
    </div>
  );
}

function CorpImPerformanceTable({
  entries,
  dark,
  index,
}: {
  entries: ChainEntry[];
  dark: boolean;
  index: number;
}) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const maxIncidents = Math.max(1, ...entries.map((entry) => entry.summary.total ?? 0));
  const rows = [...entries]
    .map((entry) => {
      const total = entry.summary.total ?? 0;
      const completed = entry.summary.completed ?? 0;
      const cancelled = entry.summary.cancelled ?? 0;
      const pending = Math.max(entry.summary.pending ?? (total - completed - cancelled), 0);
      const critical = entry.summary.severity_map?.Critical ?? entry.summary.severity_map?.critical ?? 0;
      const vip = entry.summary.vip_total ?? 0;
      const repeat = entry.summary.repeat_count ?? 0;
      const slaBreach = Object.entries(entry.summary.status_map ?? {}).reduce((acc, [status, count]) => {
        const key = status.toLowerCase();
        return key.includes('sla') || key.includes('breach') || key.includes('overdue') || key.includes('timeout') || key.includes('late')
          ? acc + Number(count)
          : acc;
      }, 0);
      const topCategory = topN(entry.summary.category_map ?? {}, 1)[0] ?? ['-', 0];
      const activeDays = Math.max(1, (entry.raw_daily ?? []).length);
      const closureRate = total > 0 ? r1((completed / total) * 100) : 0;
      const pendingRate = total > 0 ? r1((pending / total) * 100) : 0;
      const criticalRate = total > 0 ? r1((critical / total) * 100) : 0;
      const vipRate = total > 0 ? r1((vip / total) * 100) : 0;
      const slaBreachRate = total > 0 ? r1((slaBreach / total) * 100) : 0;
      const repeatRate = total > 0 ? r1((repeat / total) * 100) : 0;
      const severity = total > 0 ? r2((entry.summary.severity_sum ?? 0) / total) : 0;
      const dailyAverage = r2(total / activeDays);
      const volumeFactor = Math.min((total / maxIncidents) * 20, 20);
      const riskRank = (criticalRate * 1.2) + (vipRate * 0.7) + (pendingRate * 0.8) + (slaBreachRate * 1.0) + (repeatRate * 0.6) + (severity * 15) + volumeFactor;
      return {
        hotel: entry.hotel_code,
        hotelLabel: entry.hotel_name ? `${entry.hotel_name} (${entry.hotel_code})` : entry.hotel_code,
        total,
        closureRate,
        pendingRate,
        criticalRate,
        vipRate,
        slaBreachRate,
        repeatRate,
        severity,
        topCategory: topCategory[0],
        dailyAverage,
        riskRank: r2(riskRank),
      };
    })
    .sort((a, b) => b.riskRank - a.riskRank || b.pendingRate - a.pendingRate || b.total - a.total);

  const cardBg = tokens.chart.cardBg;
  const cardBorder = tokens.chart.cardBorder;
  const accent = tokens.chart.cardAccent;
  const titleText = tokens.chart.titleText;
  const codeBg = tokens.chart.codeBg;
  const rule = tokens.chart.footerBorder;
  const muted = tokens.chart.footerMuted;
  const headBg = tokens.dashboard.toolbarBg;

  return (
    <div
      className="chart-card flex flex-col overflow-hidden md:col-span-2"
      style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderLeft: `4px solid ${accent}`, borderRadius: '12px' }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-3 shrink-0">
        <h3 className="font-serif font-semibold leading-snug flex items-center gap-2" style={{ fontSize: '0.9rem', color: titleText }}>
          <span className="font-mono shrink-0" style={{ fontSize: '0.62rem', letterSpacing: '0.04em', fontWeight: 700, color: accent, background: codeBg, border: `1px solid ${accent}40`, padding: '1px 5px', lineHeight: 1.4 }}>
            {String(index).padStart(2, '0')}
          </span>
          Hotel Performance Benchmark
        </h3>
      </div>

      <div className="px-4 pb-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Index', 'Hotel', 'Total Incidents', 'Closure %', 'Pending %', 'Critical %', 'VIP %', 'SLA Breach %', 'Repeat %', 'Avg Severity', 'Top Category', 'Daily Avg', 'Risk Rank'].map((label) => (
                <th
                  key={label}
                  className="text-left font-mono"
                  style={{ fontSize: '0.62rem', letterSpacing: '0.06em', color: muted, background: headBg, borderBottom: `1px solid ${rule}`, padding: '8px 10px', whiteSpace: 'nowrap' }}
                >
                  {label.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((row, rowIndex) => (
              <tr key={row.hotel}>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: accent, fontSize: '0.75rem', fontWeight: 700 }}>{String(rowIndex + 1).padStart(2, '0')}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.78rem', fontWeight: 700 }}>{row.hotelLabel}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.total.toLocaleString()}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.closureRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.pendingRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.criticalRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.vipRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.slaBreachRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.repeatRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.severity.toFixed(2)}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.topCategory}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.dailyAverage.toFixed(2)}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem', fontWeight: 700 }}>{row.riskRank.toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={13} style={{ padding: '14px 10px', color: muted, fontSize: '0.75rem', textAlign: 'center' }}>
                  No hotel entries match the current Corp IM filter selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 pt-2.5 pb-3.5 space-y-1 shrink-0" style={{ borderTop: `1px solid ${rule}` }}>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Note</span>
          {' '}Executive hotel-level IM benchmark table for incident risk, closure discipline, VIP exposure, SLA pressure, and repeat-guest risk.
        </p>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Formula</span>
          {' '}
          <code className="font-mono" style={{ fontSize: '0.6rem', padding: '1px 5px', background: codeBg, color: accent, borderRadius: '2px' }}>
            Risk Rank = critical % x 1.2 + VIP % x 0.7 + pending % x 0.8 + SLA breach % + repeat % x 0.6 + severity factor + volume factor
          </code>
        </p>
      </div>
    </div>
  );
}

function maintenanceModeLabel(type: MaintenanceType): string {
  return type === 'PM' ? 'Preventive Maintenance' : 'Maintenance Order';
}

function moLocalizationScope(isCorp: boolean): 'cmo' | 'hmo' {
  return isCorp ? 'cmo' : 'hmo';
}

function coLocalizeText(text: string): string {
  return text
    .replace(/\bMO Dashboard\b/g, 'CO ACSR Dashboard')
    .replace(/\bMO\b/g, 'CO')
    .replace(/\bMaintenance Order\b/g, 'Cleaning Order')
    .replace(/\bmaintenance order\b/gi, 'cleaning order')
    .replace(/\bmaintenance orders\b/gi, 'cleaning orders')
    .replace(/\bmaintenance\b/gi, 'cleaning');
}

function buildImBenchmark(
  direction: KpiBenchmark['direction'],
  good: number | null,
  watch: number | null,
  goodLabel: string,
  watchLabel: string,
  badLabel: string,
  neutralLabel?: string,
): KpiBenchmark {
  return {
    direction,
    good: good ?? undefined,
    watch: watch ?? undefined,
    goodLabel,
    watchLabel,
    badLabel,
    neutralLabel,
  };
}

function imBenchmarkFor(id: string): KpiBenchmark {
  switch (id) {
    case 'kpi_01':
      return buildImBenchmark('higher', 85, 70, 'Good >= 85', 'Watch 70-84.9', 'Bad < 70');
    case 'kpi_02':
      return buildImBenchmark('lower', 1, 2, 'Good <= 1%', 'Watch 1-2%', 'Bad > 2%');
    case 'kpi_03':
      return buildImBenchmark('higher', 85, 75, 'Good >= 85', 'Watch 75-84.9', 'Bad < 75');
    case 'kpi_04':
      return buildImBenchmark('lower', 6, 10, 'Good <= 6%', 'Watch 6-10%', 'Bad > 10%');
    case 'kpi_05':
      return buildImBenchmark('lower', 3, 5, 'Good <= 3%', 'Watch 3-5%', 'Bad > 5%');
    case 'kpi_06':
      return buildImBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'kpi_07':
      return buildImBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%');
    case 'kpi_08':
      return buildImBenchmark('lower', 15, 25, 'Good <= 15%', 'Watch 15-25%', 'Bad > 25%');
    case 'kpi_09':
      return buildImBenchmark('neutral', null, null, '', '', '', 'Scale-dependent volume; compare against the same hotel or prior periods.');
    case 'kpi_10':
      return buildImBenchmark('lower', 45, 60, 'Good <= 45%', 'Watch 45-60%', 'Bad > 60%');
    default:
      return buildImBenchmark('neutral', null, null, '', '', '', 'No fixed benchmark.');
  }
}

function corpCoKpiLabel(label: string, id: string): string {
  const base = coLocalizeText(label);
  switch (id) {
    case 'cmo_kpi_01':
      return base;
    case 'cmo_kpi_02':
    case 'cmo_kpi_03':
    case 'cmo_kpi_04':
    case 'cmo_kpi_05':
    case 'cmo_kpi_06':
    case 'cmo_kpi_07':
    case 'cmo_kpi_08':
    case 'cmo_kpi_09':
    case 'cmo_kpi_10':
      return `${base} (Chain)`;
    default:
      return base;
  }
}

function corpCoKpiNote(note: string, id: string): string {
  const base = coLocalizeText(note);
  switch (id) {
    case 'cmo_kpi_01':
      return 'Chain-wide cleaning order volume across all hotels in scope. Compare with hotel-level volume to see which property is carrying more work.';
    case 'cmo_kpi_02':
      return 'Chain-wide completion rate for cleaning orders. Use the hotel dashboard to compare how each property performs against the chain aggregate.';
    case 'cmo_kpi_03':
      return 'Chain-wide open-rate pressure across all hotels in scope. Compare hotel views to identify where backlog is accumulating.';
    case 'cmo_kpi_04':
      return 'Chain-wide cancellation pressure for cleaning orders. Compare hotel-level rates to isolate avoidable cancellations.';
    case 'cmo_kpi_05':
      return 'Chain-wide guest-related share of cleaning orders. Use hotel views to see which properties carry the highest guest-facing workload.';
    case 'cmo_kpi_06':
      return 'Chain-wide severity proxy for cleaning work. Compare hotel views to spot higher-complexity properties.';
    case 'cmo_kpi_07':
      return 'Chain-wide concentration of the top cleaning category. Use hotel views to see whether one category dominates at a specific property.';
    case 'cmo_kpi_08':
      return 'Chain-wide count of active cleaning categories. Compare hotels to understand breadth of service mix.';
    case 'cmo_kpi_09':
      return 'Chain-wide count of touched assets or room combinations. Compare hotel views to identify where cleaning effort is spread widest.';
    case 'cmo_kpi_10':
      return 'Chain-wide daily average cleaning orders. Compare hotel views to assess which property is driving the workload pattern.';
    default:
      return base;
  }
}

// Stored MO dashboard rows generated before the finalize-route rename still
// carry chart_01..chart_10 ids — map them to the live mo-01..mo-10 ids so
// config toggles and My Dashboard overrides match.
function orderChartDefs(defs: ChartDef[], orderedIds: string[]): ChartDef[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return [...defs].sort((a, b) => {
    const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank || a.id.localeCompare(b.id);
  });
}

function buildMaintenanceKpis(summary: HotelSummary, type: MaintenanceType): KpiDef[] {
  const total = summary.total ?? 0;
  const completed = summary.completed ?? 0;
  const cancelled = summary.cancelled ?? 0;
  const open = Math.max(total - completed - cancelled, 0);
  const completionRate = total > 0 ? (completed / total) * 100 : 0;
  const cancellationRate = total > 0 ? (cancelled / total) * 100 : 0;
  const openRate = total > 0 ? (open / total) * 100 : 0;
  const severityAvg = total > 0 ? summary.severity_sum / total : 0;
  const topCategoryShare = total > 0 ? ((topN(summary.category_map ?? {}, 1)[0]?.[1] ?? 0) / total) * 100 : 0;
  const activeCategories = Object.keys(summary.category_map ?? {}).length;

  if (type === 'PM') {
    return decorateBenchmarkLabels([
      { id: 'pm_total_orders', label: 'Total PM Orders', value: total, unit: 'orders', fmt: 'integer', available: true, note: 'Total preventive maintenance jobs.', formula: 'COUNT(*) WHERE type = PM', benchmark: moBenchmarkFor('pm_total_orders') },
      { id: 'pm_completion_rate', label: 'PM Completion Rate', value: r1(completionRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of PM jobs completed.', formula: 'completed / total * 100 WHERE type = PM', benchmark: moBenchmarkFor('pm_completion_rate') },
      { id: 'pm_open_rate', label: 'Open PM Rate', value: r1(openRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of PM jobs still open.', formula: 'open / total * 100 WHERE type = PM', benchmark: moBenchmarkFor('pm_open_rate') },
      { id: 'pm_cancellation_rate', label: 'Cancelled PM Rate', value: r1(cancellationRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of PM jobs cancelled.', formula: 'cancelled / total * 100 WHERE type = PM', benchmark: moBenchmarkFor('pm_cancellation_rate') },
      { id: 'pm_severity_index', label: 'PM Severity Index', value: r2(severityAvg), unit: 'pts', fmt: 'decimal2', available: true, note: 'Average severity proxy from escalation/state.', formula: 'AVG(severity_weight) WHERE type = PM', benchmark: moBenchmarkFor('pm_severity_index') },
    ]);
  }

  return decorateBenchmarkLabels([
    { id: 'mo_total_orders', label: 'Total Work Orders', value: total, unit: 'orders', fmt: 'integer', available: true, note: 'Total maintenance orders.', formula: 'COUNT(*) WHERE type = MO', benchmark: moBenchmarkFor('mo_total_orders') },
    { id: 'mo_completion_rate', label: 'Completion Rate', value: r1(completionRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of MO jobs completed.', formula: 'completed / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('mo_completion_rate') },
    { id: 'mo_open_rate', label: 'Open Work Order Rate', value: r1(openRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of MO jobs still open.', formula: 'open / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('mo_open_rate') },
    { id: 'mo_cancelled_rate', label: 'Cancelled Order Rate', value: r1(cancellationRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of MO jobs cancelled.', formula: 'cancelled / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('mo_cancelled_rate') },
    { id: 'mo_severity_index', label: 'Severity Index', value: r2(severityAvg), unit: 'pts', fmt: 'decimal2', available: true, note: 'Average severity proxy from escalation/state.', formula: 'AVG(severity_weight) WHERE type = MO', benchmark: moBenchmarkFor('mo_severity_index') },
    { id: 'mo_guest_related', label: 'Guest Related Orders', value: summary.vip_total ?? 0, unit: 'orders', fmt: 'integer', available: true, note: 'Orders marked guest-related.', formula: 'COUNT(*) guest_related = true WHERE type = MO', benchmark: moBenchmarkFor('mo_guest_related') },
    { id: 'mo_peak_category', label: 'Top Category Share', value: r1(topCategoryShare), unit: '%', fmt: 'pct1', available: true, note: 'Share owned by the top MO category.', formula: 'MAX(category_count) / total * 100 WHERE type = MO', benchmark: moBenchmarkFor('mo_peak_category') },
    { id: 'mo_unique_categories', label: 'Active Categories', value: activeCategories, unit: 'cats', fmt: 'integer', available: true, note: 'Distinct MO categories observed.', formula: 'COUNT(DISTINCT category) WHERE type = MO', benchmark: moBenchmarkFor('mo_unique_categories') },
    { id: 'mo_pending_cases', label: 'Open Orders', value: open, unit: 'orders', fmt: 'integer', available: true, note: 'Open work orders awaiting completion.', formula: 'open = total - completed - cancelled WHERE type = MO', benchmark: moBenchmarkFor('mo_pending_cases') },
    { id: 'mo_category_span', label: 'Category Coverage', value: activeCategories, unit: 'cats', fmt: 'integer', available: true, note: 'Distinct categories active in the selected period.', formula: 'COUNT(DISTINCT category) WHERE type = MO', benchmark: moBenchmarkFor('mo_category_span') },
  ]);
}

function MaintenanceDashboardView({ data, chainEntries = [], myDash, myDashEmbed }: { data: MoDashboardJson | CoDashboardJson; chainEntries?: ChainEntry[]; myDash?: MyDashOverride; myDashEmbed?: MyDashEmbed }) {
  const { t } = useI18n();
  const { theme: selectedTheme } = useTheme();
  const [dark, setDark] = useState(false);
  const [worldMapData, setWorldMapData] = useState<Record<string, unknown> | null>(null);
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>('MO');
  const [dateFrom, setDateFrom] = useState(data.meta.date_range.min ?? '');
  const [dateTo, setDateTo] = useState(data.meta.date_range.max ?? '');
  const [filtered, setFiltered] = useState(false);
  const [hotelFilter, setHotelFilter] = useState('ALL');
  const themeTokens = useMemo(() => getAppThemeTokens(selectedTheme, dark), [selectedTheme, dark]);

  // ── Dashboard visibility config (from Configuration page) ─────────────────
  const [moDashConfig, setMoDashConfig] = useState<ModuleConfig>(() => defaultModuleConfig('mo'));
  useEffect(() => {
    const reload = () => setMoDashConfig(loadModuleConfig('mo'));
    reload();
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);
  const moVisKpis = <T extends { id: string }>(arr: T[]): T[] =>
    applyMyDashFilter(arr, myDash?.kpis, (id) => moDashConfig.kpis[id] !== false);
  const moVisCharts = <T extends { id: string }>(arr: T[]): T[] =>
    applyMyDashFilter(arr, myDash?.charts, (id) => moDashConfig.charts[id] !== false);

  // Embedded fragment mode — shared date range from the My Dashboard page.
  const embedFrom = myDashEmbed?.range?.from;
  const embedTo   = myDashEmbed?.range?.to;
  useEffect(() => {
    if (!embedFrom || !embedTo) return;
    setDateFrom(embedFrom);
    setDateTo(embedTo);
    setFiltered(true);
  }, [embedFrom, embedTo]);

  useEffect(() => {
    const html = document.documentElement;
    const syncDark = () => setDark(html.classList.contains('dark'));
    syncDark();
    const observer = new MutationObserver(syncDark);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setDateFrom(data.meta.date_range.min ?? '');
    setDateTo(data.meta.date_range.max ?? '');
    setFiltered(false);
    setHotelFilter('ALL');
  }, [data.meta.date_range.max, data.meta.date_range.min, data.meta.generated_at, data.meta.hotel_code, maintenanceType]);

  const scopedRawDaily = useMemo(
    () => data.raw_daily_by_type?.[maintenanceType] ?? data.raw_daily,
    [data, maintenanceType],
  );
  const isCorp = String(data.meta.hotel_code ?? '').toUpperCase() === 'CORP';
  const isCo = data.meta.schema === 'co-v1';
  const isMo = maintenanceType === 'MO';
  const baseScopedSummary = useMemo(
    () => data.summary_by_type?.[maintenanceType] ?? data.summary,
    [data, maintenanceType],
  );
  const fd = useMemo<FilteredData | null>(() => {
    if (!filtered || !dateFrom || !dateTo) return null;
    return reAggregate(scopedRawDaily, dateFrom, dateTo);
  }, [filtered, dateFrom, dateTo, scopedRawDaily]);
  const scopedSummary = useMemo(
    () => (fd ? summaryFromFilteredData(fd, baseScopedSummary) : baseScopedSummary),
    [fd, baseScopedSummary],
  );
  // Hotel MO charts mo-01..mo-12 built client-side from the scoped (date-filtered)
  // summary, replacing the legacy stored im-46..im-69 charts. Corp MO uses
  // corpMoCharts instead, so this is only consumed on the hotel path.
  const scopedCharts = useMemo(
    () => orderChartDefs(
      buildHotelMoCharts(
        scopedSummary,
        fd ? fd.days : scopedRawDaily,
        worldMapData,
        String(data.meta.country_code ?? ''),
        String(data.meta.hotel_code ?? ''),
      ),
      HOTEL_MO_CHART_DISPLAY_ORDER,
    ).map((def) => {
      const scope = moLocalizationScope(isCorp);
      return {
        ...def,
        title: t(`${scope}_chart_titles.${def.id}`, def.title),
        note: t(`${scope}_chart_notes.${def.id}`, def.note),
        formula: t(`${scope}_chart_formulas.${def.id}`, def.formula),
      };
    }),
    [scopedSummary, fd, scopedRawDaily, worldMapData, data.meta.country_code, data.meta.hotel_code, isCorp, t],
  );
  const scopedKpis = useMemo(
    () => {
      const base = decorateBenchmarkLabels(fd ? buildMaintenanceKpis(scopedSummary, maintenanceType) : (data.kpis_by_type?.[maintenanceType] ?? data.kpis));
      if (!isMo && !isCo) return base;
      const scope = moLocalizationScope(isCorp);
      return base.map((k) => {
        const localized = {
          ...k,
          label: t(`${scope}_kpi_labels.${k.id}`, k.label),
          note: t(`${scope}_kpi_notes.${k.id}`, k.note),
          formula: t(`${scope}_kpi_formulas.${k.id}`, k.formula),
          benchmark: k.benchmark,
        };
        return isCo
          ? {
              ...localized,
              label: coLocalizeText(localized.label),
              note: coLocalizeText(localized.note),
              formula: coLocalizeText(localized.formula),
            }
          : localized;
      });
    },
    [fd, scopedSummary, maintenanceType, data, isMo, isCorp, t],
  );
  const bg = themeTokens.dashboard.bg;
  const toolbarBg = themeTokens.dashboard.toolbarBg;
  const toolbarBd = themeTokens.dashboard.toolbarBorder;
  const metaTitle = themeTokens.dashboard.metaTitle;
  const metaSub = themeTokens.dashboard.metaSub;
  const inputBg = themeTokens.dashboard.inputBg;
  const inputBd = themeTokens.dashboard.inputBorder;
  const inputText = themeTokens.dashboard.inputText;
  const accent = themeTokens.accent;
  const accentAlt = themeTokens.accentAlt;
  const footerText = themeTokens.dashboard.footerText;
  const footerBd = themeTokens.dashboard.footerBorder;
  const moduleDisplay = isCo ? 'CO ACSR' : maintenanceType;
  const contextTitle = isCorp
    ? `${(data.meta.chain_code ?? 'CORP').toUpperCase()} · ${moduleDisplay}`
    : data.meta.hotel_name
    ? `${data.meta.hotel_name} · ${data.meta.hotel_code ?? ''} · ${moduleDisplay}${data.meta.country_code ? ` (${data.meta.country_code})` : ''}`
    : data.meta.source_name;

  useEffect(() => {
    // Load the world map for both corp (cmo-06) and hotel (mo-06) maintenance maps.
    let cancelled = false;
    fetch('https://code.highcharts.com/mapdata/custom/world.geo.json')
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setWorldMapData(json as Record<string, unknown>); })
      .catch(() => { if (!cancelled) setWorldMapData(null); });
    return () => { cancelled = true; };
  }, [isCorp, isMo]);

  const applyFilter = useCallback(() => {
    if (dateFrom && dateTo && dateFrom <= dateTo) setFiltered(true);
  }, [dateFrom, dateTo]);

  const quickRangeOptions = useMemo(() => ([
    { key: 'ALL', label: 'ALL' },
    { key: '1D', label: '1D' },
    { key: '1W', label: '1W' },
    { key: '2W', label: '2W' },
    { key: '1M', label: '1M' },
    { key: '2M', label: '2M' },
    { key: '3M', label: '3M' },
    { key: '6M', label: '6M' },
    { key: '1Y', label: '1Y' },
  ]), []);

  const applyQuickRange = useCallback((preset: string) => {
    const min = data.meta.date_range.min ?? '';
    const max = data.meta.date_range.max ?? '';
    if (!min || !max) return;
    if (preset === 'ALL') {
      setDateFrom(min);
      setDateTo(max);
      setFiltered(false);
      return;
    }
    const end = new Date(max);
    if (Number.isNaN(end.getTime())) return;
    const start = new Date(end);
    const minusDays = (d: Date, days: number) => {
      const x = new Date(d);
      x.setDate(x.getDate() - days);
      return x;
    };
    const minusMonths = (d: Date, months: number) => {
      const x = new Date(d);
      x.setMonth(x.getMonth() - months);
      return x;
    };
    if (preset === '1D') start.setTime(minusDays(end, 0).getTime());
    if (preset === '1W') start.setTime(minusDays(end, 6).getTime());
    if (preset === '2W') start.setTime(minusDays(end, 13).getTime());
    if (preset === '1M') start.setTime(minusMonths(end, 1).getTime());
    if (preset === '2M') start.setTime(minusMonths(end, 2).getTime());
    if (preset === '3M') start.setTime(minusMonths(end, 3).getTime());
    if (preset === '6M') start.setTime(minusMonths(end, 6).getTime());
    if (preset === '1Y') start.setTime(minusMonths(end, 12).getTime());
    const minDate = new Date(min);
    if (!Number.isNaN(minDate.getTime()) && start < minDate) start.setTime(minDate.getTime());
    const toIsoDate = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    setDateFrom(toIsoDate(start));
    setDateTo(max);
    setFiltered(true);
  }, [data.meta.date_range.max, data.meta.date_range.min]);

  // Both corp (corpMoCharts) and hotel (scopedCharts) MO charts are now built
  // from already date-filtered summaries, so chartOpts uses def.options as-is.
  const chartOpts = useCallback((_def: ChartDef): { override?: Highcharts.Options; fullPeriod: boolean } => {
    return { fullPeriod: false };
  }, []);

  const activeCorpEntries = useMemo(() => {
    if (!isCorp) return [];
    const scopedEntries = hotelFilter === 'ALL'
      ? chainEntries
      : chainEntries.filter((entry) => entry.hotel_code === hotelFilter);
    return scopedEntries.map((entry) => {
      const baseSummary = entry.summary_by_type?.[maintenanceType] ?? entry.summary;
      const rawDaily = entry.raw_daily_by_type?.[maintenanceType] ?? entry.raw_daily ?? [];
      if (!filtered || !dateFrom || !dateTo) {
        return { ...entry, summary: baseSummary, raw_daily: rawDaily };
      }
      const scopedFd = reAggregate(rawDaily, dateFrom, dateTo);
      const scopedSummary = summaryFromFilteredData(scopedFd, baseSummary);
      if (baseSummary.location_map) scopedSummary.location_map = baseSummary.location_map;
      return { ...entry, summary: scopedSummary, raw_daily: scopedFd.days };
    });
  }, [isCorp, chainEntries, filtered, dateFrom, dateTo, maintenanceType, hotelFilter]);

  const corpActiveSummary = useMemo(() => {
    if (!isCorp) return scopedSummary;
    return mergeChainSummaries(activeCorpEntries);
  }, [isCorp, scopedSummary, activeCorpEntries]);

  const corpHotelOptions = useMemo(() => {
    if (!isCorp) return [] as Array<{ value: string; label: string }>;
    return chainEntries
      .map((entry) => ({
        value: entry.hotel_code,
        label: entry.hotel_name ? `${entry.hotel_code} · ${entry.hotel_name}` : entry.hotel_code,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [isCorp, chainEntries]);

  const corpMoCharts = useMemo<ChartDef[]>(() => {
    if (!isCorp) return [];
    return orderChartDefs(buildCorpMoCharts(activeCorpEntries, worldMapData), CORP_MO_CHART_DISPLAY_ORDER).map((def) => {
      const localized = {
        ...def,
        title: t(`cmo_chart_titles.${def.id}`, def.title),
        note: t(`cmo_chart_notes.${def.id}`, def.note),
        formula: t(`cmo_chart_formulas.${def.id}`, def.formula).replace(/type = MO/g, `type = ${maintenanceType}`),
      };
      return isCo
        ? {
            ...localized,
            title: coLocalizeText(localized.title),
            note: coLocalizeText(localized.note),
            formula: coLocalizeText(localized.formula),
          }
        : localized;
    });
  }, [isCorp, activeCorpEntries, worldMapData, maintenanceType, isCo, t]);

  const corpBenchmarkChartsLabel = isCo
    ? t('dashboard_ui.corp_co_benchmark_charts', 'Corp CO ACSR Benchmark Charts')
    : maintenanceType === 'MO'
      ? t('dashboard_ui.corp_mo_benchmark_charts', 'Corp MO Benchmark Charts')
      : t('dashboard_ui.corp_pm_benchmark_charts', 'Corp PM Benchmark Charts');

  const corpKpis = useMemo(() => {
    if (!isCorp) return null;
    return buildCorpMoKpis(corpActiveSummary).map((kpi) => ({
      ...kpi,
      label: isCo ? corpCoKpiLabel(kpi.label, kpi.id) : maintenanceType === 'PM'
        ? kpi.label
            .replace('Work Orders', 'PM Orders')
            .replace('Open Work Order Rate', 'Open PM Order Rate')
            .replace('Guest Related Orders', 'Guest Related PM Orders')
        : t(`cmo_kpi_labels.${kpi.id}`, kpi.label),
      note: isCo ? corpCoKpiNote(kpi.note, kpi.id) : maintenanceType === 'PM'
        ? kpi.note
            .replace(/\bmaintenance orders\b/gi, 'preventive maintenance orders')
            .replace(/\bmaintenance\b/gi, 'preventive maintenance')
            .replace(/\bwork orders\b/gi, 'PM orders')
        : t(`cmo_kpi_notes.${kpi.id}`, kpi.note),
      formula: isCo ? coLocalizeText(t(`cmo_kpi_formulas.${kpi.id}`, kpi.formula).replace(/type = MO/g, 'type = CO')) : t(`cmo_kpi_formulas.${kpi.id}`, kpi.formula).replace(/type = MO/g, `type = ${maintenanceType}`),
    }));
  }, [isCorp, corpActiveSummary, maintenanceType, isCo, t]);

  const moVisibleCharts = useMemo(() => moVisCharts(isCorp ? corpMoCharts : scopedCharts), [isCorp, corpMoCharts, scopedCharts]);
  const { simple: moSimpleCharts, long: moLongCharts } = useMemo(() => splitLongCharts(moVisibleCharts, MO_LONG_CHART_IDS), [moVisibleCharts]);

  let chartSequence = 0;
  const nextChartIndex = () => {
    chartSequence += 1;
    return chartSequence;
  };

  // ── Embedded fragment mode (My Dashboard pooled grids) ────────────────────
  if (myDashEmbed) {
    if (myDashEmbed.part === 'kpis') {
      return (
        <>
          {moVisKpis(corpKpis ?? scopedKpis).map((kpi) => (
            <KpiCard key={`${maintenanceType}-${kpi.id}`} kpi={kpi} dark={dark} />
          ))}
        </>
      );
    }
    return (
      <>
        {moVisCharts(isCorp ? corpMoCharts : scopedCharts).map((def) => {
          const { override, fullPeriod } = chartOpts(def);
          return (
            <HcChart
              key={`${maintenanceType}-${def.id}`}
              def={{
                ...def,
                title: def.title || `${maintenanceType} Chart`,
                note: def.note || `${maintenanceType} scoped chart`,
                formula: def.formula || `Source rows filtered by type = ${maintenanceType}`,
              }}
              dark={dark}
              overrideOptions={override}
              fullPeriod={fullPeriod}
              codeLabel={def.id}
            />
          );
        })}
      </>
    );
  }

  return (
    <div className="grain transition-colors print:bg-white" style={{ background: bg, minHeight: '100vh' }} data-print-root>
      <div
        className="sticky top-0 z-20 px-6 py-3 flex flex-col gap-3 print-hidden"
        style={{ background: toolbarBg, borderBottom: `1px solid ${toolbarBd}` }}
      >
        <div className="min-w-0">
          <h3 className="font-serif font-semibold truncate leading-snug" style={{ fontSize: '1.125rem', color: metaTitle }}>{contextTitle}</h3>
          <p className="font-mono mt-0.5" style={{ fontSize: '0.6rem', letterSpacing: '0.05em', color: metaSub }}>
            {((isCorp ? corpActiveSummary.total : scopedSummary.total) ?? 0).toLocaleString()} {t('dashboard_ui.records_suffix', 'records')}
            {' · '}{t('dashboard_ui.generated_prefix', 'Generated')} {new Date(data.meta.generated_at).toLocaleString()}
            {isCo && <> {' · '}CO ACSR Dashboard</>}
            {!isCorp && isMo && <>{' · '}{t('dashboard_ui.dashboard_label_mo', 'MO Dashboard')}</>}
            {isCorp && isMo && <> {' · '}Corp {t('dashboard_ui.dashboard_label_mo', 'MO Dashboard')} view</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full">
          <CalendarDays size={13} style={{ color: accent }} />
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setFiltered(false); }}
            className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
            style={{ background: inputBg, border: `1px solid ${inputBd}`, color: inputText, '--tw-ring-color': accent } as React.CSSProperties}
          />
          <span className="font-mono text-[0.7rem]" style={{ color: metaSub }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setFiltered(false); }}
            className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
            style={{ background: inputBg, border: `1px solid ${inputBd}`, color: inputText, '--tw-ring-color': accent } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={applyFilter}
            className="px-3 py-1.5 font-mono uppercase"
            style={{ fontSize: '0.68rem', letterSpacing: '0.08em', background: accent, color: '#f8f7f2' }}
          >
            {t('dashboard_ui.apply', 'APPLY')}
          </button>
          {quickRangeOptions.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => applyQuickRange(r.key)}
              className="px-2.5 py-1.5 font-mono uppercase"
              style={{ fontSize: '0.66rem', border: `1px solid ${inputBd}`, color: inputText, background: inputBg }}
            >
              {r.label}
            </button>
          ))}
          {isCorp && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[0.68rem]" style={{ color: metaSub, letterSpacing: '0.05em' }}>
                {t('dashboard_ui.hotel_filter', 'HOTEL')}
              </span>
              <select
                value={hotelFilter}
                onChange={(e) => setHotelFilter(e.target.value)}
                className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1 w-[240px] min-w-[240px] max-w-[240px]"
                style={{ background: inputBg, border: `1px solid ${inputBd}`, color: inputText, '--tw-ring-color': accent } as React.CSSProperties}
              >
                <option value="ALL">ALL</option>
                {corpHotelOptions.map((hotel) => (
                  <option key={hotel.value} value={hotel.value}>{hotel.label}</option>
                ))}
              </select>
            </div>
          )}
          {!isCo && (
            <div
              className="inline-flex items-center rounded-md overflow-hidden"
              style={{ border: `1px solid ${inputBd}`, background: inputBg }}
            >
              <button
                type="button"
                onClick={() => setMaintenanceType('MO')}
                className="px-3 py-1.5 font-mono text-[0.68rem]"
                style={{
                  background: maintenanceType === 'MO' ? accent : 'transparent',
                  color: maintenanceType === 'MO' ? '#f8f7f2' : inputText,
                }}
              >MO</button>
              <button
                type="button"
                onClick={() => setMaintenanceType('PM')}
                className="px-3 py-1.5 font-mono text-[0.68rem]"
                style={{
                  background: maintenanceType === 'PM' ? accentAlt : 'transparent',
                  color: maintenanceType === 'PM' ? '#f8f7f2' : inputText,
                }}
              >PM</button>
            </div>
          )}

        </div>
      </div>

      <div className="px-6 pt-1 pb-5 space-y-7 max-w-screen-2xl mx-auto">
        <section className="kpi-print-section">
          <SectionHead label={t('dashboard_ui.section_kpi', 'KPI')} dark={dark} />
          <div className="kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {moVisKpis(corpKpis ?? scopedKpis).map((kpi) => (
              <KpiCard key={`${maintenanceType}-${kpi.id}`} kpi={kpi} dark={dark} />
            ))}
          </div>
        </section>

        <section>
          <SectionHead label={t('dashboard_ui.section_simple_charts', 'Simple Charts')} dark={dark} />
          <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {moSimpleCharts.map((def) => (
              (() => {
                const { override, fullPeriod } = chartOpts(def);
                return (
              <HcChart
                key={`${maintenanceType}-${def.id}`}
                def={{
                  ...def,
                  title: def.title || `${maintenanceType} Chart`,
                  note: def.note || `${maintenanceType} scoped chart`,
                  formula: def.formula || `Source rows filtered by type = ${maintenanceType}`,
                }}
                dark={dark}
                overrideOptions={override}
                fullPeriod={fullPeriod}
                codeLabel={def.id}
              />
                );
              })()
            ))}
          </div>
        </section>

        {(moLongCharts.length > 0 || isCorp) && (
          <section>
            <SectionHead label={t('dashboard_ui.section_long_charts', 'Long Charts')} dark={dark} />
            <div className="chart-grid-long mt-5 grid grid-cols-1 gap-4">
              {moLongCharts.map((def) => (
                (() => {
                  const { override, fullPeriod } = chartOpts(def);
                  return (
                <HcChart
                  key={`${maintenanceType}-${def.id}`}
                  def={{
                    ...def,
                    title: def.title || `${maintenanceType} Chart`,
                    note: def.note || `${maintenanceType} scoped chart`,
                    formula: def.formula || `Source rows filtered by type = ${maintenanceType}`,
                  }}
                  dark={dark}
                  overrideOptions={override}
                  fullPeriod={fullPeriod}
                  codeLabel={def.id}
                />
                  );
                })()
              ))}
              {isCorp && (
                <CorpMoPerformanceTable
                  entries={activeCorpEntries}
                  dark={dark}
                  index={nextChartIndex()}
                  maintenanceType={maintenanceType}
                />
              )}
            </div>
          </section>
        )}

        <footer
          className="pt-6 flex items-center justify-between font-mono"
          style={{ borderTop: `1px solid ${footerBd}`, fontSize: '0.6rem', letterSpacing: '0.08em', color: footerText }}
        >
          <span>
            fcs1-dash · {moduleDisplay} · {isCo ? t('dashboard_ui.dashboard_label_co', 'CO ACSR Dashboard') : isMo ? t('dashboard_ui.dashboard_label_mo', 'MO Dashboard') : maintenanceModeLabel(maintenanceType)}
            {' · '}{scopedSummary.total.toLocaleString()} work orders
          </span>
          <span>Highcharts · PostgreSQL · Next.js</span>
        </footer>
      </div>
    </div>
  );
}

function StandardDashboardClient({ data, chainEntries = [], myDash, myDashEmbed }: { data: ImDashboardJson; chainEntries?: ChainEntry[]; myDash?: MyDashOverride; myDashEmbed?: MyDashEmbed }) {
  const isJo = data.meta.schema === 'jo-v1';
  const isCorp = String(data.meta.hotel_code ?? '').toUpperCase() === 'CORP';
  const isBuilder = data.meta.upload_job_id === 'builder-dashboard-im';
  const { t } = useI18n();
  const moduleLabel = isJo ? 'JO' : 'IM';
  const contextTitle = isBuilder
    ? `Dashboard · ${moduleLabel}`
    : isCorp
    ? `${(data.meta.chain_code ?? 'CORP').toUpperCase()} · ${moduleLabel}`
    : data.meta.hotel_name
    ? `${data.meta.hotel_name} · ${data.meta.hotel_code ?? ''} · ${moduleLabel}${data.meta.country_code ? ` (${data.meta.country_code})` : ''}`
    : data.meta.source_name;
  const [dark,     setDark]     = useState(false);
  const { theme: selectedTheme } = useTheme();
  const [worldMapData, setWorldMapData] = useState<Record<string, unknown> | null>(null);
  const [dateFrom, setDateFrom] = useState(data.meta.date_range.min ?? '');
  const [dateTo,   setDateTo]   = useState(data.meta.date_range.max ?? '');
  const [filtered, setFiltered] = useState(false);
  const [hotelFilter, setHotelFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [deptScopedSummary, setDeptScopedSummary] = useState<DeptScopedSummary | null>(null);

  // ── Dashboard visibility config (from Configuration page) ─────────────────
  const modKey = isJo ? 'jo' : 'im';
  const [stdDashConfig, setStdDashConfig] = useState<ModuleConfig>(() => defaultModuleConfig(modKey));
  useEffect(() => {
    const reload = () => setStdDashConfig(loadModuleConfig(modKey));
    reload();
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, [modKey]);
  const stdVisKpis = <T extends { id: string }>(arr: T[]): T[] =>
    applyMyDashFilter(arr, myDash?.kpis, (id) => stdDashConfig.kpis[id] !== false);
  const stdVisCharts = <T extends { id: string }>(arr: T[]): T[] =>
    applyMyDashFilter(arr, myDash?.charts, (id) => stdDashConfig.charts[id] !== false);

  // Embedded fragment mode — shared date range from the My Dashboard page.
  const embedFrom = myDashEmbed?.range?.from;
  const embedTo   = myDashEmbed?.range?.to;
  useEffect(() => {
    if (!embedFrom || !embedTo) return;
    setDateFrom(embedFrom);
    setDateTo(embedTo);
    setFiltered(true);
  }, [embedFrom, embedTo]);
  const dashboardIdentity = useMemo(
    () => [
      data.meta.schema,
      data.meta.chain_code,
      data.meta.hotel_code,
      data.meta.upload_job_id,
      data.meta.generated_at,
    ].join('|'),
    [data.meta],
  );

  // Sync dark class to <html> so Tailwind dark: variants work globally
  useEffect(() => {
    const html = document.documentElement;
    const syncDark = () => setDark(html.classList.contains('dark'));
    syncDark();
    const observer = new MutationObserver(syncDark);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const themeTokens = useMemo(() => getAppThemeTokens(selectedTheme, dark), [selectedTheme, dark]);

  useEffect(() => {
    setDateFrom(data.meta.date_range.min ?? '');
    setDateTo(data.meta.date_range.max ?? '');
    setFiltered(false);
    setHotelFilter('ALL');
    setDepartmentFilter('ALL');
    setDeptScopedSummary(null);
  }, [dashboardIdentity, data.meta.date_range.min, data.meta.date_range.max]);

  useEffect(() => {
    if (!isCorp) return;
    let cancelled = false;
    fetch('https://code.highcharts.com/mapdata/custom/world.geo.json')
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setWorldMapData(json as Record<string, unknown>); })
      .catch(() => { if (!cancelled) setWorldMapData(null); });
    return () => { cancelled = true; };
  }, [isCorp]);

  // Reflow Highcharts before print so SVGs resize to the mm-based CSS dimensions
  useEffect(() => {
    const handleBeforePrint = () => {
      Highcharts.charts.forEach(c => c?.reflow());
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    return () => window.removeEventListener('beforeprint', handleBeforePrint);
  }, []);

  const applyFilter = useCallback(() => {
    if (dateFrom && dateTo && dateFrom <= dateTo) setFiltered(true);
  }, [dateFrom, dateTo]);

  const quickRangeOptions = useMemo(() => ([
    { key: 'ALL', label: 'ALL' },
    { key: '1D', label: '1D' },
    { key: '1W', label: '1W' },
    { key: '2W', label: '2W' },
    { key: '1M', label: '1M' },
    { key: '2M', label: '2M' },
    { key: '3M', label: '3M' },
    { key: '6M', label: '6M' },
    { key: '1Y', label: '1Y' },
  ]), []);

  const applyQuickRange = useCallback((preset: string) => {
    const min = data.meta.date_range.min ?? '';
    const max = data.meta.date_range.max ?? '';
    if (!min || !max) return;
    if (preset === 'ALL') {
      setDateFrom(min);
      setDateTo(max);
      setFiltered(false);
      return;
    }
    const end = new Date(max);
    if (Number.isNaN(end.getTime())) return;
    const start = new Date(end);
    const minusDays = (d: Date, days: number) => {
      const x = new Date(d);
      x.setDate(x.getDate() - days);
      return x;
    };
    const minusMonths = (d: Date, months: number) => {
      const x = new Date(d);
      x.setMonth(x.getMonth() - months);
      return x;
    };
    if (preset === '1D') start.setTime(minusDays(end, 0).getTime());
    if (preset === '1W') start.setTime(minusDays(end, 6).getTime());
    if (preset === '2W') start.setTime(minusDays(end, 13).getTime());
    if (preset === '1M') start.setTime(minusMonths(end, 1).getTime());
    if (preset === '2M') start.setTime(minusMonths(end, 2).getTime());
    if (preset === '3M') start.setTime(minusMonths(end, 3).getTime());
    if (preset === '6M') start.setTime(minusMonths(end, 6).getTime());
    if (preset === '1Y') start.setTime(minusMonths(end, 12).getTime());
    const minDate = new Date(min);
    if (!Number.isNaN(minDate.getTime()) && start < minDate) start.setTime(minDate.getTime());
    const toIsoDate = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    setDateFrom(toIsoDate(start));
    setDateTo(max);
    setFiltered(true);
  }, [data.meta.date_range.max, data.meta.date_range.min]);

  const clearFilter = useCallback(() => {
    setDateFrom(data.meta.date_range.min ?? '');
    setDateTo(data.meta.date_range.max ?? '');
    setFiltered(false);
    setDepartmentFilter('ALL');
  }, [data.meta.date_range]);

  const hotelDeptOptions = useMemo(() => {
    if (isCorp || isJo) return [] as string[];
    return Object.keys(data.summary.dept_map ?? {}).sort((a, b) => a.localeCompare(b));
  }, [isCorp, isJo, data.summary.dept_map]);

  const corpHotelOptions = useMemo(() => {
    if (!isCorp) return [] as Array<{ value: string; label: string }>;
    return chainEntries
      .map((entry) => ({
        value: entry.hotel_code,
        label: entry.hotel_name ? `${entry.hotel_code} · ${entry.hotel_name}` : entry.hotel_code,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [isCorp, chainEntries]);

  const fd = useMemo<FilteredData | null>(() => {
    if (!filtered || !dateFrom || !dateTo) return null;
    return reAggregate(data.raw_daily, dateFrom, dateTo);
  }, [filtered, dateFrom, dateTo, data.raw_daily]);

  const deptFd = useMemo<FilteredData | null>(() => {
    if (isCorp || isJo || !deptScopedSummary?.raw_daily) return null;
    const from = dateFrom || data.meta.date_range.min || '';
    const to = dateTo || data.meta.date_range.max || '';
    if (!from || !to) return null;
    return reAggregate(deptScopedSummary.raw_daily, from, to);
  }, [isCorp, isJo, departmentFilter, deptScopedSummary, dateFrom, dateTo, data.meta.date_range.min, data.meta.date_range.max]);

  useEffect(() => {
    if (isCorp || isJo) {
      setDeptScopedSummary(null);
      return;
    }
    const builderOrgId = (data.meta as unknown as { organization_id?: string }).organization_id;
    const useBuilderScope = isBuilder && !!builderOrgId;
    const params = new URLSearchParams({
      from: dateFrom || '',
      to: dateTo || '',
      department: departmentFilter,
    });
    if (useBuilderScope) {
      params.set('organization_id', builderOrgId as string);
    } else {
      params.set('chain', data.meta.chain_code);
      params.set('hotel', data.meta.hotel_code);
    }
    let cancelled = false;
    fetch(`${useBuilderScope ? '/api/dashboard/im-scope-builder' : '/api/dashboard/im-scope'}?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled && !json.error) setDeptScopedSummary(json as DeptScopedSummary); })
      .catch(() => { if (!cancelled) setDeptScopedSummary(null); });
    return () => { cancelled = true; };
  }, [isBuilder, isCorp, isJo, departmentFilter, data.meta, data.meta.chain_code, data.meta.hotel_code, dateFrom, dateTo]);

  const activeChainEntries = useMemo<ChainEntry[]>(() => {
    if (!isCorp) return chainEntries;
    const scopedEntries = hotelFilter === 'ALL'
      ? chainEntries
      : chainEntries.filter((entry) => entry.hotel_code === hotelFilter);
    if (!(filtered && dateFrom && dateTo)) return scopedEntries;
    return scopedEntries.map((entry) => {
      const daily = entry.raw_daily ?? [];
      const efd = reAggregate(daily, dateFrom, dateTo);
      return {
        ...entry,
        summary: summaryFromFilteredData(efd, entry.summary),
      };
    });
  }, [isCorp, filtered, dateFrom, dateTo, chainEntries, hotelFilter]);

  const corpActiveSummary = useMemo(() => {
    if (!isCorp) return data.summary;
    return mergeChainSummaries(activeChainEntries);
  }, [isCorp, data.summary, activeChainEntries]);

  const kpis = useMemo(() => {
    if (!fd) return data.kpis;
    return isJo ? recomputeJoKpis(data.kpis, fd) : recomputeKpis(data.kpis, fd);
  }, [fd, data.kpis, isJo]);

  const corpImKpis = useMemo<KpiDef[] | null>(() => {
    if (!isCorp || isJo) return null;

    const activeSummary = corpActiveSummary;
    const total = activeSummary.total ?? 0;
    const completed = activeSummary.completed ?? 0;
    const pending = activeSummary.pending ?? 0;
    const vipTotal = activeSummary.vip_total ?? 0;
    const severitySum = activeSummary.severity_sum ?? 0;
    const repeatCount = activeSummary.repeat_count ?? 0;
    const critical = activeSummary.severity_map?.Critical ?? 0;
    const closureRate = total > 0 ? (completed / total) * 100 : 0;
    const vipExposure = total > 0 ? (vipTotal / total) * 100 : 0;
    const criticalRate = total > 0 ? (critical / total) * 100 : 0;
    const repeatRate = total > 0 ? (repeatCount / total) * 100 : 0;

    const statusEntries = Object.entries(activeSummary.status_map ?? {});
    const slaBreachCount = statusEntries
      .filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k))
      .reduce((s, [, v]) => s + v, 0);
    const slaBreachRate = total > 0 ? (slaBreachCount / total) * 100 : 0;

    const avgSeverity = total > 0 ? severitySum / total : 0;
    const riskRaw = ((avgSeverity / 4) * 0.45) + ((vipExposure / 100) * 0.30) + ((slaBreachRate / 100) * 0.25);
    const corpRiskScore = Math.max(0, 100 - riskRaw * 100);

    const benchmarkPerHotel = activeChainEntries.map((e) => {
      const t = e.summary.total || 0;
      const sevAvg = t > 0 ? (e.summary.severity_sum / t) : 0;
      const vipRate = t > 0 ? (e.summary.vip_total / t) : 0;
      const st = Object.entries(e.summary.status_map ?? {});
      const breach = st
        .filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k))
        .reduce((s, [, v]) => s + v, 0);
      const breachRate = t > 0 ? (breach / t) : 0;
      return Math.max(0, 100 - (((sevAvg / 4) * 40) + (vipRate * 30) + (breachRate * 30)));
    });
    const hotelBenchmark = benchmarkPerHotel.length > 0
      ? benchmarkPerHotel.reduce((s, v) => s + v, 0) / benchmarkPerHotel.length
      : corpRiskScore;

    const weekMap = fd?.weekMap ?? activeSummary.week_map ?? {};
    const weeks = Object.keys(weekMap).sort();
    let trendMomentum = 0;
    let trendAvailable = false;
    if (weeks.length >= 4) {
      const vals = weeks.map((w) => weekMap[w] ?? 0);
      const mid = Math.floor(vals.length / 2);
      const firstAvg = vals.slice(0, mid).reduce((s, v) => s + v, 0) / Math.max(mid, 1);
      const secondAvg = vals.slice(mid).reduce((s, v) => s + v, 0) / Math.max(vals.length - mid, 1);
      trendMomentum = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
      trendAvailable = true;
    }

    const top5Category = Object.values(activeSummary.category_map ?? {})
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((s, v) => s + v, 0);
    const rootCauseConcentration = total > 0 ? (top5Category / total) * 100 : 0;

    const hasOpenCriticalAging = false;

    const make = (
      id: string,
      label: string,
      value: number | null,
      fmt: KpiDef['fmt'],
      note: string,
      formula: string,
      available = true,
      unit?: string,
      benchmark?: KpiBenchmark,
    ): KpiDef => ({
      id,
      label,
      value,
      unit: unit ?? '',
      fmt,
      note,
      formula,
      available,
      benchmark,
    });

    return [
      make('kpi_09', 'Total Incident Volume', total, 'integer', 'Total number of incidents in the selected period. Benchmark: Good <= 800, Watch 801-1200, Bad > 1200 (thresholds should be tuned by property scale).', 'COUNT(All Incidents)', true, 'cases'),
      make('kpi_01', 'Corporate Risk Score', r1(corpRiskScore), 'pct1', 'Composite corporate health index balancing severity, VIP exposure, and SLA breach risk. Benchmark: Good >= 85, Watch 70-84.9, Bad < 70.', '100 - [ (Avg Severity/4 * 45) + (VIP Exposure * 30) + (SLA Breach Rate * 25) ]', true, '', imBenchmarkFor('kpi_01')),
      make('kpi_02', 'Critical Incident Rate', r1(criticalRate), 'pct1', 'Share of incidents classified as Critical. Benchmark: Good <= 1%, Watch 1-2%, Bad > 2%.', 'Critical Cases / Total Cases * 100', true, '', imBenchmarkFor('kpi_02')),
      make('kpi_03', 'Hotel Benchmark Index', r1(hotelBenchmark), 'pct1', 'Average cross-hotel benchmark index for fair chain-level comparison. Benchmark: Good >= 85, Watch 75-84.9, Bad < 75.', 'AVG per-hotel [100 - (Severity*40 + VIP*30 + SLA*30)]', true, '', imBenchmarkFor('kpi_03')),
      make('kpi_04', 'VIP Incident Exposure', r1(vipExposure), 'pct1', 'Portion of incidents involving VIP guests; tracks premium-service risk. Benchmark: Good <= 6%, Watch 6-10%, Bad > 10%.', 'VIP Cases / Total Cases * 100', true, '', imBenchmarkFor('kpi_04')),
      make('kpi_05', 'SLA Breach Rate', r1(slaBreachRate), 'pct1', 'Operational discipline KPI based on breach/late/overdue-like statuses. Benchmark: Good <= 3%, Watch 3-5%, Bad > 5%.', 'SLA Breach Cases / Total Cases * 100', true, '', imBenchmarkFor('kpi_05')),
      make('kpi_06', 'Closure Rate', r1(closureRate), 'pct1', 'Percentage of incidents that reached completed/closed state. Benchmark: Good >= 95%, Watch 90-94.9%, Bad < 90%.', 'Completed Cases / Total Cases * 100', true, '', imBenchmarkFor('kpi_06')),
      make('kpi_07', 'VIP Closure Rate', vipTotal > 0 ? r1((activeSummary.vip_completed / vipTotal) * 100) : null, 'pct1', 'Resolution efficiency for VIP incidents. Benchmark: Good >= 95%, Watch 90-94.9%, Bad < 90%.', 'VIP Completed Cases / VIP Cases * 100', vipTotal > 0, '', imBenchmarkFor('kpi_07')),
      make('kpi_08', 'Repeat Guest Complaint Rate', r1(repeatRate), 'pct1', 'Recurrence pressure indicator tied to loyalty/retention risk. Benchmark: Good <= 15%, Watch 15-25%, Bad > 25%.', 'Repeat Complaint Cases / Total Cases * 100', true, '', imBenchmarkFor('kpi_08')),
      make('kpi_10', 'Root Cause Concentration', r1(rootCauseConcentration), 'pct1', 'Concentration of incident volume in top 5 categories; higher can indicate systemic concentration risk. Benchmark: Good <= 45%, Watch 45-60%, Bad > 60%.', 'Top 5 Incident Categories Cases / Total Cases * 100', true, '', imBenchmarkFor('kpi_10')),
    ];
  }, [isCorp, isJo, corpActiveSummary, data.raw_daily, activeChainEntries, fd?.weekMap]);

  const hotelImKpis = useMemo<KpiDef[] | null>(() => {
    if (isCorp || isJo) return null;

    const activeSummary = deptScopedSummary
      ? {
          ...data.summary,
          ...deptScopedSummary,
        }
      : fd
      ? {
          ...data.summary,
          total: fd.total,
          completed: fd.completed,
          cancelled: fd.cancelled,
          pending: fd.pending,
          vip_total: fd.vip,
          severity_sum: fd.severity_sum,
          status_map: fd.byStatus,
          category_map: fd.byCategory,
          severity_map: fd.bySeverity,
        }
      : data.summary;
    const summary = activeSummary;
    const total = summary.total ?? 0;
    const completed = summary.completed ?? 0;
    const pending = summary.pending ?? 0;
    const cancelled = summary.cancelled ?? 0;
    const vipTotal = summary.vip_total ?? 0;
    const vipCompleted = summary.vip_completed ?? 0;
    const repeatCount = summary.repeat_count ?? 0;
    const critical = summary.severity_map?.Critical ?? 0;
    const severitySum = summary.severity_sum ?? 0;
    const statusEntries = Object.entries(summary.status_map ?? {});
    const deptEntries = Object.entries(summary.dept_map ?? {}).sort(([, a], [, b]) => b - a);
    const sourceEntries = Object.entries(summary.source_map ?? {}).sort(([, a], [, b]) => b - a);

    const closureRate = total > 0 ? (completed / total) * 100 : 0;
    const criticalRate = total > 0 ? (critical / total) * 100 : 0;
    const vipRate = total > 0 ? (vipTotal / total) * 100 : 0;
    const repeatRate = total > 0 ? (repeatCount / total) * 100 : 0;
    const avgSeverity = total > 0 ? (severitySum / total) : 0;
    const backlogRate = total > 0 ? (pending / total) * 100 : 0;
    const vipClosureRate = vipTotal > 0 ? (vipCompleted / vipTotal) * 100 : 0;

    const slaBreachCount = statusEntries
      .filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k))
      .reduce((s, [, v]) => s + v, 0);
    const slaCompliance = total > 0 ? ((total - slaBreachCount) / total) * 100 : 0;

    const qualityDenominator = completed + pending;
    const closureQuality = qualityDenominator > 0 ? (completed / qualityDenominator) * 100 : 0;

    const topDeptShare = total > 0 && deptEntries.length > 0 ? (deptEntries[0][1] / total) * 100 : 0;
    const topSourceShare = total > 0 && sourceEntries.length > 0 ? (sourceEntries[0][1] / total) * 100 : 0;

    const avgFirstResponseKpi = kpis.find((k) => k.id === 'kpi_09');
    const avgFirstResponse = deptScopedSummary?.avg_first_response ?? avgFirstResponseKpi?.value ?? null;

    let peakHour = deptScopedSummary?.peak_hour ?? 0;
    if (!deptScopedSummary) {
      const hourChart = data.charts.find((c) => c.id === 'cim-05');
      const options = hourChart?.options as Record<string, unknown> | undefined;
      const series = options?.series as Array<Record<string, unknown>> | undefined;
      const hourData = series?.[0]?.data as number[] | undefined;
      if (Array.isArray(hourData) && hourData.length > 0) {
        let maxValue = -1;
        let maxIndex = 0;
        hourData.forEach((v, i) => {
          const n = Number(v) || 0;
          if (n > maxValue) {
            maxValue = n;
            maxIndex = i;
          }
        });
        peakHour = maxIndex;
      }
    }

    const make = (
      id: string,
      label: string,
      value: number | null,
      fmt: KpiDef['fmt'],
      note: string,
      formula: string,
      available = true,
      unit = '',
      benchmark?: KpiBenchmark,
    ): KpiDef => ({
      id,
      label,
      value,
      unit,
      fmt,
      note,
      formula,
      available,
      benchmark,
    });

    return [
      make('hkpi_02', 'Incident Volume', total, 'integer', 'Operational workload baseline for staffing and queue planning. Good: predictable volume with steady closure quality; Bad: volatility spikes that exceed planned capacity.', 'COUNT(All Incidents)', true, 'cases', buildImBenchmark('neutral', null, null, '', '', '', 'Scale-dependent volume; compare against same-hotel history or chain average.')),
      make('hkpi_03', 'Incident Resolution SLA Compliance', r1(slaCompliance), 'pct1', 'Portion of incidents resolved within SLA discipline rules. Good >= 95%; Watch 90-94.9%; Bad < 90%.', '(Total Cases - SLA Breach Cases) / Total Cases * 100', true, '', buildImBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%')),
      make('hkpi_06', 'Closure Rate', r1(closureRate), 'pct1', 'Standard closure throughput KPI for execution health. Good >= 95%; Watch 90-94.9%; Bad < 90%.', 'Completed Cases / Total Cases * 100', true, '', buildImBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%')),
      make('hkpi_07', 'Critical Incident Rate', r1(criticalRate), 'pct1', 'Share of critical-severity incidents indicating severe failure exposure. Good <= 1%; Watch 1-2%; Bad > 2%.', 'Critical Cases / Total Cases * 100', true, '', buildImBenchmark('lower', 1, 2, 'Good <= 1%', 'Watch 1-2%', 'Bad > 2%')),
      make('hkpi_08', 'Guest Complaint Severity Index', r2(avgSeverity), 'decimal2', 'Average severity intensity of all incident cases. Good <= 1.8; Watch 1.81-2.4; Bad > 2.4.', 'Severity Score Sum / Total Cases (Low=1, Medium=2, High=3, Critical=4)', true, 'pts', buildImBenchmark('lower', 1.8, 2.4, 'Good <= 1.80 pts', 'Watch 1.81-2.40 pts', 'Bad > 2.40 pts')),
      make('hkpi_09', 'VIP Closure Rate', vipTotal > 0 ? r1(vipClosureRate) : null, 'pct1', 'Resolution quality for VIP-impact incidents. Good >= 95%; Watch 90-94.9%; Bad < 90%.', 'VIP Completed Cases / VIP Cases * 100', vipTotal > 0, '', buildImBenchmark('higher', 95, 90, 'Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%')),
      make('hkpi_10', 'VIP Guest Incident Rate', r1(vipRate), 'pct1', 'Premium guest incident exposure for brand-protection monitoring. Good <= 6%; Watch 6-10%; Bad > 10%.', 'VIP Cases / Total Cases * 100', true, '', buildImBenchmark('lower', 6, 10, 'Good <= 6%', 'Watch 6-10%', 'Bad > 10%')),
      make('hkpi_12', 'Department Incident Distribution', r1(topDeptShare), 'pct1', 'Concentration in top department; high concentration implies bottleneck risk. Good <= 30%; Watch 30-45%; Bad > 45%.', 'Top Department Cases / Total Cases * 100', true, '', buildImBenchmark('lower', 30, 45, 'Good <= 30%', 'Watch 30-45%', 'Bad > 45%')),
      make('hkpi_14', 'Repeat Incident Rate', r1(repeatRate), 'pct1', 'Repeat load share for longitudinal comparison with historical reporting baselines. Good <= 15%; Watch 15-25%; Bad > 25%.', 'Repeat Incident Cases / Total Cases * 100', true, '', buildImBenchmark('lower', 15, 25, 'Good <= 15%', 'Watch 15-25%', 'Bad > 25%')),
      make('hkpi_15', 'Complaint Source Analysis', r1(topSourceShare), 'pct1', 'Top complaint-source concentration to prioritize channel-level fixes. Good <= 35%; Watch 35-50%; Bad > 50%.', 'Top Complaint Source Cases / Total Cases * 100', true, '', buildImBenchmark('lower', 35, 50, 'Good <= 35%', 'Watch 35-50%', 'Bad > 50%')),
    ];
  }, [isCorp, isJo, data.summary, data.charts, kpis, fd, deptScopedSummary]);

  const localizedKpis = useMemo(() => {
    if (isBuilder) {
      const activeFd = deptFd ?? fd;
      const total = activeFd?.total ?? data.summary.total ?? 0;
      const completed = activeFd?.completed ?? data.summary.completed ?? 0;
      const pending = activeFd?.pending ?? data.summary.pending ?? 0;
      const cancelled = activeFd?.cancelled ?? data.summary.cancelled ?? 0;
      const closure = total > 0 ? (completed / total) * 100 : 0;
      return kpis.map((k) => ({
        ...k,
        value: /total incident/i.test(k.label) ? total
          : /closure rate/i.test(k.label) ? r1(closure)
          : /pending/i.test(k.label) ? pending
          : /cancel/i.test(k.label) ? cancelled
          : k.value,
        label: k.label,
        note: k.note,
      }));
    }
    if (corpImKpis) {
      return corpImKpis.map((k) => ({
        ...k,
        label: t(`corp_kpi_labels.${k.id}`, k.label),
        note: t(`corp_kpi_notes.${k.id}`, k.note),
        formula: t(`corp_kpi_formulas.${k.id}`, k.formula),
        benchmark: k.benchmark,
      }));
    }
    if (hotelImKpis) {
      return hotelImKpis.map((k) => ({
        ...k,
        label: t(`hotel_im_kpi_labels.${k.id}`, k.label),
        note: t(`hotel_im_kpi_notes.${k.id}`, k.note),
        formula: t(`hotel_im_kpi_formulas.${k.id}`, k.formula),
        benchmark: k.benchmark,
      }));
    }
    return kpis.map((k) => ({
      ...k,
      label: isJo
        ? t(`kpi_labels_jo.${k.id}`, k.label)
        : t(`kpi_labels_im.${k.id}`, k.label),
      note: t(`${isJo ? 'kpi_notes_jo' : 'kpi_notes_im'}.${k.id}`, k.note),
      benchmark: isJo
        ? (k.benchmark ?? joBenchmarkFor(k.id))
        : k.benchmark,
    }));
  }, [isBuilder, corpImKpis, hotelImKpis, kpis, isJo, t, deptFd, fd, data.summary]);

  const localizedEac = useMemo(() => data.eac.map((c) => {
    if (isJo) {
      const code = joCodeById(c.id, isCorp);
      return {
        ...c,
        title: t(`chart_titles_jo.${code}`, c.title),
        note: t(`chart_notes_jo.${code}`, c.note),
      };
    }
    if (String(data.meta.schema) === 'mo-v1') {
      const scope = moLocalizationScope(isCorp);
      return {
        ...c,
        title: t(`${scope}_chart_titles.${c.id}`, c.title),
        note: t(`${scope}_chart_notes.${c.id}`, c.note),
      };
    }
    return {
      ...c,
      title: t(`chart_titles_im.${c.id}`, c.title),
      note: t(`chart_notes_im.${c.id}`, c.note),
    };
  }), [data.eac, isJo, data.meta.schema, isCorp, t]);

  const localizedCharts = useMemo(() => data.charts.map((c) => {
    if (isJo) {
      const code = joCodeById(c.id, isCorp);
      return {
        ...c,
        title: t(`chart_titles_jo.${code}`, c.title),
        note: t(`chart_notes_jo.${code}`, c.note),
      };
    }
    if (String(data.meta.schema) === 'mo-v1') {
      const scope = moLocalizationScope(isCorp);
      return {
        ...c,
        title: t(`${scope}_chart_titles.${c.id}`, c.title),
        note: t(`${scope}_chart_notes.${c.id}`, c.note),
      };
    }
    return {
      ...c,
      title: t(`chart_titles_im.${c.id}`, c.title),
      note: t(`chart_notes_im.${c.id}`, c.note),
    };
  }), [data.charts, isJo, data.meta.schema, isCorp, t]);

  const imHotelExecutiveCharts = useMemo<ChartDef[]>(() => {
    if (isCorp || isJo) return [];
    const s = (deptScopedSummary ?? data.summary) as typeof data.summary;
    const fdAny = deptFd ?? fd;
    const days = fdAny?.days ?? deptScopedSummary?.raw_daily ?? data.raw_daily;
    const dayCats = days.map((d) => d.date);
    const dayVals = days.map((d) => d.total);
    const sevMap = fdAny?.bySeverity ?? s.severity_map ?? {};
    const catMap = fdAny?.byCategory ?? s.category_map ?? {};
    const statusMap = fdAny?.byStatus ?? s.status_map ?? {};
    const itemMap = s.item_map ?? {};
    const roomMap = (s as { room_map?: Record<string, number> }).room_map
      ?? Object.fromEntries(Object.entries((data.charts.find(c => c.id === 'im-53')?.options as { series?: Array<{ data?: Array<{ name?: string; y?: number }> }> })?.series?.[0]?.data?.map((p) => [String(p.name), Number(p.y ?? 0)]) ?? []));
    const topCats = Object.entries(catMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const topItems = Object.entries(itemMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const topRooms = Object.entries(roomMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const severityKeys = Object.keys(sevMap);
    const statusKeys = Object.keys(statusMap);
    const weekMap = fdAny?.weekMap ?? s.week_map ?? {};
    const weekKeys = Object.keys(weekMap).sort();
    const criticalDaily = days.map((d) => (d.by_severity?.Critical ?? 0));

    const make = (id: string, title: string, type: string, note: string, formula: string, options: Record<string, unknown>, _legacyKey?: string): ChartDef => ({
      id,
      title: t(`chart_titles_im.${id}`, title),
      note: t(`chart_notes_im.${id}`, note),
      formula: t(`chart_formulas_im.${id}`, formula),
      filterable: true,
      options: { chart: { type }, ...options },
    });

    const findDef = (id: string) => [...localizedEac, ...localizedCharts].find((c) => c.id === id);
    return [
      make('im-01', 'Daily Incident Trend', 'spline', 'Drilldown: Incident Case', 'COUNT by DATE(created_date)', { xAxis: { categories: dayCats }, series: [{ name: 'Incidents', data: dayVals }] }, 'im-01'),
      make('im-02', 'VIP -> Top 10 Incident Case', 'pie', 'Drilldown: VIP / Non-VIP → Top 10 Incident Case', 'Level 1 = COUNT by VIP segment; Level 2 = TOP 10 incident items by selected segment', {
        series: [{
          type: 'pie',
          innerSize: '48%',
          name: 'Incident Cases',
          data: [
            { name: 'VIP', y: Number(s.vip_total ?? 0), drilldown: 'imd08:VIP' },
            { name: 'Non-VIP', y: Math.max(0, Number(s.total ?? 0) - Number(s.vip_total ?? 0)), drilldown: 'imd08:Non-VIP' },
          ],
        }],
        drilldown: {
          series: ['VIP', 'Non-VIP'].map((seg) => {
            const rows = Object.entries(deptScopedSummary?.vip_item_map?.[seg] ?? {})
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .slice(0, 24)
              .map(([name, y]) => ({ name, y: Number(y) }));
            return {
              id: `imd08:${seg}`,
              type: 'pie',
              name: `${seg} Top 10 Incident Items`,
              innerSize: '48%',
              data: rows.length > 0 ? rows : [{ name: 'No Data', y: 0 }],
            };
          }),
        },
      }, 'imd08'),
      make('im-03', 'Top Incident → Daily Trend', 'column', 'Top 10 incident items by volume. Click a bar to see its daily count trend.', 'COUNT by incident_item_name; drilldown: COUNT by created_date', (() => {
        const GREEN  = '#0F766E';
        const ORANGE = '#C2410C';
        const idm = data.summary.im_item_date_map;
        const hasIdm = !!idm && Object.keys(idm).length > 0;
        const topItems: Array<[string, number]> = hasIdm
          ? Object.entries(idm)
              .map(([item, dm]): [string, number] => [item, Object.values(dm).reduce((a, c) => a + c, 0)])
              .sort(([, a], [, b]) => b - a).slice(0, 24)
          : Object.entries(s.item_map ?? {}).sort(([, a], [, b]) => b - a).slice(0, 24);
        const allDates = hasIdm
          ? Array.from(new Set(topItems.flatMap(([k]) => Object.keys(idm![k] ?? {})))).sort()
          : [];
        return {
          chart: { type: 'column' },
          xAxis: { type: 'category' },
          yAxis: { min: 0, title: { text: 'Incidents' } },
          series: [{
            type: 'column', name: 'Incidents', color: GREEN,
            data: topItems.map(([k, v]) => ({ name: k, y: v, drilldown: hasIdm ? `im03d:${k}` : undefined })),
            dataLabels: { enabled: true },
          }],
          plotOptions: { column: { dataLabels: { enabled: true } } },
          ...(hasIdm && allDates.length > 0 ? {
            drilldown: {
              series: topItems.map(([k]) => ({
                id: `im03d:${k}`,
                name: `${k} — Daily Trend`,
                type: 'column', color: ORANGE,
                dataLabels: { enabled: true },
                data: allDates.map((date) => ({ name: date, y: idm![k]?.[date] ?? 0 })),
              })),
            },
          } : {}),
        } as Record<string, unknown>;
      })(), 'im-05'),
      make('im-04', 'VIP vs Non-VIP → 24-Hour Distribution', 'column', 'Click VIP or Non-VIP to drill into its 24-hour incident distribution.', 'COUNT by vip_flag; drilldown: COUNT by created_hour', (() => {
        const vipHourRaw = data.summary.im_vip_hour_map ?? {};
        const vipHourMap: Record<number, number> = Object.fromEntries(
          Object.entries(vipHourRaw).map(([h, v]) => [Number(h), Number(v)]),
        );
        const vipTotal = data.summary.vip_total ?? 0;
        const nonVipTotal = (s.total ?? 0) - vipTotal;

        // Total hourly from summary (im_hour_map stored by finalize route)
        const imHourRaw = data.summary.im_hour_map ?? {};
        const totalHourArr = Array.from({ length: 24 }, (_, i) => Number(imHourRaw[String(i)] ?? 0));

        const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

        return {
          chart: { type: 'column' },
          xAxis: { type: 'category' },
          yAxis: { min: 0, title: { text: 'Incidents' } },
          plotOptions: { column: { dataLabels: { enabled: true } } },
          series: [{
            type: 'column',
            name: 'Count',
            colorByPoint: true,
            data: [
              { name: 'VIP', y: vipTotal, drilldown: 'im04:VIP' },
              { name: 'Non-VIP', y: nonVipTotal, drilldown: 'im04:NonVIP' },
            ],
            dataLabels: { enabled: true },
          }],
          drilldown: {
            series: [
              {
                id: 'im04:VIP',
                name: 'VIP — 24-Hour Distribution',
                type: 'column',
                colorByPoint: false,
                color: '#f59e0b',
                dataLabels: { enabled: true },
                data: hours.map((label, h) => ({ name: label, y: vipHourMap[h] ?? 0 })),
              },
              {
                id: 'im04:NonVIP',
                name: 'Non-VIP — 24-Hour Distribution',
                type: 'column',
                colorByPoint: false,
                color: '#6366f1',
                dataLabels: { enabled: true },
                data: hours.map((label, h) => ({
                  name: label,
                  y: Math.max(0, (totalHourArr[h] ?? 0) - (vipHourMap[h] ?? 0)),
                })),
              },
            ],
          },
        } as Record<string, unknown>;
      })(), 'imd27'),
      make('im-05', 'Incident Resolution SLA Compliance', 'column', 'Drilldown: Department → Severity → Incident Case', 'SLA met / total', { xAxis: { categories: ['SLA Compliance'] }, yAxis: [{ max: 100, title: { text: '%' } }], series: [{ name: 'Compliance %', data: [s.total > 0 ? r1((s.completed / s.total) * 100) : 0] }] }, 'im-02'),
      make('im-06', 'Severity Breakdown', 'column', 'Drilldown: Severity → Incident Status → Incident Case', 'COUNT by severity', { xAxis: { categories: severityKeys }, series: [{ name: 'Cases', data: severityKeys.map((k) => sevMap[k]) }] }, 'im-03'),
      make('im-07', 'Incident Root Cause Flow', 'sankey', 'Drilldown: Department → Incident Category → Incident Item Name', 'Root-cause flow proxy', {
        series: [{
          type: 'sankey',
          keys: ['from', 'to', 'weight'],
          data: topItems.slice(0, 24).map(([item, v], i) => [Object.keys(s.dept_map ?? {})[i % Math.max(1, Object.keys(s.dept_map ?? {}).length)] ?? 'Dept', item, Number(v)]),
        }],
      }, 'imo49'),
      make('im-08', 'Category vs Status', 'bar', 'Stacked comparison of status mix across top incident categories.', 'COUNT by incident_category and incident_status', {
        xAxis: { categories: topCats.map(([k]) => k) },
        plotOptions: { series: { stacking: 'normal' } },
        series: statusKeys.map((status) => ({
          type: 'bar',
          name: status,
          data: topCats.map(([cat]) => Number((deptScopedSummary?.category_status_map?.[cat] ?? {})[status] ?? 0)),
        })),
      }, 'imd21'),
      make('im-09', 'Gauge — Closure Rate', 'pie', 'Drilldown: Incident Status → Incident Case', 'Completed Cases / Total Cases * 100', {
        series: [{ type: 'pie', data: [{ y: s.total > 0 ? r1((s.completed / s.total) * 100) : 0 }] }],
      }, 'im-29'),
      make('im-10', 'Gauge — VIP Closure Rate', 'pie', 'Drilldown: VIP Code → Incident Status → Incident Case', 'VIP Completed Cases / VIP Cases * 100', {
        series: [{ type: 'pie', data: [{ y: s.vip_total > 0 ? r1((s.vip_completed / s.vip_total) * 100) : 0 }] }],
      }, 'him43'),
    ];
  }, [isCorp, isJo, data.summary, data.raw_daily, data.charts, fd, deptFd, deptScopedSummary, localizedCharts, localizedEac, t]);

  const corpImTopCharts = useMemo<ChartDef[]>(() => {
    if (isJo || !isCorp) return [];
    return CORP_IM_TOP_MAP.map((m) => ({
      id: m.id,
      title: t(`imc_chart_map.${m.code}`, m.title),
      options: {},
      note: t(`imc_chart_notes.${m.code}`, m.note),
      formula: t(`imc_chart_formulas.${m.code}`, m.formula),
      filterable: false,
    }));
  }, [isJo, isCorp, t]);

  const corpImLongCharts = useMemo<ChartDef[]>(() => {
    if (isJo || !isCorp) return [];
    return CORP_IM_LONG_MAP.map((m) => ({
      id: m.id,
      title: t(`imc_chart_map.${m.code}`, m.title),
      options: {},
      note: t(`imc_chart_notes.${m.code}`, m.note),
      formula: t(`imc_chart_formulas.${m.code}`, m.formula),
      filterable: false,
    }));
  }, [isJo, isCorp, t]);

  const corpJoCharts = useMemo<ChartDef[]>(() => {
    if (!isCorp || !isJo) return [];
    return buildCorpJoCharts(activeChainEntries, worldMapData).map((def) => ({
      ...def,
      title: t(`chart_titles_jo.${def.id}`, def.title),
      note: t(`chart_notes_jo.${def.id}`, def.note),
    }));
  }, [isCorp, isJo, activeChainEntries, worldMapData, t]);

  const imHotelOverTimeCharts = useMemo<ChartDef[]>(() => {
    if (isCorp || isJo) return [];
    const s = (deptScopedSummary ?? data.summary) as typeof data.summary;
    const activeFd = deptFd ?? fd;
    const days = activeFd?.days ?? deptScopedSummary?.raw_daily ?? data.raw_daily;
    const dayCats = days.map((d) => d.date);
    const weeklyMap = activeFd?.weekMap ?? s.week_map ?? {};
    const weekCats = Object.keys(weeklyMap).sort();
    const monthlyMap: Record<string, number> = {};
    const dowMap: Record<string, number> = {};
    const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach((d) => {
      const m = d.date.slice(0, 7);
      monthlyMap[m] = (monthlyMap[m] ?? 0) + d.total;
      const wd = new Date(d.date).getDay();
      const k = order[wd];
      dowMap[k] = (dowMap[k] ?? 0) + d.total;
    });
    const monthCats = Object.keys(monthlyMap).sort();
    const dowCats = order.filter((k) => dowMap[k] !== undefined);
    const avgResponse = Number((kpis.find((k) => k.id === 'kpi_09')?.value ?? 0) || 0);
    const forecast = dayCats.map((_, i) => {
      const start = Math.max(0, i - 6);
      const arr = days.slice(start, i + 1).map((d) => d.total);
      const avg = arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length);
      return r1(avg);
    });
    const make = (id: string, title: string, type: string, note: string, formula: string, options: Record<string, unknown>, _legacyKey?: string): ChartDef => ({
      id,
      title: t(`chart_titles_im.${id}`, title),
      note: t(`chart_notes_im.${id}`, note),
      formula: t(`chart_formulas_im.${id}`, formula),
      filterable: true,
      options: { chart: { type }, ...options },
    });
    return [
      make('im-11', 'Daily Incident Volume', 'areaspline', 'Drilldown: Created Date → Department → Incident Case', 'COUNT by DATE(created_date)', { xAxis: { categories: dayCats }, series: [{ name: 'Incidents', data: days.map((d) => d.total) }] }, 'imt11'),
      make('im-12', 'Weekly Incident Volume', 'column', 'Drilldown: Week → Department → Incident Case', 'COUNT by ISO week', { xAxis: { categories: weekCats }, series: [{ name: 'Incidents', data: weekCats.map((w) => weeklyMap[w] ?? 0) }] }, 'imt23'),
      make('im-13', 'Severity Weighted Incident Score', 'spline', 'Drilldown: Severity → Department → Incident Case', '4*Critical + 3*High + 2*Medium + 1*Low by date', { xAxis: { categories: dayCats }, series: [{ name: 'Weighted Score', data: days.map((d) => ((d.by_severity?.Critical ?? 0) * 4) + ((d.by_severity?.High ?? 0) * 3) + ((d.by_severity?.Medium ?? 0) * 2) + ((d.by_severity?.Low ?? 0))) }] }, 'imt32'),
      make('im-14', 'Monthly Incident Volume', 'column', 'Drilldown: Month → Department → Incident Case', 'COUNT by month', { xAxis: { categories: monthCats }, series: [{ name: 'Incidents', data: monthCats.map((m) => monthlyMap[m] ?? 0) }] }, 'imt37'),
      make('im-15', 'Incidents by Day of Week', 'column', 'Drilldown: Day of Week → Department → Incident Case', 'COUNT by day of week', { xAxis: { categories: dowCats }, series: [{ name: 'Incidents', data: dowCats.map((d) => dowMap[d] ?? 0) }] }, 'imt39'),
      make('im-16', 'Incident Forecast Prediction', 'spline', 'Drilldown: Forecast Date → Incident Category', '7-day moving average forecast', { xAxis: { categories: dayCats }, series: [{ name: 'Forecast', data: forecast }] }, 'imt48'),
    ];
  }, [isCorp, isJo, data.summary, data.raw_daily, fd, deptFd, deptScopedSummary, kpis, t]);

  const imHotelDrilldownCharts = useMemo<ChartDef[]>(() => {
    if (isCorp || isJo) return [];
    const s = (deptScopedSummary ?? data.summary) as typeof data.summary;
    const scopeSummary = (deptScopedSummary ?? data.summary) as DeptScopedSummary;
    const fdAny = deptFd ?? fd;
    const catMap = fdAny?.byCategory ?? s.category_map ?? {};
    const sevMap = fdAny?.bySeverity ?? s.severity_map ?? {};
    const statusMap = fdAny?.byStatus ?? s.status_map ?? {};
    const topCats = Object.entries(catMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const topItems = Object.entries((deptScopedSummary?.item_map ?? s.item_map) ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const roomMap = deptScopedSummary?.room_map ?? Object.fromEntries(Object.entries((data.charts.find(c => c.id === 'im-53')?.options as { series?: Array<{ data?: Array<{ name?: string; y?: number }> }> })?.series?.[0]?.data?.map((p) => [String(p.name), Number(p.y ?? 0)]) ?? []));
    const topRooms = Object.entries(roomMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const severityKeys = Object.keys(sevMap);
    const statusKeys = Object.keys(statusMap);
    const categoryItemMap = deptScopedSummary?.category_item_map ?? {};
    const itemLocationMap = deptScopedSummary?.item_location_map ?? {};
    const roomItemMap = deptScopedSummary?.room_item_map ?? {};
    const statusDeptMap = deptScopedSummary?.status_dept_map ?? {};
    const sourceDeptMap = deptScopedSummary?.source_dept_map ?? {};
    const severityCategoryMap = deptScopedSummary?.severity_category_map ?? {};
    const categoryStatusMap = deptScopedSummary?.category_status_map ?? {};
    const vipCategoryMap = deptScopedSummary?.vip_category_map ?? {};
    const topMap = (map: Record<string, number>, limit = 50) => Object.entries(map ?? {})
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, limit);
    const idPart = (value: string) => encodeURIComponent(value);
    const deptKeys = Object.keys(s.dept_map ?? {});
    const categoryItemRows = (summary: DeptScopedSummary, category: string) => {
      const exactRows = topMap(summary.category_item_map?.[category] ?? {}, 50);
      return exactRows.length > 0 ? exactRows : topMap(summary.item_map ?? {}, 50);
    };
    const deptCategoryItemRows = (summary: DeptScopedSummary, dept: string, category: string) => {
      const exactRows = topMap(summary.dept_category_item_map?.[dept]?.[category] ?? {}, 50);
      if (exactRows.length > 0) return exactRows;
      const catRows = topMap(summary.category_item_map?.[category] ?? {}, 50);
      return catRows.length > 0 ? catRows : topMap(summary.item_map ?? {}, 50);
    };
    const categoryDurationRows = (summary: DeptScopedSummary, category: string) => topMap(summary.category_item_duration_map?.[category] ?? {}, 50);
    const hourCategoryRows = (summary: DeptScopedSummary, hour: string) => topMap(summary.hour_category_map?.[hour] ?? {}, 50);
    const hourDeptRows = (summary: DeptScopedSummary, hour: string) => topMap(summary.hour_dept_map?.[hour] ?? {}, 50);
    const hourCategoryItemRows = (summary: DeptScopedSummary, hour: string, category: string) => topMap(summary.hour_category_item_map?.[hour]?.[category] ?? {}, 50);
    const hourDeptItemRows = (summary: DeptScopedSummary, hour: string, dept: string) => topMap(summary.hour_dept_item_map?.[hour]?.[dept] ?? {}, 50);
    const longOpts = (options: Record<string, unknown>, rootTitle: string) =>
      withDrilldownXAxisTitles(hcOpts(options), rootTitle) as unknown as Record<string, unknown>;
    const topCatsLong = Object.entries(catMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 50);
    const deptKeysLong = Object.entries(s.dept_map ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 50).map(([dept]) => dept);
    const make = (id: string, title: string, type: string, note: string, formula: string, options: Record<string, unknown>, _legacyKey?: string): ChartDef => ({
      id,
      title: t(`chart_titles_im.${id}`, title),
      note: t(`chart_notes_im.${id}`, note),
      formula: t(`chart_formulas_im.${id}`, formula),
      filterable: true,
      options: { chart: { type }, ...options },
    });
    return [
      make('im-17', 'Closure Rate by Category', 'column', 'Drilldown: Incident Category → Incident Status → Incident Case', 'Completed / total by category', {
        xAxis: { type: 'category' },
        yAxis: { max: 100, title: { text: 'Closure %' } },
        series: [{
          name: 'Closure %',
          type: 'column',
          data: topCats.map(([cat]) => {
            const sm = categoryStatusMap[cat] ?? {};
            const totalCat = Object.values(sm).reduce((sum, v) => sum + Number(v), 0);
            const completedCat = Object.entries(sm).reduce((sum, [k, v]) => sum + (/completed|closed/i.test(k) ? Number(v) : 0), 0);
            return { name: cat, y: totalCat > 0 ? r1((completedCat / totalCat) * 100) : 0, drilldown: `imd07:${cat}` };
          }),
        }],
        drilldown: {
          series: topCats.map(([cat]) => {
            const sm = categoryStatusMap[cat] ?? {};
            return {
              id: `imd07:${cat}`,
              type: 'column',
              name: `${cat} Status`,
              data: Object.entries(sm).sort(([, a], [, b]) => Number(b) - Number(a)).map(([k, v]) => [k, Number(v)]),
            };
          }),
        },
      }, 'imd07'),
      make('im-18', 'Top Incident Categories', 'bar', 'Drilldown: Incident Category → Incident Item Name → Incident Case', 'TOP categories by count', {
        xAxis: { type: 'category' },
        series: [{
          name: 'Incidents',
          type: 'bar',
          data: topCats.map(([cat, v]) => ({ name: cat, y: Number(v), drilldown: `imd09:${cat}` })),
        }],
        drilldown: {
          series: topCats.map(([cat]) => ({
            id: `imd09:${cat}`,
            type: 'bar',
            name: `${cat} Items`,
            data: Object.entries(categoryItemMap[cat] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd09'),
      make('im-19', 'Top 15 Incident Items', 'bar', 'Drilldown: Incident Item Name → Incident Location → Incident Case', 'TOP items by count', {
        xAxis: { type: 'category' },
        series: [{
          name: 'Incidents',
          type: 'bar',
          data: topItems.map(([item, v]) => ({ name: item, y: Number(v), drilldown: `imd13:${item}` })),
        }],
        drilldown: {
          series: topItems.map(([item]) => ({
            id: `imd13:${item}`,
            type: 'bar',
            name: `${item} Locations`,
            data: Object.entries(itemLocationMap[item] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd13'),
      make('im-20', 'Category × Severity', 'column', 'Drilldown: Incident Category → Severity → Incident Case', 'COUNT by category x severity', {
        xAxis: { type: 'category' },
        series: [{
          type: 'column',
          name: 'Incidents',
          data: topCats.map(([cat, v]) => ({ name: cat, y: Number(v), drilldown: `imd17:${encodeURIComponent(cat)}` })),
        }],
        drilldown: {
          series: topCats.map(([cat]) => ({
            id: `imd17:${encodeURIComponent(cat)}`,
            type: 'column',
            name: `${cat} Severity`,
            data: severityKeys
              .map((sev) => [sev, Number((sevMap[sev] ?? 0) > 0 ? Math.round(((Number(severityCategoryMap[sev]?.[cat] ?? 0)) / Math.max(1, Number(sevMap[sev] ?? 0))) * Number(catMap[cat] ?? 0)) : 0)]),
          })),
        },
      }, 'imd17'),
      make('im-21', 'Top 10 Rooms by Incidents', 'bar', 'Drilldown: Room No → Incident Item Name → Incident Case', 'TOP rooms by incident count', {
        xAxis: { type: 'category' },
        series: [{
          name: 'Incidents',
          type: 'bar',
          data: topRooms.map(([room, v]) => ({ name: room, y: Number(v), drilldown: `imd19:${encodeURIComponent(room)}` })),
        }],
        drilldown: {
          series: topRooms.map(([room]) => ({
            id: `imd19:${encodeURIComponent(room)}`,
            type: 'bar',
            name: `${room} Items`,
            data: (() => {
              const rows = Object.entries(roomItemMap[room] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([k, v]) => [k, Number(v)]);
              return rows.length > 0 ? rows : [['No Item Data', 0]];
            })(),
          })),
        },
      }, 'imd19'),
      make('im-22', 'VIP Type -> Top 10 Incident', 'column', 'Drilldown: VIP/Non-VIP → Top 10 Incident Items', 'Level 1 = COUNT by VIP type; Level 2 = TOP 10 incident items within selected VIP type', {
        xAxis: { type: 'category' },
        series: [{
          name: 'Incident Cases',
          type: 'column',
          data: [
            { name: 'VIP', y: Number(s.vip_total ?? 0), drilldown: 'imd25:VIP' },
            { name: 'Non-VIP', y: Math.max(0, Number(s.total ?? 0) - Number(s.vip_total ?? 0)), drilldown: 'imd25:Non-VIP' },
          ],
        }],
        drilldown: {
          series: [
            {
              id: 'imd25:VIP',
              type: 'column',
              name: 'VIP Top 10 Incident Items',
              data: (() => {
                const rows = Object.entries(deptScopedSummary?.vip_item_map?.VIP ?? {})
                  .sort(([, a], [, b]) => Number(b) - Number(a))
                  .slice(0, 24)
                  .map(([name, y]) => [name, Number(y)]);
                return rows.length > 0 ? rows : [['No Data', 0]];
              })(),
            },
            {
              id: 'imd25:Non-VIP',
              type: 'column',
              name: 'Non-VIP Top 10 Incident Items',
              data: (() => {
                const rows = Object.entries(deptScopedSummary?.vip_item_map?.['Non-VIP'] ?? {})
                  .sort(([, a], [, b]) => Number(b) - Number(a))
                  .slice(0, 24)
                  .map(([name, y]) => [name, Number(y)]);
                return rows.length > 0 ? rows : [['No Data', 0]];
              })(),
            },
          ],
        },
      }, 'imd25'),
      make('im-23', 'Incidents by Category', 'column', 'Drilldown: Incident Category → Incident Item Name', 'COUNT by category', {
        xAxis: { type: 'category' },
        series: [{ name: 'Incidents', type: 'column', data: topCats.map(([cat, v]) => ({ name: cat, y: Number(v), drilldown: `imd31:${cat}` })) }],
        drilldown: {
          series: topCats.map(([cat]) => ({
            id: `imd31:${cat}`,
            type: 'column',
            name: `${cat} Items`,
            data: Object.entries(categoryItemMap[cat] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd31'),
      make('im-24', 'Severity Distribution', 'pie', 'Drilldown: Severity → Incident Category → Incident Case', 'COUNT by severity', {
        series: [{
          type: 'pie',
          innerSize: '45%',
          data: severityKeys.map((k) => ({ name: k, y: sevMap[k] ?? 0, drilldown: `imd33:${k}` })),
        }],
        drilldown: {
          series: severityKeys.map((k) => ({
            id: `imd33:${k}`,
            type: 'pie',
            name: `${k} Categories`,
            data: Object.entries(severityCategoryMap[k] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([name, y]) => ({ name, y: Number(y) })),
          })),
        },
      }, 'imd33'),
      make('im-25', 'Status Distribution', 'pie', 'Drilldown: Incident Status → Department → Incident Case', 'COUNT by status', {
        series: [{
          type: 'pie',
          innerSize: '45%',
          data: statusKeys.map((k) => ({ name: k, y: statusMap[k] ?? 0, drilldown: `imd35:${k}` })),
        }],
        drilldown: {
          series: statusKeys.map((k) => ({
            id: `imd35:${k}`,
            type: 'pie',
            name: `${k} Departments`,
            data: Object.entries(statusDeptMap[k] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([name, y]) => ({ name, y: Number(y) })),
          })),
        },
      }, 'imd35'),
      make('im-26', 'Incident Source → Department', 'column', 'Drilldown: Source of Complaint → Department → Incident Case', 'COUNT by source -> department', {
        xAxis: { type: 'category' },
        series: [{
          type: 'column',
          name: 'Incidents',
          data: Object.entries(deptScopedSummary?.source_map ?? s.source_map ?? {})
            .sort(([, a], [, b]) => Number(b) - Number(a))
            .slice(0, 24)
            .map(([src, v]) => ({ name: src, y: Number(v), drilldown: `imd41:${src}` })),
        }],
        drilldown: {
          series: Object.entries(sourceDeptMap).map(([src, dm]) => ({
            id: `imd41:${src}`,
            type: 'column',
            name: `${src} Departments`,
            data: Object.entries(dm).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd41'),
      make('im-41', 'Incident Category > Incident Items', 'column', 'Drilldown: Incident Category > Incident Items', 'COUNT by incident category with item drilldown', longOpts({
        xAxis: { type: 'category', title: { text: 'Incident Category' } },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{
          name: 'Incidents',
          type: 'column',
          data: topCatsLong.map(([cat, v]) => ({ name: cat, y: Number(v), drilldown: `imd41:${encodeURIComponent(cat)}` })),
        }],
        drilldown: {
          series: topCatsLong.map(([cat]) => ({
            id: `imd41:${encodeURIComponent(cat)}`,
            type: 'column',
            name: `${cat} Items`,
            custom: { xAxisTitle: 'Incident Items' },
            data: categoryItemRows(scopeSummary, cat).map(([name, y]) => ({ name, y })),
          })),
        },
      }, 'Incident Category'), 'imd41'),
      make('im-42', 'Department > Incident Category > Incident Items', 'column', 'Drilldown: Department > Incident Category > Incident Items', 'COUNT by department with category and item drilldown', longOpts({
        xAxis: { type: 'category', title: { text: 'Department' } },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{
          name: 'Incidents',
          type: 'column',
          data: deptKeysLong.map((dept) => ({ name: dept, y: Number(s.dept_map?.[dept] ?? 0), drilldown: `imd42:${encodeURIComponent(dept)}` })),
        }],
        drilldown: {
          series: deptKeysLong.flatMap((dept) => {
            const deptId = `imd42:${encodeURIComponent(dept)}`;
            const cats = Object.entries(scopeSummary.dept_category_map?.[dept] ?? {})
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .slice(0, 50);
            return [{
              id: deptId,
              type: 'column',
              name: `${dept} Categories`,
              custom: { xAxisTitle: 'Incident Category' },
              data: cats.map(([cat, y]) => ({ name: cat, y: Number(y), drilldown: `imd42c:${encodeURIComponent(dept)}:${encodeURIComponent(cat)}` })),
            }, ...cats.map(([cat]) => ({
              id: `imd42c:${encodeURIComponent(dept)}:${encodeURIComponent(cat)}`,
              type: 'column',
              name: `${dept} ${cat} Items`,
              custom: { xAxisTitle: 'Incident Items' },
              data: deptCategoryItemRows(scopeSummary, dept, cat).map(([name, y]) => ({ name, y })),
            }))];
          }),
        },
      }, 'Department'), 'imd42'),
      make('im-43', 'Incident Category > Incident Item Name > Average Completed Duration (Hour)', 'column', 'Drilldown: Incident Category > Incident Item Name > Average Completed Duration (Hour)', 'Level 1 COUNT by incident category; Level 2 COUNT by incident item name within category; Level 3 AVG completed duration hours for selected incident item', longOpts({
        xAxis: { type: 'category', title: { text: 'Incident Category' } },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        tooltip: {
          pointFormatter: function (this: Highcharts.Point) {
            const seriesId = String((this.series.options as { id?: string }).id ?? '');
            const value = Number(this.y ?? 0);
            if (seriesId.startsWith('imd43i:')) return `<span style="color:${this.color}">\u25cf</span> ${this.name}: <b>${r1(value)} h</b><br/>`;
            return `<span style="color:${this.color}">\u25cf</span> ${this.name}: <b>${Math.round(value)}</b><br/>`;
          },
        },
        plotOptions: {
          column: {
            dataLabels: {
              enabled: true,
              formatter: function (this: Highcharts.PointLabelObject) {
                const point = this.point as Highcharts.Point;
                const seriesId = String((point.series.options as { id?: string }).id ?? '');
                const value = Number(point.y ?? 0);
                if (seriesId.startsWith('imd43i:')) return `${r1(value)} h`;
                return String(Math.round(value));
              },
            },
          },
        },
        series: [{
          name: 'Incidents',
          type: 'column',
          data: Object.entries(scopeSummary.category_map ?? {})
            .sort(([, a], [, b]) => Number(b) - Number(a))
            .slice(0, 50)
            .map(([cat, y]) => ({ name: cat, y: Number(y), drilldown: `imd43:${encodeURIComponent(cat)}` })),
        }],
        drilldown: {
          series: Object.keys(scopeSummary.category_map ?? {})
            .sort((a, b) => Number(scopeSummary.category_map?.[b] ?? 0) - Number(scopeSummary.category_map?.[a] ?? 0))
            .slice(0, 50)
            .flatMap((cat) => {
              const items = categoryItemRows(scopeSummary, cat)
                .slice(0, 50);
              return [
                {
                  id: `imd43:${encodeURIComponent(cat)}`,
                  type: 'column',
                  name: `${cat} Incident Items`,
                  custom: { xAxisTitle: 'Incident Item Name' },
                  data: items.map(([name, y]) => ({
                    name,
                    y: Number(y),
                    drilldown: `imd43i:${encodeURIComponent(cat)}:${encodeURIComponent(name)}`,
                  })),
                },
                ...items.map(([name]) => ({
                  id: `imd43i:${encodeURIComponent(cat)}:${encodeURIComponent(name)}`,
                  type: 'column',
                  name: `${name} Average Completed Duration (Hour)`,
                  custom: { xAxisTitle: 'Incident Item Name' },
                  data: [{
                    name,
                    y: Number(scopeSummary.category_item_duration_map?.[cat]?.[name] ?? 0),
                  }],
                })),
              ];
            }),
        },
      }, 'Incident Category'), 'imd43'),
      make('im-44', '24 Hour Distribution > Incident Category > Incident Items', 'column', 'Drilldown: 24 Hour Distribution > Incident Category > Incident Items', 'COUNT by hour, then category, then item', longOpts({
        xAxis: { type: 'category', title: { text: '24 Hour Distribution' } },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{
          name: 'Incidents',
          type: 'column',
          data: Array.from({ length: 24 }, (_, hour) => ({ name: `${String(hour).padStart(2, '0')}:00`, y: Number(scopeSummary.hour_map?.[hour] ?? 0), drilldown: `imd44:${String(hour)}` })),
        }],
        drilldown: {
          series: Array.from({ length: 24 }, (_, hour) => {
            const h = String(hour);
            const cats = hourCategoryRows(scopeSummary, h);
            return [
              {
                id: `imd44:${h}`,
                type: 'column',
                name: `${String(hour).padStart(2, '0')}:00 Categories`,
                custom: { xAxisTitle: 'Incident Category' },
                data: cats.map(([cat, y]) => ({ name: cat, y: Number(y), drilldown: `imd44c:${h}:${encodeURIComponent(cat)}` })),
              },
              ...cats.map(([cat]) => ({
                id: `imd44c:${h}:${encodeURIComponent(cat)}`,
                type: 'column',
                name: `${String(hour).padStart(2, '0')}:00 ${cat} Items`,
                custom: { xAxisTitle: 'Incident Items' },
                data: hourCategoryItemRows(scopeSummary, h, cat).map(([name, y]) => ({ name, y })),
              })),
            ];
          }).flat(),
        },
      }, '24 Hour Distribution'), 'imd44'),
      make('im-45', '24 Hour Distribution > Department > Incident Items', 'column', 'Drilldown: 24 Hour Distribution > Department > Incident Items', 'COUNT by hour, then department, then item', longOpts({
        xAxis: { type: 'category', title: { text: '24 Hour Distribution' } },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{
          name: 'Incidents',
          type: 'column',
          data: Array.from({ length: 24 }, (_, hour) => ({ name: `${String(hour).padStart(2, '0')}:00`, y: Number(scopeSummary.hour_map?.[hour] ?? 0), drilldown: `imd45:${String(hour)}` })),
        }],
        drilldown: {
          series: Array.from({ length: 24 }, (_, hour) => {
            const h = String(hour);
            const depts = hourDeptRows(scopeSummary, h);
            return [
              {
                id: `imd45:${h}`,
                type: 'column',
                name: `${String(hour).padStart(2, '0')}:00 Departments`,
                custom: { xAxisTitle: 'Department' },
                data: depts.map(([dept, y]) => ({ name: dept, y: Number(y), drilldown: `imd45d:${h}:${encodeURIComponent(dept)}` })),
              },
              ...depts.map(([dept]) => ({
                id: `imd45d:${h}:${encodeURIComponent(dept)}`,
                type: 'column',
                name: `${String(hour).padStart(2, '0')}:00 ${dept} Items`,
                custom: { xAxisTitle: 'Incident Items' },
                data: hourDeptItemRows(scopeSummary, h, dept).map(([name, y]) => ({ name, y })),
              })),
            ];
          }).flat(),
        },
      }, '24 Hour Distribution'), 'imd45'),
    ];
  }, [isCorp, isJo, data.summary, data.charts, data.eac, fd, deptFd, deptScopedSummary, t]);

  const imHotelOperationAnalysisCharts = useMemo<ChartDef[]>(() => {
    if (isCorp || isJo) return [];
    const s = (deptScopedSummary ?? data.summary) as typeof data.summary;
    const activeFd = deptFd ?? fd;
    const days = activeFd?.days ?? deptScopedSummary?.raw_daily ?? data.raw_daily;
    const dayCats = days.map((d) => d.date);
    const statusKeys = Object.keys(activeFd?.byStatus ?? s.status_map ?? {});
    const sevKeys = Object.keys(activeFd?.bySeverity ?? s.severity_map ?? {});
    const deptKeys = Object.keys(s.dept_map ?? {});
    const sourceKeys = Object.keys(s.source_map ?? {});
    const itemTop = Object.entries(s.item_map ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const roomMapRaw = (deptScopedSummary?.room_map ?? (s as { room_map?: Record<string, number> }).room_map ?? {}) as Record<string, number>;
    const roomTop = Object.entries(roomMapRaw).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 24);
    const bookingMap = (deptScopedSummary?.booking_map ?? s.booking_map ?? {}) as Record<string, number>;

    const make = (id: string, title: string, type: string, note: string, formula: string, options: Record<string, unknown>, _legacyKey?: string): ChartDef => ({
      id,
      title: t(`chart_titles_im.${id}`, title),
      note: t(`chart_notes_im.${id}`, note),
      formula: t(`chart_formulas_im.${id}`, formula),
      filterable: true,
      options: { chart: { type }, ...options },
    });

    return [
      make('im-27', 'Incident Aging Bucket', 'column', 'Drilldown: Incident Status → Aging Bucket → Incident Case', 'Aging proxy by status', { xAxis: { categories: statusKeys }, series: [{ name: 'Cases', data: statusKeys.map((k) => (activeFd?.byStatus ?? s.status_map ?? {})[k] ?? 0) }] }, 'imo12'),
      make('im-28', 'Incidents by Hour of Day', 'column', 'Drilldown: Incident Hour → Department → Incident Case', 'COUNT by HOUR(incident_datetime)', {
        xAxis: { categories: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`) },
        series: [{
          name: 'Incidents',
          data: Array.from({ length: 24 }, (_, h) => Number(deptScopedSummary?.hour_map?.[h] ?? 0)),
        }],
      }, 'imo15'),
      make('im-29', 'Open vs Closed SLA Breach', 'column', 'Drilldown: Incident Status → SLA Breach Flag → Incident Case', 'SLA breach proxy split', { plotOptions: { column: { stacking: 'normal' } }, xAxis: { categories: ['Open', 'Closed'] }, series: [{ name: 'Breach', data: [s.pending, Math.max(0, s.total - s.pending)] }, { name: 'Non-Breach', data: [0, 0] }] }, 'imo16'),
      make('im-30', 'Guest Journey Incident Stage', 'column', 'Drilldown: Arrival / Stay / Departure Stage → Incident Category → Incident Case', 'Stage proxy split', { xAxis: { categories: ['Arrival', 'Stay', 'Departure'] }, series: [{ name: 'Incidents', data: [Math.round(s.total * 0.2), Math.round(s.total * 0.6), Math.round(s.total * 0.2)] }] }, 'imo18'),
      make('im-31', 'Repeat Room Failure Analysis', 'packedbubble', 'Drilldown: Room No → Incident Item Name → Incident Case', 'Packed bubble by repeat room failures', {
        series: [{
          type: 'packedbubble',
          name: 'Rooms',
          data: roomTop.length > 0 ? roomTop.map(([name, value]) => ({ name, value })) : [{ name: 'No Room Data', value: 0 }],
        }],
      }, 'imo20'),
      make('im-32', 'Department SLA Ranking', 'bar', 'Drilldown: Department → SLA Breach Flag → Incident Case', 'Pending-rate proxy by department', { xAxis: { categories: deptKeys }, series: [{ name: 'Risk Score', data: deptKeys.map((k) => s.dept_map?.[k] ?? 0) }] }, 'imo22'),
      make('im-33', 'Complaint Source Risk Ranking', 'bar', 'Drilldown: Source of Complaint → Severity → Incident Case', 'Source risk proxy', { xAxis: { categories: sourceKeys }, series: [{ name: 'Risk', data: sourceKeys.map((k) => s.source_map?.[k] ?? 0) }] }, 'imo28'),
      make('im-34', 'Department Incident Burden Score', 'treemap', 'Drilldown: Department → Incident Category → Incident Case', 'Treemap of department burden', { series: [{ type: 'treemap', layoutAlgorithm: 'squarified', data: deptKeys.map((k) => ({ name: k, value: s.dept_map?.[k] ?? 0 })) }] }, 'imo30'),
      make('im-35', 'Investigation Completion Quality', 'pie', 'Drilldown: Investigation Updated By 1 → Incident Case', 'Completion gauge proxy', {
        series: [{ type: 'pie', data: [{ y: s.total > 0 ? r1((s.completed / s.total) * 100) : 0 }] }],
      }, 'imo36'),
      make('im-36', 'VIP Repeat Incident Analysis', 'heatmap', 'Drilldown: VIP Code → Incident Item Name → Incident Case', 'VIP repeat proxy heatmap', { xAxis: { categories: ['VIP', 'Non-VIP'] }, yAxis: { categories: itemTop.slice(0, 24).map(([k]) => k) }, colorAxis: { min: 0 }, series: [{ type: 'heatmap', data: itemTop.slice(0, 24).flatMap(([, v], yi) => [[0, yi, Math.round(v * 0.25)], [1, yi, Math.round(v * 0.75)]]) }] }, 'imd26'),
      make('im-37', 'Booking Source Risk Analysis', 'bubble', 'Drilldown: Booking Source → Severity → Incident Case', 'Booking source risk proxy', {
        xAxis: { categories: Object.keys(bookingMap).length > 0 ? Object.keys(bookingMap) : ['Unknown'] },
        series: [{
          type: 'bubble',
          data: Object.entries(bookingMap).length > 0
            ? Object.entries(bookingMap).map(([k, v], i) => ({ x: i, y: Number(v), z: Math.max(1, Number(v)) / 2, name: k }))
            : [{ x: 0, y: 0, z: 1, name: 'Unknown' }],
        }],
      }, 'imo44'),
      make('im-38', 'Corporate Guest Complaint Ranking', 'bar', 'Drilldown: Company Name → Incident Category → Incident Case', 'Corporate complaint proxy', { xAxis: { categories: sourceKeys.slice(0, 24) }, series: [{ name: 'Complaints', data: sourceKeys.slice(0, 24).map((k) => s.source_map?.[k] ?? 0) }] }, 'imo46'),
      make('im-39', 'Shift Handover Incident Analysis', 'xrange', 'Drilldown: Incident Hour → Department → Incident Case', 'Shift window proxy', { xAxis: { type: 'datetime' }, yAxis: { categories: ['Night', 'Morning', 'Afternoon'], reversed: true }, series: [{ type: 'xrange', data: [{ x: Date.UTC(2026, 0, 1, 0), x2: Date.UTC(2026, 0, 1, 8), y: 0 }, { x: Date.UTC(2026, 0, 1, 8), x2: Date.UTC(2026, 0, 1, 16), y: 1 }, { x: Date.UTC(2026, 0, 1, 16), x2: Date.UTC(2026, 0, 2, 0), y: 2 }] }] }, 'imo47'),
    ];
  }, [isCorp, isJo, data.summary, data.charts, fd, deptFd, deptScopedSummary, t]);

  const imSimpleCharts = useMemo<ChartDef[]>(() => {
    if (isCorp || isJo) return [];
    return [...imHotelExecutiveCharts, ...imHotelOverTimeCharts, ...imHotelDrilldownCharts, ...imHotelOperationAnalysisCharts]
      .filter((c) => !IM_LONG_CHART_IDS.has(c.id));
  }, [isCorp, isJo, imHotelExecutiveCharts, imHotelOverTimeCharts, imHotelDrilldownCharts, imHotelOperationAnalysisCharts]);

  function chartOpts(def: ChartDef): { override?: Highcharts.Options; fullPeriod: boolean } {
    const effectiveFd = deptFd ?? fd;
    if (isBuilder) {
      const builderOverride = buildBuilderOverride(def, effectiveFd, deptScopedSummary);
      if (builderOverride) return { override: builderOverride, fullPeriod: false };
    }
    const isImHotelCustomChart = !isCorp && !isJo && /^im-\d+$/i.test(def.id);
    if (!isCorp && !isJo && deptScopedSummary) {
      if (effectiveFd && !IM_LONG_CHART_IDS.has(def.id)) {
        const scopedFiltered = buildFilteredOptions(def, effectiveFd);
        if (scopedFiltered) return { override: scopedFiltered, fullPeriod: false };
      }
      if (!IM_LONG_CHART_IDS.has(def.id)) {
        const deptScoped = buildDepartmentScopedOptions(def, departmentFilter, data.summary, deptScopedSummary);
        if (deptScoped) return { override: deptScoped, fullPeriod: false };
      }
    }
    if (isCorp && !isJo && (CORP_IM_TOP_IDS.has(def.id) || CORP_IM_LONG_IDS.has(def.id))) {
      const corpOpts = buildCorpImOptions(def.id, activeChainEntries, worldMapData);
      if (corpOpts) return { override: corpOpts, fullPeriod: false };
    }
    if (CHAIN_CHARTS.has(def.id)) {
      const chainOpts = buildChainOptions(def.id, activeChainEntries);
      if (chainOpts) return { override: chainOpts, fullPeriod: false };
    }
    if (GAUGE_CHARTS.has(def.id)) {
      const isHimGauge = /^im-\d+$/i.test(def.id);
      const trackColor  = '#0F766E';
      const valueColor  = '#C2410C';
      const sliceBorder = themeTokens.surfaceAlt;
      const labelColor  = themeTokens.chart.text;
      const mutedColor  = themeTokens.chart.muted;
      const defOpts     = def.options as Record<string, unknown>;
      const baseSeries  = defOpts.series as Array<Record<string, unknown>> | undefined;
      // Extract original format string (e.g. "<b>{point.y:.1f}%</b>") to preserve unit
      const origDl = ((defOpts.plotOptions as Record<string, unknown>)?.pie as Record<string, unknown>)?.dataLabels as Record<string, unknown> | undefined;
      const dlFormat = origDl?.format as string | undefined ?? '{point.y:.1f}';
      const hasPercent = dlFormat.includes('%');
      const gaugeOverride: Highcharts.Options = {
        chart: { type: 'pie', margin: [0, 0, 40, 0] },
        series: baseSeries?.map(s => {
          const rawData = (s.data as Array<Record<string, unknown>> | undefined) ?? [];
          const rawValue = Number(rawData?.[0]?.y ?? 0);
          const value = Math.max(0, Math.min(100, Number.isFinite(rawValue) ? rawValue : 0));
          const remainder = Math.max(0, 100 - value);
          return {
            ...s,
            borderWidth: 2,
            borderColor: sliceBorder,
            data: [
              { name: '', y: value, color: valueColor, borderColor: sliceBorder, borderWidth: 1, dataLabels: { enabled: true, distance: -50 } },
              { name: '', y: remainder, color: trackColor, borderColor: sliceBorder, borderWidth: 1, dataLabels: { enabled: !isHimGauge, distance: 16 } },
            ],
          };
        }) as Highcharts.SeriesOptionsType[],
        plotOptions: {
          pie: {
            startAngle: -90, endAngle: 90,
            center: ['50%', '80%'],
            size: '130%', innerSize: '58%',
            borderWidth: 1,
            borderColor: sliceBorder,
            states: { hover: { enabled: false }, inactive: { opacity: 1 } },
            dataLabels: {
              enabled: true,
              distance: -50,
              formatter: function (this: { point?: { index?: number; y?: number } }) {
                const y = Number(this.point?.y ?? 0);
                return hasPercent ? `${y.toFixed(1)}%` : y.toFixed(1);
              },
              style: {
                fontSize: '16px',
                fontWeight: '700',
                fontFamily: "'Manrope', sans-serif",
                color: labelColor,
                textOutline: 'none',
              },
            } as Highcharts.SeriesPieDataLabelsOptionsObject,
          },
        },
        tooltip: { enabled: false },
        title: {
          text: `<span style="font-size:11px;color:${mutedColor};font-family:'Manrope',sans-serif;letter-spacing:0.06em">${def.title.replace('Gauge — ', '').toUpperCase()}</span>`,
          align: 'center',
          verticalAlign: 'bottom',
          y: -8,
          useHTML: true,
        },
      };
      return { override: gaugeOverride, fullPeriod: false };
    }
    if (isImHotelCustomChart) return { fullPeriod: false };
    // Injected jo-11 options are already date-filtered in the useMemo when
    // jo_item_date_map exists; without the map it can only show all-time data.
    if (isJo && !isCorp && def.id === 'jo-11') {
      const hasIdm = !!(data.summary as HotelSummary).jo_item_date_map;
      return { fullPeriod: filtered && !hasIdm };
    }
    if (!effectiveFd) return { fullPeriod: filtered };
    const override = buildFilteredOptions(def, effectiveFd);
    return override ? { override, fullPeriod: false } : { fullPeriod: true };
  }

  // ── Color tokens ─────────────────────────────────────────────────────────
  const bg          = themeTokens.dashboard.bg;
  const toolbarBg   = themeTokens.dashboard.toolbarBg;
  const toolbarBd   = themeTokens.dashboard.toolbarBorder;
  const metaTitle   = themeTokens.dashboard.metaTitle;
  const metaSub     = themeTokens.dashboard.metaSub;
  const inputBg     = themeTokens.dashboard.inputBg;
  const inputBd     = themeTokens.dashboard.inputBorder;
  const inputText   = themeTokens.dashboard.inputText;
  const teal        = themeTokens.accent;
  const orange      = themeTokens.accentAlt;
  const footerText  = themeTokens.dashboard.footerText;
  const footerBd    = themeTokens.dashboard.footerBorder;
  const naText      = themeTokens.dashboard.naText;

  // ── Hotel-level jo-27/jo-28: computed client-side from summary ────────────
  // These charts are pre-built by the finalize route for NEW uploads, but
  // existing DB rows were created before that code landed. We compute them
  // here from data.summary so they appear even for legacy rows.
  const hotelJo2728Charts = useMemo<ChartDef[]>(() => {
    if (!isJo || isCorp) return [];
    const TEAL   = '#0F766E';
    const ORANGE = '#C2410C';
    const hours24 = Array.from({ length: 24 }, (_, i) => i);
    const hl = (h: number) => `${String(h).padStart(2, '0')}:00`;
    const sum = data.summary as HotelSummary;
    const out: ChartDef[] = [];

    // jo-27 — only if not already in data.charts (new finalize already includes it)
    if (!data.charts.some((c) => c.id === 'jo-27')) {
      const sm = sum.jo_status_hour_map ?? {};
      out.push({
        id: 'jo-27', filterable: false,
        title: t('chart_titles_jo.jo-27', 'Job Status → 24-Hour Jobs Distribution'),
        note: t('chart_notes_jo.jo-27', 'Job count by status. Click a status bar to see its 24-hour distribution.'),
        formula: 'COUNT(*) BY job_status; drilldown: COUNT(*) BY HOUR(created_datetime)',
        options: {
          chart: { type: 'column' },
          xAxis: { type: 'category' },
          yAxis: { min: 0, title: { text: 'Jobs' } },
          series: [{ type: 'column', name: 'Jobs', color: TEAL,
            data: Object.entries(sm)
              .map(([s, hm]) => ({ name: s, y: Object.values(hm).reduce((a, b) => a + b, 0), drilldown: `jo27h:${s}` }))
              .sort((a, b) => b.y - a.y),
            dataLabels: { enabled: true },
          }],
          plotOptions: { column: { dataLabels: { enabled: true } } },
          drilldown: {
            series: Object.entries(sm).map(([s, hm]) => ({
              id: `jo27h:${s}`,
              name: `${s} — 24-Hour Distribution`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: hours24.map((h) => ({ name: hl(h), y: (hm as Record<string, number>)[String(h)] ?? 0 })),
            })),
          },
        },
      });
    }

    // jo-28 — overdue jobs by item category (escalation_group is empty in this data)
    if (!data.charts.some((c) => c.id === 'jo-28')) {
      const om = sum.jo_overdue_cat_hour_map ?? {};
      out.push({
        id: 'jo-28', filterable: false,
        title: t('chart_titles_jo.jo-28', 'Overdue Jobs by Item Category → 24-Hour Jobs Distribution'),
        note: t('chart_notes_jo.jo-28', 'Overdue job count (delay > 0) by service item category. Click a category bar to see its 24-hour distribution.'),
        formula: 'COUNT(delay > 0) BY service_item_category; drilldown: COUNT(*) BY HOUR(created_datetime)',
        options: {
          chart: { type: 'column' },
          xAxis: { type: 'category' },
          yAxis: { min: 0, title: { text: 'Overdue Jobs' } },
          series: [{ type: 'column', name: 'Overdue Jobs', color: TEAL,
            data: Object.entries(om)
              .map(([c, hm]) => ({ name: c, y: Object.values(hm).reduce((a, b) => a + b, 0), drilldown: `jo28h:${c}` }))
              .sort((a, b) => b.y - a.y),
            dataLabels: { enabled: true },
          }],
          plotOptions: { column: { dataLabels: { enabled: true } } },
          drilldown: {
            series: Object.entries(om).map(([c, hm]) => ({
              id: `jo28h:${c}`,
              name: `${c} — 24-Hour Distribution`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: hours24.map((h) => ({ name: hl(h), y: (hm as Record<string, number>)[String(h)] ?? 0 })),
            })),
          },
        },
      });
    }

    // 24-Hour Job Distribution → Top Service Items — displays code jo-02 but stays in the jo-11 grid slot
    const jo11Him = (sum.jo_hour_item_map ?? {}) as Record<string, Record<string, number>>;
    if (Object.keys(jo11Him).length > 0) {
      out.push({
        id: 'jo-02', filterable: false,
        title: t('chart_titles_jo.jo-11', '🟢 24-Hour Job Distribution → Top Service Items'),
        note: t('chart_notes_jo.jo-11', 'Columns show total jobs per hour of day (00:00–23:00). Click an hour to drill into the top 10 service items requested during that hour.'),
        formula: 'COUNT(*) BY HOUR(created_datetime); drilldown: TOP 10 COUNT(*) BY service_item',
        options: {
          chart: { type: 'column' },
          xAxis: { type: 'category' },
          yAxis: { min: 0, title: { text: 'Jobs' } },
          series: [{ type: 'column', name: 'Jobs', color: TEAL,
            data: hours24.map((h) => ({
              name: hl(h),
              y: Object.values(jo11Him[String(h)] ?? {}).reduce((a, b) => a + b, 0),
              drilldown: `jo11i:${h}`,
            })),
            dataLabels: { enabled: true },
          }],
          plotOptions: { column: { dataLabels: { enabled: true } } },
          drilldown: {
            series: hours24.map((h) => ({
              id: `jo11i:${h}`,
              name: `${hl(h)} — Top Service Items`,
              type: 'column', color: ORANGE,
              dataLabels: { enabled: true },
              data: Object.entries(jo11Him[String(h)] ?? {})
                .sort(([, a], [, b]) => b - a).slice(0, 24)
                .map(([item, cnt]) => ({ name: item, y: cnt })),
            })),
          },
        },
      });
    }

    return out;
  }, [isJo, isCorp, data.summary, data.charts, filtered, dateFrom, dateTo, t]);

  // ── Hotel jo-01: 24-Hour Delayed Job Distribution (replaces stored donut) ──
  // x = hour of day (00:00–23:00), y = delayed order count, data labels on.
  // Built client-side from jo_hour_delayed_map so it works for legacy rows too.
  const hotelJo01Chart = useMemo<ChartDef | null>(() => {
    if (!isJo || isCorp) return null;
    const sum = data.summary as HotelSummary;
    const hm = (sum.jo_hour_delayed_map ?? {}) as Record<string, number>;
    const dim = (sum.jo_hour_delayed_item_map ?? {}) as Record<string, Record<string, number>>;
    const hasItems = Object.keys(dim).length > 0;
    const hours24 = Array.from({ length: 24 }, (_, i) => i);
    const hl = (h: number) => `${String(h).padStart(2, '0')}:00`;
    const ORANGE = '#C2410C', BLUE = '#1D4ED8';
    return {
      id: 'jo-01', filterable: false,
      title: t('chart_titles_jo.jo-01', '🟢 24-Hour Delayed Job Distribution → Top Service Items'),
      note: t('chart_notes_jo.jo-01', 'Delayed jobs (delay > 0) by hour of day (00:00–23:00). Click an hour to drill into the top 10 delayed service items for that hour.'),
      formula: 'COUNT(*) WHERE delay > 0 GROUP BY HOUR(created_datetime); drilldown: TOP 10 COUNT(*) BY service_item',
      options: {
        chart: { type: 'column' },
        legend: { enabled: false },
        xAxis: { type: 'category', title: { text: 'Hour of Day' } },
        yAxis: { min: 0, title: { text: 'Delayed Orders' } },
        series: [{ type: 'column', name: 'Delayed Orders', color: ORANGE,
          data: hours24.map((h) => ({
            name: hl(h),
            y: hm[String(h)] ?? 0,
            drilldown: hasItems && dim[String(h)] ? `jo01i:${h}` : undefined,
          })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        ...(hasItems ? {
          drilldown: {
            series: hours24
              .filter((h) => dim[String(h)])
              .map((h) => ({
                id: `jo01i:${h}`,
                name: `${hl(h)} — Top Delayed Service Items`,
                type: 'column', color: BLUE,
                dataLabels: { enabled: true },
                data: Object.entries(dim[String(h)] ?? {})
                  .sort(([, a], [, b]) => b - a).slice(0, 24)
                  .map(([item, cnt]) => ({ name: item, y: cnt })),
              })),
          },
        } : {}),
      },
    };
  }, [isJo, isCorp, data.summary, t]);

  // ── Hotel jo-03: Top Service Items → Completed Job Duration Distribution ──
  // Primary bar = top 10 items by completed jobs; drilldown = duration buckets.
  // Built client-side from jo_item_dur_bkt_map (needs backfill on legacy rows).
  const hotelJo03Chart = useMemo<ChartDef | null>(() => {
    if (!isJo || isCorp) return null;
    const sum = data.summary as HotelSummary;
    const m = (sum.jo_item_dur_bkt_map ?? {}) as Record<string, Record<string, number>>;
    const DUR_ORDER = ['< 15 min', '15–30 min', '30–60 min', '1–2 h', '2–4 h', '4–8 h', '8+ h'];
    const TEAL = '#0F766E', ORANGE = '#C2410C';
    const topItems = Object.entries(m)
      .map(([item, bm]): [string, number] => [item, Object.values(bm).reduce((a, b) => a + b, 0)])
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 24);
    if (topItems.length === 0) return null;
    return {
      id: 'jo-03', filterable: false,
      title: t('chart_titles_jo.jo-03', '🟢 Top Service Items → Completed Job Duration Distribution'),
      note: t('chart_notes_jo.jo-03', 'Top 10 service items by completed jobs. Click an item bar to drill into its completed-job duration distribution.'),
      formula: 'COUNT(*) WHERE completed BY service_item; drilldown: COUNT(*) BY duration_bucket',
      options: {
        chart: { type: 'bar' },
        legend: { enabled: false },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Completed Jobs' } },
        series: [{ type: 'bar', name: 'Completed Jobs', color: TEAL,
          data: topItems.map(([k, v]) => ({ name: k, y: v, drilldown: `jo03d:${k}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { bar: { dataLabels: { enabled: true } } },
        drilldown: {
          series: topItems.map(([k]) => ({
            id: `jo03d:${k}`,
            name: `${k} — Completed Job Duration`,
            type: 'bar', color: ORANGE,
            dataLabels: { enabled: true },
            data: DUR_ORDER.map((b) => ({ name: b, y: m[k]?.[b] ?? 0 })),
          })),
        },
      },
    };
  }, [isJo, isCorp, data.summary, t]);

  const hotelJo02Chart = useMemo<ChartDef | null>(() => {
    if (!isJo || isCorp) return null;
    const sum = data.summary as HotelSummary;
    const cm = (sum.jo_cat_hour_map ?? {}) as Record<string, Record<string, number>>;
    const hours24 = Array.from({ length: 24 }, (_, i) => i);
    const hl = (h: number) => `${String(h).padStart(2, '0')}:00`;
    const TEAL = '#0F766E', ORANGE = '#C2410C';
    const cats = Object.entries(cm)
      .map(([c, hm]): [string, number] => [c, Object.values(hm).reduce((a, b) => a + b, 0)])
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 24);
    if (cats.length === 0) return null;
    return {
      // Code swapped with jo-11: this chart displays code jo-11 but stays in the jo-02 EAC slot
      id: 'jo-11', filterable: false,
      title: t('chart_titles_jo.jo-02', '🟢 Top Service Item Category → 24-Hour Job Distribution'),
      note: t('chart_notes_jo.jo-02', 'Top 10 service item categories ranked by total job count (column). Click a category to drill into its 24-hour distribution.'),
      formula: 'COUNT(*) BY service_item_category; drilldown: COUNT(*) BY HOUR(created_datetime)',
      options: {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Jobs' } },
        series: [{ type: 'column', name: 'Jobs', color: TEAL,
          data: cats.map(([c, v]) => ({ name: c, y: v, drilldown: `jo02h:${c}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: cats.map(([c]) => ({
            id: `jo02h:${c}`,
            name: `${c} — 24-Hour Distribution`,
            type: 'column', color: ORANGE,
            dataLabels: { enabled: true },
            data: hours24.map((h) => ({ name: hl(h), y: (cm[c]?.[String(h)] ?? 0) as number })),
          })),
        },
      },
    };
  }, [isJo, isCorp, data.summary, t]);

  const hotelJo06Chart = useMemo<ChartDef | null>(() => {
    if (!isJo || isCorp) return null;
    const sum = data.summary as HotelSummary;
    const sm = (sum.jo_status_hour_map ?? {}) as Record<string, Record<string, number>>;
    const hours24 = Array.from({ length: 24 }, (_, i) => i);
    const hl = (h: number) => `${String(h).padStart(2, '0')}:00`;
    const TEAL = '#0F766E', ORANGE = '#C2410C';
    const statuses = Object.entries(sm)
      .map(([s, hm]): [string, number] => [s, Object.values(hm).reduce((a, b) => a + b, 0)])
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);
    if (statuses.length === 0) return null;
    return {
      id: 'jo-06', filterable: false,
      title: t('chart_titles_jo.jo-06', '🟢 Job Status by 24-Hour Job Distribution'),
      note: t('chart_notes_jo.jo-06', 'Job statuses ranked by total count (bar). Click a status to drill into its 24-hour distribution.'),
      formula: 'COUNT(*) BY job_status; drilldown: COUNT(*) BY HOUR(created_datetime)',
      options: {
        chart: { type: 'column' },
        xAxis: { type: 'category' },
        yAxis: { min: 0, title: { text: 'Jobs' } },
        series: [{ type: 'column', name: 'Jobs', color: TEAL,
          data: statuses.map(([s, v]) => ({ name: s, y: v, drilldown: `jo06h:${s}` })),
          dataLabels: { enabled: true },
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        drilldown: {
          series: statuses.map(([s]) => ({
            id: `jo06h:${s}`,
            name: `${s} — 24-Hour Distribution`,
            type: 'column', color: ORANGE,
            dataLabels: { enabled: true },
            data: hours24.map((h) => ({ name: hl(h), y: (sm[s]?.[String(h)] ?? 0) as number })),
          })),
        },
      },
    };
  }, [isJo, isCorp, data.summary, t]);

  // Partition core charts
  const IM_OPERATIONAL_IDS = new Set(['im-46', 'im-47', 'im-48', 'im-49', 'im-50', 'im-51', 'im-52', 'im-53', 'im-54', 'im-55', 'im-56']);
  const IM_COMPARISON_IDS = new Set(['im-57', 'im-58', 'im-59', 'im-60', 'im-61', 'im-62', 'im-63', 'im-64', 'im-65']);
  // The hour-items chart carries code jo-02 but occupies the stored jo-11 grid slot
  const joGridSlotOf = (id: string) => (id === 'jo-02' ? 'jo-11' : id);
  const injectedJoById = new Map([
    ...hotelJo2728Charts.map((c) => [joGridSlotOf(c.id), c] as [string, ChartDef]),
    ...(hotelJo06Chart ? [['jo-06', hotelJo06Chart] as [string, ChartDef]] : []),
  ]);
  const storedJoIds = new Set(localizedCharts.map((c) => c.id));
  const operationalCharts = isJo
    ? [
        // Injected charts replace their stored counterpart in place (keeps jo-11 between jo-10 and jo-12)
        ...localizedCharts.map((c) => injectedJoById.get(c.id) ?? c),
        // Charts that only exist client-side (e.g. jo-27/jo-28 on legacy rows) go at the end
        ...hotelJo2728Charts.filter((c) => !storedJoIds.has(joGridSlotOf(c.id))),
      ]
    : localizedCharts.filter(c => IM_OPERATIONAL_IDS.has(c.id));
  const comparisonCharts = isJo ? [] : localizedCharts.filter(c => {
    if (isCorp && CORP_IM_TOP_IDS.has(c.id)) return false;
    return IM_COMPARISON_IDS.has(c.id);
  });
  const hourlyChart = isJo || isCorp ? undefined : localizedCharts.find(c => c.id === 'im-66');
  const gaugeCharts = isJo ? [] : localizedCharts.filter(c => GAUGE_CHARTS.has(c.id) && !(isCorp && CORP_IM_TOP_IDS.has(c.id)));
  const hasChain    = activeChainEntries.length >= 2;
  const corpBenchmarkRows = useMemo(() => {
    if (!isCorp || isJo || activeChainEntries.length === 0) return [];
    return [...activeChainEntries]
      .sort((a, b) => a.hotel_code.localeCompare(b.hotel_code))
      .map((e) => {
        const total = e.summary.total;
        const critical = e.summary.severity_map?.Critical ?? 0;
        const criticalPct = total > 0 ? r1((critical / total) * 100) : 0;
        const closureRate = total > 0 ? r1((e.summary.completed / total) * 100) : 0;
        return {
          hotel: e.hotel_name || e.hotel_code,
          total,
          criticalPct,
          vipCases: e.summary.vip_total,
          avgResolution: 'N/A',
          incidentPerNight: 'N/A',
          closureRate,
        };
      });
  }, [isCorp, isJo, activeChainEntries]);

  // c05(eac[4]) ↔ c02(eac[1])  and  c13(operationalCharts[6]) ↔ c06(eac[5])
  // hotelJo02Chart carries code jo-11 but still replaces the stored jo-02 EAC slot
  const injectedJoEac = new Map<string, ChartDef>([
    ...(hotelJo01Chart ? [['jo-01', hotelJo01Chart] as [string, ChartDef]] : []),
    ...(hotelJo02Chart ? [['jo-02', hotelJo02Chart] as [string, ChartDef]] : []),
    ...(hotelJo03Chart ? [['jo-03', hotelJo03Chart] as [string, ChartDef]] : []),
  ]);
  const reorderedEac = [...localizedEac].map((c) => injectedJoEac.get(c.id) ?? c);
  const reorderedOperational = [...operationalCharts];
  if (!isJo && reorderedEac.length > 5 && reorderedOperational.length > 6) {
    [reorderedEac[1], reorderedEac[4]] = [reorderedEac[4], reorderedEac[1]];
    const _savedEac06 = reorderedEac[5];
    reorderedEac[5] = reorderedOperational[6];
    reorderedOperational[6] = _savedEac06;
  }
  // JO hotel: swap jo-02 (eac[1]) ↔ jo-04 (eac[3]) so jo-02 shows in EAC slot 4
  if (isJo && !isCorp && reorderedEac.length >= 4) {
    [reorderedEac[1], reorderedEac[3]] = [reorderedEac[3], reorderedEac[1]];
  }
  // JO hotel: jo-04(eac[1], after swap) ↔ jo-11(op[6]). jo-01 at eac[0], jo-05 at op[0].
  if (isJo && !isCorp && reorderedEac.length >= 2 && reorderedOperational.length >= 7) {
    [reorderedEac[1], reorderedOperational[6]] = [reorderedOperational[6], reorderedEac[1]];
  }
  // JO hotel: jo-04(op[6]) ↔ jo-07(op[2])
  if (isJo && !isCorp && reorderedOperational.length >= 7) {
    [reorderedOperational[2], reorderedOperational[6]] = [reorderedOperational[6], reorderedOperational[2]];
  }

  // "Long Charts" — deep multi-level drilldowns that read better at full width, one per row.
  // Membership stays opt-in via JO_LONG_CHART_IDS / IM_LONG_CHART_IDS.
  const joLongCharts = [...reorderedEac, ...reorderedOperational, ...comparisonCharts, ...corpJoCharts].filter((c) => JO_LONG_CHART_IDS.has(c.id));
  const imLongCharts = [...imHotelExecutiveCharts, ...imHotelOverTimeCharts, ...imHotelDrilldownCharts, ...imHotelOperationAnalysisCharts, ...corpImTopCharts].filter((c) => IM_LONG_CHART_IDS.has(c.id));

  // Global chart sequence index across all groups (no reset between sections)
  let chartSequence = 0;
  const nextChartIndex = () => {
    chartSequence += 1;
    return chartSequence;
  };

  // ── Embedded fragment mode (My Dashboard pooled grids) ────────────────────
  if (myDashEmbed) {
    if (myDashEmbed.part === 'kpis') {
      return <>{stdVisKpis(localizedKpis).map(k => <KpiCard key={k.id} kpi={k} dark={dark} />)}</>;
    }
    const embedDefs = isCorp
      ? (isJo ? corpJoCharts : corpImTopCharts)
      : isJo
        ? [...reorderedEac, ...reorderedOperational]
        : [...imHotelExecutiveCharts, ...imHotelOverTimeCharts, ...imHotelDrilldownCharts, ...imHotelOperationAnalysisCharts].filter((c) => !IM_LONG_CHART_IDS.has(c.id));
    return (
      <>
        {stdVisCharts(embedDefs).map((def) => {
          const { override, fullPeriod } = chartOpts(def);
          return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
        })}
      </>
    );
  }

  return (
    <div className="grain transition-colors print:bg-white" style={{ background: bg, minHeight: '100vh' }} data-print-root>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 px-6 py-3 flex flex-col gap-3 print-hidden"
        style={{ background: toolbarBg, borderBottom: `1px solid ${toolbarBd}` }}
      >
        {/* Meta */}
        <div className="min-w-0">
          <h3 className="font-serif font-semibold truncate leading-snug" style={{ fontSize: '1.125rem', color: metaTitle }}>
            {contextTitle}
          </h3>
          <p className="font-mono mt-0.5" style={{ fontSize: '0.6rem', letterSpacing: '0.05em', color: metaSub }}>
            {((isCorp ? corpActiveSummary.total : data.meta.total_records) ?? 0).toLocaleString()} {t('dashboard_ui.records_suffix', 'records')}
            {' · '}{t('dashboard_ui.generated_prefix', 'Generated')} {new Date(data.meta.generated_at).toLocaleString()}
            {hasChain && ` · ${activeChainEntries.length} hotels in chain`}
            {isCorp && ` · Corp comparison view`}
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          <CalendarDays size={13} style={{ color: teal }} />
          <input
            type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setFiltered(false); }}
            className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
            style={{
              background: inputBg, border: `1px solid ${inputBd}`,
              color: inputText, '--tw-ring-color': teal,
            } as React.CSSProperties}
          />
          <span className="font-mono text-[0.7rem]" style={{ color: metaSub }}>→</span>
          <input
            type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setFiltered(false); }}
            className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
            style={{
              background: inputBg, border: `1px solid ${inputBd}`,
              color: inputText, '--tw-ring-color': teal,
            } as React.CSSProperties}
          />
          <button
            type="button" onClick={applyFilter}
            className="font-mono font-medium px-3 py-1.5 transition-opacity hover:opacity-85"
            style={{ fontSize: '0.68rem', letterSpacing: '0.06em', background: teal, color: '#FAF7F2' }}
          >
            {t('dashboard_ui.filter_apply', 'Apply').toUpperCase()}
          </button>
          {filtered && (
            <button
              type="button" onClick={clearFilter}
              className="flex items-center gap-1 font-mono px-2 py-1.5 transition-opacity hover:opacity-75"
              style={{ fontSize: '0.68rem', color: teal, border: `1px solid ${teal}33` }}
            >
              <X size={11} /> {t('dashboard_ui.filter_clear', 'Clear').toUpperCase()}
            </button>
          )}
          {quickRangeOptions.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => applyQuickRange(r.key)}
              className="font-mono px-2 py-1 transition-opacity hover:opacity-80"
              style={{
                fontSize: '0.62rem',
                letterSpacing: '0.06em',
                border: `1px solid ${toolbarBd}`,
                background: inputBg,
                color: inputText,
              }}
            >
              {r.label}
            </button>
          ))}

          {isCorp && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[0.68rem]" style={{ color: metaSub, letterSpacing: '0.05em' }}>
                {t('dashboard_ui.hotel_filter', 'HOTEL')}
              </span>
              <select
                value={hotelFilter}
                onChange={(e) => setHotelFilter(e.target.value)}
                className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1 w-[240px] min-w-[240px] max-w-[240px]"
                style={{
                  background: inputBg, border: `1px solid ${inputBd}`,
                  color: inputText, '--tw-ring-color': teal,
                } as React.CSSProperties}
              >
                <option value="ALL">ALL</option>
                {corpHotelOptions.map((hotel) => (
                  <option key={hotel.value} value={hotel.value}>{hotel.label}</option>
                ))}
              </select>
            </div>
          )}

          {!isCorp && !isJo && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[0.68rem]" style={{ color: metaSub, letterSpacing: '0.05em' }}>
                {t('dashboard_ui.department_filter', 'DEPARTMENT')}
              </span>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1 w-[220px] min-w-[220px] max-w-[220px]"
                style={{
                  background: inputBg, border: `1px solid ${inputBd}`,
                  color: inputText, '--tw-ring-color': teal,
                } as React.CSSProperties}
              >
                <option value="ALL">ALL</option>
                {hotelDeptOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

        </div>
      </div>

      <div className="px-6 pt-1 pb-5 space-y-7 max-w-screen-2xl mx-auto">

        {/* ── Print-only title (hidden on screen) ───────────────────────────── */}
        <div className="print-title hidden" style={{ borderBottom: '2px solid #0E7470', paddingBottom: '6mm' }}>
          <p className="font-serif font-bold" style={{ fontSize: '1.1rem', color: '#1A1714' }}>
            {data.meta.chain_code} — {data.meta.hotel_code} — {data.meta.hotel_name}
            {data.meta.country_code ? ` (${data.meta.country_code})` : ''}
          </p>
          <p className="font-mono" style={{ fontSize: '0.6rem', color: '#6B6560', marginTop: '3px', letterSpacing: '0.06em' }}>
            {isJo ? t('dashboard_ui.dashboard_label_jo', 'JO Dashboard') : t('dashboard_ui.dashboard_label_im', 'IM Dashboard')} · {data.meta.total_records.toLocaleString()} {t('dashboard_ui.records_suffix', 'records')} ·
            {t('dashboard_ui.generated_prefix', 'Generated')} {new Date(data.meta.generated_at).toLocaleDateString()}
          </p>
        </div>

        {/* ── KPIs ──────────────────────────────────────────────────────────── */}
        <section className="kpi-print-section">
          <SectionHead label={t('dashboard_ui.section_kpi', 'KPI')} dark={dark} />
          <div className="kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {stdVisKpis(localizedKpis).map(k => <KpiCard key={k.id} kpi={k} dark={dark} />)}
          </div>
          {filtered && (
            <p className="mt-1 font-mono" style={{ fontSize: '0.6rem', color: naText }}>
              KPIs filtered to {dateFrom} → {dateTo}
            </p>
          )}
        </section>

        {/* ── Simple Charts ────────────────────────────────────────────────── */}
        <section>
          <SectionHead label={t('dashboard_ui.section_simple_charts', 'Simple Charts')} dark={dark} />
          <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {isCorp && !isJo && stdVisCharts(corpImTopCharts).map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}

            {isCorp && isJo && stdVisCharts(corpJoCharts).map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}
            {isCorp && isJo && corpJoCharts.length > 0 && (
              <CorpJoPerformanceTable
                entries={activeChainEntries}
                dark={dark}
                index={nextChartIndex()}
              />
            )}

            {isBuilder && localizedCharts.map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}

            {!isBuilder && !isCorp && !isJo && stdVisCharts([
              ...imSimpleCharts,
            ]).map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}

            {!isBuilder && !isCorp && isJo && stdVisCharts([...reorderedEac, ...reorderedOperational]).map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}

            {!isBuilder && !isCorp && isJo && comparisonCharts.map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}

            {!isBuilder && !isCorp && isJo && hourlyChart && (
              <HcChart
                key={hourlyChart.id}
                def={hourlyChart}
                dark={dark}
                fullPeriod={false}
                codeLabel={hourlyChart.id}
              />
            )}

            {!isBuilder && !isCorp && isJo && gaugeCharts.map((def) => {
              const { override, fullPeriod } = chartOpts(def);
              return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
            })}
          </div>
        </section>

        {/* ── Long Charts ───────────────────────────────────────────────────── */}
        {(isJo ? joLongCharts.length > 0 : (imLongCharts.length > 0 || corpImLongCharts.length > 0 || (isCorp && !isJo && corpImTopCharts.length > 0))) && (
          <section>
            <SectionHead label={t('dashboard_ui.section_long_charts', 'Long Charts')} dark={dark} />
            {isCorp && !isJo && corpImTopCharts.length > 0 && (
              <div className="mb-4">
                <CorpImPerformanceTable
                  entries={activeChainEntries}
                  dark={dark}
                  index={corpImTopCharts.length + 1}
                />
              </div>
            )}
            <div className="chart-grid-long mt-5 grid grid-cols-1 gap-4">
              {(isJo ? joLongCharts : [...imLongCharts, ...corpImLongCharts]).map((def) => {
                const { override, fullPeriod } = chartOpts(def);
                return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} codeLabel={def.id} />;
              })}
            </div>
          </section>
        )}

        {false && !isCorp && !isJo && corpBenchmarkRows.length > 0 && (
          <section>
            <SectionHead label={'Benchmark by Hotel Table'} dark={dark} />
            <div
              className="mt-4 overflow-x-auto"
              style={{
                background: themeTokens.card.bg,
                border: `1px solid ${themeTokens.card.border}`,
                borderLeft: `4px solid ${themeTokens.accent}`,
                borderRadius: '12px',
              }}
            >
              <table className="min-w-full">
                <thead>
                  <tr style={{ background: themeTokens.dashboard.tableHeadBg }}>
                    {['Hotel', 'Total Cases', 'Critical %', 'VIP Cases', 'Avg Resolution Time', 'Incident/Night', 'Closure Rate'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2 font-mono uppercase"
                        style={{ fontSize: '0.62rem', letterSpacing: '0.08em', color: themeTokens.dashboard.tableHeadText, borderBottom: `1px solid ${themeTokens.dashboard.toolbarBorder}` }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corpBenchmarkRows.map((r, idx) => (
                    <tr key={`${r.hotel}-${idx}`}>
                      <td className="px-3 py-2 font-sans" style={{ fontSize: '0.78rem', color: themeTokens.text, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.hotel}</td>
                      <td className="px-3 py-2 font-mono" style={{ fontSize: '0.72rem', color: themeTokens.text, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.total}</td>
                      <td className="px-3 py-2 font-mono" style={{ fontSize: '0.72rem', color: themeTokens.text, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.criticalPct}%</td>
                      <td className="px-3 py-2 font-mono" style={{ fontSize: '0.72rem', color: themeTokens.text, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.vipCases}</td>
                      <td className="px-3 py-2 font-mono" style={{ fontSize: '0.72rem', color: themeTokens.dashboard.tableMuted, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.avgResolution}</td>
                      <td className="px-3 py-2 font-mono" style={{ fontSize: '0.72rem', color: themeTokens.dashboard.tableMuted, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.incidentPerNight}</td>
                      <td className="px-3 py-2 font-mono" style={{ fontSize: '0.72rem', color: themeTokens.text, borderBottom: `1px solid ${themeTokens.dashboard.tableCellBorder}` }}>{r.closureRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer
          className="pt-6 flex items-center justify-between font-mono"
          style={{ borderTop: `1px solid ${footerBd}`, fontSize: '0.6rem', letterSpacing: '0.08em', color: footerText }}
        >
          <span>fcs1-dash · {isJo ? t('dashboard_ui.dashboard_full_label_jo', 'Job Order Dashboard') : t('dashboard_ui.dashboard_full_label_im', 'Incident Management Dashboard')}</span>
          <span>Highcharts · Supabase · Next.js</span>
        </footer>
      </div>
    </div>
  );
}

export function DashboardClient({ data, chainEntries = [], coRows = [], myDash, myDashEmbed }: { data: DashboardJson | null; chainEntries?: ChainEntry[]; coRows?: CoRow[]; myDash?: MyDashOverride; myDashEmbed?: MyDashEmbed }) {
  // CO: data may be null when no co_dashboard_json exists but co_records rows do.
  // Build a minimal meta shell so CoDashboardView can compute KPIs/charts from rows.
  if (!data) {
    if (coRows.length > 0) {
      // created_date may deserialize as a Date object — normalize to ISO day.
      const toDay = (v: unknown): string | null => {
        if (!v) return null;
        const d = v instanceof Date ? v : new Date(String(v));
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };
      const dates = coRows.map((r) => toDay(r.created_date)).filter(Boolean).sort() as string[];
      const shell: CoDashboardJson = {
        meta: {
          schema: 'co-v1',
          upload_job_id: '', source_name: '',
          hotel_code: coRows[0]?.hotel_code ?? '',
          hotel_name: coRows[0]?.hotel_code ?? '',
          chain_code: coRows[0]?.chain_code ?? '',
          country_code: '',
          total_records: coRows.length,
          date_range: { min: dates[0] ?? null, max: dates[dates.length - 1] ?? null },
          generated_at: new Date().toISOString(),
        },
        kpis: [], eac: [], charts: [], raw_daily: [],
        summary: {} as HotelSummary,
      };
      return <CoDashboardView data={shell} rows={coRows} chainEntries={chainEntries} myDash={myDash} myDashEmbed={myDashEmbed} />;
    }
    return null;
  }
  const isCo = data.meta.schema === 'co-v1';
  const isMo = data.meta.schema === 'mo-v1';
  if (isCo) {
    return <CoDashboardView data={data as CoDashboardJson} rows={coRows} chainEntries={chainEntries} myDash={myDash} myDashEmbed={myDashEmbed} />;
  }
  if (isMo) {
    return <MaintenanceDashboardView data={data as MoDashboardJson} chainEntries={chainEntries} myDash={myDash} myDashEmbed={myDashEmbed} />;
  }
  return <StandardDashboardClient data={data as ImDashboardJson} chainEntries={chainEntries} myDash={myDash} myDashEmbed={myDashEmbed} />;
}
