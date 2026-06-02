'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Sun, Moon, Printer, CalendarDays, X } from 'lucide-react';
import Highcharts from 'highcharts';
import { KpiCard }  from '@/components/dashboard/KpiCard';
import type { ImDashboardJson, DailyBucket, KpiDef, ChartDef, ChainEntry } from '@/types/dashboard';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';

const HcChart = dynamic(() => import('@/components/dashboard/HcChart').then(m => m.HcChart), { ssr: false });

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAIN_CHARTS = new Set(['chart_12', 'chart_13', 'chart_14', 'chart_15', 'chart_16', 'chart_17', 'chart_18', 'chart_20']);
const GAUGE_CHARTS = new Set(['eac_06', 'chart_22', 'chart_23', 'chart_24', 'him09', 'him10', 'him35']);
const CORP_IM_TOP_IDS = new Set(['chart_18', 'chart_19', 'chart_20', 'chart_21', 'chart_22', 'chart_23', 'chart_24', 'chart_25', 'chart_26', 'chart_27', 'chart_28', 'chart_29', 'chart_30', 'chart_31', 'chart_33', 'chart_34', 'chart_35', 'chart_36']);
const JO_EAC_ORDER = ['jo_eac_01', 'jo_eac_02', 'jo_eac_03', 'jo_eac_04'];
const JO_CHART_ORDER = ['jo_chart_01', 'jo_chart_02', 'jo_chart_03', 'jo_chart_04', 'jo_chart_05', 'jo_chart_06', 'jo_chart_07', 'jo_chart_08', 'jo_chart_09', 'jo_chart_10', 'jo_chart_11', 'jo_chart_12', 'jo_chart_13', 'jo_chart_14', 'jo_chart_15', 'jo_chart_16', 'jo_chart_17', 'jo_chart_18'];
const CORP_IM_TOP_MAP: Array<{ code: string; id: string; title: string; note: string; formula: string }> = [
  { code: 'cim01', id: 'chart_22', title: 'Hotel Incident -> Top 10 Incident Item', note: 'Shows each hotel total then top 10 incident items for drilldown prioritization. Benchmark: Good when top 3 items <= 45% of hotel incidents; Bad when top 3 items > 60% (concentration risk).', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = TOP 10 COUNT(incident_case) GROUP BY incident_item_name per hotel' },
  { code: 'cim02', id: 'chart_18', title: 'Total Incident vs Status by Hotel', note: 'Compares hotel volume and status mix to detect closure imbalance. Benchmark: Good when Completed >= 95% and Pending <= 5%; Bad when Pending > 10%.', formula: 'COUNT(incident_case) GROUP BY hotel_code, incident_status' },
  { code: 'cim03', id: 'chart_19', title: 'VIP Closure Rate vs VIP Incident by Hotel', note: 'Dual-axis chart for premium guest risk and recovery effectiveness. Benchmark: Good VIP Closure >= 95%; Bad < 90%.', formula: 'VIP Incidents = COUNT(vip_code valid) GROUP BY hotel; VIP Closure % = VIP Completed / VIP Incidents * 100' },
  { code: 'cim04', id: 'chart_26', title: 'Hotel Incident -> Top 10 Incident Category', note: 'Drilldown from hotel totals to top 10 categories for root-cause governance. Benchmark: Good when top category <= 20%; Bad when top category > 35%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = TOP 10 COUNT(incident_case) GROUP BY incident_category per hotel' },
  { code: 'cim05', id: 'chart_21', title: 'Chain — Repeat Incident Rate by Hotel', note: 'Shows recurrence pressure by hotel to flag unresolved systemic issues. Benchmark: Good <= 15%; Watch 15–25%; Bad > 25%.', formula: 'Repeat Rate % = repeat_count / total_cases * 100 per hotel' },
  { code: 'cim06', id: 'chart_23', title: 'Worldmap Incident by Hotel', note: 'Country-level map with hotel-level labels for cross-region executive visibility. Benchmark: Good when no single country exceeds 50% of chain incidents; Bad when one country > 70%.', formula: 'Country Value = SUM(total_cases) GROUP BY country_code; Label = CONCAT(hotel_code, incident_count) list per country' },
  { code: 'cim07', id: 'chart_24', title: 'Hotel -> Department', note: 'Hotel-to-department drilldown for operational ownership alignment. Benchmark: Good when no department exceeds 25% of hotel incidents; Bad > 40%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = COUNT(incident_case) GROUP BY department per hotel' },
  { code: 'cim08', id: 'chart_25', title: 'Hotel -> Source of Complaint', note: 'Hotel-to-source drilldown for channel quality control. Benchmark: Good when Unknown Source <= 5%; Bad > 15%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = COUNT(incident_case) GROUP BY source_of_complaint per hotel' },
  { code: 'cim09', id: 'chart_20', title: 'VIP vs Non-VIP by Hotel', note: 'Stacked comparison of VIP and non-VIP load by hotel. Benchmark: Good VIP Share <= 6%; Watch 6–10%; Bad > 10%.', formula: 'VIP = COUNT(vip_code valid); Non-VIP = total_cases - VIP; GROUP BY hotel_code' },
  { code: 'cim10', id: 'chart_27', title: 'Hotel -> Booking Source', note: 'Drilldown from hotel totals to booking source composition for commercial insights. Benchmark: Good when Unknown booking <= 5%; Bad > 15%.', formula: 'Level 1 = COUNT(incident_case) GROUP BY hotel_code; Level 2 = COUNT(incident_case) GROUP BY booking_source per hotel' },
  { code: 'cim11', id: 'chart_28', title: 'Multi-Hotel Benchmark Scorecard', note: 'Executive matrix comparing risk, critical, VIP, SLA, and trend in one panel. Benchmark: Good risk score <= 60; Watch 60–100; Bad > 100.', formula: 'Risk Score = (Critical*5) + (High*3) + (VIP*4) + (SLA Breach*3) + (Open*2) + volume_adjust' },
  { code: 'cim12', id: 'chart_29', title: 'Hotel Risk Ranking', note: 'Ranks hotels by weighted risk for intervention priority. Benchmark: Good when high-risk hotel count reduces period-over-period; Bad when top hotel risk grows >10% WoW.', formula: 'Hotel Risk = Severity Score + (VIP*4) + (Open*2) + (SLA*3)' },
  { code: 'cim13', id: 'chart_30', title: 'Severity vs Volume Quadrant', note: 'Bubble quadrant for strategic risk classification (high volume + high severity = immediate focus). Benchmark: Good when no hotel in top-right high-risk quadrant; Bad when multiple hotels cluster there.', formula: 'X=COUNT(cases), Y=AVG(severity score), Bubble=VIP cases, Color=country/region' },
  { code: 'cim14', id: 'chart_31', title: 'Regional Risk Heatmap', note: 'Region matrix compares critical, VIP, SLA breach and trend intensity. Benchmark: Good when all risk cells trend down or stay green; Bad when >=2 metrics red in same region.', formula: 'Regional KPI = AVG(metric by hotel in region); Regional Risk = aggregate of weighted KPI intensities' },
  { code: 'cim15', id: 'chart_33', title: 'Department Risk Heatmap', note: 'Shows department risk intensity by hotel to target governance actions. Benchmark: Good when top department risk <= 20% of hotel total; Bad > 35%.', formula: 'Department Risk Proxy = COUNT(cases) by hotel_code + department (or weighted severity where available)' },
  { code: 'cim16', id: 'chart_34', title: 'Root Cause Pareto Chart', note: 'Ranks root causes and cumulative contribution for improvement prioritization. Benchmark: Good when top 5 causes <= 45%; Bad when top 5 > 60%.', formula: 'Bars = COUNT(incident_category/item); Cumulative % = running_total / total_cases * 100' },
  { code: 'cim17', id: 'chart_35', title: 'Open Critical Aging Dashboard', note: 'Highlights unresolved critical burden (aging proxy) by hotel for escalation governance. Benchmark: Good = 0 open critical aging; Bad when persistent > 3 cases.', formula: 'Open Critical Aging Proxy = MIN(critical_cases, pending_cases) by hotel (aging date fallback when explicit age not present)' },
  { code: 'cim18', id: 'chart_36', title: 'Hotel x Department Matrix', note: 'Cross-hotel department matrix for fast benchmarking and imbalance detection. Benchmark: Good when cross-hotel variance is balanced; Bad when one department dominates across multiple hotels.', formula: 'Matrix Cell = COUNT(incident_case) GROUP BY hotel_code, department' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergeRecords(maps: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function r1(n: number) { return Math.round(n * 10) / 10; }
function r2(n: number) { return Math.round(n * 100) / 100; }

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
  if (id === 'hkpi_07') return v <= 1 ? '🟢' : (v <= 2 ? '🟡' : '🔴'); // Critical Incident Rate
  if (id === 'hkpi_10') return v <= 6 ? '🟢' : (v <= 10 ? '🟡' : '🔴'); // VIP Guest Incident Rate
  if (id === 'hkpi_12') return v <= 30 ? '🟢' : (v <= 45 ? '🟡' : '🔴'); // Department Incident Distribution
  if (id === 'hkpi_14') return v <= 15 ? '🟢' : (v <= 25 ? '🟡' : '🔴'); // Repeat Incident Rate
  if (id === 'hkpi_15') return v <= 35 ? '🟢' : (v <= 50 ? '🟡' : '🔴'); // Complaint Source Analysis
  if (id === 'hkpi_16') return v <= 5 ? '🟢' : (v <= 10 ? '🟡' : '🔴'); // Open Backlog Rate
  if (id === 'hkpi_19') return v <= 30 ? '🟢' : (v <= 60 ? '🟡' : '🔴'); // Avg First Response (min)

  // Higher is better
  if (id === 'hkpi_03') return v >= 95 ? '🟢' : (v >= 90 ? '🟡' : '🔴'); // SLA Compliance
  if (id === 'hkpi_06') return v >= 95 ? '🟢' : (v >= 90 ? '🟡' : '🔴'); // Closure Rate
  if (id === 'hkpi_09') return v >= 95 ? '🟢' : (v >= 90 ? '🟡' : '🔴'); // VIP Closure Rate

  // Mid/other metrics with broad practical defaults
  if (id === 'hkpi_08') return v <= 1.8 ? '🟢' : (v <= 2.4 ? '🟡' : '🔴'); // Severity Index
  if (id === 'hkpi_20') return v <= 10 ? '🟢' : (v <= 25 ? '🟡' : '🔴'); // Cancelled cases absolute (fallback)

  // Context KPIs (volume, pending, peak hour) are neutral
  return '⚪';
}

function corpImKpiEmoji(id: string, value: number | null, available: boolean): string {
  if (!available || value === null) return '';
  const v = Number(value);
  if (!Number.isFinite(v)) return '';

  // Higher is better
  if (id === 'kpi_01') return v >= 85 ? '🟢' : (v >= 70 ? '🟡' : '🔴'); // Corporate Risk Score
  if (id === 'kpi_03') return v >= 85 ? '🟢' : (v >= 75 ? '🟡' : '🔴'); // Hotel Benchmark Index
  if (id === 'kpi_06') return v >= 95 ? '🟢' : (v >= 90 ? '🟡' : '🔴'); // Closure Rate
  if (id === 'kpi_07') return v >= 95 ? '🟢' : (v >= 90 ? '🟡' : '🔴'); // VIP Closure Rate

  // Lower is better
  if (id === 'kpi_02') return v <= 1 ? '🟢' : (v <= 2 ? '🟡' : '🔴'); // Critical Incident Rate
  if (id === 'kpi_04') return v <= 6 ? '🟢' : (v <= 10 ? '🟡' : '🔴'); // VIP Incident Exposure
  if (id === 'kpi_05') return v <= 3 ? '🟢' : (v <= 5 ? '🟡' : '🔴'); // SLA Breach Rate
  if (id === 'kpi_08') return v <= 15 ? '🟢' : (v <= 25 ? '🟡' : '🔴'); // Repeat Guest Complaint Rate
  if (id === 'kpi_10') return v <= 45 ? '🟢' : (v <= 60 ? '🟡' : '🔴'); // Root Cause Concentration

  // Total Incident Volume depends heavily on property scale
  if (id === 'kpi_09') return v <= 800 ? '🟢' : (v <= 1200 ? '🟡' : '🔴');

  return '⚪';
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
  severity_category_map?: Record<string, Record<string, number>>;
  category_status_map?: Record<string, Record<string, number>>;
  vip_item_map?: Record<string, Record<string, number>>;
  vip_category_map?: Record<string, Record<string, number>>;
  avg_first_response: number | null;
  peak_hour: number;
  peak_hour_share: number;
  hour_map?: Record<number, number>;
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
    const rows = Object.entries(depMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10);
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
  const top10 = topCats.slice(0, 10);

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
    case 'eac_01': return hcOpts({
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
    case 'chart_03': return hcOpts({
      chart: { type: 'pie' },
      series: [{ name: 'Incidents', type: 'pie', innerSize: '45%',
        data: Object.entries(byStatus).sort(([,a],[,b])=>b-a).map(([name,y])=>({ name,y,...(STAT_COLORS[name]?{color:STAT_COLORS[name]}:{}) })) }],
      plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' } } },
    });
    case 'eac_02': case 'chart_02': return hcOpts({
      chart: { type: def.id === 'eac_02' ? 'column' : 'pie' },
      ...(def.id === 'eac_02'
        ? { xAxis: { categories: SEV_ORDER.filter(s => bySeverity[s]) }, series: [{ name: 'Count', data: SEV_ORDER.filter(s=>bySeverity[s]).map(s=>({ y: bySeverity[s]??0, color: SEV_COLORS[s as keyof typeof SEV_COLORS] })) }] }
        : { series: [{ name:'Incidents', type:'pie', innerSize:'50%', data: SEV_ORDER.filter(s=>bySeverity[s]).map(s=>({ name:s, y:bySeverity[s], color:SEV_COLORS[s as keyof typeof SEV_COLORS] })) }] }),
      plotOptions: def.id === 'eac_02'
        ? { column: { dataLabels: { enabled: true } } }
        : { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%' } } },
    });
    case 'eac_03': case 'chart_04': return hcOpts({
      chart: { type: def.id === 'eac_03' ? 'areaspline' : 'spline' },
      xAxis: { categories: sortedDays, tickInterval: tickIv },
      yAxis: { title: { text: 'Incidents' }, min: 0 },
      series: [{ name: 'Incidents', data: days.map(d => d.total), ...(def.id === 'eac_03' ? { fillOpacity: 0.15 } : {}) }],
      tooltip: { shared: true },
    });
    case 'eac_04': case 'chart_01': {
      const cats = topCats.slice(0, def.id === 'chart_01' ? 999 : 10);
      return hcOpts({
        chart: { type: def.id === 'eac_04' ? 'bar' : 'column' },
        xAxis: { categories: cats },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: cats.map(c=>byCategory[c]??0) }],
        plotOptions: { [def.id === 'eac_04' ? 'bar' : 'column']: { dataLabels: { enabled: true } } },
      });
    }
    case 'chart_05': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: sortedMonths },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: 'Incidents', data: sortedMonths.map(m => monthMap[m] ?? 0) }],
      plotOptions: { column: { dataLabels: { enabled: true } } },
    });
    case 'chart_11': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: top10 },
      yAxis: { title: { text: 'Closure Rate (%)' }, min: 0, max: 100 },
      series: [{ name: 'Closure Rate %', data: catClosureRates(top10) }],
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      tooltip: { pointFormat: 'Closure Rate: <b>{point.y:.1f}%</b>' },
    });
    case 'chart_19': return hcOpts({
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
    case 'chart_12': return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: 'Total Incidents', data: entries.map(e => e.summary.total) }],
      plotOptions: { column: { dataLabels: { enabled: true } } },
      tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
    });
    case 'chart_13': return hcOpts({
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
    case 'chart_14': return hcOpts({
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
    case 'chart_15': return hcOpts({
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
    case 'chart_16': {
      // Collect all category keys across hotels, take top-6
      const allCatMap: Record<string, number> = {};
      for (const e of entries) for (const [k, v] of Object.entries(e.summary.category_map)) allCatMap[k] = (allCatMap[k] ?? 0) + v;
      const topCats = Object.entries(allCatMap).sort(([,a],[,b])=>b-a).slice(0,6).map(([k])=>k);
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
    case 'chart_17': return hcOpts({
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
    case 'chart_18': {
      // Top-5 depts across chain → stacked bar per hotel
      const allDeptMap: Record<string, number> = {};
      for (const e of entries) for (const [k, v] of Object.entries(e.summary.dept_map)) allDeptMap[k] = (allDeptMap[k] ?? 0) + v;
      const topDepts = Object.entries(allDeptMap).sort(([,a],[,b])=>b-a).slice(0,5).map(([k])=>k);
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
    case 'chart_20': return hcOpts({
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
  const topItems = Object.entries(deptItemMap).sort(([, a], [, b]) => b - a).slice(0, 15).map(([k]) => k);

  if (def.id === 'eac_04' || def.id === 'chart_01') {
    const cats = topCats.slice(0, def.id === 'chart_01' ? 999 : 10);
    return hcOpts({
      chart: { type: def.id === 'eac_04' ? 'bar' : 'column' },
      xAxis: { categories: cats },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: `${department} Incidents`, data: cats.map((c) => deptCategoryMap[c] ?? 0) }],
      plotOptions: { [def.id === 'eac_04' ? 'bar' : 'column']: { dataLabels: { enabled: true } } },
    });
  }

  if (def.id === 'chart_07') {
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { categories: topItems },
      yAxis: { title: { text: 'Incidents' } },
      series: [{ name: `${department} Items`, data: topItems.map((k) => deptItemMap[k] ?? 0) }],
      plotOptions: { bar: { dataLabels: { enabled: true } } },
    });
  }

  if (def.id === 'chart_18') {
    const cats = Object.entries(deptCategoryMap).sort(([, a], [, b]) => b - a).slice(0, 10).map(([k]) => k);
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

  if (id === 'chart_18') {
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

  if (id === 'chart_19') {
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

  if (id === 'chart_20') {
    return hcOpts({
      chart: { type: 'column' },
      xAxis: { categories: codes },
      yAxis: { min: 0, title: { text: 'Incidents' } },
      plotOptions: { series: { stacking: 'normal' } },
      series: [
        {
          type: 'column',
          name: 'VIP',
          data: entries.map((e) => e.summary.vip_total),
          color: '#0E7470',
        },
        {
          type: 'column',
          name: 'Non-VIP',
          data: entries.map((e) => Math.max(e.summary.total - e.summary.vip_total, 0)),
          color: '#C55A10',
        }
      ],
      tooltip: { shared: true },
    });
  }

  if (id === 'chart_21') return buildChainOptions('chart_20', entries); // Repeat rate
  if (id === 'chart_22') {
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
        .slice(0, 10)
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
  if (id === 'chart_23') {
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
  if (id === 'chart_24') {
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
  if (id === 'chart_25') {
    const topHotels = entries
      .map((e) => ({ hotel: e.hotel_code, total: e.summary.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
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
        .slice(0, 10)
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
  if (id === 'chart_26') {
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
        .slice(0, 10)
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
  if (id === 'chart_27') {
    const topHotels = entries
      .map((e) => ({ hotel: e.hotel_code, total: e.summary.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
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
            .slice(0, 10)
            .map(([name, y]) => ({ name, y }));
          const sourceFallback = Object.entries(entry?.summary.source_map ?? {})
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
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

  if (id === 'chart_28') {
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

  if (id === 'chart_29') {
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

  if (id === 'chart_30') {
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

  if (id === 'chart_31') {
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

  if (id === 'chart_32') {
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

  if (id === 'chart_33' || id === 'chart_36') {
    const depts = Array.from(new Set(entries.flatMap((e) => Object.keys(e.summary.dept_map ?? {}))))
      .sort((a, b) => (entries.reduce((s, e) => s + (e.summary.dept_map[b] ?? 0), 0)) - (entries.reduce((s, e) => s + (e.summary.dept_map[a] ?? 0), 0)))
      .slice(0, 10);
    const data: Array<[number, number, number]> = [];
    entries.forEach((e, x) => depts.forEach((d, y) => data.push([x, y, e.summary.dept_map[d] ?? 0])));
    return hcOpts({
      chart: { type: 'heatmap' },
      xAxis: { categories: entries.map((e) => e.hotel_code) },
      yAxis: { categories: depts, title: { text: null }, reversed: true },
      colorAxis: { min: 0, minColor: '#E6F4F1', maxColor: '#0E7470' },
      series: [{ type: 'heatmap', name: id === 'chart_33' ? 'Department Risk' : 'Department Cases', data, dataLabels: { enabled: true } }],
    });
  }

  if (id === 'chart_34') {
    const root: Record<string, number> = {};
    for (const e of entries) for (const [k, v] of Object.entries(e.summary.item_map ?? e.summary.category_map ?? {})) root[k] = (root[k] ?? 0) + v;
    const top = Object.entries(root).sort(([, a], [, b]) => b - a).slice(0, 10);
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

  if (id === 'chart_35') {
    const criticalOpen = entries.map((e) => {
      const critical = e.summary.severity_map?.Critical ?? 0;
      const pending = e.summary.pending ?? 0;
      return { hotel: e.hotel_code, count: Math.min(critical, pending) };
    });
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { categories: criticalOpen.map((r) => r.hotel) },
      yAxis: { min: 0, title: { text: 'Open Critical (Aging proxy)' } },
      series: [{ type: 'bar', name: 'Open Critical', data: criticalOpen.map((r) => r.count), color: '#C55A10' }],
      plotOptions: { bar: { dataLabels: { enabled: true } } },
    });
  }

  if (id === 'chart_37') {
    const target = 5;
    const rows = entries.map((e) => {
      const breach = Object.entries(e.summary.status_map ?? {}).filter(([k]) => /(breach|overdue|timeout|late|sla)/i.test(k)).reduce((s, [, v]) => s + v, 0);
      const rate = safePct(breach, Math.max(e.summary.total, 1));
      return { hotel: e.hotel_code, rate };
    }).sort((a, b) => b.rate - a.rate);
    const hasAnyBreach = rows.some((r) => r.rate > 0);
    const finalRows = hasAnyBreach
      ? rows
      : entries
          .map((e) => ({
            hotel: e.hotel_code,
            rate: safePct(e.summary.pending ?? 0, Math.max(e.summary.total, 1)),
          }))
          .sort((a, b) => b.rate - a.rate);
    return hcOpts({
      chart: { type: 'bar' },
      xAxis: { categories: finalRows.map((r) => r.hotel) },
      yAxis: { min: 0, title: { text: 'SLA Breach Rate %' }, plotLines: [{ value: target, color: '#0E7470', width: 2, dashStyle: 'ShortDash', label: { text: `Target ${target}%` } }] },
      series: [{ type: 'bar', name: hasAnyBreach ? 'Breach Rate %' : 'Pending Proxy %', data: finalRows.map((r) => r1(r.rate)), color: '#C55A10' }],
      plotOptions: { bar: { minPointLength: 6, dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
    });
  }

  return undefined;
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionHead({ label, dark }: { label: string; dark: boolean }) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  return (
    <div className="print-section-head flex items-center gap-4">
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

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardClient({ data, chainEntries = [] }: { data: ImDashboardJson; chainEntries?: ChainEntry[] }) {
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
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [deptScopedSummary, setDeptScopedSummary] = useState<DeptScopedSummary | null>(null);

  // Sync dark class to <html> so Tailwind dark: variants work globally
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const themeTokens = useMemo(() => getAppThemeTokens(selectedTheme, dark), [selectedTheme, dark]);

  useEffect(() => {
    if (!isCorp || isJo) return;
    let cancelled = false;
    fetch('https://code.highcharts.com/mapdata/custom/world.geo.json')
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setWorldMapData(json as Record<string, unknown>); })
      .catch(() => { if (!cancelled) setWorldMapData(null); });
    return () => { cancelled = true; };
  }, [isCorp, isJo]);

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
    if (!(isCorp && !isJo && filtered && dateFrom && dateTo)) return chainEntries;
    return chainEntries.map((entry) => {
      const daily = entry.raw_daily ?? [];
      const efd = reAggregate(daily, dateFrom, dateTo);
      return {
        ...entry,
        summary: summaryFromFilteredData(efd, entry.summary),
      };
    });
  }, [isCorp, isJo, filtered, dateFrom, dateTo, chainEntries]);

  const kpis = useMemo(() => {
    if (!fd) return data.kpis;
    return isJo ? recomputeJoKpis(data.kpis, fd) : recomputeKpis(data.kpis, fd);
  }, [fd, data.kpis, isJo]);

  const corpImKpis = useMemo<KpiDef[] | null>(() => {
    if (!isCorp || isJo) return null;

    const activeSummary = filtered ? mergeChainSummaries(activeChainEntries) : data.summary;
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
    ): KpiDef => ({
      id,
      label,
      value,
      unit: unit ?? '',
      fmt,
      note,
      formula,
      available,
    });

    return [
      make('kpi_09', 'Total Incident Volume', total, 'integer', 'Total number of incidents in the selected period. Benchmark: Good <= 800, Watch 801-1200, Bad > 1200 (thresholds should be tuned by property scale).', 'COUNT(All Incidents)', true, 'cases'),
      make('kpi_01', 'Corporate Risk Score', r1(corpRiskScore), 'pct1', 'Composite corporate health index balancing severity, VIP exposure, and SLA breach risk. Benchmark: Good >= 85, Watch 70-84.9, Bad < 70.', '100 - [ (Avg Severity/4 * 45) + (VIP Exposure * 30) + (SLA Breach Rate * 25) ]'),
      make('kpi_02', 'Critical Incident Rate', r1(criticalRate), 'pct1', 'Share of incidents classified as Critical. Benchmark: Good <= 1%, Watch 1-2%, Bad > 2%.', 'Critical Cases / Total Cases * 100'),
      make('kpi_03', 'Hotel Benchmark Index', r1(hotelBenchmark), 'pct1', 'Average cross-hotel benchmark index for fair chain-level comparison. Benchmark: Good >= 85, Watch 75-84.9, Bad < 75.', 'AVG per-hotel [100 - (Severity*40 + VIP*30 + SLA*30)]'),
      make('kpi_04', 'VIP Incident Exposure', r1(vipExposure), 'pct1', 'Portion of incidents involving VIP guests; tracks premium-service risk. Benchmark: Good <= 6%, Watch 6-10%, Bad > 10%.', 'VIP Cases / Total Cases * 100'),
      make('kpi_05', 'SLA Breach Rate', r1(slaBreachRate), 'pct1', 'Operational discipline KPI based on breach/late/overdue-like statuses. Benchmark: Good <= 3%, Watch 3-5%, Bad > 5%.', 'SLA Breach Cases / Total Cases * 100'),
      make('kpi_06', 'Closure Rate', r1(closureRate), 'pct1', 'Percentage of incidents that reached completed/closed state. Benchmark: Good >= 95%, Watch 90-94.9%, Bad < 90%.', 'Completed Cases / Total Cases * 100'),
      make('kpi_07', 'VIP Closure Rate', vipTotal > 0 ? r1((activeSummary.vip_completed / vipTotal) * 100) : null, 'pct1', 'Resolution efficiency for VIP incidents. Benchmark: Good >= 95%, Watch 90-94.9%, Bad < 90%.', 'VIP Completed Cases / VIP Cases * 100', vipTotal > 0),
      make('kpi_08', 'Repeat Guest Complaint Rate', r1(repeatRate), 'pct1', 'Recurrence pressure indicator tied to loyalty/retention risk. Benchmark: Good <= 15%, Watch 15-25%, Bad > 25%.', 'Repeat Complaint Cases / Total Cases * 100'),
      make('kpi_10', 'Root Cause Concentration', r1(rootCauseConcentration), 'pct1', 'Concentration of incident volume in top 5 categories; higher can indicate systemic concentration risk. Benchmark: Good <= 45%, Watch 45-60%, Bad > 60%.', 'Top 5 Incident Categories Cases / Total Cases * 100'),
    ];
  }, [isCorp, isJo, data.summary, data.raw_daily, activeChainEntries, filtered, fd?.weekMap]);

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
      const hourChart = data.charts.find((c) => c.id === 'chart_21');
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
    ): KpiDef => ({
      id,
      label,
      value,
      unit,
      fmt,
      note,
      formula,
      available,
    });

    return [
      make('hkpi_02', 'Incident Volume', total, 'integer', 'Operational workload baseline for staffing and queue planning. Good: predictable volume with steady closure quality; Bad: volatility spikes that exceed planned capacity.', 'COUNT(All Incidents)', true, 'cases'),
      make('hkpi_03', 'Incident Resolution SLA Compliance', r1(slaCompliance), 'pct1', 'Portion of incidents resolved within SLA discipline rules. Good >= 95%; Watch 90-94.9%; Bad < 90%.', '(Total Cases - SLA Breach Cases) / Total Cases * 100'),
      make('hkpi_06', 'Closure Rate', r1(closureRate), 'pct1', 'Standard closure throughput KPI for execution health. Good >= 95%; Watch 90-94.9%; Bad < 90%.', 'Completed Cases / Total Cases * 100'),
      make('hkpi_07', 'Critical Incident Rate', r1(criticalRate), 'pct1', 'Share of critical-severity incidents indicating severe failure exposure. Good <= 1%; Watch 1-2%; Bad > 2%.', 'Critical Cases / Total Cases * 100'),
      make('hkpi_08', 'Guest Complaint Severity Index', r2(avgSeverity), 'decimal2', 'Average severity intensity of all incident cases. Good <= 1.8; Watch 1.81-2.4; Bad > 2.4.', 'Severity Score Sum / Total Cases (Low=1, Medium=2, High=3, Critical=4)', true, 'pts'),
      make('hkpi_09', 'VIP Closure Rate', vipTotal > 0 ? r1(vipClosureRate) : null, 'pct1', 'Resolution quality for VIP-impact incidents. Good >= 95%; Watch 90-94.9%; Bad < 90%.', 'VIP Completed Cases / VIP Cases * 100', vipTotal > 0),
      make('hkpi_10', 'VIP Guest Incident Rate', r1(vipRate), 'pct1', 'Premium guest incident exposure for brand-protection monitoring. Good <= 6%; Watch 6-10%; Bad > 10%.', 'VIP Cases / Total Cases * 100'),
      make('hkpi_12', 'Department Incident Distribution', r1(topDeptShare), 'pct1', 'Concentration in top department; high concentration implies bottleneck risk. Good <= 30%; Watch 30-45%; Bad > 45%.', 'Top Department Cases / Total Cases * 100'),
      make('hkpi_14', 'Repeat Incident Rate', r1(repeatRate), 'pct1', 'Repeat load share for longitudinal comparison with historical reporting baselines. Good <= 15%; Watch 15-25%; Bad > 25%.', 'Repeat Incident Cases / Total Cases * 100'),
      make('hkpi_15', 'Complaint Source Analysis', r1(topSourceShare), 'pct1', 'Top complaint-source concentration to prioritize channel-level fixes. Good <= 35%; Watch 35-50%; Bad > 50%.', 'Top Complaint Source Cases / Total Cases * 100'),
      make('hkpi_16', 'Open Backlog Rate', r1(backlogRate), 'pct1', 'Open workload pressure currently unresolved. Good <= 5%; Watch 5-10%; Bad > 10%.', 'Pending Cases / Total Cases * 100'),
      make('hkpi_17', 'Pending Cases', pending, 'integer', 'Current unresolved queue size requiring active follow-up. Good: stable near 0; Bad: sustained growth over multiple days/weeks.', 'COUNT(Status = Pending)', true, 'cases'),
      make('hkpi_18', 'Peak Incident Time Analysis', peakHour, 'integer', 'Peak hourly load marker for shift planning and staffing. Good: balanced hourly pattern; Bad: sharp single-hour spikes without staffing alignment.', 'Peak Hour = ARGMAX(hourly_incident_count)', true, 'h'),
      make('hkpi_19', 'Avg First Response', avgFirstResponse === null ? null : r2(avgFirstResponse), 'decimal2', 'Average response latency from case creation to first investigation update. Good <= 30 min; Watch 31-60 min; Bad > 60 min.', 'AVG(first_investigation_timestamp - created_timestamp) in minutes', avgFirstResponse !== null, 'min'),
      make('hkpi_20', 'Cancelled Cases', cancelled, 'integer', 'Volume of cancelled cases to monitor process leakage. Good <= 2%; Watch 2-5%; Bad > 5% of total incidents.', 'COUNT(Status = Cancelled)', true, 'cases'),
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
        label: `${t(`corp_kpi_labels.${k.id}`, k.label)} ${corpImKpiEmoji(k.id, k.value, k.available)}`.trim(),
        note: t(`corp_kpi_notes.${k.id}`, k.note),
        formula: t(`corp_kpi_formulas.${k.id}`, k.formula),
      }));
    }
    if (hotelImKpis) {
      return hotelImKpis.map((k) => ({
        ...k,
        label: `${t(`hotel_im_kpi_labels.${k.id}`, k.label)} ${hotelImKpiEmoji(k.id, k.value, k.available)}`.trim(),
        note: t(`hotel_im_kpi_notes.${k.id}`, k.note),
        formula: t(`hotel_im_kpi_formulas.${k.id}`, k.formula),
      }));
    }
    return kpis.map((k) => ({
      ...k,
      label: t(`${isJo ? 'kpi_labels_jo' : 'kpi_labels_im'}.${k.id}`, k.label),
      note: t(`${isJo ? 'kpi_notes_jo' : 'kpi_notes_im'}.${k.id}`, k.note),
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
    return {
      ...c,
      title: t(`chart_titles_im.${c.id}`, c.title),
      note: t(`chart_notes_im.${c.id}`, c.note),
    };
  }), [data.eac, isJo, isCorp, t]);

  const localizedCharts = useMemo(() => data.charts.map((c) => {
    if (isJo) {
      const code = joCodeById(c.id, isCorp);
      return {
        ...c,
        title: t(`chart_titles_jo.${code}`, c.title),
        note: t(`chart_notes_jo.${code}`, c.note),
      };
    }
    return {
      ...c,
      title: t(`chart_titles_im.${c.id}`, c.title),
      note: t(`chart_notes_im.${c.id}`, c.note),
    };
  }), [data.charts, isJo, isCorp, t]);

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
      ?? Object.fromEntries(Object.entries((data.charts.find(c => c.id === 'chart_08')?.options as { series?: Array<{ data?: Array<{ name?: string; y?: number }> }> })?.series?.[0]?.data?.map((p) => [String(p.name), Number(p.y ?? 0)]) ?? []));
    const topCats = Object.entries(catMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10);
    const topItems = Object.entries(itemMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 15);
    const topRooms = Object.entries(roomMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10);
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
      make('him01', 'Daily Incident Trend', 'spline', 'Drilldown: Incident Case', 'COUNT by DATE(created_date)', { xAxis: { categories: dayCats }, series: [{ name: 'Incidents', data: dayVals }] }, 'him01'),
      make('him02', 'VIP -> Top 10 Incident Case', 'pie', 'Drilldown: VIP / Non-VIP → Top 10 Incident Case', 'Level 1 = COUNT by VIP segment; Level 2 = TOP 10 incident items by selected segment', {
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
              .slice(0, 10)
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
      make('him03', 'Top 10 Department x Category Heatmap', 'heatmap', 'Drilldown: Department → Incident Category → Incident Item Name', 'COUNT by department x category (top 10 x top 10)', (() => {
        const dcm = (s as { dept_category_map?: Record<string, Record<string, number>> }).dept_category_map ?? {};
        const deptCats = Object.entries(dcm)
          .map(([d, m]) => [d, Object.values(m ?? {}).reduce((a, b) => a + b, 0)] as const)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([d]) => d);
        const catTotals: Record<string, number> = {};
        for (const d of deptCats) for (const [c, v] of Object.entries(dcm[d] ?? {})) catTotals[c] = (catTotals[c] ?? 0) + v;
        const catKeys = Object.entries(catTotals).sort(([, a], [, b]) => b - a).slice(0, 10).map(([c]) => c);
        const heat = deptCats.flatMap((d, xi) =>
          catKeys.map((c, yi) => [xi, yi, dcm[d]?.[c] ?? 0]),
        );
        return {
          xAxis: { categories: deptCats },
          yAxis: { categories: catKeys, reversed: true },
          colorAxis: { min: 0 },
          series: [{ type: 'heatmap', data: heat }],
        } as Record<string, unknown>;
      })(), 'him05'),
      make('him04', 'Incident by Status → Department', 'pie', 'Drilldown: Incident Status → Department → Incident Case', 'COUNT by status -> department', {
        series: [{
          type: 'pie',
          innerSize: '45%',
          name: 'Status',
          data: statusKeys.map((k) => ({ name: k, y: Number(statusMap[k] ?? 0), drilldown: `him04:${k}` })),
        }],
        drilldown: {
          series: statusKeys.map((k) => ({
            id: `him04:${k}`,
            type: 'pie',
            innerSize: '45%',
            name: `${k} Departments`,
            data: Object.entries(deptScopedSummary?.status_dept_map?.[k] ?? {})
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .slice(0, 10)
              .map(([name, y]) => ({ name, y: Number(y) })),
          })),
        },
      }, 'imd27'),
      make('him05', 'Incident Resolution SLA Compliance', 'column', 'Drilldown: Department → Severity → Incident Case', 'SLA met / total', { xAxis: { categories: ['SLA Compliance'] }, yAxis: [{ max: 100, title: { text: '%' } }], series: [{ name: 'Compliance %', data: [s.total > 0 ? r1((s.completed / s.total) * 100) : 0] }] }, 'him02'),
      make('him06', 'Severity Breakdown', 'column', 'Drilldown: Severity → Incident Status → Incident Case', 'COUNT by severity', { xAxis: { categories: severityKeys }, series: [{ name: 'Cases', data: severityKeys.map((k) => sevMap[k]) }] }, 'him03'),
      make('him07', 'Incident Root Cause Flow', 'sankey', 'Drilldown: Department → Incident Category → Incident Item Name', 'Root-cause flow proxy', {
        series: [{
          type: 'sankey',
          keys: ['from', 'to', 'weight'],
          data: topItems.slice(0, 8).map(([item, v], i) => [Object.keys(s.dept_map ?? {})[i % Math.max(1, Object.keys(s.dept_map ?? {}).length)] ?? 'Dept', item, Number(v)]),
        }],
      }, 'imo49'),
      make('him08', 'Category vs Status', 'bar', 'Stacked comparison of status mix across top incident categories.', 'COUNT by incident_category and incident_status', {
        xAxis: { categories: topCats.map(([k]) => k) },
        plotOptions: { series: { stacking: 'normal' } },
        series: statusKeys.map((status) => ({
          type: 'bar',
          name: status,
          data: topCats.map(([cat]) => Number((deptScopedSummary?.category_status_map?.[cat] ?? {})[status] ?? 0)),
        })),
      }, 'imd21'),
      make('him09', 'Gauge — Closure Rate', 'pie', 'Drilldown: Incident Status → Incident Case', 'Completed Cases / Total Cases * 100', {
        series: [{ type: 'pie', data: [{ y: s.total > 0 ? r1((s.completed / s.total) * 100) : 0 }] }],
      }, 'him29'),
      make('him10', 'Gauge — VIP Closure Rate', 'pie', 'Drilldown: VIP Code → Incident Status → Incident Case', 'VIP Completed Cases / VIP Cases * 100', {
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
      make('him11', 'Daily Incident Volume', 'areaspline', 'Drilldown: Created Date → Department → Incident Case', 'COUNT by DATE(created_date)', { xAxis: { categories: dayCats }, series: [{ name: 'Incidents', data: days.map((d) => d.total) }] }, 'imt11'),
      make('him12', 'Weekly Incident Volume', 'column', 'Drilldown: Week → Department → Incident Case', 'COUNT by ISO week', { xAxis: { categories: weekCats }, series: [{ name: 'Incidents', data: weekCats.map((w) => weeklyMap[w] ?? 0) }] }, 'imt23'),
      make('him13', 'Severity Weighted Incident Score', 'spline', 'Drilldown: Severity → Department → Incident Case', '4*Critical + 3*High + 2*Medium + 1*Low by date', { xAxis: { categories: dayCats }, series: [{ name: 'Weighted Score', data: days.map((d) => ((d.by_severity?.Critical ?? 0) * 4) + ((d.by_severity?.High ?? 0) * 3) + ((d.by_severity?.Medium ?? 0) * 2) + ((d.by_severity?.Low ?? 0))) }] }, 'imt32'),
      make('him14', 'Monthly Incident Volume', 'column', 'Drilldown: Month → Department → Incident Case', 'COUNT by month', { xAxis: { categories: monthCats }, series: [{ name: 'Incidents', data: monthCats.map((m) => monthlyMap[m] ?? 0) }] }, 'imt37'),
      make('him15', 'Incidents by Day of Week', 'column', 'Drilldown: Day of Week → Department → Incident Case', 'COUNT by day of week', { xAxis: { categories: dowCats }, series: [{ name: 'Incidents', data: dowCats.map((d) => dowMap[d] ?? 0) }] }, 'imt39'),
      make('him16', 'Incident Forecast Prediction', 'spline', 'Drilldown: Forecast Date → Incident Category', '7-day moving average forecast', { xAxis: { categories: dayCats }, series: [{ name: 'Forecast', data: forecast }] }, 'imt48'),
    ];
  }, [isCorp, isJo, data.summary, data.raw_daily, fd, deptFd, deptScopedSummary, kpis, t]);

  const imHotelDrilldownCharts = useMemo<ChartDef[]>(() => {
    if (isCorp || isJo) return [];
    const s = (deptScopedSummary ?? data.summary) as typeof data.summary;
    const fdAny = deptFd ?? fd;
    const catMap = fdAny?.byCategory ?? s.category_map ?? {};
    const sevMap = fdAny?.bySeverity ?? s.severity_map ?? {};
    const statusMap = fdAny?.byStatus ?? s.status_map ?? {};
    const topCats = Object.entries(catMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10);
    const topItems = Object.entries((deptScopedSummary?.item_map ?? s.item_map) ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 15);
    const roomMap = deptScopedSummary?.room_map ?? Object.fromEntries(Object.entries((data.charts.find(c => c.id === 'chart_08')?.options as { series?: Array<{ data?: Array<{ name?: string; y?: number }> }> })?.series?.[0]?.data?.map((p) => [String(p.name), Number(p.y ?? 0)]) ?? []));
    const topRooms = Object.entries(roomMap).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10);
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
    const make = (id: string, title: string, type: string, note: string, formula: string, options: Record<string, unknown>, _legacyKey?: string): ChartDef => ({
      id,
      title: t(`chart_titles_im.${id}`, title),
      note: t(`chart_notes_im.${id}`, note),
      formula: t(`chart_formulas_im.${id}`, formula),
      filterable: true,
      options: { chart: { type }, ...options },
    });
    return [
      make('him17', 'Closure Rate by Category', 'column', 'Drilldown: Incident Category → Incident Status → Incident Case', 'Completed / total by category', {
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
      make('him18', 'Top Incident Categories', 'bar', 'Drilldown: Incident Category → Incident Item Name → Incident Case', 'TOP categories by count', {
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
            data: Object.entries(categoryItemMap[cat] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd09'),
      make('him19', 'Top 15 Incident Items', 'bar', 'Drilldown: Incident Item Name → Incident Location → Incident Case', 'TOP items by count', {
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
            data: Object.entries(itemLocationMap[item] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd13'),
      make('him20', 'Category × Severity', 'column', 'Drilldown: Incident Category → Severity → Incident Case', 'COUNT by category x severity', {
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
      make('him21', 'Top 10 Rooms by Incidents', 'bar', 'Drilldown: Room No → Incident Item Name → Incident Case', 'TOP rooms by incident count', {
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
              const rows = Object.entries(roomItemMap[room] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([k, v]) => [k, Number(v)]);
              return rows.length > 0 ? rows : [['No Item Data', 0]];
            })(),
          })),
        },
      }, 'imd19'),
      make('him22', 'VIP Type -> Top 10 Incident', 'column', 'Drilldown: VIP/Non-VIP → Top 10 Incident Items', 'Level 1 = COUNT by VIP type; Level 2 = TOP 10 incident items within selected VIP type', {
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
                  .slice(0, 10)
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
                  .slice(0, 10)
                  .map(([name, y]) => [name, Number(y)]);
                return rows.length > 0 ? rows : [['No Data', 0]];
              })(),
            },
          ],
        },
      }, 'imd25'),
      make('him23', 'Incidents by Category', 'column', 'Drilldown: Incident Category → Incident Item Name', 'COUNT by category', {
        xAxis: { type: 'category' },
        series: [{ name: 'Incidents', type: 'column', data: topCats.map(([cat, v]) => ({ name: cat, y: Number(v), drilldown: `imd31:${cat}` })) }],
        drilldown: {
          series: topCats.map(([cat]) => ({
            id: `imd31:${cat}`,
            type: 'column',
            name: `${cat} Items`,
            data: Object.entries(categoryItemMap[cat] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd31'),
      make('him24', 'Severity Distribution', 'pie', 'Drilldown: Severity → Incident Category → Incident Case', 'COUNT by severity', {
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
            data: Object.entries(severityCategoryMap[k] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([name, y]) => ({ name, y: Number(y) })),
          })),
        },
      }, 'imd33'),
      make('him25', 'Status Distribution', 'pie', 'Drilldown: Incident Status → Department → Incident Case', 'COUNT by status', {
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
            data: Object.entries(statusDeptMap[k] ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([name, y]) => ({ name, y: Number(y) })),
          })),
        },
      }, 'imd35'),
      make('him26', 'Incident Source → Department', 'column', 'Drilldown: Source of Complaint → Department → Incident Case', 'COUNT by source -> department', {
        xAxis: { type: 'category' },
        series: [{
          type: 'column',
          name: 'Incidents',
          data: Object.entries(deptScopedSummary?.source_map ?? s.source_map ?? {})
            .sort(([, a], [, b]) => Number(b) - Number(a))
            .slice(0, 10)
            .map(([src, v]) => ({ name: src, y: Number(v), drilldown: `imd41:${src}` })),
        }],
        drilldown: {
          series: Object.entries(sourceDeptMap).map(([src, dm]) => ({
            id: `imd41:${src}`,
            type: 'column',
            name: `${src} Departments`,
            data: Object.entries(dm).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10).map(([k, v]) => [k, Number(v)]),
          })),
        },
      }, 'imd41'),
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
    const itemTop = Object.entries(s.item_map ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 12);
    const roomMapRaw = (deptScopedSummary?.room_map ?? (s as { room_map?: Record<string, number> }).room_map ?? {}) as Record<string, number>;
    const roomTop = Object.entries(roomMapRaw).sort(([, a], [, b]) => Number(b) - Number(a)).slice(0, 10);
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
      make('him27', 'Incident Aging Bucket', 'column', 'Drilldown: Incident Status → Aging Bucket → Incident Case', 'Aging proxy by status', { xAxis: { categories: statusKeys }, series: [{ name: 'Cases', data: statusKeys.map((k) => (activeFd?.byStatus ?? s.status_map ?? {})[k] ?? 0) }] }, 'imo12'),
      make('him28', 'Incidents by Hour of Day', 'column', 'Drilldown: Incident Hour → Department → Incident Case', 'COUNT by HOUR(incident_datetime)', {
        xAxis: { categories: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`) },
        series: [{
          name: 'Incidents',
          data: Array.from({ length: 24 }, (_, h) => Number(deptScopedSummary?.hour_map?.[h] ?? 0)),
        }],
      }, 'imo15'),
      make('him29', 'Open vs Closed SLA Breach', 'column', 'Drilldown: Incident Status → SLA Breach Flag → Incident Case', 'SLA breach proxy split', { plotOptions: { column: { stacking: 'normal' } }, xAxis: { categories: ['Open', 'Closed'] }, series: [{ name: 'Breach', data: [s.pending, Math.max(0, s.total - s.pending)] }, { name: 'Non-Breach', data: [0, 0] }] }, 'imo16'),
      make('him30', 'Guest Journey Incident Stage', 'column', 'Drilldown: Arrival / Stay / Departure Stage → Incident Category → Incident Case', 'Stage proxy split', { xAxis: { categories: ['Arrival', 'Stay', 'Departure'] }, series: [{ name: 'Incidents', data: [Math.round(s.total * 0.2), Math.round(s.total * 0.6), Math.round(s.total * 0.2)] }] }, 'imo18'),
      make('him31', 'Repeat Room Failure Analysis', 'packedbubble', 'Drilldown: Room No → Incident Item Name → Incident Case', 'Packed bubble by repeat room failures', {
        series: [{
          type: 'packedbubble',
          name: 'Rooms',
          data: roomTop.length > 0 ? roomTop.map(([name, value]) => ({ name, value })) : [{ name: 'No Room Data', value: 0 }],
        }],
      }, 'imo20'),
      make('him32', 'Department SLA Ranking', 'bar', 'Drilldown: Department → SLA Breach Flag → Incident Case', 'Pending-rate proxy by department', { xAxis: { categories: deptKeys }, series: [{ name: 'Risk Score', data: deptKeys.map((k) => s.dept_map?.[k] ?? 0) }] }, 'imo22'),
      make('him33', 'Complaint Source Risk Ranking', 'bar', 'Drilldown: Source of Complaint → Severity → Incident Case', 'Source risk proxy', { xAxis: { categories: sourceKeys }, series: [{ name: 'Risk', data: sourceKeys.map((k) => s.source_map?.[k] ?? 0) }] }, 'imo28'),
      make('him34', 'Department Incident Burden Score', 'treemap', 'Drilldown: Department → Incident Category → Incident Case', 'Treemap of department burden', { series: [{ type: 'treemap', layoutAlgorithm: 'squarified', data: deptKeys.map((k) => ({ name: k, value: s.dept_map?.[k] ?? 0 })) }] }, 'imo30'),
      make('him35', 'Investigation Completion Quality', 'pie', 'Drilldown: Investigation Updated By 1 → Incident Case', 'Completion gauge proxy', {
        series: [{ type: 'pie', data: [{ y: s.total > 0 ? r1((s.completed / s.total) * 100) : 0 }] }],
      }, 'imo36'),
      make('him36', 'VIP Repeat Incident Analysis', 'heatmap', 'Drilldown: VIP Code → Incident Item Name → Incident Case', 'VIP repeat proxy heatmap', { xAxis: { categories: ['VIP', 'Non-VIP'] }, yAxis: { categories: itemTop.slice(0, 10).map(([k]) => k) }, colorAxis: { min: 0 }, series: [{ type: 'heatmap', data: itemTop.slice(0, 10).flatMap(([, v], yi) => [[0, yi, Math.round(v * 0.25)], [1, yi, Math.round(v * 0.75)]]) }] }, 'imd26'),
      make('him37', 'Booking Source Risk Analysis', 'bubble', 'Drilldown: Booking Source → Severity → Incident Case', 'Booking source risk proxy', {
        xAxis: { categories: Object.keys(bookingMap).length > 0 ? Object.keys(bookingMap) : ['Unknown'] },
        series: [{
          type: 'bubble',
          data: Object.entries(bookingMap).length > 0
            ? Object.entries(bookingMap).map(([k, v], i) => ({ x: i, y: Number(v), z: Math.max(1, Number(v)) / 2, name: k }))
            : [{ x: 0, y: 0, z: 1, name: 'Unknown' }],
        }],
      }, 'imo44'),
      make('him38', 'Corporate Guest Complaint Ranking', 'bar', 'Drilldown: Company Name → Incident Category → Incident Case', 'Corporate complaint proxy', { xAxis: { categories: sourceKeys.slice(0, 10) }, series: [{ name: 'Complaints', data: sourceKeys.slice(0, 10).map((k) => s.source_map?.[k] ?? 0) }] }, 'imo46'),
      make('him39', 'Shift Handover Incident Analysis', 'xrange', 'Drilldown: Incident Hour → Department → Incident Case', 'Shift window proxy', { xAxis: { type: 'datetime' }, yAxis: { categories: ['Night', 'Morning', 'Afternoon'], reversed: true }, series: [{ type: 'xrange', data: [{ x: Date.UTC(2026, 0, 1, 0), x2: Date.UTC(2026, 0, 1, 8), y: 0 }, { x: Date.UTC(2026, 0, 1, 8), x2: Date.UTC(2026, 0, 1, 16), y: 1 }, { x: Date.UTC(2026, 0, 1, 16), x2: Date.UTC(2026, 0, 2, 0), y: 2 }] }] }, 'imo47'),
    ];
  }, [isCorp, isJo, data.summary, data.charts, fd, deptFd, deptScopedSummary, t]);


  function chartOpts(def: ChartDef): { override?: Highcharts.Options; fullPeriod: boolean } {
    const effectiveFd = deptFd ?? fd;
    if (isBuilder) {
      const builderOverride = buildBuilderOverride(def, effectiveFd, deptScopedSummary);
      if (builderOverride) return { override: builderOverride, fullPeriod: false };
    }
    const isImHotelCustomChart = !isCorp && !isJo && /^him\d+$/i.test(def.id);
    if (!isCorp && !isJo && deptScopedSummary) {
      if (effectiveFd) {
        const scopedFiltered = buildFilteredOptions(def, effectiveFd);
        if (scopedFiltered) return { override: scopedFiltered, fullPeriod: false };
      }
      const deptScoped = buildDepartmentScopedOptions(def, departmentFilter, data.summary, deptScopedSummary);
      if (deptScoped) return { override: deptScoped, fullPeriod: false };
    }
    if (isCorp && !isJo && CORP_IM_TOP_IDS.has(def.id)) {
      const corpOpts = buildCorpImOptions(def.id, activeChainEntries, worldMapData);
      if (corpOpts) return { override: corpOpts, fullPeriod: false };
    }
    if (CHAIN_CHARTS.has(def.id)) {
      const chainOpts = buildChainOptions(def.id, activeChainEntries);
      if (chainOpts) return { override: chainOpts, fullPeriod: false };
    }
    if (GAUGE_CHARTS.has(def.id)) {
      const isHimGauge = /^him\d+$/i.test(def.id);
      const trackColor  = '#e6e6e6';
      const valueColor  = '#7cb5ec';
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
              { name: '', y: value, color: valueColor, borderColor: sliceBorder, borderWidth: 2, dataLabels: { enabled: true, distance: -50 } },
              { name: '', y: remainder, color: trackColor, borderColor: sliceBorder, borderWidth: 2, dataLabels: { enabled: !isHimGauge, distance: 16 } },
            ],
          };
        }) as Highcharts.SeriesOptionsType[],
        plotOptions: {
          pie: {
            startAngle: -90, endAngle: 90,
            center: ['50%', '80%'],
            size: '130%', innerSize: '58%',
            borderWidth: 2,
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

  // Partition core charts
  const operationalCharts = isJo ? localizedCharts : localizedCharts.filter(c => {
    const n = parseInt(c.id.replace('chart_', ''));
    return n >= 1 && n <= 11;
  });
  const comparisonCharts = isJo ? [] : localizedCharts.filter(c => {
    const n = parseInt(c.id.replace('chart_', ''));
    if (isCorp && CORP_IM_TOP_IDS.has(c.id)) return false;
    return n >= 12 && n <= 20;
  });
  const hourlyChart = isJo || isCorp ? undefined : localizedCharts.find(c => c.id === 'chart_21');
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
  const reorderedEac = [...localizedEac];
  const reorderedOperational = [...operationalCharts];
  if (!isJo && reorderedEac.length > 5 && reorderedOperational.length > 6) {
    [reorderedEac[1], reorderedEac[4]] = [reorderedEac[4], reorderedEac[1]];
    const _savedEac06 = reorderedEac[5];
    reorderedEac[5] = reorderedOperational[6];
    reorderedOperational[6] = _savedEac06;
  }

  // Global chart sequence index across all groups (no reset between sections)
  let chartSequence = 0;
  const nextChartIndex = () => {
    chartSequence += 1;
    return chartSequence;
  };

  return (
    <div className="grain transition-colors print:bg-white" style={{ background: bg, minHeight: '100vh' }} data-print-root>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 px-6 py-3 flex flex-wrap items-center gap-3 print-hidden"
        style={{ background: toolbarBg, borderBottom: `1px solid ${toolbarBd}` }}
      >
        {/* Meta */}
          <div className="flex-1 min-w-0">
            <h3 className="font-serif font-semibold truncate leading-snug" style={{ fontSize: '1.125rem', color: metaTitle }}>
              {contextTitle}
            </h3>
            <p className="font-mono mt-0.5" style={{ fontSize: '0.6rem', letterSpacing: '0.05em', color: metaSub }}>
            {data.meta.total_records.toLocaleString()} {t('dashboard_ui.records_suffix', 'records')}
            {' · '}{t('dashboard_ui.generated_prefix', 'Generated')} {new Date(data.meta.generated_at).toLocaleString()}
            {hasChain && ` · ${chainEntries.length} hotels in chain`}
            {isCorp && ` · Corp comparison view`}
          </p>
        </div>

        {/* Date range filter */}
        <div className="flex items-center gap-2">
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
        </div>
        <div className="flex items-center gap-1.5">
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
        </div>

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

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={() => window.print()}
            className="flex items-center gap-1.5 font-mono px-3 py-1.5 transition-opacity hover:opacity-75"
            style={{ fontSize: '0.68rem', letterSpacing: '0.06em', color: orange, border: `1px solid ${orange}33` }}
          >
            <Printer size={12} /> {t('dashboard_ui.export_pdf', 'Export PDF').toUpperCase()}
          </button>
          <button
            type="button" onClick={() => setDark(d => !d)}
            className="p-1.5 transition-opacity hover:opacity-75"
            style={{ color: metaSub, border: `1px solid ${toolbarBd}` }}
            aria-label={t('dashboard_ui.toggle_dark_mode', 'Toggle dark mode')}
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
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
          <div className="kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {localizedKpis.map(k => <KpiCard key={k.id} kpi={k} dark={dark} />)}
          </div>
          {filtered && (
            <p className="mt-1 font-mono" style={{ fontSize: '0.6rem', color: naText }}>
              KPIs filtered to {dateFrom} → {dateTo}
            </p>
          )}
        </section>

        {/* ── Corp IM top charts ───────────────────────────────────────────── */}
        {isCorp && !isJo && corpImTopCharts.length > 0 && (
          <section>
            <SectionHead label={'Corp Comparison Top 10'} dark={dark} />
            <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              {corpImTopCharts.map((def, idx) => {
                const { override, fullPeriod } = chartOpts(def);
                const uiIndex = idx + 1;
                return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={uiIndex} />;
              })}
            </div>
          </section>
        )}

        {isBuilder ? (
          <section>
            <SectionHead label={'Builder Charts'} dark={dark} />
            <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              {localizedCharts.map((def) => {
                const { override, fullPeriod } = chartOpts(def);
                const uiIndex = builderIndexFromId(def.id) ?? nextChartIndex();
                return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={uiIndex} />;
              })}
            </div>
          </section>
        ) : !isCorp && (
          <>
            {!isJo ? (
              <>
                <section>
                  <SectionHead label={'Executive Charts'} dark={dark} />
                  <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {imHotelExecutiveCharts.map((def) => {
                      const { override, fullPeriod } = chartOpts(def);
                      const uiIndex = nextChartIndex();
                      return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={uiIndex} />;
                    })}
                  </div>
                </section>
                <section>
                  <SectionHead label={'Over the time charts'} dark={dark} />
                  <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {imHotelOverTimeCharts.map((def) => {
                      const { override, fullPeriod } = chartOpts(def);
                      const uiIndex = nextChartIndex();
                      return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={uiIndex} />;
                    })}
                  </div>
                </section>
                <section>
                  <SectionHead label={'Drilldown charts'} dark={dark} />
                  <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {imHotelDrilldownCharts.map((def) => {
                      const { override, fullPeriod } = chartOpts(def);
                      const uiIndex = nextChartIndex();
                      return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={uiIndex} />;
                    })}
                  </div>
                </section>
                <section>
                  <SectionHead label={'Operation Analysis'} dark={dark} />
                  <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {imHotelOperationAnalysisCharts.map((def, idx) => {
                      const { override, fullPeriod } = chartOpts(def);
                      const uiIndex = nextChartIndex();
                      return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={uiIndex} />;
                    })}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section>
                  <SectionHead label={t('dashboard_ui.section_charts', 'Executive Analysis Charts')} dark={dark} />
                  <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {reorderedEac.map((def) => {
                      const { override, fullPeriod } = chartOpts(def);
                      return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={nextChartIndex()} />;
                    })}
                  </div>
                </section>
                <section>
                  <SectionHead label={t('dashboard_ui.operational_jo', 'Operational Detail — JO View')} dark={dark} />
                  <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {reorderedOperational.map((def) => {
                      const { override, fullPeriod } = chartOpts(def);
                      return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={nextChartIndex()} />;
                    })}
                  </div>
                </section>
              </>
            )}

            {isJo && (
            <section>
              <SectionHead
                label={hasChain ? `${t('dashboard_ui.chain_comparison', 'Chain Comparison')} — ${chainEntries.length} ${t('dashboard_ui.hotels', 'Hotels')}` : t('dashboard_ui.chain_comparison', 'Chain Comparison')}
                dark={dark}
              />
              {!hasChain && (
                <p className="mt-1.5 mb-4 font-mono" style={{ fontSize: '0.62rem', color: naText }}>
                  {t('dashboard_ui.benchmarking_hint', 'Upload CSVs for other hotels in the same chain to enable cross-hotel benchmarking.')}
                </p>
              )}
              <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                {comparisonCharts.map((def, i) => {
                  const { override, fullPeriod } = chartOpts(def);
                  return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={nextChartIndex()} />;
                })}
              </div>
            </section>
            )}

            {isJo && hourlyChart && (
              <section>
                <SectionHead label={t('dashboard_ui.time_patterns', 'Time Patterns')} dark={dark} />
                <div className="chart-grid mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <HcChart
                    key={hourlyChart.id}
                    def={hourlyChart}
                    dark={dark}
                    fullPeriod={false}
                    index={nextChartIndex()}
                  />
                </div>
              </section>
            )}

            {isJo && gaugeCharts.length > 0 && (
              <section>
                <SectionHead label={t('dashboard_ui.performance_gauges', 'Performance Gauges')} dark={dark} />
                <div className="chart-grid mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {gaugeCharts.map((def, i) => {
                    const { override, fullPeriod } = chartOpts(def);
                    return <HcChart key={def.id} def={def} dark={dark} overrideOptions={override} fullPeriod={fullPeriod} index={nextChartIndex()} />;
                  })}
                </div>
              </section>
            )}
          </>
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

