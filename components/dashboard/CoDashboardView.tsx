'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';
import Highcharts from 'highcharts';
import type { ChartDef, ChainEntry, CoDashboardJson } from '@/types/dashboard';
import type { CoRow } from '@/types/csv';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { loadModuleConfig, defaultModuleConfig, type ModuleConfig } from '@/lib/dash-config-defs';
import { applyMyDashFilter, type MyDashOverride, type MyDashEmbed } from '@/lib/my-dashboard-defs';
import { localHour, localDateKey } from '@/lib/timezone';

const HcChart = dynamic(() => import('@/components/dashboard/HcChart').then((m) => m.HcChart), { ssr: false });

type Tone = 'good' | 'watch' | 'bad' | 'neutral';
type TrendDirection = 'up' | 'down' | 'flat' | 'na';

interface CoFilters {
  dateFrom: string;
  dateTo: string;
  floor: string;
  attendant: string;
  roomType: string;
  status: string;
}

interface KpiCardModel {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  fmt: 'integer' | 'pct1' | 'decimal2';
  available: boolean;
  note: string;
  formula: string;
  status: Tone;
  statusLabel: string;
  statusDetail: string;
  trendDirection: TrendDirection;
  trendLabel: string;
  trendDetail: string;
  benchmark: string[];
}

const REPORT_VARIANT = 'ACSR';
// Multi-level drilldown charts rendered full-width (1 per row) in the "Long Charts" section.
const LONG_CHART_IDS = new Set([
  'co-06', 'co-22', 'co-24', 'co-26', 'co-27', 'co-30', 'co-33', 'co-36', 'co-39', 'co-40', 'co-41', 'co-42',
  'cco-25', 'cco-27', 'cco-29', 'cco-30',
  'cco-33', 'cco-36', 'cco-39', 'cco-42', 'cco-43', 'cco-44', 'cco-45', 'cco-46',
]);
const DEFAULT_FILTERS: CoFilters = {
  dateFrom: '',
  dateTo: '',
  floor: 'ALL',
  attendant: 'ALL',
  roomType: 'ALL',
  status: 'ALL',
};

// ⏰ 24-hour-of-day distribution charts — always computed from the full upload
// period (date filter ignored), matching JO/MO's established behavior, so a
// date-range selection never rescopes "time of day" charts. Other filters
// (floor/attendant/room type/status/hotel) still apply normally.
const CO_24H_CHART_IDS = new Set([
  'co-04', 'co-15', 'co-16', 'co-17', 'co-18', 'co-19', 'co-20',
  'co-25', 'co-26', 'co-27', 'co-28', 'co-29', 'co-30', 'co-31', 'co-32', 'co-33',
  'co-40', 'co-42',
  'cco-18', 'cco-19', 'cco-20', 'cco-21', 'cco-22', 'cco-23',
  'cco-28', 'cco-29', 'cco-30', 'cco-31', 'cco-32', 'cco-33', 'cco-34', 'cco-35', 'cco-36',
  'cco-44', 'cco-46',
]);

function normText(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function normKey(value: string | null | undefined): string {
  return normText(value).toLowerCase();
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(value: string): Date | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateInput(value: string | null | undefined): string {
  const text = normText(value);
  if (!text) return '';
  const date = parseLocalDateKey(text);
  if (!date) return '';
  return formatLocalDateKey(date);
}

function parseDate(value: string): Date | null {
  return parseLocalDateKey(value);
}

// CO's created/completed date-time (post-ingestion-fix) is true UTC —
// converted to the org's configured timezone for the local hour-of-day.
function hourFromSource(source: string | null | undefined, timeZone: string): number | null {
  if (!source) return null;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return null;
  return localHour(date, timeZone);
}

// Precomputes each row's hour-of-day bucket in a single pass. The 24-hour
// distribution charts previously recomputed this per row on every one of
// their 24 buckets via `rows.filter(row => hourFromSource(...) === h)` — an
// O(24n) scan (parsing + timezone-converting the same date up to 24 times
// per row) repeated across ~35 chart definitions. This cuts that to a single
// O(n) pass; callers group via the returned per-row hour lookup instead.
function computeHourByRow(rows: CoRow[], sourceFn: (row: CoRow) => string | null | undefined, timeZone: string): Map<CoRow, number | null> {
  const map = new Map<CoRow, number | null>();
  for (const row of rows) {
    map.set(row, hourFromSource(sourceFn(row), timeZone));
  }
  return map;
}

// Groups rows into 24 hour-of-day buckets using a precomputed per-row hour
// lookup (from computeHourByRow) — a single O(n) pass instead of 24 filters.
function bucketRowsByHour(rows: CoRow[], hourByRow: Map<CoRow, number | null>): CoRow[][] {
  const buckets: CoRow[][] = Array.from({ length: 24 }, () => []);
  for (const row of rows) {
    const h = hourByRow.get(row);
    if (h !== null && h !== undefined) buckets[h].push(row);
  }
  return buckets;
}

// Row date/time fields (created_date/completed_time/start_time) are stored
// as true UTC instants (see hourFromSource above) — a bare "YYYY-MM-DD" is
// already a calendar date and needs no conversion, but a full timestamp must
// be converted to the org's configured timezone via localDateKey, not JS's
// ambient local Date getters (formatLocalDateKey), or the daily trend charts
// and date-range filter can bucket a row onto the wrong calendar day near
// midnight in timezones ahead of UTC.
function toDateKey(value: string | null | undefined, timeZone: string): string {
  const text = normText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return localDateKey(date, timeZone);
}

function toMinutes(row: CoRow): number {
  const candidates = [
    row.actual_duration_minutes,
    row.duration_minutes,
    row.planned_duration_minutes,
    row.ahead_behind_minutes !== null && row.ahead_behind_minutes !== undefined ? Math.max(0, row.ahead_behind_minutes * -1) : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return Number.NaN;
}

function toPlannedMinutes(row: CoRow): number | null {
  if (typeof row.planned_duration_minutes === 'number' && Number.isFinite(row.planned_duration_minutes)) return row.planned_duration_minutes;
  if (typeof row.duration_minutes === 'number' && Number.isFinite(row.duration_minutes)) return row.duration_minutes;
  return null;
}

function isCompleted(row: CoRow): boolean {
  return row.is_completed || Boolean(row.completed_time);
}

function isDelayed(row: CoRow): boolean {
  if (!isCompleted(row)) return false;
  if (!row.is_on_time) return true;
  if (typeof row.duration_variance_minutes === 'number') return row.duration_variance_minutes > 0;
  if (typeof row.ahead_behind_minutes === 'number') return row.ahead_behind_minutes > 0;
  const planned = toPlannedMinutes(row);
  return planned !== null && toMinutes(row) > planned;
}

function isOnTime(row: CoRow): boolean {
  return isCompleted(row) && row.is_on_time;
}

function isReclean(row: CoRow): boolean {
  const status = normKey(row.status_normalized);
  const passFail = normKey(row.pass_fail);
  return row.reclean_flag
    || passFail === 'fail'
    || status.includes('re-clean')
    || status.includes('reclean');
}

function rowStatus(row: CoRow): string {
  if (isReclean(row)) return 'Re-clean';
  if (isCompleted(row) && isDelayed(row)) return 'Delayed';
  if (isCompleted(row)) return 'Completed';
  if (row.start_time && !row.completed_time) return 'In Progress';
  if (row.status_normalized) return row.status_normalized;
  if (row.pass_fail) return row.pass_fail;
  return 'Pending';
}

function median(values: number[]): number | null {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return acc + value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? acc + parsed : acc;
    }
    return acc;
  }, 0);
}

function mean(values: number[]): number | null {
  const nums = values
    .map((value) => (typeof value === 'string' ? Number(value) : value))
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (nums.length === 0) return null;
  return sum(nums) / nums.length;
}

function formatValue(value: number | null, fmt: KpiCardModel['fmt']): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (fmt === 'integer') return Math.round(value).toLocaleString();
  if (fmt === 'pct1') return value.toFixed(1);
  return value.toFixed(2);
}

function formatTrendDelta(value: number | null, fmt: KpiCardModel['fmt']): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = fmt === 'integer' ? Math.round(value) : fmt === 'pct1' ? Number(value.toFixed(1)) : Number(value.toFixed(2));
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded}${fmt === 'pct1' ? ' pts' : fmt === 'decimal2' ? '' : ''}`;
}

function toneLabel(tone: Tone): string {
  if (tone === 'good') return 'GOOD';
  if (tone === 'watch') return 'NEEDS IMPROVEMENT';
  if (tone === 'bad') return 'BAD';
  return 'INFO';
}

function toneColors(tokens: ReturnType<typeof getAppThemeTokens>, tone: Tone): { border: string; badgeBg: string; badgeText: string } {
  if (tone === 'good') return { border: '#16a34a', badgeBg: 'rgba(22,163,74,0.12)', badgeText: '#16a34a' };
  if (tone === 'watch') return { border: '#d97706', badgeBg: 'rgba(217,119,6,0.12)', badgeText: '#d97706' };
  if (tone === 'bad') return { border: '#dc2626', badgeBg: 'rgba(220,38,38,0.12)', badgeText: '#dc2626' };
  return { border: tokens.accent, badgeBg: tokens.accentTint, badgeText: tokens.accent };
}

function compareTrend(current: number | null, previous: number | null, higherIsBetter: boolean): { direction: TrendDirection; delta: number | null; tone: Tone } {
  if (current === null || !Number.isFinite(current) || previous === null || !Number.isFinite(previous)) {
    if (current === null || !Number.isFinite(current)) return { direction: 'na', delta: null, tone: 'neutral' };
    if (higherIsBetter) return { direction: 'na', delta: null, tone: current > 0 ? 'good' : 'bad' };
    return { direction: 'na', delta: null, tone: current <= 0 ? 'good' : 'bad' };
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.0001) return { direction: 'flat', delta: 0, tone: 'neutral' };
  const direction: TrendDirection = delta > 0 ? 'up' : 'down';
  if (higherIsBetter) {
    if (delta > 0) return { direction, delta, tone: 'good' };
    if (previous === 0) return { direction, delta, tone: current > 0 ? 'good' : 'neutral' };
    const ratio = current / previous;
    return { direction, delta, tone: ratio >= 0.9 ? 'watch' : 'bad' };
  }
  if (delta < 0) return { direction, delta, tone: 'good' };
  if (previous === 0) return { direction, delta, tone: current === 0 ? 'neutral' : 'bad' };
  const ratio = current / previous;
  return { direction, delta, tone: ratio <= 1.1 ? 'watch' : 'bad' };
}

function classifyRate(value: number | null, good: number, watch: number, higherIsBetter: boolean): Tone {
  if (value === null || !Number.isFinite(value)) return 'neutral';
  if (higherIsBetter) {
    if (value >= good) return 'good';
    if (value >= watch) return 'watch';
    return 'bad';
  }
  if (value <= good) return 'good';
  if (value <= watch) return 'watch';
  return 'bad';
}

function matchesRow(row: CoRow, filters: CoFilters, timeZone: string): boolean {
  const rowDate = toDateKey(row.created_date ?? row.completed_time ?? row.start_time, timeZone);
  if (filters.dateFrom && rowDate && rowDate < filters.dateFrom) return false;
  if (filters.dateTo && rowDate && rowDate > filters.dateTo) return false;
  if (filters.floor !== 'ALL' && normKey(row.floor) !== normKey(filters.floor)) return false;
  if (filters.attendant !== 'ALL' && normKey(row.attendant) !== normKey(filters.attendant)) return false;
  if (filters.roomType !== 'ALL' && normKey(row.room_type) !== normKey(filters.roomType)) return false;
  if (filters.status !== 'ALL' && normKey(rowStatus(row)) !== normKey(filters.status)) return false;
  return true;
}

function buildFilterClause(filters: CoFilters): string {
  const parts: string[] = [];
  if (filters.dateFrom || filters.dateTo) parts.push(`created_date BETWEEN ${filters.dateFrom || '*'} AND ${filters.dateTo || '*'}`);
  if (filters.floor !== 'ALL') parts.push(`floor = '${filters.floor.replace(/'/g, "''")}'`);
  if (filters.attendant !== 'ALL') parts.push(`attendant = '${filters.attendant.replace(/'/g, "''")}'`);
  if (filters.roomType !== 'ALL') parts.push(`room_type = '${filters.roomType.replace(/'/g, "''")}'`);
  if (filters.status !== 'ALL') parts.push(`status = '${filters.status.replace(/'/g, "''")}'`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function buildFilterSummary(filters: CoFilters): string {
  const parts: string[] = [];
  if (filters.dateFrom || filters.dateTo) parts.push(`Date ${filters.dateFrom || 'min'} → ${filters.dateTo || 'max'}`);
  if (filters.floor !== 'ALL') parts.push(`Floor ${filters.floor}`);
  if (filters.attendant !== 'ALL') parts.push(`Attendant ${filters.attendant}`);
  if (filters.roomType !== 'ALL') parts.push(`Room Type ${filters.roomType}`);
  if (filters.status !== 'ALL') parts.push(`Status ${filters.status}`);
  return parts.length ? parts.join(' · ') : 'All filters';
}

function sortedUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normText(value)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function previousRange(dateFrom: string, dateTo: string): { from: string; to: string } | null {
  const start = parseDate(dateFrom);
  const end = parseDate(dateTo);
  if (!start || !end || end < start) return null;
  const span = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - span);
  return {
    from: formatLocalDateKey(prevStart),
    to: formatLocalDateKey(prevEnd),
  };
}

function groupCount(rows: CoRow[], getter: (row: CoRow) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = normText(getter(row)) || 'Unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function groupSum(
  rows: CoRow[],
  keyGetter: (row: CoRow) => string | null | undefined,
  valueGetter: (row: CoRow) => number | string | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = normText(keyGetter(row)) || 'Unknown';
    const rawValue = valueGetter(row);
    const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

function topEntries(map: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, limit);
}

function buildMetricFormula(filters: CoFilters, clause: string, expression: string): string {
  return `${expression} WHERE ${clause} | ${buildFilterSummary(filters)}`;
}

function benchmarkLinesForKpi(id: string): string[] {
  switch (id) {
    case 'co_total_orders':
    case 'co_completed_orders':
      return ['Scale-dependent volume; compare with same hotel history.', 'Use period-over-period trend and staffing plan for context.'];
    case 'co_completion_rate':
      return ['Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%'];
    case 'co_avg_duration':
    case 'co_median_duration':
      return ['Good <= 40 min', 'Watch 40-44 min', 'Bad > 44 min'];
    case 'co_on_time_rate':
      return ['Good >= 90%', 'Watch 80-89.9%', 'Bad < 80%'];
    case 'co_delayed_orders':
    case 'co_reclean_rate':
      return ['Good <= 5%', 'Watch 5-10%', 'Bad > 10%'];
    case 'co_inspection_pass_rate':
      return ['Good >= 95%', 'Watch 90-94.9%', 'Bad < 90%'];
    case 'co_productivity_score':
      return ['Good = improving vs prior period', 'Watch = flat vs prior period', 'Bad = declining vs prior period'];
    default:
      return ['Compare with historical trend or peer hotel baseline.'];
  }
}

function buildKpis(filteredRows: CoRow[], previousRows: CoRow[], filters: CoFilters): KpiCardModel[] {
  const total = filteredRows.length;
  const completedRows = filteredRows.filter(isCompleted);
  const completed = completedRows.length;
  const completionRate = total > 0 ? (completed / total) * 100 : null;
  const avgDuration = mean(completedRows.map(toMinutes));
  const medianDuration = median(completedRows.map(toMinutes));
  const onTimeCompleted = completedRows.filter(isOnTime).length;
  const onTimeRate = completed > 0 ? (onTimeCompleted / completed) * 100 : null;
  const delayedOrders = completedRows.filter(isDelayed).length;
  const delayedRate = total > 0 ? (delayedOrders / total) * 100 : null;
  const recleanCount = filteredRows.filter(isReclean).length;
  const recleanRate = total > 0 ? (recleanCount / total) * 100 : null;
  const inspectedRows = filteredRows.filter((row) => normText(row.pass_fail) || normText(row.inspection_status)).length;
  const passCount = filteredRows.filter((row) => normKey(row.pass_fail) === 'pass' || normKey(row.inspection_status) === 'pass').length;
  const inspectionPassRate = inspectedRows > 0
    ? (passCount / inspectedRows) * 100
    : completed > 0
      ? Math.max(0, ((completed - recleanCount) / completed) * 100)
      : null;
  const totalCleaningCredit = sum(completedRows.map((row) => (typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0)));
  const totalLaborHours = sum(completedRows.map((row) => toMinutes(row) / 60).filter((value) => Number.isFinite(value) && value > 0));
  const productivityScore = totalLaborHours > 0 ? (totalCleaningCredit / totalLaborHours) * 100 : null;

  const previousTotal = previousRows.length;
  const previousCompleted = previousRows.filter(isCompleted).length;
  const previousCompletionRate = previousTotal > 0 ? (previousCompleted / previousTotal) * 100 : null;
  const previousAvgDuration = mean(previousRows.filter(isCompleted).map(toMinutes));
  const previousMedianDuration = median(previousRows.filter(isCompleted).map(toMinutes));
  const previousOnTimeCompleted = previousRows.filter((row) => isCompleted(row) && isOnTime(row)).length;
  const previousOnTimeRate = previousCompleted > 0 ? (previousOnTimeCompleted / previousCompleted) * 100 : null;
  const previousDelayedOrders = previousRows.filter((row) => isDelayed(row)).length;
  const previousDelayedRate = previousTotal > 0 ? (previousDelayedOrders / previousTotal) * 100 : null;
  const previousRecleanRate = previousTotal > 0 ? (previousRows.filter(isReclean).length / previousTotal) * 100 : null;
  const previousInspectionPassRate = previousRows.filter((row) => normText(row.pass_fail) || normText(row.inspection_status)).length > 0
    ? (previousRows.filter((row) => normKey(row.pass_fail) === 'pass' || normKey(row.inspection_status) === 'pass').length
      / previousRows.filter((row) => normText(row.pass_fail) || normText(row.inspection_status)).length) * 100
    : null;
  const previousTotalCleaningCredit = sum(previousRows.filter(isCompleted).map((row) => (typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0)));
  const previousTotalLaborHours = sum(previousRows.filter(isCompleted).map((row) => toMinutes(row) / 60).filter((value) => Number.isFinite(value) && value > 0));
  const previousProductivityScore = previousTotalLaborHours > 0 ? (previousTotalCleaningCredit / previousTotalLaborHours) * 100 : null;

  const durationBenchmark = previousAvgDuration !== null && previousAvgDuration > 0 ? previousAvgDuration : 40;
  const medianBenchmark = previousMedianDuration !== null && previousMedianDuration > 0 ? previousMedianDuration : 40;
  const productivityTone = compareTrend(productivityScore, previousProductivityScore, true).tone;

  const filterClause = buildFilterClause(filters);

  const totalTrend = compareTrend(total, previousTotal, true);
  const completedTrend = compareTrend(completed, previousCompleted, true);
  const avgDurationTrend = compareTrend(avgDuration, previousAvgDuration, false);
  const medianTrend = compareTrend(medianDuration, previousMedianDuration, false);
  const onTimeTrend = compareTrend(onTimeRate, previousOnTimeRate, true);
  const delayedTrend = compareTrend(delayedOrders, previousDelayedOrders, false);
  const recleanTrend = compareTrend(recleanRate, previousRecleanRate, false);
  const inspectionTrend = compareTrend(inspectionPassRate, previousInspectionPassRate, true);
  const productivityTrend = compareTrend(productivityScore, previousProductivityScore, true);

  return [
    {
      id: 'co_total_orders',
      label: 'Total Cleaning Orders',
      value: total,
      unit: 'orders',
      fmt: 'integer',
      available: true,
      note: 'Total cleaning order records in the selected period.',
      formula: buildMetricFormula(filters, filterClause, 'COUNT(*)'),
      status: totalTrend.tone,
      statusLabel: toneLabel(totalTrend.tone),
      statusDetail: totalTrend.tone === 'good'
        ? 'Volume is holding or improving versus the prior period.'
        : totalTrend.tone === 'watch'
          ? 'Volume is slightly weaker than the prior period.'
          : 'Volume dropped materially versus the prior period.',
      trendDirection: totalTrend.direction,
      trendLabel: formatTrendDelta(totalTrend.delta, 'integer'),
      trendDetail: 'Compared with the immediately preceding equal-length period.',
      benchmark: benchmarkLinesForKpi('co_total_orders'),
    },
    {
      id: 'co_completed_orders',
      label: 'Completed Orders',
      value: completed,
      unit: 'orders',
      fmt: 'integer',
      available: true,
      note: 'Orders that reached completion during the selected period.',
      formula: buildMetricFormula(filters, filterClause, "COUNT(*) FILTER status_normalized = 'Completed'"),
      status: completedTrend.tone,
      statusLabel: toneLabel(completedTrend.tone),
      statusDetail: completedTrend.tone === 'good'
        ? 'Completed throughput improved versus the prior period.'
        : completedTrend.tone === 'watch'
          ? 'Completed throughput is close to the prior period.'
          : 'Completed throughput fell versus the prior period.',
      trendDirection: completedTrend.direction,
      trendLabel: formatTrendDelta(completedTrend.delta, 'integer'),
      trendDetail: 'Compared with the immediately preceding equal-length period.',
      benchmark: benchmarkLinesForKpi('co_completed_orders'),
    },
    {
      id: 'co_completion_rate',
      label: 'Completion Rate',
      value: completionRate,
      unit: '%',
      fmt: 'pct1',
      available: true,
      note: 'Share of cleaning orders completed in the selected period.',
      formula: buildMetricFormula(filters, filterClause, 'Completed Orders / Total Orders * 100'),
      status: classifyRate(completionRate, 95, 90, true),
      statusLabel: toneLabel(classifyRate(completionRate, 95, 90, true)),
      statusDetail: completionRate === null
        ? 'No completed records available for rate calculation.'
        : completionRate >= 95
          ? 'Completion rate is within target.'
          : completionRate >= 90
            ? 'Completion rate is acceptable but not yet at target.'
            : 'Completion rate needs improvement.',
      trendDirection: compareTrend(completionRate, previousCompletionRate, true).direction,
      trendLabel: formatTrendDelta(compareTrend(completionRate, previousCompletionRate, true).delta, 'pct1'),
      trendDetail: 'Rate change versus the prior equal-length period.',
      benchmark: benchmarkLinesForKpi('co_completion_rate'),
    },
    {
      id: 'co_avg_duration',
      label: 'Average Cleaning Duration',
      value: avgDuration,
      unit: 'min',
      fmt: 'decimal2',
      available: true,
      note: 'Average completion time for completed cleaning orders.',
      formula: buildMetricFormula(filters, filterClause, 'AVG(actual_duration_minutes)'),
      status: avgDuration === null ? 'neutral' : (avgDuration <= durationBenchmark ? 'good' : avgDuration <= durationBenchmark * 1.1 ? 'watch' : 'bad'),
      statusLabel: toneLabel(avgDuration === null ? 'neutral' : (avgDuration <= durationBenchmark ? 'good' : avgDuration <= durationBenchmark * 1.1 ? 'watch' : 'bad')),
      statusDetail: avgDuration === null
        ? 'No completed rows with duration are available.'
        : avgDuration <= durationBenchmark
          ? 'Average duration is within plan.'
          : avgDuration <= durationBenchmark * 1.1
            ? 'Average duration is slightly above the benchmark.'
            : 'Average duration is above the benchmark and should be reduced.',
      trendDirection: avgDurationTrend.direction,
      trendLabel: formatTrendDelta(avgDurationTrend.delta, 'decimal2'),
      trendDetail: 'Compared against the prior period average; lower is better.',
      benchmark: benchmarkLinesForKpi('co_avg_duration'),
    },
    {
      id: 'co_median_duration',
      label: 'Median Cleaning Duration',
      value: medianDuration,
      unit: 'min',
      fmt: 'decimal2',
      available: true,
      note: 'Median completion time, which reduces distortion from outliers.',
      formula: buildMetricFormula(filters, filterClause, 'MEDIAN(actual_duration_minutes)'),
      status: medianDuration === null ? 'neutral' : (medianDuration <= medianBenchmark ? 'good' : medianDuration <= medianBenchmark * 1.1 ? 'watch' : 'bad'),
      statusLabel: toneLabel(medianDuration === null ? 'neutral' : (medianDuration <= medianBenchmark ? 'good' : medianDuration <= medianBenchmark * 1.1 ? 'watch' : 'bad')),
      statusDetail: medianDuration === null
        ? 'No completed rows with duration are available.'
        : medianDuration <= medianBenchmark
          ? 'Median duration is within plan.'
          : medianDuration <= medianBenchmark * 1.1
            ? 'Median duration is slightly above the benchmark.'
            : 'Median duration is above the benchmark.',
      trendDirection: medianTrend.direction,
      trendLabel: formatTrendDelta(medianTrend.delta, 'decimal2'),
      trendDetail: 'Compared against the prior period median; lower is better.',
      benchmark: benchmarkLinesForKpi('co_median_duration'),
    },
    {
      id: 'co_on_time_rate',
      label: 'On-Time Completion Rate',
      value: onTimeRate,
      unit: '%',
      fmt: 'pct1',
      available: true,
      note: 'Share of completed cleaning orders finished on or before the planned time.',
      formula: buildMetricFormula(filters, filterClause, 'On-Time Completed / Completed * 100'),
      status: classifyRate(onTimeRate, 90, 80, true),
      statusLabel: toneLabel(classifyRate(onTimeRate, 90, 80, true)),
      statusDetail: onTimeRate === null
        ? 'No completed rows available for on-time calculation.'
        : onTimeRate >= 90
          ? 'On-time performance is strong.'
          : onTimeRate >= 80
            ? 'On-time performance is acceptable but can be tightened.'
            : 'On-time performance needs attention.',
      trendDirection: onTimeTrend.direction,
      trendLabel: formatTrendDelta(onTimeTrend.delta, 'pct1'),
      trendDetail: 'Compared against the prior equal-length period.',
      benchmark: benchmarkLinesForKpi('co_on_time_rate'),
    },
    {
      id: 'co_delayed_orders',
      label: 'Delayed Orders',
      value: delayedOrders,
      unit: 'orders',
      fmt: 'integer',
      available: true,
      note: 'Completed orders that missed the planned completion window.',
      formula: buildMetricFormula(filters, filterClause, "COUNT(*) FILTER status = 'Delayed'"),
      status: delayedRate === null ? 'neutral' : classifyRate(delayedRate, 5, 10, false),
      statusLabel: toneLabel(delayedRate === null ? 'neutral' : classifyRate(delayedRate, 5, 10, false)),
      statusDetail: delayedRate === null
        ? 'No delayed order ratio can be computed yet.'
        : delayedRate <= 5
          ? 'Delay pressure is low.'
          : delayedRate <= 10
            ? 'Delay pressure is manageable but should be watched.'
            : 'Delay pressure is elevated.',
      trendDirection: delayedTrend.direction,
      trendLabel: formatTrendDelta(delayedTrend.delta, 'integer'),
      trendDetail: 'Lower delayed volume is better; compare with the prior period.',
      benchmark: benchmarkLinesForKpi('co_delayed_orders'),
    },
    {
      id: 'co_reclean_rate',
      label: 'Re-clean Rate',
      value: recleanRate,
      unit: '%',
      fmt: 'pct1',
      available: true,
      note: 'Share of cleaning orders that triggered a re-clean requirement.',
      formula: buildMetricFormula(filters, filterClause, 'Re-clean Orders / Total Orders * 100'),
      status: recleanRate === null ? 'neutral' : classifyRate(recleanRate, 5, 10, false),
      statusLabel: toneLabel(recleanRate === null ? 'neutral' : classifyRate(recleanRate, 5, 10, false)),
      statusDetail: recleanRate === null
        ? 'No re-clean signal is available.'
        : recleanRate <= 5
          ? 'Re-clean pressure is controlled.'
          : recleanRate <= 10
            ? 'Re-clean pressure is moderate.'
            : 'Re-clean pressure is high.',
      trendDirection: recleanTrend.direction,
      trendLabel: formatTrendDelta(recleanTrend.delta, 'pct1'),
      trendDetail: 'Lower re-clean rate is better; compare with the prior period.',
      benchmark: benchmarkLinesForKpi('co_reclean_rate'),
    },
    {
      id: 'co_inspection_pass_rate',
      label: 'Inspection Pass Rate',
      value: inspectionPassRate,
      unit: '%',
      fmt: 'pct1',
      available: true,
      note: 'Share of inspected orders that passed inspection.',
      formula: buildMetricFormula(filters, filterClause, 'Inspection Pass / Inspected * 100'),
      status: classifyRate(inspectionPassRate, 95, 90, true),
      statusLabel: toneLabel(classifyRate(inspectionPassRate, 95, 90, true)),
      statusDetail: inspectionPassRate === null
        ? 'No inspected rows were found.'
        : inspectedRows === 0
          ? 'Inspection fields were not provided in this upload, so the rate is estimated from completed orders without re-clean signals.'
        : inspectionPassRate >= 95
          ? 'Inspection quality is strong.'
          : inspectionPassRate >= 90
            ? 'Inspection quality is acceptable but should improve.'
            : 'Inspection quality needs improvement.',
      trendDirection: inspectionTrend.direction,
      trendLabel: formatTrendDelta(inspectionTrend.delta, 'pct1'),
      trendDetail: 'Compared against the prior equal-length period.',
      benchmark: benchmarkLinesForKpi('co_inspection_pass_rate'),
    },
    {
      id: 'co_productivity_score',
      label: 'Attendant Productivity Score',
      value: productivityScore,
      unit: 'score',
      fmt: 'decimal2',
      available: true,
      note: 'Credit-weighted output per labor hour, normalized to a score for comparison.',
      formula: buildMetricFormula(filters, filterClause, 'SUM(cleaning_credit) / SUM(labor_hours) * 100'),
      status: productivityTone,
      statusLabel: toneLabel(productivityTone),
      statusDetail: productivityScore === null
        ? 'No productivity baseline can be computed yet.'
        : productivityTone === 'good'
          ? 'Productivity improved versus the prior period.'
          : productivityTone === 'watch'
            ? 'Productivity is close to the prior period.'
            : 'Productivity has weakened versus the prior period.',
      trendDirection: productivityTrend.direction,
      trendLabel: formatTrendDelta(productivityTrend.delta, 'decimal2'),
      trendDetail: 'Higher productivity score is better.',
      benchmark: benchmarkLinesForKpi('co_productivity_score'),
    },
  ];
}

function chartTitleSuffix(filters: CoFilters): string {
  return buildFilterSummary(filters);
}

function makeChartBase(id: string, title: string, note: string, formula: string, options: Highcharts.Options): ChartDef {
  return {
    id,
    title,
    note,
    formula,
    filterable: true,
    options: options as Record<string, unknown>,
    height: 320,
  };
}

function buildDeltaLineSeries(values: number[]): Array<Highcharts.PointOptionsObject & { custom?: { deltaAbs: number | null; deltaPct: number | null } }> {
  return values.map((value, index) => {
    if (index === 0) {
      return {
        y: value,
        custom: { deltaAbs: null, deltaPct: null },
      };
    }
    const previous = values[index - 1];
    const deltaAbs = value - previous;
    const deltaPct = previous === 0 ? null : (deltaAbs / previous) * 100;
    return {
      y: value,
      custom: { deltaAbs, deltaPct },
    };
  });
}

function buildCharts(filteredRows: CoRow[], filters: CoFilters, timeZone: string): ChartDef[] {
  const clause = buildFilterClause(filters);
  const suffix = chartTitleSuffix(filters);
  const allRows = filteredRows;
  const completedRows = filteredRows.filter(isCompleted);
  // Single-pass hour lookup shared by every 24-hour-distribution chart below
  // (co-04, co-15..20, co-25..27, co-28..39) — see computeHourByRow/bucketRowsByHour.
  const hourByRow = computeHourByRow(allRows, (row) => row.completed_time ?? row.start_time ?? row.created_date, timeZone);
  const dailyMap = new Map<string, { total: number; completed: number; delayed: number; reclean: number }>();
  const statusMap = groupCount(allRows, rowStatus);
  const statusRoomTypeMap = new Map<string, Map<string, number>>();
  const stayStatusMap = groupCount(allRows, (row) => row.stay_status);
  const stayStatusCleaningStatusMap = new Map<string, Map<string, number>>();
  const floorMap = groupCount(allRows, (row) => row.floor);
  const roomTypeMap = groupCount(allRows, (row) => row.room_type);
  const cleaningTypeCountMap = groupCount(completedRows, (row) => row.cleaning_type);
  const attendantCompletedMap = groupCount(completedRows, (row) => row.attendant);
  const attendantCreditMap = groupSum(completedRows, (row) => row.attendant, (row) => row.cleaning_credit);
  const onTimeDelayedMap = {
    onTime: completedRows.filter(isOnTime).length,
    delayed: completedRows.filter(isDelayed).length,
  };
  const inspectionBuckets = {
    pass: 0,
    fail: 0,
    reclean: 0,
    noInspection: 0,
  };

  for (const row of allRows) {
    const dateKey = toDateKey(row.created_date ?? row.completed_time ?? row.start_time, timeZone) || 'Unknown';
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { total: 0, completed: 0, delayed: 0, reclean: 0 });
    const daily = dailyMap.get(dateKey)!;
    daily.total += 1;
    if (isCompleted(row)) daily.completed += 1;
    if (isDelayed(row)) daily.delayed += 1;
    if (isReclean(row)) daily.reclean += 1;

    const statusKey = rowStatus(row);
    const roomTypeKey = normText(row.room_type) || 'Unknown Room Type';
    if (!statusRoomTypeMap.has(statusKey)) statusRoomTypeMap.set(statusKey, new Map<string, number>());
    const roomTypeBucket = statusRoomTypeMap.get(statusKey)!;
    roomTypeBucket.set(roomTypeKey, (roomTypeBucket.get(roomTypeKey) ?? 0) + 1);

    const stayStatusKey = normText(row.stay_status) || 'Unknown Stay Status';
    const cleaningStatusKey = rowStatus(row);
    if (!stayStatusCleaningStatusMap.has(stayStatusKey)) stayStatusCleaningStatusMap.set(stayStatusKey, new Map<string, number>());
    const cleaningStatusBucket = stayStatusCleaningStatusMap.get(stayStatusKey)!;
    cleaningStatusBucket.set(cleaningStatusKey, (cleaningStatusBucket.get(cleaningStatusKey) ?? 0) + 1);

    const passFail = normKey(row.pass_fail);
    if (passFail === 'pass') inspectionBuckets.pass += 1;
    else if (passFail === 'fail') inspectionBuckets.fail += 1;
    else inspectionBuckets.noInspection += 1;
    if (isReclean(row)) inspectionBuckets.reclean += 1;
  }

  const dailyDates = Array.from(dailyMap.keys()).sort((a, b) => a.localeCompare(b));
  const dailyTotalSeries = dailyDates.map((date) => dailyMap.get(date)?.total ?? 0);
  const dailyCompletedSeries = dailyDates.map((date) => dailyMap.get(date)?.completed ?? 0);
  const dailyDelayedSeries = dailyDates.map((date) => dailyMap.get(date)?.delayed ?? 0);
  const dailyRecleanSeries = dailyDates.map((date) => dailyMap.get(date)?.reclean ?? 0);
  const dailyTotalDeltaSeries = buildDeltaLineSeries(dailyTotalSeries);
  const dailyCompletedDeltaSeries = buildDeltaLineSeries(dailyCompletedSeries);
  const dailyDelayedDeltaSeries = buildDeltaLineSeries(dailyDelayedSeries);
  const dailyRecleanDeltaSeries = buildDeltaLineSeries(dailyRecleanSeries);

  const statusEntries = topEntries(statusMap, 20);
  const stayStatusEntries = topEntries(stayStatusMap, 20);
  const floorEntries = topEntries(floorMap, 20);
  const roomTypeEntries = topEntries(roomTypeMap, 50);
  const statusDrilldownSeries = statusEntries.map(([statusName]) => {
    const roomTypeBucket = statusRoomTypeMap.get(statusName) ?? new Map<string, number>();
    const roomTypeEntriesForStatus = topEntries(Object.fromEntries(roomTypeBucket.entries()), 20);
    return {
      id: statusName,
      name: `${statusName} — Room Type`,
      type: 'pie' as const,
      innerSize: '58%',
      data: roomTypeEntriesForStatus.map(([roomTypeName, count]) => ({
        name: roomTypeName,
        y: count,
      })),
    };
  });
  const cleaningTypeEntries = topEntries(cleaningTypeCountMap, 20).map(([key]) => key);
  const avgDurationByCleaningType = cleaningTypeEntries.map((key) => {
    const durations = completedRows.filter((row) => normText(row.cleaning_type) === key).map((row) => toMinutes(row));
    const value = mean(durations) ?? 0;
    return Number(value.toFixed(2));
  });
  const roomTypeAvgDurationSeries = roomTypeEntries.map(([roomTypeName]) => {
    const roomTypeRows = completedRows.filter((row) => normText(row.room_type) === roomTypeName);
    const durationValues = roomTypeRows.map((row) => toMinutes(row)).filter((value) => Number.isFinite(value));
    const avgDuration = durationValues.length > 0 ? Number(mean(durationValues)!.toFixed(2)) : null;
    return [roomTypeName, avgDuration] as [string, number | null];
  });
  const stayStatusAvgDurationSeries = stayStatusEntries.map(([stayStatusName]) => {
    const stayStatusRows = completedRows.filter((row) => normText(row.stay_status) === stayStatusName);
    const durationValues = stayStatusRows.map((row) => toMinutes(row)).filter((value) => Number.isFinite(value));
    const avgDuration = durationValues.length > 0 ? Number(mean(durationValues)!.toFixed(2)) : null;
    return [stayStatusName, avgDuration] as [string, number | null];
  });
  const onTimeDelayedCategories = ['On Time', 'Delayed'];
  const onTimeDelayedCounts = [onTimeDelayedMap.onTime, onTimeDelayedMap.delayed];
  const onTimeDelayedAvgDurations: Array<number | null> = [
    (() => { const m = mean(completedRows.filter(isOnTime).map((row) => toMinutes(row)).filter((value) => Number.isFinite(value))); return m !== null ? Number(m.toFixed(2)) : null; })(),
    (() => { const m = mean(completedRows.filter(isDelayed).map((row) => toMinutes(row)).filter((value) => Number.isFinite(value))); return m !== null ? Number(m.toFixed(2)) : null; })(),
  ];
  const completedDurationValues = completedRows.map((row) => toMinutes(row)).filter((value) => Number.isFinite(value));
  const completedDurationAverage = completedDurationValues.length > 0 ? Number(mean(completedDurationValues)!.toFixed(1)) : 0;
  const durationBins = [
    { label: '0-15', min: 0, max: 15 },
    { label: '15-30', min: 15, max: 30 },
    { label: '30-45', min: 30, max: 45 },
    { label: '45-60', min: 45, max: 60 },
    { label: '60-75', min: 60, max: 75 },
    { label: '75-90', min: 75, max: 90 },
    { label: '>90', min: 90, max: Number.POSITIVE_INFINITY },
  ];
  const durationBinCounts = durationBins.map((bin) => completedDurationValues.filter((value) => value >= bin.min && value < bin.max).length);
  const completionHourCategories = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
  const completedHourBuckets = bucketRowsByHour(completedRows, hourByRow);
  const completionHourCounts = completedHourBuckets.map((rows) => rows.length);
  const hourFloorCreditMap = new Map<string, number>();
  for (const row of completedRows) {
    const hour = hourByRow.get(row);
    if (hour === null || hour === undefined) continue;
    const floor = normText(row.floor) || 'Unknown';
    const key = `${hour}::${floor}`;
    const credit = typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0;
    hourFloorCreditMap.set(key, (hourFloorCreditMap.get(key) ?? 0) + credit);
  }
  const floorHeatmapEntries = floorEntries;
  const stayStatusDrilldownSeries = stayStatusEntries.map(([stayStatusName]) => {
    const stayStatusCleaningBucket = stayStatusCleaningStatusMap.get(stayStatusName) ?? new Map<string, number>();
    const cleaningStatusEntries = topEntries(Object.fromEntries(stayStatusCleaningBucket.entries()), 20);
    return {
      id: stayStatusName,
      name: `${stayStatusName} — Cleaning Status`,
      type: 'pie' as const,
      innerSize: '58%',
      data: cleaningStatusEntries.map(([cleaningStatusName, count]) => ({
        name: cleaningStatusName,
        y: count,
      })),
    };
  });
  const topAttendants = topEntries(attendantCompletedMap, 10);

  // co-03 drilldown: top attendants per duration bucket
  const durationBinAttendants = durationBins.map((bin) => {
    const binRows = completedRows.filter((row) => {
      const v = toMinutes(row);
      return Number.isFinite(v) && v >= bin.min && v < bin.max;
    });
    const attCounts = groupCount(binRows, (row) => normText(row.attendant) || 'Unknown Attendant');
    return topEntries(attCounts, 15).map(([name, y]) => ({ name, y }));
  });

  // co-04 drilldown: duration bucket counts per completion hour
  const hourDurBucketCounts = completedHourBuckets.map((hourRows) =>
    durationBins.map((bin) =>
      hourRows.filter((row) => {
        const v = toMinutes(row);
        return Number.isFinite(v) && v >= bin.min && v < bin.max;
      }).length,
    ),
  );

  // co-15-20: 24-Hour Cleaning distribution (all rows by hour, 6 drilldown dimensions)
  const allHourRows24 = bucketRowsByHour(allRows, hourByRow);
  const allHourCounts24 = allHourRows24.map((rows) => rows.length);
  const h24DurBins = allHourRows24.map((rows) =>
    durationBins.map((bin) => ({
      name: bin.label,
      y: rows.filter(isCompleted).filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && v >= bin.min && v < bin.max; }).length,
    }))
  );
  const h24StayStatus = allHourRows24.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.stay_status) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const h24CleaningStatus = allHourRows24.map((rows) => {
    const m = groupCount(rows, rowStatus);
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const h24Attendant = allHourRows24.map((rows) => {
    const m = groupCount(rows.filter(isCompleted), (r) => normText(r.attendant) || 'Unknown Attendant');
    return topEntries(m, 15).map(([name, y]) => ({ name, y }));
  });
  const h24OnTimeDelayed = allHourRows24.map((rows) => {
    const completed = rows.filter(isCompleted);
    return [
      { name: 'On Time', y: completed.filter(isOnTime).length },
      { name: 'Delayed', y: completed.filter(isDelayed).length },
    ];
  });
  const h24CleaningType = allHourRows24.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.cleaning_type) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });

  // co-21-24: Cleaning Duration distribution drilldown dimensions
  const durBinRows = durationBins.map((bin) =>
    completedRows.filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && v >= bin.min && v < bin.max; })
  );
  const durBinStayStatus = durBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.stay_status) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const durBinAttendant = durBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.attendant) || 'Unknown Attendant');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });
  const durBinCleaningType = durBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.cleaning_type) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const durBinRoomType = durBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.room_type) || 'Unknown Room Type');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });

  // co-25-27: 24-Hour Delayed Order distribution drilldown dimensions
  const delayedRows = completedRows.filter(isDelayed);
  const delayedHourRows = bucketRowsByHour(delayedRows, hourByRow);
  const delayedHourCounts = delayedHourRows.map((rows) => rows.length);
  const delayedHourStayStatus = delayedHourRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.stay_status) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const delayedHourAttendant = delayedHourRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.attendant) || 'Unknown Attendant');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });
  const delayedHourRoomType = delayedHourRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.room_type) || 'Unknown Room Type');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });

  // co-28-39: Dimension → 24-Hour / Cleaning Duration drilldowns
  const _g1ByHour = (rows: CoRow[]) => {
    const counts = new Array(24).fill(0);
    for (const r of rows) {
      const h = hourByRow.get(r);
      if (h !== null && h !== undefined) counts[h]++;
    }
    return completionHourCategories.map((label, h) => ({ name: label, y: counts[h] }));
  };
  const _g2ByDur = (rows: CoRow[]) =>
    durationBins.map((bin) => ({
      name: bin.label,
      y: rows.filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && v >= bin.min && v < bin.max; }).length,
    }));

  const dim24hSS = topEntries(groupCount(allRows, (r) => normText(r.stay_status) || 'Unknown'), 20)
    .map(([name, total]) => ({ name, total, drill: _g1ByHour(allRows.filter((r) => (normText(r.stay_status) || 'Unknown') === name)) }));
  const dim24hCS = topEntries(groupCount(allRows, rowStatus), 20)
    .map(([name, total]) => ({ name, total, drill: _g1ByHour(allRows.filter((r) => rowStatus(r) === name)) }));
  const dim24hRT = topEntries(groupCount(allRows, (r) => normText(r.room_type) || 'Unknown Room Type'), 50)
    .map(([name, total]) => ({ name, total, drill: _g1ByHour(allRows.filter((r) => (normText(r.room_type) || 'Unknown Room Type') === name)) }));
  const dim24hOTD = [
    { name: 'On Time', total: completedRows.filter(isOnTime).length, drill: _g1ByHour(completedRows.filter(isOnTime)) },
    { name: 'Delayed', total: completedRows.filter(isDelayed).length, drill: _g1ByHour(completedRows.filter(isDelayed)) },
  ];
  const dim24hCT = topEntries(groupCount(allRows, (r) => normText(r.cleaning_type) || 'Unknown'), 20)
    .map(([name, total]) => ({ name, total, drill: _g1ByHour(allRows.filter((r) => (normText(r.cleaning_type) || 'Unknown') === name)) }));
  const dim24hAtt = topEntries(groupCount(completedRows, (r) => normText(r.attendant) || 'Unknown Attendant'), 50)
    .map(([name, total]) => ({ name, total, drill: _g1ByHour(completedRows.filter((r) => (normText(r.attendant) || 'Unknown Attendant') === name)) }));

  const dimDurSS = topEntries(groupCount(completedRows, (r) => normText(r.stay_status) || 'Unknown'), 20)
    .map(([name, total]) => ({ name, total, drill: _g2ByDur(completedRows.filter((r) => (normText(r.stay_status) || 'Unknown') === name)) }));
  const dimDurCS = topEntries(groupCount(completedRows, rowStatus), 20)
    .map(([name, total]) => ({ name, total, drill: _g2ByDur(completedRows.filter((r) => rowStatus(r) === name)) }));
  const dimDurRT = topEntries(groupCount(completedRows, (r) => normText(r.room_type) || 'Unknown Room Type'), 50)
    .map(([name, total]) => ({ name, total, drill: _g2ByDur(completedRows.filter((r) => (normText(r.room_type) || 'Unknown Room Type') === name)) }));
  const dimDurOTD = [
    { name: 'On Time', total: completedRows.filter(isOnTime).length, drill: _g2ByDur(completedRows.filter(isOnTime)) },
    { name: 'Delayed', total: completedRows.filter(isDelayed).length, drill: _g2ByDur(completedRows.filter(isDelayed)) },
  ];
  const dimDurCT = topEntries(groupCount(completedRows, (r) => normText(r.cleaning_type) || 'Unknown'), 20)
    .map(([name, total]) => ({ name, total, drill: _g2ByDur(completedRows.filter((r) => (normText(r.cleaning_type) || 'Unknown') === name)) }));
  const dimDurAtt = topEntries(groupCount(completedRows, (r) => normText(r.attendant) || 'Unknown Attendant'), 10)
    .map(([name, total]) => ({ name, total, drill: _g2ByDur(completedRows.filter((r) => (normText(r.attendant) || 'Unknown Attendant') === name)) }));

  // ── co-39 / co-40: Floor → Attendant nested aggregation ────────────────────
  type DdSeriesLocal = { id: string; name: string; type: 'column'; color: string; dataLabels: { enabled: boolean; format?: string }; data: Array<{ name: string; y: number; drilldown?: string }> };
  type Co39AttAgg = { count: number; durations: number[]; roomTypeDur: Map<string, number[]>; hourCount: Map<number, number> };
  const co39FloorAtt = new Map<string, Map<string, Co39AttAgg>>();
  for (const row of completedRows) {
    const floor = normText(row.floor) || 'Unknown Floor';
    const att = normText(row.attendant) || 'Unknown Attendant';
    if (!co39FloorAtt.has(floor)) co39FloorAtt.set(floor, new Map());
    const attMap = co39FloorAtt.get(floor)!;
    if (!attMap.has(att)) attMap.set(att, { count: 0, durations: [], roomTypeDur: new Map(), hourCount: new Map() });
    const agg = attMap.get(att)!;
    agg.count += 1;
    const dur = toMinutes(row);
    if (Number.isFinite(dur)) {
      agg.durations.push(dur);
      const roomType = normText(row.room_type) || 'Unknown Room Type';
      if (!agg.roomTypeDur.has(roomType)) agg.roomTypeDur.set(roomType, []);
      agg.roomTypeDur.get(roomType)!.push(dur);
    }
    const hourSource = row.completed_time ?? row.start_time ?? row.created_date;
    const h = hourFromSource(hourSource, timeZone);
    if (h !== null) agg.hourCount.set(h, (agg.hourCount.get(h) ?? 0) + 1);
  }
  const co39Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const co39Dd: DdSeriesLocal[] = [];
  const co40Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const co40Dd: DdSeriesLocal[] = [];
  const CO_L1 = '#ea580c', CO_L2 = '#1D4ED8';
  const floorSorted = Array.from(co39FloorAtt.entries())
    .map(([floor, attMap]) => {
      let n = 0;
      for (const a of attMap.values()) n += a.count;
      return { floor, attMap, n };
    })
    .sort((a, b) => b.n - a.n || a.floor.localeCompare(b.floor))
    .slice(0, 50);
  floorSorted.forEach(({ floor, attMap, n }, iIdx) => {
    co39Primary.push({ name: floor, y: n, drilldown: `co39i:${iIdx}` });
    co40Primary.push({ name: floor, y: n, drilldown: `co40i:${iIdx}` });
    const attSorted = Array.from(attMap.entries())
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, 50);
    const att39Data: DdSeriesLocal['data'] = [];
    const att40Data: DdSeriesLocal['data'] = [];
    attSorted.forEach(([att, agg], aIdx) => {
      att39Data.push({ name: att, y: agg.count, drilldown: `co39a:${iIdx}:${aIdx}` });
      att40Data.push({ name: att, y: agg.count, drilldown: `co40a:${iIdx}:${aIdx}` });
      const overallAvg = agg.durations.length > 0 ? Number(mean(agg.durations)!.toFixed(1)) : 0;
      const rtData = Array.from(agg.roomTypeDur.entries())
        .map(([rt, arr]) => ({ name: rt, y: Number(mean(arr)!.toFixed(1)) }))
        .sort((a, b) => b.y - a.y)
        .slice(0, 50);
      co39Dd.push({
        id: `co39a:${iIdx}:${aIdx}`, name: `${att} — Avg Cleaning Duration (min)`,
        type: 'column', color: CO_L2, dataLabels: { enabled: true, format: '{point.y}' },
        data: [{ name: 'ALL ROOMS', y: overallAvg }, ...rtData],
      });
      co40Dd.push({
        id: `co40a:${iIdx}:${aIdx}`, name: `${att} — 24-Hour Cleaning Distribution`,
        type: 'column', color: CO_L2, dataLabels: { enabled: true, format: '{point.y}' },
        data: Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: agg.hourCount.get(h) ?? 0 })),
      });
    });
    co39Dd.push({ id: `co39i:${iIdx}`, name: `${floor} — Attendants`, type: 'column', color: CO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: att39Data });
    co40Dd.push({ id: `co40i:${iIdx}`, name: `${floor} — Attendants`, type: 'column', color: CO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: att40Data });
  });

  // ── co-41 / co-42: Inspector → Attendant nested aggregation ────────────────
  const co41InspAtt = new Map<string, Map<string, Co39AttAgg>>();
  for (const row of completedRows) {
    const insp = normText(row.supervisor) || 'Unknown Inspector';
    const att = normText(row.attendant) || 'Unknown Attendant';
    if (!co41InspAtt.has(insp)) co41InspAtt.set(insp, new Map());
    const attMap = co41InspAtt.get(insp)!;
    if (!attMap.has(att)) attMap.set(att, { count: 0, durations: [], roomTypeDur: new Map(), hourCount: new Map() });
    const agg = attMap.get(att)!;
    agg.count += 1;
    const dur = toMinutes(row);
    if (Number.isFinite(dur)) {
      agg.durations.push(dur);
      const roomType = normText(row.room_type) || 'Unknown Room Type';
      if (!agg.roomTypeDur.has(roomType)) agg.roomTypeDur.set(roomType, []);
      agg.roomTypeDur.get(roomType)!.push(dur);
    }
    const hourSource = row.completed_time ?? row.start_time ?? row.created_date;
    const h = hourFromSource(hourSource, timeZone);
    if (h !== null) agg.hourCount.set(h, (agg.hourCount.get(h) ?? 0) + 1);
  }
  const co41Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const co41Dd: DdSeriesLocal[] = [];
  const co42Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const co42Dd: DdSeriesLocal[] = [];
  const inspSorted = Array.from(co41InspAtt.entries())
    .map(([insp, attMap]) => {
      let n = 0;
      for (const a of attMap.values()) n += a.count;
      return { insp, attMap, n };
    })
    .sort((a, b) => b.n - a.n || a.insp.localeCompare(b.insp))
    .slice(0, 50);
  inspSorted.forEach(({ insp, attMap, n }, iIdx) => {
    co41Primary.push({ name: insp, y: n, drilldown: `co41i:${iIdx}` });
    co42Primary.push({ name: insp, y: n, drilldown: `co42i:${iIdx}` });
    const attSorted = Array.from(attMap.entries())
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, 50);
    const att41Data: DdSeriesLocal['data'] = [];
    const att42Data: DdSeriesLocal['data'] = [];
    attSorted.forEach(([att, agg], aIdx) => {
      att41Data.push({ name: att, y: agg.count, drilldown: `co41a:${iIdx}:${aIdx}` });
      att42Data.push({ name: att, y: agg.count, drilldown: `co42a:${iIdx}:${aIdx}` });
      const overallAvg = agg.durations.length > 0 ? Number(mean(agg.durations)!.toFixed(1)) : 0;
      const rtData = Array.from(agg.roomTypeDur.entries())
        .map(([rt, arr]) => ({ name: rt, y: Number(mean(arr)!.toFixed(1)) }))
        .sort((a, b) => b.y - a.y)
        .slice(0, 50);
      co41Dd.push({
        id: `co41a:${iIdx}:${aIdx}`, name: `${att} — Avg Cleaning Duration (min)`,
        type: 'column', color: CO_L2, dataLabels: { enabled: true, format: '{point.y}' },
        data: [{ name: 'ALL ROOMS', y: overallAvg }, ...rtData],
      });
      co42Dd.push({
        id: `co42a:${iIdx}:${aIdx}`, name: `${att} — 24-Hour Cleaning Distribution`,
        type: 'column', color: CO_L2, dataLabels: { enabled: true, format: '{point.y}' },
        data: Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: agg.hourCount.get(h) ?? 0 })),
      });
    });
    co41Dd.push({ id: `co41i:${iIdx}`, name: `${insp} — Attendants`, type: 'column', color: CO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: att41Data });
    co42Dd.push({ id: `co42i:${iIdx}`, name: `${insp} — Attendants`, type: 'column', color: CO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: att42Data });
  });
  return [
    makeChartBase(
      'co-01',
      'Cleaning Status → Room Type',
      `Distribution of cleaning orders by cleaning status with drilldown into room type. ${suffix}.`,
      `COUNT(*) GROUP BY status_normalized DRILLDOWN room_type WHERE ${clause}`,
      {
        chart: { type: 'pie' },
        title: { text: undefined },
        plotOptions: {
          pie: {
            innerSize: '58%',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            showInLegend: true,
          },
        },
        tooltip: { pointFormat: '<b>{point.y}</b> orders' },
        series: [{ type: 'pie', name: 'Status', data: statusEntries.map(([name, y]) => ({ name, y, drilldown: name })) }],
        drilldown: {
          series: statusDrilldownSeries,
        },
      },
    ),
    makeChartBase(
      'co-02',
      'Stay Status vs Average Cleaning Duration',
      `Stay-status workload compared with average cleaning duration. ${suffix}.`,
      `COUNT(*) GROUP BY stay_status + AVG(actual_duration_minutes) WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: {
          categories: stayStatusEntries.map(([key]) => key),
          crosshair: true,
        },
        yAxis: [
          {
            title: { text: 'Orders' },
          },
          {
            title: { text: 'Avg Duration (min)' },
            opposite: true,
          },
        ],
        plotOptions: {
          column: {
            dataLabels: { enabled: true, format: '{point.y}' },
          },
          line: {
            dataLabels: { enabled: true, format: '{point.y:.2f}' },
            marker: { enabled: true },
          },
        },
        tooltip: { shared: true },
        series: [
          {
            type: 'column',
            name: 'Orders',
            data: stayStatusEntries.map(([, value]) => value),
            color: '#0f766e',
          },
          {
            type: 'line',
            name: 'Avg Duration (min)',
            data: stayStatusAvgDurationSeries.map(([, value]) => value),
            yAxis: 1,
            color: '#ea580c',
            lineWidth: 3,
            zIndex: 10,
            marker: { enabled: true, radius: 4 },
            dashStyle: 'Solid',
          },
        ],
      },
    ),
    makeChartBase(
      'co-03',
      'Cleaning Duration → Attendant',
      `Duration distribution of completed orders with drilldown into top attendants per bucket. Average duration: ${completedDurationAverage.toFixed(1)} mins. ${suffix}.`,
      `COUNT(*) GROUP BY duration_bin DRILLDOWN attendant WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        subtitle: {
          text: `Average duration: ${completedDurationAverage.toFixed(1)} mins`,
        },
        xAxis: {
          type: 'category' as const,
          title: { text: 'Duration (mins)' },
        },
        yAxis: {
          title: { text: 'Completed Orders' },
        },
        plotOptions: {
          column: {
            dataLabels: { enabled: true, format: '{point.y}' },
          },
        },
        tooltip: {
          headerFormat: '<b>{point.key}</b><br/>',
          pointFormat: '<b>{point.y}</b> orders — click to see attendant breakdown',
        },
        series: [
          {
            type: 'column',
            name: 'Completed Orders',
            color: '#B45309',
            data: durationBins.map((bin, i) => ({
              name: bin.label,
              y: durationBinCounts[i],
              drilldown: `co-dur:${i}`,
            })),
          },
        ],
        drilldown: {
          series: durationBins.map((bin, i) => ({
            id: `co-dur:${i}`,
            name: `${bin.label} min — Attendants`,
            type: 'bar' as const,
            color: '#ea580c',
            dataLabels: { enabled: true, format: '{point.y}' },
            data: durationBinAttendants[i].map((entry) => ({ name: entry.name, y: entry.y })),
          })),
        },
      },
    ),
    makeChartBase(
      'co-04',
      '24-Hour Completion → Duration',
      `Completed orders by hour of day with drilldown into cleaning duration distribution per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(completed_time) DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: {
          type: 'category' as const,
          title: { text: 'Hour of Day (UTC)' },
        },
        yAxis: {
          title: { text: 'Completed Orders' },
        },
        plotOptions: {
          column: {
            dataLabels: { enabled: true, format: '{point.y}' },
          },
        },
        tooltip: {
          headerFormat: '<b>{point.key}</b><br/>',
          pointFormat: '<b>{point.y}</b> completed orders — click to see duration split',
        },
        series: [
          {
            type: 'column',
            name: 'Completed Orders',
            color: '#B45309',
            data: completionHourCategories.map((label, hour) => ({
              name: label,
              y: completionHourCounts[hour],
              drilldown: `co-hour:${hour}`,
            })),
          },
        ],
        drilldown: {
          series: completionHourCategories.map((label, hour) => ({
            id: `co-hour:${hour}`,
            name: `${label} — Duration Distribution`,
            type: 'bar' as const,
            color: '#0f766e',
            dataLabels: { enabled: true, format: '{point.y}' },
            data: durationBins.map((bin, i) => ({
              name: bin.label,
              y: hourDurBucketCounts[hour][i],
            })),
          })),
        },
      },
    ),
    makeChartBase(
      'co-05',
      'Average Cleaning Duration by Cleaning Type',
      `Average time spent by cleaning service type. ${suffix}.`,
      `AVG(actual_duration_minutes) GROUP BY cleaning_type WHERE ${clause}`,
      {
        chart: { type: 'column' },
        xAxis: { categories: cleaningTypeEntries },
        yAxis: { title: { text: 'Minutes' } },
        series: [{ type: 'column', name: 'Avg Duration (min)', data: avgDurationByCleaningType }],
      },
    ),
    makeChartBase(
      'co-06',
      'Room Type vs Average Cleaning Duration',
      `Room-type workload compared with average cleaning duration. ${suffix}.`,
      `COUNT(*) GROUP BY room_type + AVG(actual_duration_minutes) WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: {
          categories: roomTypeEntries.map(([key]) => key),
          crosshair: true,
        },
        yAxis: [
          {
            title: { text: 'Orders' },
          },
          {
            title: { text: 'Avg Duration (min)' },
            opposite: true,
          },
        ],
        plotOptions: {
          column: {
            dataLabels: { enabled: true, format: '{point.y}' },
          },
          line: {
            dataLabels: { enabled: true, format: '{point.y:.2f}' },
            marker: { enabled: true },
          },
        },
        tooltip: {
          shared: true,
        },
        series: [
          {
            type: 'column',
            name: 'Orders',
            data: roomTypeEntries.map(([, value]) => value),
            color: '#0f766e',
          },
          {
            type: 'line',
            name: 'Avg Duration (min)',
            data: roomTypeAvgDurationSeries.map(([, value]) => value),
            yAxis: 1,
            color: '#ea580c',
          },
        ],
      },
    ),
    makeChartBase(
      'co-07',
      'Stay Status → Cleaning Status',
      `Stay-status distribution with drilldown into cleaning status. ${suffix}.`,
      `COUNT(*) GROUP BY stay_status DRILLDOWN status_normalized WHERE ${clause}`,
      {
        chart: { type: 'pie' },
        title: { text: undefined },
        plotOptions: {
          pie: {
            innerSize: '62%',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            showInLegend: true,
          },
        },
        tooltip: { pointFormat: '<b>{point.y}</b> orders' },
        series: [{
          type: 'pie',
          name: 'Stay Status',
          data: stayStatusEntries.map(([name, y]) => ({ name, y, drilldown: name })),
        }],
        drilldown: {
          series: stayStatusDrilldownSeries,
        },
      },
    ),
    makeChartBase(
      'co-08',
      'Top 10 Attendants by Completed Credit vs Orders',
      `Completed credit versus completed-order throughput by attendant. ${suffix}.`,
      `COUNT(*) + SUM(cleaning_credit) WHERE status_normalized = 'Completed' GROUP BY attendant ORDER BY COUNT(*) DESC LIMIT 10`,
      {
        chart: { type: 'line' },
        title: { text: undefined },
        xAxis: { categories: topAttendants.map(([key]) => key) },
        yAxis: [
          { title: { text: 'Completed Orders' } },
          { title: { text: 'Completed Credit' }, opposite: true },
        ],
        legend: { enabled: true },
        plotOptions: {
          line: {
            marker: { enabled: true, radius: 4 },
            lineWidth: 3,
          },
        },
        tooltip: {
          shared: true,
        },
        series: [
          {
            type: 'line',
            name: 'Completed Orders',
            data: topAttendants.map(([, value]) => value),
            color: '#0f766e',
            yAxis: 0,
          },
          {
            type: 'line',
            name: 'Completed Credit',
            data: topAttendants.map(([attendant]) => Number((attendantCreditMap[attendant] ?? 0).toFixed(2))),
            color: '#ea580c',
            yAxis: 1,
          },
        ],
      },
    ),
    makeChartBase(
      'co-09',
      'On-Time vs Delayed Orders',
      `Comparative split between on-time and delayed completions. ${suffix}.`,
      `COUNT(*) GROUP BY is_on_time WHERE completed = true AND ${clause}`,
      {
        chart: { type: 'pie' },
        plotOptions: {
          pie: {
            innerSize: '62%',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            showInLegend: true,
          },
        },
        series: [
          {
            type: 'pie',
            name: 'Orders',
            data: [
              { name: 'On Time', y: onTimeDelayedMap.onTime },
              { name: 'Delayed', y: onTimeDelayedMap.delayed },
            ],
          },
        ],
      },
    ),
    makeChartBase(
      'co-10',
      'Re-clean / Inspection Result Analysis',
      `Inspection pass/fail and re-clean pressure in one view. ${suffix}.`,
      `COUNT(*) GROUP BY pass_fail AND reclean_flag WHERE ${clause}`,
      {
        chart: { type: 'column' },
        xAxis: { categories: ['Pass', 'Fail', 'No Inspection'] },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: {
          column: {
            stacking: 'normal',
          },
        },
        series: [
          {
            type: 'column',
            name: 'Re-clean Flagged',
            data: [
              allRows.filter((row) => normKey(row.pass_fail) === 'pass' && isReclean(row)).length,
              allRows.filter((row) => normKey(row.pass_fail) === 'fail' && isReclean(row)).length,
              allRows.filter((row) => !normText(row.pass_fail) && isReclean(row)).length,
            ],
          },
          {
            type: 'column',
            name: 'Normal',
            data: [
              inspectionBuckets.pass - allRows.filter((row) => normKey(row.pass_fail) === 'pass' && isReclean(row)).length,
              inspectionBuckets.fail - allRows.filter((row) => normKey(row.pass_fail) === 'fail' && isReclean(row)).length,
              inspectionBuckets.noInspection - allRows.filter((row) => !normText(row.pass_fail) && isReclean(row)).length,
            ],
          },
        ],
      },
    ),
    makeChartBase(
      'co-11',
      'Daily Cleaning Order Trend',
      `Daily volume trend for total, completed, delayed, and re-clean orders. ${suffix}.`,
      `COUNT(*) BY DATE(created_date) WITH COMPLETION AND EXCEPTION LINES WHERE ${clause}`,
      {
        chart: { type: 'line' },
        xAxis: { categories: dailyDates },
        yAxis: { title: { text: 'Orders' } },
        legend: { enabled: true },
        plotOptions: {
          series: {
            marker: { enabled: false },
            lineWidth: 2,
          },
        },
        tooltip: {
          pointFormatter: function (this: Highcharts.Point) {
            const point = this as Highcharts.Point & { custom?: { deltaAbs?: number | null; deltaPct?: number | null } };
            const deltaAbs = point.custom?.deltaAbs ?? null;
            const deltaPct = point.custom?.deltaPct ?? null;
            const absText = deltaAbs === null ? '—' : `${deltaAbs > 0 ? '+' : ''}${Math.round(deltaAbs)}`;
            const pctText = deltaPct === null ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
            return `<b>${this.series.name}</b><br/>Value: <b>${this.y ?? 0}</b><br/>Δ vs previous: <b>${absText}</b> (${pctText})`;
          },
        },
        series: [
          { type: 'line', name: 'Total', color: '#0f766e', data: dailyTotalDeltaSeries },
          { type: 'line', name: 'Completed', color: '#ea580c', data: dailyCompletedDeltaSeries },
          { type: 'line', name: 'Delayed', color: '#9B2335', data: dailyDelayedDeltaSeries },
          { type: 'line', name: 'Re-clean', color: '#7c3aed', data: dailyRecleanDeltaSeries },
        ],
      },
    ),
    makeChartBase(
      'co-12',
      'On-Time/Delayed vs Average Cleaning Duration',
      `On-time and delayed workload compared with average cleaning duration. ${suffix}.`,
      `COUNT(*) GROUP BY is_on_time + AVG(actual_duration_minutes) WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: {
          categories: onTimeDelayedCategories,
          crosshair: true,
        },
        yAxis: [
          {
            title: { text: 'Orders' },
          },
          {
            title: { text: 'Avg Duration (min)' },
            opposite: true,
          },
        ],
        plotOptions: {
          column: {
            dataLabels: { enabled: true, format: '{point.y}' },
          },
          line: {
            dataLabels: { enabled: true, format: '{point.y:.2f}' },
            marker: { enabled: true },
          },
        },
        tooltip: { shared: true },
        series: [
          {
            type: 'column',
            name: 'Orders',
            data: onTimeDelayedCounts,
            color: '#0f766e',
          },
          {
            type: 'line',
            name: 'Avg Duration (min)',
            data: onTimeDelayedAvgDurations,
            yAxis: 1,
            color: '#ea580c',
            lineWidth: 3,
            zIndex: 10,
            marker: { enabled: true, radius: 4 },
            dashStyle: 'Solid',
          },
        ],
      },
    ),
    makeChartBase(
      'co-13',
      'Ahead / On-Time / Behind Completion',
      `Completion timing split for finished orders. ${suffix}.`,
      `COUNT(*) GROUP BY completion_timing_bucket WHERE ${clause}`,
      {
        chart: { type: 'pie' },
        title: { text: undefined },
        plotOptions: {
          pie: {
            innerSize: '62%',
            dataLabels: {
              enabled: true,
              format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)',
            },
            showInLegend: true,
          },
        },
        tooltip: {
          pointFormat: '<b>{point.y}</b> rooms ({point.percentage:.1f}%)',
        },
        series: [
          {
            type: 'pie',
            name: 'Rooms',
            color: '#B45309',
            data: [
              {
                name: 'Ahead',
                y: completedRows.filter((row) => {
                const variance = typeof row.duration_variance_minutes === 'number'
                  ? row.duration_variance_minutes
                  : null;
                if (variance !== null) return variance < 0;
                if (typeof row.actual_duration_minutes === 'number' && typeof row.planned_duration_minutes === 'number') {
                  return row.actual_duration_minutes < row.planned_duration_minutes;
                }
                return isCompleted(row) && !isDelayed(row) && !isOnTime(row) ? true : false;
              }).length,
              },
              {
                name: 'On-Time',
                y: completedRows.filter((row) => {
                const variance = typeof row.duration_variance_minutes === 'number'
                  ? row.duration_variance_minutes
                  : null;
                if (variance !== null) return variance === 0;
                if (typeof row.actual_duration_minutes === 'number' && typeof row.planned_duration_minutes === 'number') {
                  return row.actual_duration_minutes === row.planned_duration_minutes;
                }
                return isOnTime(row) && !isDelayed(row);
              }).length,
              },
              {
                name: 'Behind',
                y: completedRows.filter((row) => {
                const variance = typeof row.duration_variance_minutes === 'number'
                  ? row.duration_variance_minutes
                  : null;
                if (variance !== null) return variance > 0;
                if (typeof row.actual_duration_minutes === 'number' && typeof row.planned_duration_minutes === 'number') {
                  return row.actual_duration_minutes > row.planned_duration_minutes;
                }
                return isDelayed(row);
              }).length,
              },
            ],
          },
        ],
      },
    ),
    makeChartBase(
      'co-14',
      'Hour × Floor Total Completion Credit',
      `Heatmap of total completion credit by hour and floor for completed orders. ${suffix}.`,
      `SUM(cleaning_credit) GROUP BY HOUR(completed_time), floor WHERE status_normalized = 'Completed' AND ${clause}`,
      {
        chart: { type: 'heatmap' },
        title: { text: undefined },
        xAxis: {
          categories: floorHeatmapEntries.map(([floor]) => floor),
          title: { text: 'Floor' },
        },
        yAxis: {
          categories: completionHourCategories,
          title: { text: 'Hour of Day' },
          reversed: true,
        },
        colorAxis: {
          min: 0,
          minColor: '#eff6ff',
          maxColor: '#0f766e',
        },
        tooltip: {
          formatter: function () {
            const point = this.point as Highcharts.Point & { value?: number; custom?: { floor?: string } };
            const hourLabel = completionHourCategories[typeof this.y === 'number' ? this.y : 0] ?? 'Unknown';
            const floorLabel = point.custom?.floor ?? floorHeatmapEntries[typeof this.x === 'number' ? this.x : 0]?.[0] ?? 'Unknown';
            return `<b>${floorLabel}</b><br/>${hourLabel}<br/><b>${Number(point.value ?? 0).toFixed(2)}</b> total credit`;
          },
        },
        plotOptions: {
          heatmap: {
            dataLabels: {
              enabled: true,
              format: '{point.value:.1f}',
              style: { textOutline: 'none' },
            },
          },
        },
        series: [
          {
            type: 'heatmap',
            name: 'Total Completion Credit',
            borderWidth: 1,
            data: completionHourCategories.flatMap((hourLabel, hourIndex) => floorHeatmapEntries.map(([floorLabel], floorIndex) => ({
              x: floorIndex,
              y: hourIndex,
              value: hourFloorCreditMap.get(`${hourIndex}::${floorLabel}`) ?? 0,
              custom: { floor: floorLabel, hour: hourLabel },
            }))),
          },
        ],
      },
    ),
    makeChartBase(
      'co-15',
      '24-Hour Cleaning → Duration',
      `All cleaning orders by hour of day with drilldown into cleaning duration distribution per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see duration split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: completionHourCategories.map((label, h) => ({ name: label, y: allHourCounts24[h], drilldown: `co-h24dur:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-h24dur:${h}`, name: `${label} — Duration`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: h24DurBins[h] })) },
      },
    ),
    makeChartBase(
      'co-16',
      '24-Hour Cleaning → Stay Status',
      `All cleaning orders by hour of day with drilldown into stay status per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN stay_status WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see stay status split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: completionHourCategories.map((label, h) => ({ name: label, y: allHourCounts24[h], drilldown: `co-h24ss:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-h24ss:${h}`, name: `${label} — Stay Status`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: h24StayStatus[h] })) },
      },
    ),
    makeChartBase(
      'co-17',
      '24-Hour Cleaning → Cleaning Status',
      `All cleaning orders by hour of day with drilldown into cleaning status per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN status_normalized WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see cleaning status split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: completionHourCategories.map((label, h) => ({ name: label, y: allHourCounts24[h], drilldown: `co-h24cs:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-h24cs:${h}`, name: `${label} — Cleaning Status`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: h24CleaningStatus[h] })) },
      },
    ),
    makeChartBase(
      'co-18',
      '24-Hour Cleaning → Attendant',
      `Completed cleaning orders by hour of day with drilldown into top attendants per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN attendant WHERE completed = true AND ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see attendant split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: completionHourCategories.map((label, h) => ({ name: label, y: allHourCounts24[h], drilldown: `co-h24att:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-h24att:${h}`, name: `${label} — Attendants`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: h24Attendant[h] })) },
      },
    ),
    makeChartBase(
      'co-19',
      '24-Hour Cleaning → On-Time/Delayed',
      `Completed cleaning orders by hour of day with drilldown into on-time vs delayed per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN is_on_time WHERE completed = true AND ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see on-time/delayed split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: completionHourCategories.map((label, h) => ({ name: label, y: allHourCounts24[h], drilldown: `co-h24otd:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-h24otd:${h}`, name: `${label} — On-Time/Delayed`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: h24OnTimeDelayed[h] })) },
      },
    ),
    makeChartBase(
      'co-20',
      '24-Hour Cleaning → Cleaning Type',
      `All cleaning orders by hour of day with drilldown into cleaning type per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN cleaning_type WHERE ${clause}`,
      {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see cleaning type split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: completionHourCategories.map((label, h) => ({ name: label, y: allHourCounts24[h], drilldown: `co-h24ct:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-h24ct:${h}`, name: `${label} — Cleaning Type`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: h24CleaningType[h] })) },
      },
    ),
    makeChartBase(
      'co-21',
      'Cleaning Duration → Stay Status',
      `Cleaning duration distribution with drilldown into stay status per duration bucket. ${suffix}.`,
      `COUNT(*) GROUP BY duration_bin DRILLDOWN stay_status WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see stay status split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durationBins.map((bin, i) => ({ name: bin.label, y: durationBinCounts[i], drilldown: `co-durss:${i}` })) }],
        drilldown: { series: durationBins.map((bin, i) => ({ id: `co-durss:${i}`, name: `${bin.label} — Stay Status`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: durBinStayStatus[i] })) },
      },
    ),
    makeChartBase(
      'co-22',
      'Cleaning Duration → Attendant',
      `Cleaning duration distribution with drilldown into top attendants per duration bucket. ${suffix}.`,
      `COUNT(*) GROUP BY duration_bin DRILLDOWN attendant WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see attendant split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durationBins.map((bin, i) => ({ name: bin.label, y: durationBinCounts[i], drilldown: `co-duratt:${i}` })) }],
        drilldown: { series: durationBins.map((bin, i) => ({ id: `co-duratt:${i}`, name: `${bin.label} — Attendants`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: durBinAttendant[i] })) },
      },
    ),
    makeChartBase(
      'co-23',
      'Cleaning Duration → Cleaning Type',
      `Cleaning duration distribution with drilldown into cleaning type per duration bucket. ${suffix}.`,
      `COUNT(*) GROUP BY duration_bin DRILLDOWN cleaning_type WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see cleaning type split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durationBins.map((bin, i) => ({ name: bin.label, y: durationBinCounts[i], drilldown: `co-durct:${i}` })) }],
        drilldown: { series: durationBins.map((bin, i) => ({ id: `co-durct:${i}`, name: `${bin.label} — Cleaning Type`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: durBinCleaningType[i] })) },
      },
    ),
    makeChartBase(
      'co-24',
      'Cleaning Duration → Room Type',
      `Cleaning duration distribution with drilldown into room type per duration bucket. ${suffix}.`,
      `COUNT(*) GROUP BY duration_bin DRILLDOWN room_type WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see room type split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durationBins.map((bin, i) => ({ name: bin.label, y: durationBinCounts[i], drilldown: `co-durrt:${i}` })) }],
        drilldown: { series: durationBins.map((bin, i) => ({ id: `co-durrt:${i}`, name: `${bin.label} — Room Type`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: durBinRoomType[i] })) },
      },
    ),
    makeChartBase(
      'co-25',
      '24-Hour Delayed → Stay Status',
      `Delayed orders by hour of day with drilldown into stay status per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN stay_status WHERE delayed = true AND ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Delayed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> delayed orders — click to see stay status split' },
        series: [{ type: 'column', name: 'Delayed Orders', color: '#92400e', data: completionHourCategories.map((label, h) => ({ name: label, y: delayedHourCounts[h], drilldown: `co-dlyss:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-dlyss:${h}`, name: `${label} — Stay Status`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: delayedHourStayStatus[h] })) },
      },
    ),
    makeChartBase(
      'co-26',
      '24-Hour Delayed → Attendant',
      `Delayed orders by hour of day with drilldown into top attendants per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN attendant WHERE delayed = true AND ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Delayed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> delayed orders — click to see attendant split' },
        series: [{ type: 'column', name: 'Delayed Orders', color: '#92400e', data: completionHourCategories.map((label, h) => ({ name: label, y: delayedHourCounts[h], drilldown: `co-dlyatt:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-dlyatt:${h}`, name: `${label} — Attendants`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: delayedHourAttendant[h] })) },
      },
    ),
    makeChartBase(
      'co-27',
      '24-Hour Delayed → Room Type',
      `Delayed orders by hour of day with drilldown into room type per hour. ${suffix}.`,
      `COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN room_type WHERE delayed = true AND ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
        yAxis: { title: { text: 'Delayed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> delayed orders — click to see room type split' },
        series: [{ type: 'column', name: 'Delayed Orders', color: '#92400e', data: completionHourCategories.map((label, h) => ({ name: label, y: delayedHourCounts[h], drilldown: `co-dlyrt:${h}` })) }],
        drilldown: { series: completionHourCategories.map((label, h) => ({ id: `co-dlyrt:${h}`, name: `${label} — Room Type`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: delayedHourRoomType[h] })) },
      },
    ),
    makeChartBase(
      'co-28',
      'Stay Status → 24-Hour Cleaning Distribution',
      `Distribution of cleaning orders by stay status with drilldown into 24-hour completion pattern. ${suffix}.`,
      `COUNT(*) GROUP BY stay_status DRILLDOWN HOUR(any_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Stay Status' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: dim24hSS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimss24h:${i}` })) }],
        drilldown: { series: dim24hSS.map((d, i) => ({ id: `co-dimss24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-29',
      'Cleaning Status → 24-Hour Cleaning Distribution',
      `Distribution of cleaning orders by cleaning status with drilldown into 24-hour completion pattern. ${suffix}.`,
      `COUNT(*) GROUP BY status_normalized DRILLDOWN HOUR(any_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Cleaning Status' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: dim24hCS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimcs24h:${i}` })) }],
        drilldown: { series: dim24hCS.map((d, i) => ({ id: `co-dimcs24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-30',
      'Room Type → 24-Hour Cleaning Distribution',
      `Distribution of cleaning orders by room type with drilldown into 24-hour completion pattern. ${suffix}.`,
      `COUNT(*) GROUP BY room_type DRILLDOWN HOUR(any_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Room Type' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: dim24hRT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimrt24h:${i}` })) }],
        drilldown: { series: dim24hRT.map((d, i) => ({ id: `co-dimrt24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-31',
      'On-Time/Delayed → 24-Hour Cleaning Distribution',
      `Distribution of completed orders by on-time/delayed status with drilldown into 24-hour completion pattern. ${suffix}.`,
      `COUNT(*) GROUP BY is_on_time DRILLDOWN HOUR(any_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'On-Time / Delayed' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#16a34a', data: dim24hOTD.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimotd24h:${i}` })) }],
        drilldown: { series: dim24hOTD.map((d, i) => ({ id: `co-dimotd24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-32',
      'Cleaning Type → 24-Hour Cleaning Distribution',
      `Distribution of cleaning orders by cleaning type with drilldown into 24-hour completion pattern. ${suffix}.`,
      `COUNT(*) GROUP BY cleaning_type DRILLDOWN HOUR(any_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Cleaning Type' } },
        yAxis: { title: { text: 'Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
        series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: dim24hCT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimct24h:${i}` })) }],
        drilldown: { series: dim24hCT.map((d, i) => ({ id: `co-dimct24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-33',
      'Top 50 Attendants → 24-Hour Cleaning Distribution',
      `Top 50 attendants by completed orders with drilldown into 24-hour completion pattern. ${suffix}.`,
      `COUNT(*) GROUP BY attendant TOP 50 DRILLDOWN HOUR(any_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Attendant' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#16a34a', data: dim24hAtt.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimatt24h:${i}` })) }],
        drilldown: { series: dim24hAtt.map((d, i) => ({ id: `co-dimatt24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-34',
      'Stay Status → Cleaning Duration Distribution',
      `Distribution of completed orders by stay status with drilldown into cleaning duration distribution. ${suffix}.`,
      `COUNT(*) GROUP BY stay_status DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Stay Status' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: dimDurSS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimssdr:${i}` })) }],
        drilldown: { series: dimDurSS.map((d, i) => ({ id: `co-dimssdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-35',
      'Cleaning Status → Cleaning Duration Distribution',
      `Distribution of completed orders by cleaning status with drilldown into cleaning duration distribution. ${suffix}.`,
      `COUNT(*) GROUP BY status_normalized DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Cleaning Status' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: dimDurCS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimcsdr:${i}` })) }],
        drilldown: { series: dimDurCS.map((d, i) => ({ id: `co-dimcsdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-36',
      'Room Type → Cleaning Duration Distribution',
      `Distribution of completed orders by room type with drilldown into cleaning duration distribution. ${suffix}.`,
      `COUNT(*) GROUP BY room_type DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Room Type' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: dimDurRT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimrtdr:${i}` })) }],
        drilldown: { series: dimDurRT.map((d, i) => ({ id: `co-dimrtdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-37',
      'On-Time/Delayed → Cleaning Duration Distribution',
      `Distribution of completed orders by on-time/delayed status with drilldown into cleaning duration distribution. ${suffix}.`,
      `COUNT(*) GROUP BY is_on_time DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'On-Time / Delayed' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: dimDurOTD.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimotddr:${i}` })) }],
        drilldown: { series: dimDurOTD.map((d, i) => ({ id: `co-dimotddr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-38',
      'Cleaning Type → Cleaning Duration Distribution',
      `Distribution of completed orders by cleaning type with drilldown into cleaning duration distribution. ${suffix}.`,
      `COUNT(*) GROUP BY cleaning_type DRILLDOWN duration_bin WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const, title: { text: 'Cleaning Type' } },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: dimDurCT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `co-dimctdr:${i}` })) }],
        drilldown: { series: dimDurCT.map((d, i) => ({ id: `co-dimctdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
      },
    ),
    makeChartBase(
      'co-39',
      'Floor → Room Attendant → Average Cleaning Duration',
      `Completed orders per floor. Click a floor to see its room attendants, and an attendant to see average cleaning duration (mins) overall and by room type. ${suffix}.`,
      `COUNT(*) GROUP BY floor DRILLDOWN attendant DRILLDOWN AVG(duration_minutes) BY room_type WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const },
        yAxis: { title: { text: 'Completed Orders / Avg Minutes' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: co39Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
        drilldown: { series: co39Dd as unknown as Highcharts.SeriesOptionsType[] },
      },
    ),
    makeChartBase(
      'co-40',
      'Floor → Room Attendant → 24-Hour Cleaning Distribution',
      `Completed orders per floor. Click a floor to see its room attendants, and an attendant to see their 24-hour cleaning completion distribution. ${suffix}.`,
      `COUNT(*) GROUP BY floor DRILLDOWN attendant DRILLDOWN HOUR(completed_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: co40Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
        drilldown: { series: co40Dd as unknown as Highcharts.SeriesOptionsType[] },
      },
    ),
    makeChartBase(
      'co-41',
      'Inspector → Room Attendant → Average Cleaning Duration',
      `Completed orders per inspector. Click an inspector to see their room attendants, and an attendant to see average cleaning duration (mins) overall and by room type. ${suffix}.`,
      `COUNT(*) GROUP BY supervisor DRILLDOWN attendant DRILLDOWN AVG(duration_minutes) BY room_type WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const },
        yAxis: { title: { text: 'Completed Orders / Avg Minutes' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: co41Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
        drilldown: { series: co41Dd as unknown as Highcharts.SeriesOptionsType[] },
      },
    ),
    makeChartBase(
      'co-42',
      'Inspector → Room Attendant → 24-Hour Cleaning Distribution',
      `Completed orders per inspector. Click an inspector to see their room attendants, and an attendant to see their 24-hour cleaning completion distribution. ${suffix}.`,
      `COUNT(*) GROUP BY supervisor DRILLDOWN attendant DRILLDOWN HOUR(completed_time) WHERE ${clause}`,
      {
        chart: { type: 'column' }, title: { text: undefined },
        xAxis: { type: 'category' as const },
        yAxis: { title: { text: 'Completed Orders' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
        series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: co42Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
        drilldown: { series: co42Dd as unknown as Highcharts.SeriesOptionsType[] },
      },
    ),
  ];
}

function buildCorpCharts(filteredRows: CoRow[], filters: CoFilters, timeZone: string): ChartDef[] {
  const clause = buildFilterClause(filters);
  const suffix = chartTitleSuffix(filters);
  const allRows = filteredRows;
  const completedRows = filteredRows.filter(isCompleted);
  // Single-pass hour lookup shared by every 24-hour-distribution chart below
  // (cco-18..23, cco-28..36) — see computeHourByRow/bucketRowsByHour.
  const hourByRow = computeHourByRow(allRows, (row) => row.completed_time ?? row.start_time ?? row.created_date, timeZone);

  const statusPriority = (status: string): number => {
    const normalized = status.toLowerCase();
    if (normalized.includes('completed')) return 0;
    if (normalized.includes('in progress')) return 1;
    if (normalized.includes('pending')) return 2;
    if (normalized.includes('delayed')) return 3;
    if (normalized.includes('reclean') || normalized.includes('re-clean')) return 4;
    return 5;
  };

  const dailyMap = new Map<string, { total: number; completed: number; delayed: number; reclean: number }>();
  const hotelTotalMap = groupCount(allRows, (row) => normText(row.hotel_code) || 'Unknown Hotel');
  const hotelCompletedMap = groupCount(completedRows, (row) => normText(row.hotel_code) || 'Unknown Hotel');
  const hotelStatusMap = new Map<string, Map<string, number>>();
  const hotelStayStatusMap = new Map<string, Map<string, number>>();
  const hotelRoomTypeMap = new Map<string, Map<string, number>>();
  const stayStatusHotelMap = new Map<string, Map<string, number>>();
  const hotelCreditMap = new Map<string, number>();
  const hotelAvgDurationMap = new Map<string, number>();
  const hotelDurationBuckets = new Map<string, number[]>();
  const hotelOnTimeCounts = new Map<string, number>();
  const hotelDelayedCounts = new Map<string, number>();
  const hotelRecleanCounts = new Map<string, number>();
  const hotelCompletionHourCreditMap = new Map<string, Map<number, number>>();
  const hotelCompletionHourCountMap = new Map<string, Map<number, number>>();

  const cleaningTypeCounts = groupCount(completedRows, (row) => normText(row.cleaning_type) || 'Unknown Cleaning Type');
  const roomTypeCounts = groupCount(completedRows, (row) => normText(row.room_type) || 'Unknown Room Type');
  const hotelRoomTypeDurationMap = new Map<string, Map<string, number[]>>();
  const hotelCleaningTypeDurationMap = new Map<string, Map<string, number[]>>();
  const hotelRoomTypeCreditMap = new Map<string, Map<string, number>>();
  const hourCategories = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
  const hotelCodes = Array.from(new Set(allRows.map((row) => normText(row.hotel_code) || 'Unknown Hotel')))
    .sort((a, b) => (hotelTotalMap[b] ?? 0) - (hotelTotalMap[a] ?? 0) || a.localeCompare(b));

  for (const row of allRows) {
    const hotel = normText(row.hotel_code) || 'Unknown Hotel';
    const status = rowStatus(row);
    const stayStatus = normText(row.stay_status) || 'Unknown Stay Status';
    const roomType = normText(row.room_type) || 'Unknown Room Type';
    const cleaningType = normText(row.cleaning_type) || 'Unknown Cleaning Type';
    const duration = toMinutes(row);
    const credit = typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0;
    const dateKey = toDateKey(row.created_date ?? row.completed_time ?? row.start_time, timeZone) || 'Unknown';
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { total: 0, completed: 0, delayed: 0, reclean: 0 });
    const daily = dailyMap.get(dateKey)!;
    daily.total += 1;
    if (isCompleted(row)) daily.completed += 1;
    if (isDelayed(row)) daily.delayed += 1;
    if (isReclean(row)) daily.reclean += 1;

    if (!hotelStatusMap.has(hotel)) hotelStatusMap.set(hotel, new Map<string, number>());
    hotelStatusMap.get(hotel)!.set(status, (hotelStatusMap.get(hotel)!.get(status) ?? 0) + 1);

    if (!stayStatusHotelMap.has(stayStatus)) stayStatusHotelMap.set(stayStatus, new Map<string, number>());
    stayStatusHotelMap.get(stayStatus)!.set(hotel, (stayStatusHotelMap.get(stayStatus)!.get(hotel) ?? 0) + 1);

    if (!hotelStayStatusMap.has(hotel)) hotelStayStatusMap.set(hotel, new Map<string, number>());
    hotelStayStatusMap.get(hotel)!.set(stayStatus, (hotelStayStatusMap.get(hotel)!.get(stayStatus) ?? 0) + 1);

    if (!hotelRoomTypeMap.has(hotel)) hotelRoomTypeMap.set(hotel, new Map<string, number>());
    hotelRoomTypeMap.get(hotel)!.set(roomType, (hotelRoomTypeMap.get(hotel)!.get(roomType) ?? 0) + 1);

    if (isCompleted(row) && duration !== null && Number.isFinite(duration)) {
      if (!hotelDurationBuckets.has(hotel)) hotelDurationBuckets.set(hotel, []);
      hotelDurationBuckets.get(hotel)!.push(duration);

      if (!hotelRoomTypeDurationMap.has(hotel)) hotelRoomTypeDurationMap.set(hotel, new Map<string, number[]>());
      if (!hotelRoomTypeDurationMap.get(hotel)!.has(roomType)) hotelRoomTypeDurationMap.get(hotel)!.set(roomType, []);
      hotelRoomTypeDurationMap.get(hotel)!.get(roomType)!.push(duration);

      if (!hotelCleaningTypeDurationMap.has(hotel)) hotelCleaningTypeDurationMap.set(hotel, new Map<string, number[]>());
      if (!hotelCleaningTypeDurationMap.get(hotel)!.has(cleaningType)) hotelCleaningTypeDurationMap.get(hotel)!.set(cleaningType, []);
      hotelCleaningTypeDurationMap.get(hotel)!.get(cleaningType)!.push(duration);
    }

    if (isCompleted(row)) {
      hotelCreditMap.set(hotel, (hotelCreditMap.get(hotel) ?? 0) + credit);
      if (!hotelRoomTypeCreditMap.has(hotel)) hotelRoomTypeCreditMap.set(hotel, new Map<string, number>());
      hotelRoomTypeCreditMap.get(hotel)!.set(roomType, (hotelRoomTypeCreditMap.get(hotel)!.get(roomType) ?? 0) + credit);

      const source = row.completed_time ?? row.start_time ?? row.created_date;
      const hour = hourFromSource(source, timeZone);
      if (hour !== null) {
        if (!hotelCompletionHourCreditMap.has(hotel)) hotelCompletionHourCreditMap.set(hotel, new Map<number, number>());
        hotelCompletionHourCreditMap.get(hotel)!.set(hour, (hotelCompletionHourCreditMap.get(hotel)!.get(hour) ?? 0) + credit);
        if (!hotelCompletionHourCountMap.has(hotel)) hotelCompletionHourCountMap.set(hotel, new Map<number, number>());
        hotelCompletionHourCountMap.get(hotel)!.set(hour, (hotelCompletionHourCountMap.get(hotel)!.get(hour) ?? 0) + 1);
      }
    }

    if (isOnTime(row)) hotelOnTimeCounts.set(hotel, (hotelOnTimeCounts.get(hotel) ?? 0) + 1);
    if (isDelayed(row)) hotelDelayedCounts.set(hotel, (hotelDelayedCounts.get(hotel) ?? 0) + 1);
    if (isReclean(row)) hotelRecleanCounts.set(hotel, (hotelRecleanCounts.get(hotel) ?? 0) + 1);
  }

  const dailyDates: string[] = Array.from(dailyMap.keys()).sort((a, b) => a.localeCompare(b));
  const topStatuses = topEntries(groupCount(allRows, rowStatus), 12);
  const corpStayStatusEntries = topEntries(groupCount(allRows, (row) => normText(row.stay_status) || 'Unknown Stay Status'), 8).map(([key]) => key);
  const cleaningTypeEntries = topEntries(cleaningTypeCounts, 12).map(([key]) => key);
  const roomTypeEntries = topEntries(roomTypeCounts, 12).map(([key]) => key);
  const corpRoomTypeEntries = topEntries(groupCount(allRows, (row) => normText(row.room_type) || 'Unknown Room Type'), 8).map(([key]) => key);
  const hotelAvgDurationEntries = hotelCodes
    .map((hotel) => {
      const values = hotelDurationBuckets.get(hotel) ?? [];
      const avg = values.length > 0 ? Number(mean(values)!.toFixed(2)) : null;
      return { hotel, avg, total: hotelTotalMap[hotel] ?? 0 };
    })
    .sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity) || b.total - a.total || a.hotel.localeCompare(b.hotel));
  const hotelCreditEntries = hotelCodes
    .map((hotel) => ({
      hotel,
      orders: hotelCompletedMap[hotel] ?? 0,
      credit: Number((hotelCreditMap.get(hotel) ?? 0).toFixed(2)),
    }))
    .sort((a, b) => b.credit - a.credit || b.orders - a.orders || a.hotel.localeCompare(b.hotel));
  const delayedRankedHotels = [...hotelCodes]
    .sort((a, b) => (hotelDelayedCounts.get(b) ?? 0) - (hotelDelayedCounts.get(a) ?? 0) || (hotelTotalMap[b] ?? 0) - (hotelTotalMap[a] ?? 0));
  const readinessRiskEntries = hotelCodes
    .map((hotel) => {
      const total = hotelTotalMap[hotel] ?? 0;
      const completed = hotelCompletedMap[hotel] ?? 0;
      const delayed = hotelDelayedCounts.get(hotel) ?? 0;
      const reclean = hotelRecleanCounts.get(hotel) ?? 0;
      const behind = completedRows.filter((row) => {
        if ((normText(row.hotel_code) || 'Unknown Hotel') !== hotel) return false;
        if (typeof row.duration_variance_minutes === 'number') return row.duration_variance_minutes > 0;
        return isDelayed(row);
      }).length;
      const completionGap = total > 0 ? Math.max(0, 100 - (completed / total) * 100) : 0;
      const delayedRate = completed > 0 ? (delayed / completed) * 100 : 0;
      const behindRate = completed > 0 ? (behind / completed) * 100 : 0;
      const recleanRate = total > 0 ? (reclean / total) * 100 : 0;
      const score = Number(((completionGap * 0.35) + (delayedRate * 0.25) + (behindRate * 0.25) + (recleanRate * 0.15)).toFixed(2));
      return { hotel, score, completionGap, delayedRate, behindRate, recleanRate };
    })
    .sort((a, b) => b.score - a.score || a.hotel.localeCompare(b.hotel));
  const qualityLeakageEntries = hotelCodes
    .map((hotel) => {
      const hotelRows = allRows.filter((row) => (normText(row.hotel_code) || 'Unknown Hotel') === hotel);
      const inspected = hotelRows.filter((row) => normText(row.pass_fail) || normText(row.inspection_status)).length;
      const fail = hotelRows.filter((row) => normKey(row.pass_fail) === 'fail' || normKey(row.inspection_status) === 'fail').length;
      const reclean = hotelRows.filter(isReclean).length;
      const noInspection = hotelRows.length - inspected;
      return {
        hotel,
        recleanRate: hotelRows.length > 0 ? Number(((reclean / hotelRows.length) * 100).toFixed(2)) : 0,
        failRate: inspected > 0 ? Number(((fail / inspected) * 100).toFixed(2)) : 0,
        noInspection,
      };
    })
    .sort((a, b) => (b.recleanRate + b.failRate) - (a.recleanRate + a.failRate) || b.noInspection - a.noInspection || a.hotel.localeCompare(b.hotel));

  const hourDurBuckets = new Map<number, number[]>();
  for (let _h = 0; _h < 24; _h++) {
    const _rows = completedRows.filter((row) => {
      const _src = row.completed_time ?? row.start_time ?? row.created_date;
      return hourFromSource(_src, timeZone) === _h;
    });
    hourDurBuckets.set(_h, [
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v < 15; }).length,
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v >= 15 && v < 30; }).length,
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v >= 30 && v < 45; }).length,
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v >= 45 && v < 60; }).length,
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v >= 60 && v < 75; }).length,
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v >= 75 && v < 90; }).length,
      _rows.filter(r => { const v = toMinutes(r); return Number.isFinite(v) && v >= 90; }).length,
    ]);
  }

  const _durBucketFns: Array<(v: number) => boolean> = [
    (v) => v >= 0 && v < 15,
    (v) => v >= 15 && v < 30,
    (v) => v >= 30 && v < 45,
    (v) => v >= 45 && v < 60,
    (v) => v >= 60 && v < 75,
    (v) => v >= 75 && v < 90,
    (v) => v >= 90,
  ];
  const durBucketLabels = ['0-15 min', '15-30 min', '30-45 min', '45-60 min', '60-75 min', '75-90 min', '>90 min'];
  const durBucketAttendants = new Map<number, Array<{ name: string; y: number }>>();
  for (let _bi = 0; _bi < _durBucketFns.length; _bi++) {
    const _bRows = completedRows.filter((row) => { const v = toMinutes(row); return Number.isFinite(v) && _durBucketFns[_bi](v); });
    const _attCounts = groupCount(_bRows, (row) => normText(row.attendant) || 'Unknown Attendant');
    durBucketAttendants.set(_bi, topEntries(_attCounts, 15).map(([name, y]) => ({ name, y })));
  }

  // cco-18-23: 24-Hour Cleaning distribution (all rows by hour, 6 drilldown dimensions)
  const ccoAllHourRows24 = bucketRowsByHour(allRows, hourByRow);
  const ccoAllHourCounts24 = ccoAllHourRows24.map((rows) => rows.length);
  const ccoHourCategories = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  const ccoh24DurBins = ccoAllHourRows24.map((rows) =>
    durBucketLabels.map((label, bi) => ({
      name: label,
      y: rows.filter(isCompleted).filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && _durBucketFns[bi](v); }).length,
    }))
  );
  const ccoh24StayStatus = ccoAllHourRows24.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.stay_status) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const ccoh24CleaningStatus = ccoAllHourRows24.map((rows) => {
    const m = groupCount(rows, rowStatus);
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const ccoh24Attendant = ccoAllHourRows24.map((rows) => {
    const m = groupCount(rows.filter(isCompleted), (r) => normText(r.attendant) || 'Unknown Attendant');
    return topEntries(m, 15).map(([name, y]) => ({ name, y }));
  });
  const ccoh24OnTimeDelayed = ccoAllHourRows24.map((rows) => {
    const completed = rows.filter(isCompleted);
    return [
      { name: 'On Time', y: completed.filter(isOnTime).length },
      { name: 'Delayed', y: completed.filter(isDelayed).length },
    ];
  });
  const ccoh24CleaningType = ccoAllHourRows24.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.cleaning_type) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });

  // cco-24-27: Cleaning Duration distribution drilldown dimensions
  const ccoDurBinRows = _durBucketFns.map((fn) =>
    completedRows.filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && fn(v); })
  );
  const ccoDurBinStayStatus = ccoDurBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.stay_status) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const ccoDurBinAttendant = ccoDurBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.attendant) || 'Unknown Attendant');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });
  const ccoDurBinCleaningType = ccoDurBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.cleaning_type) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const ccoDurBinRoomType = ccoDurBinRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.room_type) || 'Unknown Room Type');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });
  const ccoDurBinCounts = _durBucketFns.map((fn) =>
    completedRows.filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && fn(v); }).length
  );

  // cco-28-30: 24-Hour Delayed Order distribution drilldown dimensions
  const ccoDelayedRows = completedRows.filter(isDelayed);
  const ccoDelayedHourRows = bucketRowsByHour(ccoDelayedRows, hourByRow);
  const ccoDelayedHourCounts = ccoDelayedHourRows.map((rows) => rows.length);
  const ccoDelayedHourStayStatus = ccoDelayedHourRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.stay_status) || 'Unknown');
    return topEntries(m, 20).map(([name, y]) => ({ name, y }));
  });
  const ccoDelayedHourAttendant = ccoDelayedHourRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.attendant) || 'Unknown Attendant');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });
  const ccoDelayedHourRoomType = ccoDelayedHourRows.map((rows) => {
    const m = groupCount(rows, (r) => normText(r.room_type) || 'Unknown Room Type');
    return topEntries(m, 50).map(([name, y]) => ({ name, y }));
  });

  // cco-31-42: Dimension → 24-Hour / Cleaning Duration drilldowns
  const _ccog1ByHour = (rows: CoRow[]) => {
    const counts = new Array(24).fill(0);
    for (const r of rows) {
      const h = hourByRow.get(r);
      if (h !== null && h !== undefined) counts[h]++;
    }
    return ccoHourCategories.map((label, h) => ({ name: label, y: counts[h] }));
  };
  const _ccog2ByDur = (rows: CoRow[]) =>
    durBucketLabels.map((label, bi) => ({
      name: label,
      y: rows.filter((r) => { const v = toMinutes(r); return Number.isFinite(v) && _durBucketFns[bi](v); }).length,
    }));

  const ccoDim24hSS = topEntries(groupCount(allRows, (r) => normText(r.stay_status) || 'Unknown'), 12)
    .map(([name, total]) => ({ name, total, drill: _ccog1ByHour(allRows.filter((r) => (normText(r.stay_status) || 'Unknown') === name)) }));
  const ccoDim24hCS = topEntries(groupCount(allRows, rowStatus), 12)
    .map(([name, total]) => ({ name, total, drill: _ccog1ByHour(allRows.filter((r) => rowStatus(r) === name)) }));
  const ccoDim24hRT = topEntries(groupCount(allRows, (r) => normText(r.room_type) || 'Unknown Room Type'), 50)
    .map(([name, total]) => ({ name, total, drill: _ccog1ByHour(allRows.filter((r) => (normText(r.room_type) || 'Unknown Room Type') === name)) }));
  const ccoDim24hOTD = [
    { name: 'On Time', total: completedRows.filter(isOnTime).length, drill: _ccog1ByHour(completedRows.filter(isOnTime)) },
    { name: 'Delayed', total: completedRows.filter(isDelayed).length, drill: _ccog1ByHour(completedRows.filter(isDelayed)) },
  ];
  const ccoDim24hCT = topEntries(groupCount(allRows, (r) => normText(r.cleaning_type) || 'Unknown'), 12)
    .map(([name, total]) => ({ name, total, drill: _ccog1ByHour(allRows.filter((r) => (normText(r.cleaning_type) || 'Unknown') === name)) }));
  const ccoDim24hAtt = topEntries(groupCount(completedRows, (r) => normText(r.attendant) || 'Unknown Attendant'), 50)
    .map(([name, total]) => ({ name, total, drill: _ccog1ByHour(completedRows.filter((r) => (normText(r.attendant) || 'Unknown Attendant') === name)) }));

  const ccoDimDurSS = topEntries(groupCount(completedRows, (r) => normText(r.stay_status) || 'Unknown'), 12)
    .map(([name, total]) => ({ name, total, drill: _ccog2ByDur(completedRows.filter((r) => (normText(r.stay_status) || 'Unknown') === name)) }));
  const ccoDimDurCS = topEntries(groupCount(completedRows, rowStatus), 12)
    .map(([name, total]) => ({ name, total, drill: _ccog2ByDur(completedRows.filter((r) => rowStatus(r) === name)) }));
  const ccoDimDurRT = topEntries(groupCount(completedRows, (r) => normText(r.room_type) || 'Unknown Room Type'), 50)
    .map(([name, total]) => ({ name, total, drill: _ccog2ByDur(completedRows.filter((r) => (normText(r.room_type) || 'Unknown Room Type') === name)) }));
  const ccoDimDurOTD = [
    { name: 'On Time', total: completedRows.filter(isOnTime).length, drill: _ccog2ByDur(completedRows.filter(isOnTime)) },
    { name: 'Delayed', total: completedRows.filter(isDelayed).length, drill: _ccog2ByDur(completedRows.filter(isDelayed)) },
  ];
  const ccoDimDurCT = topEntries(groupCount(completedRows, (r) => normText(r.cleaning_type) || 'Unknown'), 12)
    .map(([name, total]) => ({ name, total, drill: _ccog2ByDur(completedRows.filter((r) => (normText(r.cleaning_type) || 'Unknown') === name)) }));
  const ccoDimDurAtt = topEntries(groupCount(completedRows, (r) => normText(r.attendant) || 'Unknown Attendant'), 50)
    .map(([name, total]) => ({ name, total, drill: _ccog2ByDur(completedRows.filter((r) => (normText(r.attendant) || 'Unknown Attendant') === name)) }));

  // ── cco-43 / cco-44: Hotel → Floor → Attendant nested aggregation ──────────
  type CcoAttAgg = { count: number; credit: number; durations: number[]; roomTypeDur: Map<string, number[]>; hourCount: Map<number, number> };
  const ccoHotelFloorAtt = new Map<string, Map<string, Map<string, CcoAttAgg>>>();
  for (const row of completedRows) {
    const hotel = normText(row.hotel_code) || 'Unknown Hotel';
    const floor = normText(row.floor) || 'Unknown Floor';
    const att = normText(row.attendant) || 'Unknown Attendant';
    if (!ccoHotelFloorAtt.has(hotel)) ccoHotelFloorAtt.set(hotel, new Map());
    const floorMap = ccoHotelFloorAtt.get(hotel)!;
    if (!floorMap.has(floor)) floorMap.set(floor, new Map());
    const attMap = floorMap.get(floor)!;
    if (!attMap.has(att)) attMap.set(att, { count: 0, credit: 0, durations: [], roomTypeDur: new Map(), hourCount: new Map() });
    const agg = attMap.get(att)!;
    agg.count += 1;
    agg.credit += typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0;
    const dur = toMinutes(row);
    if (dur !== null && Number.isFinite(dur)) {
      agg.durations.push(dur);
      const roomType = normText(row.room_type) || 'Unknown Room Type';
      if (!agg.roomTypeDur.has(roomType)) agg.roomTypeDur.set(roomType, []);
      agg.roomTypeDur.get(roomType)!.push(dur);
    }
    const hourSource = row.completed_time ?? row.start_time ?? row.created_date;
    const h = hourFromSource(hourSource, timeZone);
    if (h !== null) agg.hourCount.set(h, (agg.hourCount.get(h) ?? 0) + 1);
  }
  // Flatten into Highcharts drilldown series for both charts (index-based ids; names may contain colons)
  type DdSeries = { id: string; name: string; type: 'column'; color: string; dataLabels: { enabled: boolean; format?: string }; data: Array<{ name: string; y: number; drilldown?: string }> };
  const cco43Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const cco43Dd: DdSeries[] = [];
  const cco44Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const cco44Dd: DdSeries[] = [];
  const CCO_L1 = '#ea580c', CCO_L2 = '#B45309', CCO_L3 = '#1D4ED8';
  // Natural floor order (L1, L2, ... L27) instead of alphabetical/count order; unknowns sort last.
  const naturalFloorCompare = (a: string, b: string): number => {
    if (a === 'Unknown Floor') return b === 'Unknown Floor' ? 0 : 1;
    if (b === 'Unknown Floor') return -1;
    const na = Number(a.replace(/\D+/g, ''));
    const nb = Number(b.replace(/\D+/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  };
  const ccoHotelsSorted = Array.from(ccoHotelFloorAtt.entries())
    .map(([hotel, floorMap]) => {
      let n = 0;
      for (const attMap of floorMap.values()) for (const a of attMap.values()) n += a.count;
      return { hotel, floorMap, n };
    })
    .sort((a, b) => b.n - a.n || a.hotel.localeCompare(b.hotel))
    .slice(0, 50);
  ccoHotelsSorted.forEach(({ hotel, floorMap, n }, hIdx) => {
    cco43Primary.push({ name: hotel, y: n, drilldown: `cco43h:${hIdx}` });
    cco44Primary.push({ name: hotel, y: n, drilldown: `cco44h:${hIdx}` });
    const floorSorted = Array.from(floorMap.entries())
      .map(([floor, attMap]) => {
        let m = 0;
        for (const a of attMap.values()) m += a.count;
        return { floor, attMap, m };
      })
      .sort((a, b) => b.m - a.m || a.floor.localeCompare(b.floor))
      .slice(0, 50)
      .sort((a, b) => naturalFloorCompare(a.floor, b.floor));
    const insp43Data: DdSeries['data'] = [];
    const insp44Data: DdSeries['data'] = [];
    floorSorted.forEach(({ floor, attMap, m }, iIdx) => {
      insp43Data.push({ name: floor, y: m, drilldown: `cco43i:${hIdx}:${iIdx}` });
      insp44Data.push({ name: floor, y: m, drilldown: `cco44i:${hIdx}:${iIdx}` });
      const attSorted = Array.from(attMap.entries())
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .slice(0, 50);
      const att43Data: DdSeries['data'] = [];
      const att44Data: DdSeries['data'] = [];
      attSorted.forEach(([att, agg], aIdx) => {
        att43Data.push({ name: att, y: agg.count, drilldown: `cco43a:${hIdx}:${iIdx}:${aIdx}` });
        att44Data.push({ name: att, y: agg.count, drilldown: `cco44a:${hIdx}:${iIdx}:${aIdx}` });
        // cco-43 leaf: average cleaning duration (mins) per room type, with overall avg first
        const overallAvg = agg.durations.length > 0 ? Number(mean(agg.durations)!.toFixed(1)) : 0;
        const rtData = Array.from(agg.roomTypeDur.entries())
          .map(([rt, arr]) => ({ name: rt, y: Number(mean(arr)!.toFixed(1)) }))
          .sort((a, b) => b.y - a.y)
          .slice(0, 50);
        cco43Dd.push({
          id: `cco43a:${hIdx}:${iIdx}:${aIdx}`, name: `${att} — Avg Cleaning Duration (min)`,
          type: 'column', color: CCO_L3, dataLabels: { enabled: true, format: '{point.y}' },
          data: [{ name: 'ALL ROOMS', y: overallAvg }, ...rtData],
        });
        // cco-44 leaf: 24-hour cleaning distribution
        cco44Dd.push({
          id: `cco44a:${hIdx}:${iIdx}:${aIdx}`, name: `${att} — 24-Hour Cleaning Distribution`,
          type: 'column', color: CCO_L3, dataLabels: { enabled: true, format: '{point.y}' },
          data: Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: agg.hourCount.get(h) ?? 0 })),
        });
      });
      cco43Dd.push({ id: `cco43i:${hIdx}:${iIdx}`, name: `${floor} — Attendants`, type: 'column', color: CCO_L2, dataLabels: { enabled: true, format: '{point.y}' }, data: att43Data });
      cco44Dd.push({ id: `cco44i:${hIdx}:${iIdx}`, name: `${floor} — Attendants`, type: 'column', color: CCO_L2, dataLabels: { enabled: true, format: '{point.y}' }, data: att44Data });
    });
    cco43Dd.push({ id: `cco43h:${hIdx}`, name: `${hotel} — Floors`, type: 'column', color: CCO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: insp43Data });
    cco44Dd.push({ id: `cco44h:${hIdx}`, name: `${hotel} — Floors`, type: 'column', color: CCO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: insp44Data });
  });

  // ── cco-45 / cco-46: Hotel → Inspector → Attendant nested aggregation ──────
  const ccoHotelInspAtt = new Map<string, Map<string, Map<string, CcoAttAgg>>>();
  for (const row of completedRows) {
    const hotel = normText(row.hotel_code) || 'Unknown Hotel';
    const insp = normText(row.supervisor) || 'Unknown Inspector';
    const att = normText(row.attendant) || 'Unknown Attendant';
    if (!ccoHotelInspAtt.has(hotel)) ccoHotelInspAtt.set(hotel, new Map());
    const inspMap = ccoHotelInspAtt.get(hotel)!;
    if (!inspMap.has(insp)) inspMap.set(insp, new Map());
    const attMap = inspMap.get(insp)!;
    if (!attMap.has(att)) attMap.set(att, { count: 0, credit: 0, durations: [], roomTypeDur: new Map(), hourCount: new Map() });
    const agg = attMap.get(att)!;
    agg.count += 1;
    agg.credit += typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0;
    const dur = toMinutes(row);
    if (dur !== null && Number.isFinite(dur)) {
      agg.durations.push(dur);
      const roomType = normText(row.room_type) || 'Unknown Room Type';
      if (!agg.roomTypeDur.has(roomType)) agg.roomTypeDur.set(roomType, []);
      agg.roomTypeDur.get(roomType)!.push(dur);
    }
    const hourSource = row.completed_time ?? row.start_time ?? row.created_date;
    const h = hourFromSource(hourSource, timeZone);
    if (h !== null) agg.hourCount.set(h, (agg.hourCount.get(h) ?? 0) + 1);
  }
  const cco45Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const cco45Dd: DdSeries[] = [];
  const cco46Primary: Array<{ name: string; y: number; drilldown: string }> = [];
  const cco46Dd: DdSeries[] = [];
  const ccoInspHotelsSorted = Array.from(ccoHotelInspAtt.entries())
    .map(([hotel, inspMap]) => {
      let n = 0;
      for (const attMap of inspMap.values()) for (const a of attMap.values()) n += a.count;
      return { hotel, inspMap, n };
    })
    .sort((a, b) => b.n - a.n || a.hotel.localeCompare(b.hotel))
    .slice(0, 50);
  ccoInspHotelsSorted.forEach(({ hotel, inspMap, n }, hIdx) => {
    cco45Primary.push({ name: hotel, y: n, drilldown: `cco45h:${hIdx}` });
    cco46Primary.push({ name: hotel, y: n, drilldown: `cco46h:${hIdx}` });
    const inspSorted = Array.from(inspMap.entries())
      .map(([insp, attMap]) => {
        let m = 0;
        for (const a of attMap.values()) m += a.count;
        return { insp, attMap, m };
      })
      .sort((a, b) => b.m - a.m || a.insp.localeCompare(b.insp))
      .slice(0, 50);
    const insp45Data: DdSeries['data'] = [];
    const insp46Data: DdSeries['data'] = [];
    inspSorted.forEach(({ insp, attMap, m }, iIdx) => {
      insp45Data.push({ name: insp, y: m, drilldown: `cco45i:${hIdx}:${iIdx}` });
      insp46Data.push({ name: insp, y: m, drilldown: `cco46i:${hIdx}:${iIdx}` });
      const attSorted = Array.from(attMap.entries())
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .slice(0, 50);
      const att45Data: DdSeries['data'] = [];
      const att46Data: DdSeries['data'] = [];
      attSorted.forEach(([att, agg], aIdx) => {
        att45Data.push({ name: att, y: agg.count, drilldown: `cco45a:${hIdx}:${iIdx}:${aIdx}` });
        att46Data.push({ name: att, y: agg.count, drilldown: `cco46a:${hIdx}:${iIdx}:${aIdx}` });
        // cco-45 leaf: average cleaning duration (mins) per room type, with overall avg first
        const overallAvg = agg.durations.length > 0 ? Number(mean(agg.durations)!.toFixed(1)) : 0;
        const rtData = Array.from(agg.roomTypeDur.entries())
          .map(([rt, arr]) => ({ name: rt, y: Number(mean(arr)!.toFixed(1)) }))
          .sort((a, b) => b.y - a.y)
          .slice(0, 50);
        cco45Dd.push({
          id: `cco45a:${hIdx}:${iIdx}:${aIdx}`, name: `${att} — Avg Cleaning Duration (min)`,
          type: 'column', color: CCO_L3, dataLabels: { enabled: true, format: '{point.y}' },
          data: [{ name: 'ALL ROOMS', y: overallAvg }, ...rtData],
        });
        // cco-46 leaf: 24-hour cleaning distribution
        cco46Dd.push({
          id: `cco46a:${hIdx}:${iIdx}:${aIdx}`, name: `${att} — 24-Hour Cleaning Distribution`,
          type: 'column', color: CCO_L3, dataLabels: { enabled: true, format: '{point.y}' },
          data: Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, '0')}:00`, y: agg.hourCount.get(h) ?? 0 })),
        });
      });
      cco45Dd.push({ id: `cco45i:${hIdx}:${iIdx}`, name: `${insp} — Attendants`, type: 'column', color: CCO_L2, dataLabels: { enabled: true, format: '{point.y}' }, data: att45Data });
      cco46Dd.push({ id: `cco46i:${hIdx}:${iIdx}`, name: `${insp} — Attendants`, type: 'column', color: CCO_L2, dataLabels: { enabled: true, format: '{point.y}' }, data: att46Data });
    });
    cco45Dd.push({ id: `cco45h:${hIdx}`, name: `${hotel} — Inspectors`, type: 'column', color: CCO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: insp45Data });
    cco46Dd.push({ id: `cco46h:${hIdx}`, name: `${hotel} — Inspectors`, type: 'column', color: CCO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: insp46Data });
  });

  const make = (id: string, title: string, note: string, formula: string, options: Highcharts.Options): ChartDef =>
    makeChartBase(id, title, `${note} ${suffix}.`, `${formula} WHERE ${clause}`, options);

  return [
    (() => {
      // cco-01: Hotel → Top Average Credit by Inspector → Top Average Credit
      // by Attendant (3-level donut). Reuses the shared ccoHotelInspAtt
      // aggregation (same source as cco-04/45/46), pivoting levels 2-3 to
      // AVERAGE cleaning_credit (sum ÷ completed orders) instead of raw count.
      const cco01Dd: Highcharts.SeriesOptionsType[] = [];
      ccoInspHotelsSorted.forEach(({ inspMap }, hIdx) => {
        const inspAvgSorted = Array.from(inspMap.entries())
          .map(([insp, attMap]) => {
            let credit = 0, count = 0;
            for (const a of attMap.values()) { credit += a.credit; count += a.count; }
            return { insp, avg: count > 0 ? Number((credit / count).toFixed(2)) : 0, attMap };
          })
          .sort((a, b) => b.avg - a.avg || a.insp.localeCompare(b.insp))
          .slice(0, 20);
        cco01Dd.push({
          id: `cco01h:${hIdx}`,
          name: 'Top Average Credit by Inspector',
          type: 'pie', innerSize: '58%',
          dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
          data: inspAvgSorted.map(({ insp, avg }, iIdx) => ({ name: insp, y: avg, drilldown: `cco01i:${hIdx}:${iIdx}` })),
        } as Highcharts.SeriesOptionsType);
        inspAvgSorted.forEach(({ insp, attMap }, iIdx) => {
          const attAvgSorted = Array.from(attMap.entries())
            .map(([att, agg]) => ({ att, avg: agg.count > 0 ? Number((agg.credit / agg.count).toFixed(2)) : 0 }))
            .sort((a, b) => b.avg - a.avg || a.att.localeCompare(b.att))
            .slice(0, 20);
          cco01Dd.push({
            id: `cco01i:${hIdx}:${iIdx}`,
            name: `${insp} — Top Average Credit by Attendant`,
            type: 'pie', innerSize: '58%',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            data: attAvgSorted.map(({ att, avg }) => ({ name: att, y: avg })),
          } as Highcharts.SeriesOptionsType);
        });
      });

      return make('cco-01', 'Hotel → Top Average Credit by Inspector → Top Average Credit by Attendant', 'Completed orders per hotel. Click a hotel to see inspectors ranked by average cleaning credit, then an inspector to see their attendants ranked by average cleaning credit', 'COUNT(*) GROUP BY hotel_code DRILLDOWN AVG(cleaning_credit) BY supervisor DRILLDOWN AVG(cleaning_credit) BY attendant', {
        chart: { type: 'pie' },
        title: { text: undefined },
        plotOptions: {
          pie: {
            innerSize: '58%',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            showInLegend: true,
          },
        },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        series: [{
          type: 'pie',
          name: 'Completed Orders',
          data: ccoInspHotelsSorted.map(({ hotel, n }, hIdx) => ({ name: hotel, y: n, drilldown: `cco01h:${hIdx}` })),
        }],
        drilldown: { series: cco01Dd },
      });
    })(),
    make('cco-02', 'Hotel vs Average Cleaning Duration', 'Hotel-to-hotel cleaning speed comparison with workload context', 'COUNT(*) + AVG(actual_duration_minutes) GROUP BY hotel_code', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { categories: hotelAvgDurationEntries.map((item) => item.hotel), crosshair: true },
      yAxis: [
        { title: { text: 'Orders' } },
        { title: { text: 'Avg Duration (min)' }, opposite: true },
      ],
      plotOptions: {
        column: { dataLabels: { enabled: true, format: '{point.y}' } },
        line: { dataLabels: { enabled: true, format: '{point.y:.2f}' }, marker: { enabled: true } },
      },
      tooltip: { shared: true },
      series: [
        { type: 'column', name: 'Orders', data: hotelAvgDurationEntries.map((item) => item.total), color: '#0f766e' },
        { type: 'line', name: 'Avg Duration (min)', data: hotelAvgDurationEntries.map((item) => item.avg), yAxis: 1, color: '#ea580c', lineWidth: 3, zIndex: 10, marker: { enabled: true, radius: 4 }, dashStyle: 'Solid' },
      ],
    }),
    (() => {
      // cco-03: Hotel → Floor → Attendant Credit → Average Cleaning Duration
      // (4-level vertical-bar drilldown, mirrors cco-43's Hotel→Floor→
      // Attendant→AvgDuration structure exactly, but the Hotel/Floor/
      // Attendant levels plot cleaning_credit sums instead of order counts).
      type Cco03Agg = { credit: number; durations: number[]; roomTypeDur: Map<string, number[]> };
      const cco03HotelFloorAtt = new Map<string, Map<string, Map<string, Cco03Agg>>>();
      for (const row of completedRows) {
        const hotel = normText(row.hotel_code) || 'Unknown Hotel';
        const floor = normText(row.floor) || 'Unknown Floor';
        const att = normText(row.attendant) || 'Unknown Attendant';
        const credit = typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0;
        if (!cco03HotelFloorAtt.has(hotel)) cco03HotelFloorAtt.set(hotel, new Map());
        const floorMap = cco03HotelFloorAtt.get(hotel)!;
        if (!floorMap.has(floor)) floorMap.set(floor, new Map());
        const attMap = floorMap.get(floor)!;
        if (!attMap.has(att)) attMap.set(att, { credit: 0, durations: [], roomTypeDur: new Map() });
        const agg = attMap.get(att)!;
        agg.credit += credit;
        const dur = toMinutes(row);
        if (dur !== null && Number.isFinite(dur)) {
          agg.durations.push(dur);
          const roomType = normText(row.room_type) || 'Unknown Room Type';
          if (!agg.roomTypeDur.has(roomType)) agg.roomTypeDur.set(roomType, []);
          agg.roomTypeDur.get(roomType)!.push(dur);
        }
      }

      const cco03Primary: Array<{ name: string; y: number; drilldown: string }> = [];
      const cco03DdSeries: DdSeries[] = [];
      const cco03HotelsSorted = Array.from(cco03HotelFloorAtt.entries())
        .map(([hotel, floorMap]) => {
          let credit = 0;
          for (const attMap of floorMap.values()) for (const a of attMap.values()) credit += a.credit;
          return { hotel, floorMap, credit: Number(credit.toFixed(2)) };
        })
        .sort((a, b) => b.credit - a.credit || a.hotel.localeCompare(b.hotel))
        .slice(0, 50);

      cco03HotelsSorted.forEach(({ hotel, floorMap, credit }, hIdx) => {
        cco03Primary.push({ name: hotel, y: credit, drilldown: `cco03h:${hIdx}` });
        const floorSorted = Array.from(floorMap.entries())
          .map(([floor, attMap]) => {
            let credit2 = 0;
            for (const a of attMap.values()) credit2 += a.credit;
            return { floor, attMap, credit: Number(credit2.toFixed(2)) };
          })
          .sort((a, b) => b.credit - a.credit || a.floor.localeCompare(b.floor))
          .slice(0, 50)
          .sort((a, b) => naturalFloorCompare(a.floor, b.floor));
        const floorData: DdSeries['data'] = [];
        floorSorted.forEach(({ floor, attMap, credit: floorCredit }, fIdx) => {
          floorData.push({ name: floor, y: floorCredit, drilldown: `cco03f:${hIdx}:${fIdx}` });
          const attSorted = Array.from(attMap.entries())
            .sort((a, b) => b[1].credit - a[1].credit || a[0].localeCompare(b[0]))
            .slice(0, 50);
          const attData: DdSeries['data'] = [];
          attSorted.forEach(([att, agg], aIdx) => {
            attData.push({ name: att, y: Number(agg.credit.toFixed(2)), drilldown: `cco03a:${hIdx}:${fIdx}:${aIdx}` });
            // Leaf: average cleaning duration (mins) per room type, with overall avg first
            const overallAvg = agg.durations.length > 0 ? Number(mean(agg.durations)!.toFixed(1)) : 0;
            const rtData = Array.from(agg.roomTypeDur.entries())
              .map(([rt, arr]) => ({ name: rt, y: Number(mean(arr)!.toFixed(1)) }))
              .sort((a, b) => b.y - a.y)
              .slice(0, 50);
            cco03DdSeries.push({
              id: `cco03a:${hIdx}:${fIdx}:${aIdx}`, name: `${att} — Avg Cleaning Duration (min)`,
              type: 'column', color: CCO_L3, dataLabels: { enabled: true, format: '{point.y}' },
              data: [{ name: 'ALL ROOMS', y: overallAvg }, ...rtData],
            });
          });
          cco03DdSeries.push({ id: `cco03f:${hIdx}:${fIdx}`, name: `${floor} — Attendant Credit`, type: 'column', color: CCO_L2, dataLabels: { enabled: true, format: '{point.y}' }, data: attData });
        });
        cco03DdSeries.push({ id: `cco03h:${hIdx}`, name: `${hotel} — Floors`, type: 'column', color: CCO_L1, dataLabels: { enabled: true, format: '{point.y}' }, data: floorData });
      });

      return make('cco-03', 'Hotel → Floor → Attendant Credit → Average Cleaning Duration', 'Cleaning credit earned per hotel and floor. Click a hotel to see its floors, a floor to see its attendants ranked by credit, and an attendant to see average cleaning duration (mins) overall and by room type', 'SUM(cleaning_credit) GROUP BY hotel DRILLDOWN floor DRILLDOWN attendant DRILLDOWN AVG(duration_minutes) BY room_type', {
        chart: { type: 'column' },
        title: { text: undefined },
        xAxis: { type: 'category' },
        yAxis: { title: { text: 'Cleaning Credit' } },
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
        tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
        series: [{
          type: 'column',
          name: 'Cleaning Credit',
          color: '#0F766E',
          dataLabels: { enabled: true, format: '{point.y}' },
          data: cco03Primary,
        }],
        drilldown: { series: cco03DdSeries as unknown as Highcharts.SeriesOptionsType[] },
      });
    })(),
    (() => {
      // cco-04: Hotel → Inspector → Room Attendant → Average Cleaning Duration
      // (by Room Type) — 4-level donut drilldown. Reuses the same
      // ccoHotelInspAtt aggregation already computed for cco-45 (identical
      // dimensional structure), just rendered as pie/donut instead of column.
      const cco04Dd: Highcharts.SeriesOptionsType[] = [];
      ccoInspHotelsSorted.forEach(({ hotel, inspMap }, hIdx) => {
        const inspSorted = Array.from(inspMap.entries())
          .map(([insp, attMap]) => {
            let m = 0;
            for (const a of attMap.values()) m += a.count;
            return { insp, attMap, m };
          })
          .sort((a, b) => b.m - a.m || a.insp.localeCompare(b.insp))
          .slice(0, 50);
        const insp04Data: Array<{ name: string; y: number; drilldown: string }> = [];
        inspSorted.forEach(({ insp, attMap }, iIdx) => {
          insp04Data.push({ name: insp, y: [...attMap.values()].reduce((s, a) => s + a.count, 0), drilldown: `cco04i:${hIdx}:${iIdx}` });
          const attSorted = Array.from(attMap.entries())
            .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
            .slice(0, 50);
          const att04Data: Array<{ name: string; y: number; drilldown: string }> = [];
          attSorted.forEach(([att, agg], aIdx) => {
            att04Data.push({ name: att, y: agg.count, drilldown: `cco04a:${hIdx}:${iIdx}:${aIdx}` });
            const overallAvg = agg.durations.length > 0 ? Number(mean(agg.durations)!.toFixed(1)) : 0;
            const rtData = Array.from(agg.roomTypeDur.entries())
              .map(([rt, arr]) => ({ name: rt, y: Number(mean(arr)!.toFixed(1)) }))
              .sort((a, b) => b.y - a.y)
              .slice(0, 50);
            cco04Dd.push({
              id: `cco04a:${hIdx}:${iIdx}:${aIdx}`, name: `${att} — Avg Cleaning Duration (min)`,
              type: 'pie', innerSize: '58%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
              data: [{ name: 'ALL ROOMS', y: overallAvg }, ...rtData],
            } as Highcharts.SeriesOptionsType);
          });
          cco04Dd.push({
            id: `cco04i:${hIdx}:${iIdx}`, name: `${insp} — Attendants`,
            type: 'pie', innerSize: '58%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            data: att04Data,
          } as Highcharts.SeriesOptionsType);
        });
        cco04Dd.push({
          id: `cco04h:${hIdx}`, name: `${hotel} — Inspectors`,
          type: 'pie', innerSize: '58%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
          data: insp04Data,
        } as Highcharts.SeriesOptionsType);
      });

      return make('cco-04', 'Hotel → Inspector → Room Attendant → Average Cleaning Duration (by Room Type)', 'Completed orders per hotel. Click a hotel to see its inspectors, an inspector to see their room attendants, and an attendant to see average cleaning duration (mins) overall and by room type', 'COUNT(*) GROUP BY hotel DRILLDOWN supervisor DRILLDOWN attendant DRILLDOWN AVG(duration_minutes) BY room_type', {
        chart: { type: 'pie' },
        title: { text: undefined },
        plotOptions: {
          pie: {
            innerSize: '58%',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
            showInLegend: true,
          },
        },
        tooltip: { pointFormat: '<b>{point.y}</b> orders' },
        series: [{
          type: 'pie',
          name: 'Completed Orders',
          data: ccoInspHotelsSorted.map(({ hotel, n }, hIdx) => ({ name: hotel, y: n, drilldown: `cco04h:${hIdx}` })),
        }],
        drilldown: { series: cco04Dd },
      });
    })(),
    make('cco-05', 'Hotel vs Room Type', 'Hotel-level cleaning order volume with drilldown into room type', 'COUNT(*) BY hotel_code DRILLDOWN room_type', {
      chart: { type: 'bar' },
      title: { text: undefined },
      xAxis: { type: 'category' },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: {
        bar: { dataLabels: { enabled: true, format: '{point.y}' } },
      },
      tooltip: { pointFormat: '<b>{point.y}</b> orders' },
      series: [
        {
          type: 'bar',
          name: 'Orders',
          color: '#0f766e',
          data: hotelCodes.map((hotel) => ({
            name: hotel,
            y: hotelTotalMap[hotel] ?? 0,
            drilldown: `cco-room:${hotel}`,
          })),
        },
      ],
      drilldown: {
        series: hotelCodes.map((hotel) => ({
          id: `cco-room:${hotel}`,
          name: `${hotel} - Room Type`,
          type: 'bar' as const,
          data: topEntries(Object.fromEntries((hotelRoomTypeMap.get(hotel) ?? new Map<string, number>()).entries()), 20).map(([name, y]) => ({ name, y })),
        })),
      },
    }),
    make('cco-06', 'Hotel vs Completion Credit', 'Hotel-level completed order volume compared with total completion credit', `COUNT(*) + SUM(cleaning_credit) WHERE status_normalized = 'Completed' GROUP BY hotel_code`, {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { categories: hotelCreditEntries.map((item) => item.hotel), crosshair: true },
      yAxis: [
        { title: { text: 'Completed Orders' } },
        { title: { text: 'Completion Credit' }, opposite: true },
      ],
      plotOptions: {
        column: { dataLabels: { enabled: true, format: '{point.y}' } },
        line: { dataLabels: { enabled: true, format: '{point.y:.2f}' }, marker: { enabled: true } },
      },
      tooltip: { shared: true },
      series: [
        { type: 'column', name: 'Completed Orders', data: hotelCreditEntries.map((item) => item.orders), color: '#0f766e', yAxis: 0 },
        { type: 'line', name: 'Completion Credit', data: hotelCreditEntries.map((item) => item.credit), color: '#ea580c', yAxis: 1, lineWidth: 3, zIndex: 10, marker: { enabled: true, radius: 4 }, dashStyle: 'Solid' },
      ],
    }),
    make('cco-07', 'Top 10 Hotels by Completed Credit vs Orders', 'Completed credit versus throughput by hotel for executive ranking', `COUNT(*) + SUM(cleaning_credit) WHERE status_normalized = 'Completed' GROUP BY hotel_code ORDER BY SUM(cleaning_credit) DESC LIMIT 10`, {
      chart: { type: 'line' },
      title: { text: undefined },
      xAxis: { categories: hotelCreditEntries.slice(0, 10).map((item) => item.hotel) },
      yAxis: [
        { title: { text: 'Completed Orders' } },
        { title: { text: 'Completed Credit' }, opposite: true },
      ],
      legend: { enabled: true },
      plotOptions: {
        line: {
          marker: { enabled: true, radius: 4 },
          lineWidth: 3,
        },
      },
      tooltip: { shared: true },
      series: [
        { type: 'line', name: 'Completed Orders', data: hotelCreditEntries.slice(0, 10).map((item) => item.orders), color: '#0f766e', yAxis: 0 },
        { type: 'line', name: 'Completed Credit', data: hotelCreditEntries.slice(0, 10).map((item) => item.credit), color: '#ea580c', yAxis: 1 },
      ],
    }),
    make('cco-08', 'On-Time vs Delayed by Hotel', 'Punctuality comparison by hotel — On Time (green) and Delayed (red) stacked per hotel, ranked by most delayed first', 'COUNT(*) GROUP BY hotel_code, is_on_time WHERE completed = true', {
      chart: { type: 'bar' },
      xAxis: { categories: delayedRankedHotels },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { bar: { stacking: 'normal', dataLabels: { enabled: true, format: '{point.y}' } } },
      legend: { enabled: true },
      tooltip: { shared: true },
      series: [
        { type: 'bar' as const, name: 'On Time', color: '#0f766e', data: delayedRankedHotels.map((hotel) => hotelOnTimeCounts.get(hotel) ?? 0) },
        { type: 'bar' as const, name: 'Delayed', color: '#9B2335', data: delayedRankedHotels.map((hotel) => hotelDelayedCounts.get(hotel) ?? 0) },
      ],
    }),
    make('cco-09', 'Re-clean / Inspection Result Analysis', `Inspection pass/fail and re-clean pressure in one view. ${suffix}.`, `COUNT(*) GROUP BY pass_fail AND reclean_flag WHERE ${clause}`, {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { categories: ['Pass', 'Fail', 'No Inspection'] },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { stacking: 'normal' } },
      series: [
        {
          type: 'column',
          name: 'Re-clean Flagged',
          data: [
            allRows.filter((row) => normKey(row.pass_fail) === 'pass' && isReclean(row)).length,
            allRows.filter((row) => normKey(row.pass_fail) === 'fail' && isReclean(row)).length,
            allRows.filter((row) => !normText(row.pass_fail) && isReclean(row)).length,
          ],
        },
        {
          type: 'column',
          name: 'Normal',
          data: [
            allRows.filter((row) => normKey(row.pass_fail) === 'pass' && !isReclean(row)).length,
            allRows.filter((row) => normKey(row.pass_fail) === 'fail' && !isReclean(row)).length,
            allRows.filter((row) => !normText(row.pass_fail) && !isReclean(row)).length,
          ],
        },
      ],
    }),
    make('cco-10', 'Daily Cleaning Order Trend', `Daily volume trend for total, completed, delayed, and re-clean orders. ${suffix}.`, `COUNT(*) BY DATE(created_date) WITH COMPLETION AND EXCEPTION LINES WHERE ${clause}`, {
      chart: { type: 'line' },
      xAxis: { categories: dailyDates },
      yAxis: { title: { text: 'Orders' } },
      legend: { enabled: true },
      plotOptions: { series: { marker: { enabled: false }, lineWidth: 2 } },
      tooltip: {
        pointFormatter: function (this: Highcharts.Point) {
          const point = this as Highcharts.Point & { custom?: { deltaAbs?: number | null; deltaPct?: number | null } };
          const deltaAbs = point.custom?.deltaAbs ?? null;
          const deltaPct = point.custom?.deltaPct ?? null;
          const absText = deltaAbs === null ? '—' : `${deltaAbs > 0 ? '+' : ''}${Math.round(deltaAbs)}`;
          const pctText = deltaPct === null ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
          return `<b>${this.series.name}</b><br/>Value: <b>${this.y ?? 0}</b><br/>Δ vs previous: <b>${absText}</b> (${pctText})`;
        },
      },
      series: [
        { type: 'line', name: 'Total', color: '#0f766e', data: dailyDates.map((date) => dailyMap.get(date)?.total ?? 0) },
        { type: 'line', name: 'Completed', color: '#ea580c', data: dailyDates.map((date) => dailyMap.get(date)?.completed ?? 0) },
        { type: 'line', name: 'Delayed', color: '#9B2335', data: dailyDates.map((date) => dailyMap.get(date)?.delayed ?? 0) },
        { type: 'line', name: 'Re-clean', color: '#7c3aed', data: dailyDates.map((date) => dailyMap.get(date)?.reclean ?? 0) },
      ],
    }),
    make('cco-11', 'On-Time/Delayed vs Avg Duration by Hotel', 'On-time and delayed workload compared with average cleaning duration by hotel', 'COUNT(*) GROUP BY is_on_time + AVG(actual_duration_minutes) BY hotel_code', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { categories: hotelAvgDurationEntries.map((item) => item.hotel), crosshair: true },
      yAxis: [
        { title: { text: 'Orders' } },
        { title: { text: 'Avg Duration (min)' }, opposite: true },
      ],
      plotOptions: {
        column: { stacking: 'normal', dataLabels: { enabled: true, format: '{point.y}' } },
        line: { dataLabels: { enabled: true, format: '{point.y:.2f}' }, marker: { enabled: true } },
      },
      tooltip: { shared: true },
      series: [
        { type: 'column', name: 'On Time', data: hotelAvgDurationEntries.map((item) => hotelOnTimeCounts.get(item.hotel) ?? 0), color: '#0f766e' },
        { type: 'column', name: 'Delayed', data: hotelAvgDurationEntries.map((item) => hotelDelayedCounts.get(item.hotel) ?? 0), color: '#9B2335' },
        { type: 'line', name: 'Avg Duration (min)', data: hotelAvgDurationEntries.map((item) => item.avg), yAxis: 1, color: '#ea580c', lineWidth: 3, zIndex: 10, marker: { enabled: true, radius: 4 }, dashStyle: 'Solid' },
      ],
    }),
    make('cco-12', 'Ahead / On-Time / Behind Completion', `Completion timing split for finished orders. ${suffix}.`, `COUNT(*) GROUP BY completion_timing_bucket WHERE ${clause}`, {
      chart: { type: 'pie' },
      title: { text: undefined },
      plotOptions: {
        pie: {
          innerSize: '62%',
          dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' },
          showInLegend: true,
        },
      },
      tooltip: { pointFormat: '<b>{point.y}</b> rooms ({point.percentage:.1f}%)' },
      series: [{
        type: 'pie',
        name: 'Rooms',
        color: '#B45309',
        data: [
          { name: 'Ahead', y: completedRows.filter((row) => (typeof row.duration_variance_minutes === 'number' ? row.duration_variance_minutes < 0 : isCompleted(row) && !isDelayed(row) && !isOnTime(row) ? true : false)).length },
          { name: 'On-Time', y: completedRows.filter((row) => (typeof row.duration_variance_minutes === 'number' ? row.duration_variance_minutes === 0 : isOnTime(row) && !isDelayed(row))).length },
          { name: 'Behind', y: completedRows.filter((row) => (typeof row.duration_variance_minutes === 'number' ? row.duration_variance_minutes > 0 : isDelayed(row))).length },
        ],
      }],
    }),
    make('cco-13', 'Cleaning Duration → Attendant', `Duration distribution of completed orders with drilldown into top attendants per bucket. ${suffix}.`, `COUNT(*) GROUP BY duration_bin DRILLDOWN attendant WHERE ${clause}`, {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category', title: { text: 'Duration (mins)' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see attendant breakdown' },
      series: [{
        type: 'column',
        name: 'Completed Orders',
        color: '#0f766e',
        data: durBucketLabels.map((label, i) => ({
          name: label,
          y: completedRows.filter((row) => { const v = toMinutes(row); return Number.isFinite(v) && _durBucketFns[i](v); }).length,
          drilldown: `cco-dur:${i}`,
        })),
      }],
      drilldown: {
        series: durBucketLabels.map((label, i) => ({
          id: `cco-dur:${i}`,
          name: `${label} — Attendants`,
          type: 'bar' as const,
          color: '#ea580c',
          dataLabels: { enabled: true, format: '{point.y}' },
          data: (durBucketAttendants.get(i) ?? []).map((entry) => ({ name: entry.name, y: entry.y })),
        })),
      },
    }),
    make('cco-14', 'Top Attendant Credit', `Top attendants by completed cleaning orders. ${suffix}.`, `COUNT(*) GROUP BY attendant WHERE ${clause} AND completed = true`, {
      chart: { type: 'treemap' },
      title: { text: undefined },
      plotOptions: {
        treemap: { colorByPoint: true, dataLabels: { enabled: true, format: '<b>{point.name}</b><br/>{point.value}', style: { fontSize: '11px', textOutline: 'none' } } },
      },
      tooltip: { pointFormat: '<b>{point.name}</b>: <b>{point.value}</b> completions' },
      series: [{
        type: 'treemap',
        name: 'Completions',
        data: topEntries(groupCount(completedRows, (r) => normText(r.attendant) || 'Unknown'), 20)
          .map(([name, value]) => ({ name, value })),
      }],
    }),
    make('cco-15', 'Hotel Readiness Risk Index', 'Ranks hotels by readiness risk using completion gap, delayed work, behind completions, and re-clean pressure', `Risk Score = completion_gap * 0.35 + delayed_rate * 0.25 + behind_rate * 0.25 + reclean_rate * 0.15 WHERE ${clause}`, {
      chart: { type: 'bar' },
      title: { text: undefined },
      xAxis: { categories: readinessRiskEntries.map((entry) => entry.hotel) },
      yAxis: { title: { text: 'Risk Score' } },
      plotOptions: {
        bar: {
          dataLabels: { enabled: true, format: '{point.y:.2f}' },
        },
      },
      tooltip: {
        pointFormatter: function (this: Highcharts.Point) {
          const custom = this.options.custom as { completionGap?: number; delayedRate?: number; behindRate?: number; recleanRate?: number } | undefined;
          return `<b>${this.y ?? 0}</b> score<br/>Completion gap: ${(custom?.completionGap ?? 0).toFixed(1)}%<br/>Delayed: ${(custom?.delayedRate ?? 0).toFixed(1)}%<br/>Behind: ${(custom?.behindRate ?? 0).toFixed(1)}%<br/>Re-clean: ${(custom?.recleanRate ?? 0).toFixed(1)}%`;
        },
      },
      series: [{
        type: 'bar',
        name: 'Readiness Risk',
        color: '#9B2335',
        data: readinessRiskEntries.map((entry) => ({
          y: entry.score,
          custom: {
            completionGap: entry.completionGap,
            delayedRate: entry.delayedRate,
            behindRate: entry.behindRate,
            recleanRate: entry.recleanRate,
          },
        })),
      }],
    }),
    make('cco-16', 'Staffing Pressure by Hotel and Hour', `Heatmap of completed orders by local hour and hotel. ${suffix}.`, `COUNT(*) GROUP BY HOUR(completed_time), hotel_code WHERE status_normalized = 'Completed' AND ${clause}`, {
      chart: { type: 'heatmap' },
      title: { text: undefined },
      xAxis: { categories: hotelCodes, title: { text: 'Hotel' } },
      yAxis: { categories: hourCategories, title: { text: 'Hour of Day' }, reversed: true },
      colorAxis: { min: 0, minColor: '#eff6ff', maxColor: '#0f766e' },
      tooltip: {
        formatter: function () {
          const point = this.point as Highcharts.Point & { value?: number };
          const hotel = hotelCodes[typeof this.x === 'number' ? this.x : 0] ?? 'Unknown Hotel';
          const hourLabel = hourCategories[typeof this.y === 'number' ? this.y : 0] ?? 'Unknown';
          return `<b>${hotel}</b><br/>${hourLabel}<br/><b>${Number(point.value ?? 0)}</b> completed orders`;
        },
      },
      plotOptions: { heatmap: { dataLabels: { enabled: true, format: '{point.value:.0f}', style: { textOutline: 'none' } } } },
      series: [{
        type: 'heatmap',
        name: 'Completed Orders',
        borderWidth: 1,
        data: hourCategories.flatMap((_, hourIndex) => hotelCodes.map((hotel, hotelIndex) => ({
          x: hotelIndex,
          y: hourIndex,
          value: hotelCompletionHourCountMap.get(hotel)?.get(hourIndex) ?? 0,
        }))),
      }],
    }),
    make('cco-17', 'Quality Leakage by Hotel', 'Compares re-clean rate, inspection fail rate, and no-inspection volume by hotel', `reclean_rate + inspection_fail_rate + no_inspection_count BY hotel_code WHERE ${clause}`, {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { categories: qualityLeakageEntries.map((entry) => entry.hotel), crosshair: true },
      yAxis: [
        { title: { text: 'Rate %' } },
        { title: { text: 'No Inspection Orders' }, opposite: true },
      ],
      plotOptions: {
        column: { dataLabels: { enabled: true, format: '{point.y:.1f}' } },
        line: { dataLabels: { enabled: true, format: '{point.y:.0f}' }, marker: { enabled: true } },
      },
      tooltip: { shared: true },
      series: [
        { type: 'column', name: 'Re-clean Rate %', data: qualityLeakageEntries.map((entry) => entry.recleanRate), color: '#9B2335', yAxis: 0 },
        { type: 'column', name: 'Inspection Fail Rate %', data: qualityLeakageEntries.map((entry) => entry.failRate), color: '#ea580c', yAxis: 0 },
        { type: 'line', name: 'No Inspection Orders', data: qualityLeakageEntries.map((entry) => entry.noInspection), color: '#0f766e', yAxis: 1, lineWidth: 3, zIndex: 10, marker: { enabled: true, radius: 4 }, dashStyle: 'Solid' },
      ],
    }),
    make('cco-18', '24-Hour Cleaning → Duration', 'All cleaning orders by hour of day with drilldown into cleaning duration distribution per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN duration_bin', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see duration split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoAllHourCounts24[h], drilldown: `cco-h24dur:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-h24dur:${h}`, name: `${label} — Duration`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoh24DurBins[h] })) },
    }),
    make('cco-19', '24-Hour Cleaning → Stay Status', 'All cleaning orders by hour of day with drilldown into stay status per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN stay_status', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see stay status split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoAllHourCounts24[h], drilldown: `cco-h24ss:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-h24ss:${h}`, name: `${label} — Stay Status`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoh24StayStatus[h] })) },
    }),
    make('cco-20', '24-Hour Cleaning → Cleaning Status', 'All cleaning orders by hour of day with drilldown into cleaning status per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN status_normalized', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see cleaning status split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoAllHourCounts24[h], drilldown: `cco-h24cs:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-h24cs:${h}`, name: `${label} — Cleaning Status`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoh24CleaningStatus[h] })) },
    }),
    make('cco-21', '24-Hour Cleaning → Attendant', 'Completed cleaning orders by hour of day — click a bar to see top attendants for that hour as a treemap', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN attendant WHERE completed = true', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: {
        column: {
          dataLabels: { enabled: true, format: '{point.y}' },
          cursor: 'pointer',
          point: {
            events: {
              click: function(this: Highcharts.Point) {
                const chart = this.series.chart;
                const h = this.index ?? 0;
                const label = ccoHourCategories[h] ?? '';
                const attData = (ccoh24Attendant[h] ?? []).map(({ name, y }) => ({ name, value: y }));
                chart.series[0].setVisible(false, false);
                chart.xAxis[0].update({ visible: false }, false);
                chart.yAxis[0].update({ visible: false }, false);
                chart.addSeries({
                  type: 'treemap' as const,
                  name: `${label} — Attendants`,
                  colorByPoint: true,
                  dataLabels: { enabled: true, useHTML: true, format: '<span style="font-size:11px;line-height:1.3"><b>{point.name}</b><br/><span style="font-size:13px">{point.value}</span></span>' },
                  data: attData,
                } as Highcharts.SeriesOptionsType, false);
                let btn: Highcharts.SVGElement;
                btn = chart.renderer.button('← Back', 10, 5, (() => {
                  if (chart.series.length > 1) chart.series[chart.series.length - 1].remove(false);
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
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see attendant split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoAllHourCounts24[h] })) }],
    }),
    make('cco-22', '24-Hour Cleaning → On-Time/Delayed', 'Completed cleaning orders by hour of day with drilldown into on-time vs delayed per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN is_on_time WHERE completed = true', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see on-time/delayed split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoAllHourCounts24[h], drilldown: `cco-h24otd:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-h24otd:${h}`, name: `${label} — On-Time/Delayed`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoh24OnTimeDelayed[h] })) },
    }),
    make('cco-23', '24-Hour Cleaning → Cleaning Type', 'All cleaning orders by hour of day with drilldown into cleaning type per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN cleaning_type', {
      chart: { type: 'column' },
      title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see cleaning type split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoAllHourCounts24[h], drilldown: `cco-h24ct:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-h24ct:${h}`, name: `${label} — Cleaning Type`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoh24CleaningType[h] })) },
    }),
    make('cco-24', 'Cleaning Duration → Stay Status', 'Cleaning duration distribution with drilldown into stay status per duration bucket', 'COUNT(*) GROUP BY duration_bin DRILLDOWN stay_status', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see stay status split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durBucketLabels.map((label, i) => ({ name: label, y: ccoDurBinCounts[i], drilldown: `cco-durss:${i}` })) }],
      drilldown: { series: durBucketLabels.map((label, i) => ({ id: `cco-durss:${i}`, name: `${label} — Stay Status`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDurBinStayStatus[i] })) },
    }),
    make('cco-25', 'Cleaning Duration → Attendant', 'Cleaning duration distribution with drilldown into top attendants per duration bucket', 'COUNT(*) GROUP BY duration_bin DRILLDOWN attendant', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see attendant split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durBucketLabels.map((label, i) => ({ name: label, y: ccoDurBinCounts[i], drilldown: `cco-duratt:${i}` })) }],
      drilldown: { series: durBucketLabels.map((label, i) => ({ id: `cco-duratt:${i}`, name: `${label} — Attendants`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDurBinAttendant[i] })) },
    }),
    make('cco-26', 'Cleaning Duration → Cleaning Type', 'Cleaning duration distribution with drilldown into cleaning type per duration bucket', 'COUNT(*) GROUP BY duration_bin DRILLDOWN cleaning_type', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see cleaning type split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durBucketLabels.map((label, i) => ({ name: label, y: ccoDurBinCounts[i], drilldown: `cco-durct:${i}` })) }],
      drilldown: { series: durBucketLabels.map((label, i) => ({ id: `cco-durct:${i}`, name: `${label} — Cleaning Type`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDurBinCleaningType[i] })) },
    }),
    make('cco-27', 'Cleaning Duration → Room Type', 'Cleaning duration distribution with drilldown into room type per duration bucket', 'COUNT(*) GROUP BY duration_bin DRILLDOWN room_type', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Duration (mins)' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see room type split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: durBucketLabels.map((label, i) => ({ name: label, y: ccoDurBinCounts[i], drilldown: `cco-durrt:${i}` })) }],
      drilldown: { series: durBucketLabels.map((label, i) => ({ id: `cco-durrt:${i}`, name: `${label} — Room Type`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDurBinRoomType[i] })) },
    }),
    make('cco-28', '24-Hour Delayed → Stay Status', 'Delayed orders by hour of day with drilldown into stay status per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN stay_status WHERE delayed = true', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Delayed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> delayed orders — click to see stay status split' },
      series: [{ type: 'column', name: 'Delayed Orders', color: '#92400e', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoDelayedHourCounts[h], drilldown: `cco-dlyss:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-dlyss:${h}`, name: `${label} — Stay Status`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDelayedHourStayStatus[h] })) },
    }),
    make('cco-29', '24-Hour Delayed → Attendant', 'Delayed orders by hour of day with drilldown into top attendants per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN attendant WHERE delayed = true', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Delayed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> delayed orders — click to see attendant split' },
      series: [{ type: 'column', name: 'Delayed Orders', color: '#92400e', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoDelayedHourCounts[h], drilldown: `cco-dlyatt:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-dlyatt:${h}`, name: `${label} — Attendants`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDelayedHourAttendant[h] })) },
    }),
    make('cco-30', '24-Hour Delayed → Room Type', 'Delayed orders by hour of day with drilldown into room type per hour', 'COUNT(*) GROUP BY HOUR(any_time) DRILLDOWN room_type WHERE delayed = true', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Hour of Day' } },
      yAxis: { title: { text: 'Delayed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> delayed orders — click to see room type split' },
      series: [{ type: 'column', name: 'Delayed Orders', color: '#92400e', data: ccoHourCategories.map((label, h) => ({ name: label, y: ccoDelayedHourCounts[h], drilldown: `cco-dlyrt:${h}` })) }],
      drilldown: { series: ccoHourCategories.map((label, h) => ({ id: `cco-dlyrt:${h}`, name: `${label} — Room Type`, type: 'bar' as const, color: '#ea580c', dataLabels: { enabled: true, format: '{point.y}' }, data: ccoDelayedHourRoomType[h] })) },
    }),
    make('cco-31', 'Stay Status → 24-Hour Cleaning Distribution', 'Orders by stay status with drilldown into 24-hour completion pattern', 'COUNT(*) GROUP BY stay_status DRILLDOWN HOUR(any_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Stay Status' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoDim24hSS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimss24h:${i}` })) }],
      drilldown: { series: ccoDim24hSS.map((d, i) => ({ id: `cco-dimss24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-32', 'Cleaning Status → 24-Hour Cleaning Distribution', 'Orders by cleaning status with drilldown into 24-hour completion pattern', 'COUNT(*) GROUP BY status_normalized DRILLDOWN HOUR(any_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Cleaning Status' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoDim24hCS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimcs24h:${i}` })) }],
      drilldown: { series: ccoDim24hCS.map((d, i) => ({ id: `cco-dimcs24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-33', 'Room Type → 24-Hour Cleaning Distribution', 'Orders by room type with drilldown into 24-hour completion pattern', 'COUNT(*) GROUP BY room_type DRILLDOWN HOUR(any_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Room Type' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoDim24hRT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimrt24h:${i}` })) }],
      drilldown: { series: ccoDim24hRT.map((d, i) => ({ id: `cco-dimrt24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-34', 'On-Time/Delayed → 24-Hour Cleaning Distribution', 'Completed orders by on-time/delayed status with drilldown into 24-hour completion pattern', 'COUNT(*) GROUP BY is_on_time DRILLDOWN HOUR(any_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'On-Time / Delayed' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#16a34a', data: ccoDim24hOTD.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimotd24h:${i}` })) }],
      drilldown: { series: ccoDim24hOTD.map((d, i) => ({ id: `cco-dimotd24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-35', 'Cleaning Type → 24-Hour Cleaning Distribution', 'Orders by cleaning type with drilldown into 24-hour completion pattern', 'COUNT(*) GROUP BY cleaning_type DRILLDOWN HOUR(any_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Cleaning Type' } },
      yAxis: { title: { text: 'Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
      series: [{ type: 'column', name: 'Orders', color: '#16a34a', data: ccoDim24hCT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimct24h:${i}` })) }],
      drilldown: { series: ccoDim24hCT.map((d, i) => ({ id: `cco-dimct24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-36', 'Top 50 Attendants → 24-Hour Cleaning Distribution', 'Top 50 attendants by completed orders with drilldown into 24-hour completion pattern', 'COUNT(*) GROUP BY attendant TOP 50 DRILLDOWN HOUR(any_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Attendant' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> orders — click to see hourly split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#16a34a', data: ccoDim24hAtt.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimatt24h:${i}` })) }],
      drilldown: { series: ccoDim24hAtt.map((d, i) => ({ id: `cco-dimatt24h:${i}`, name: `${d.name} — By Hour`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-37', 'Stay Status → Cleaning Duration Distribution', 'Completed orders by stay status with drilldown into cleaning duration distribution', 'COUNT(*) GROUP BY stay_status DRILLDOWN duration_bin', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Stay Status' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: ccoDimDurSS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimssdr:${i}` })) }],
      drilldown: { series: ccoDimDurSS.map((d, i) => ({ id: `cco-dimssdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-38', 'Cleaning Status → Cleaning Duration Distribution', 'Completed orders by cleaning status with drilldown into cleaning duration distribution', 'COUNT(*) GROUP BY status_normalized DRILLDOWN duration_bin', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Cleaning Status' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: ccoDimDurCS.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimcsdr:${i}` })) }],
      drilldown: { series: ccoDimDurCS.map((d, i) => ({ id: `cco-dimcsdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-39', 'Room Type → Cleaning Duration Distribution', 'Completed orders by room type with drilldown into cleaning duration distribution', 'COUNT(*) GROUP BY room_type DRILLDOWN duration_bin', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Room Type' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: ccoDimDurRT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimrtdr:${i}` })) }],
      drilldown: { series: ccoDimDurRT.map((d, i) => ({ id: `cco-dimrtdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-40', 'On-Time/Delayed → Cleaning Duration Distribution', 'Completed orders by on-time/delayed status with drilldown into cleaning duration distribution', 'COUNT(*) GROUP BY is_on_time DRILLDOWN duration_bin', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'On-Time / Delayed' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: ccoDimDurOTD.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimotddr:${i}` })) }],
      drilldown: { series: ccoDimDurOTD.map((d, i) => ({ id: `cco-dimotddr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-41', 'Cleaning Type → Cleaning Duration Distribution', 'Completed orders by cleaning type with drilldown into cleaning duration distribution', 'COUNT(*) GROUP BY cleaning_type DRILLDOWN duration_bin', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Cleaning Type' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: ccoDimDurCT.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimctdr:${i}` })) }],
      drilldown: { series: ccoDimDurCT.map((d, i) => ({ id: `cco-dimctdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-42', 'Top 50 Attendants → Cleaning Duration Distribution', 'Top 50 attendants by completed orders with drilldown into cleaning duration distribution', 'COUNT(*) GROUP BY attendant TOP 50 DRILLDOWN duration_bin', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const, title: { text: 'Attendant' } },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b> completed orders — click to see duration split' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#ea580c', data: ccoDimDurAtt.map((d, i) => ({ name: d.name, y: d.total, drilldown: `cco-dimattdr:${i}` })) }],
      drilldown: { series: ccoDimDurAtt.map((d, i) => ({ id: `cco-dimattdr:${i}`, name: `${d.name} — Duration`, type: 'bar' as const, color: '#B45309', dataLabels: { enabled: true, format: '{point.y}' }, data: d.drill })) },
    }),
    make('cco-43', 'Hotel → Floor → Room Attendant → Average Cleaning Duration', 'Completed orders per hotel. Click a hotel to see its floors, a floor to see its room attendants, and an attendant to see average cleaning duration (mins) overall and by room type', 'COUNT(*) GROUP BY hotel DRILLDOWN floor DRILLDOWN attendant DRILLDOWN AVG(duration_minutes) BY room_type', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const },
      yAxis: { title: { text: 'Completed Orders / Avg Minutes' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: cco43Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
      drilldown: { series: cco43Dd as unknown as Highcharts.SeriesOptionsType[] },
    }),
    make('cco-44', 'Hotel → Floor → Room Attendant → 24-Hour Cleaning Distribution', 'Completed orders per hotel. Click a hotel to see its floors, a floor to see its room attendants, and an attendant to see their 24-hour cleaning completion distribution', 'COUNT(*) GROUP BY hotel DRILLDOWN floor DRILLDOWN attendant DRILLDOWN HOUR(completed_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: cco44Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
      drilldown: { series: cco44Dd as unknown as Highcharts.SeriesOptionsType[] },
    }),
    make('cco-45', 'Hotel → Inspector → Room Attendant → Average Cleaning Duration (by Room Type)', 'Completed orders per hotel. Click a hotel to see its inspectors, an inspector to see their room attendants, and an attendant to see average cleaning duration (mins) overall and by room type', 'COUNT(*) GROUP BY hotel DRILLDOWN supervisor DRILLDOWN attendant DRILLDOWN AVG(duration_minutes) BY room_type', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const },
      yAxis: { title: { text: 'Completed Orders / Avg Minutes' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: cco45Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
      drilldown: { series: cco45Dd as unknown as Highcharts.SeriesOptionsType[] },
    }),
    make('cco-46', 'Hotel → Inspector → Room Attendant → 24-Hour Cleaning Distribution', 'Completed orders per hotel. Click a hotel to see its inspectors, an inspector to see their room attendants, and an attendant to see their 24-hour cleaning completion distribution', 'COUNT(*) GROUP BY hotel DRILLDOWN supervisor DRILLDOWN attendant DRILLDOWN HOUR(completed_time)', {
      chart: { type: 'column' }, title: { text: undefined },
      xAxis: { type: 'category' as const },
      yAxis: { title: { text: 'Completed Orders' } },
      plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y}' } } },
      tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: '<b>{point.y}</b>' },
      series: [{ type: 'column', name: 'Completed Orders', color: '#0F766E', data: cco46Primary, dataLabels: { enabled: true, format: '{point.y}' } }],
      drilldown: { series: cco46Dd as unknown as Highcharts.SeriesOptionsType[] },
    }),
  ];
}

function CoKpiCard({
  kpi,
  dark,
  empty = false,
  showDelta = true,
}: {
  kpi: KpiCardModel;
  dark: boolean;
  empty?: boolean;
  showDelta?: boolean;
}) {
  const { theme } = useTheme();
  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);
  const [open, setOpen] = useState(false);
  const palette = toneColors(tokens, kpi.status);
  const surface = tokens.card.bg;
  const border = tokens.card.border;
  const labelColor = tokens.card.label;
  const valueColor = tokens.card.value;
  const subColor = tokens.card.sub;

  return (
    <div
      className="relative overflow-visible rounded-xl transition-all duration-150 select-none print:break-inside-avoid"
      style={{
        background: surface,
        border: `1px solid ${border}`,
        borderLeft: `4px solid ${palette.border}`,
      }}
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="space-y-1">
            <div
              className="font-mono uppercase leading-tight"
              style={{ fontSize: '0.6rem', letterSpacing: '0.14em', color: labelColor }}
            >
              {kpi.label}
            </div>
            <div
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono"
              style={{
                background: palette.badgeBg,
                color: palette.badgeText,
                fontSize: '0.56rem',
                letterSpacing: '0.12em',
              }}
            >
              {kpi.statusLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 mt-0.5 transition-opacity hover:opacity-70"
            aria-label="Show KPI details"
            style={{ color: labelColor }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1.2" />
              <text x="6" y="9.2" textAnchor="middle" fontSize="7.5" fontFamily="inherit" fill="currentColor">?</text>
            </svg>
          </button>
        </div>
        <div className="flex items-baseline gap-1 leading-none">
          <span className="font-serif font-bold tabular-nums" style={{ fontSize: '1.72rem', color: valueColor, lineHeight: 1 }}>
            {empty ? '—' : formatValue(kpi.value, kpi.fmt)}
          </span>
          {kpi.unit && (
            <span className="font-mono" style={{ fontSize: '0.68rem', color: subColor, marginBottom: '2px' }}>
              {kpi.unit}
            </span>
          )}
        </div>
        {showDelta && (
          <div className="mt-2 flex items-center gap-2 font-mono" style={{ fontSize: '0.58rem', color: subColor }}>
            <span>{kpi.trendDirection === 'up' ? '▲' : kpi.trendDirection === 'down' ? '▼' : '•'}</span>
            <span>{kpi.trendLabel}</span>
            <span>{kpi.trendDetail}</span>
          </div>
        )}
      </div>
      {open && (
        <div
          className="absolute z-30 top-full left-0 mt-1 w-72 p-3 shadow-xl space-y-1.5"
          style={{
            background: tokens.card.tooltipBg,
            border: `1px solid ${tokens.card.tooltipBorder}`,
            borderLeft: `3px solid ${palette.border}`,
            color: tokens.card.tooltipText,
            borderRadius: '8px',
          }}
          >
          <p className="font-sans leading-relaxed" style={{ fontSize: '0.7rem' }}>{kpi.note}</p>
          <p className="font-sans leading-relaxed" style={{ fontSize: '0.7rem' }}>{kpi.statusDetail}</p>
          {kpi.benchmark.length > 0 && (
            <div className="space-y-0.5 pt-1">
              <p className="font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: subColor }}>Benchmark</p>
              {kpi.benchmark.map((line) => (
                <p key={line} className="font-mono leading-relaxed" style={{ fontSize: '0.62rem', color: subColor }}>{line}</p>
              ))}
            </div>
          )}
          <p className="font-mono leading-relaxed" style={{ fontSize: '0.62rem', color: subColor }}>
            Formula: {kpi.formula}
          </p>
          <p className="font-mono leading-relaxed" style={{ fontSize: '0.62rem', color: subColor }}>
            Trend: {kpi.trendDetail}
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyChartCard({
  title,
  note,
  formula,
  dark,
}: {
  title: string;
  note: string;
  formula: string;
  dark: boolean;
}) {
  const { theme } = useTheme();
  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);
  return (
    <div
      className="chart-card flex flex-col overflow-hidden rounded-xl"
      style={{
        background: tokens.chart.cardBg,
        border: `1px solid ${tokens.chart.cardBorder}`,
        borderLeft: `4px solid ${tokens.chart.cardAccent}`,
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <h3 className="font-serif font-semibold" style={{ fontSize: '0.9rem', color: tokens.chart.titleText }}>
          {title}
        </h3>
        <span className="font-mono" style={{ fontSize: '0.58rem', letterSpacing: '0.08em', color: tokens.chart.alertText }}>
          NO DATA
        </span>
      </div>
      <div className="flex min-h-[280px] items-center justify-center px-4 py-8 text-center">
        <div className="max-w-sm space-y-2">
          <p className="font-sans text-sm" style={{ color: tokens.chart.footerMuted }}>
            No rows match the current filter selection.
          </p>
          <p className="font-sans text-xs" style={{ color: tokens.chart.footerMuted }}>
            Adjust the date range, floor, attendant, room type, or status filters to populate this chart.
          </p>
        </div>
      </div>
      <div className="px-4 pt-2.5 pb-3.5 space-y-1" style={{ borderTop: `1px solid ${tokens.chart.footerBorder}` }}>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: tokens.chart.footerMuted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Note</span>
          &nbsp;{note}
        </p>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: tokens.chart.footerMuted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Formula</span>
          {' '}
          <code className="font-mono" style={{ fontSize: '0.6rem', padding: '1px 5px', background: tokens.chart.codeBg, color: tokens.chart.cardAccent, borderRadius: '2px' }}>
            {formula}
          </code>
        </p>
      </div>
    </div>
  );
}

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

function CorpCoPerformanceTable({
  rows,
  dark,
  codeLabel,
}: {
  rows: CoRow[];
  dark: boolean;
  codeLabel: string;
}) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const byHotel = rows.reduce((acc, row) => {
    const hotel = normText(row.hotel_code) || 'UNKNOWN';
    if (!acc.has(hotel)) acc.set(hotel, []);
    acc.get(hotel)!.push(row);
    return acc;
  }, new Map<string, CoRow[]>());

  const maxOrders = Math.max(1, ...Array.from(byHotel.values()).map((hotelRows) => hotelRows.length));
  const tableRows = Array.from(byHotel.entries())
    .map(([hotel, hotelRows]) => {
      const total = hotelRows.length;
      const completedRows = hotelRows.filter(isCompleted);
      const completed = completedRows.length;
      const delayed = completedRows.filter(isDelayed).length;
      const onTime = completedRows.filter(isOnTime).length;
      const reclean = hotelRows.filter(isReclean).length;
      const inspectedRows = hotelRows.filter((row) => normText(row.pass_fail) || normText(row.inspection_status));
      const passRows = hotelRows.filter((row) => normKey(row.pass_fail) === 'pass' || normKey(row.inspection_status) === 'pass');
      const duration = mean(completedRows.map(toMinutes));
      const completionCredit = sum(completedRows.map((row) => (typeof row.cleaning_credit === 'number' && Number.isFinite(row.cleaning_credit) ? row.cleaning_credit : 0)));
      const completionRate = total > 0 ? (completed / total) * 100 : 0;
      const onTimeRate = completed > 0 ? (onTime / completed) * 100 : 0;
      const delayedRate = completed > 0 ? (delayed / completed) * 100 : 0;
      const recleanRate = total > 0 ? (reclean / total) * 100 : 0;
      const inspectionPassRate = inspectedRows.length > 0 ? (passRows.length / inspectedRows.length) * 100 : 0;
      const volumeFactor = Math.min((total / maxOrders) * 15, 15);
      const riskRank = ((100 - completionRate) * 0.35) + (delayedRate * 0.25) + (recleanRate * 0.2) + ((100 - inspectionPassRate) * 0.15) + volumeFactor;
      return {
        hotel,
        total,
        completed,
        completionRate: Number(completionRate.toFixed(1)),
        avgDuration: duration === null ? null : Number(duration.toFixed(2)),
        onTimeRate: Number(onTimeRate.toFixed(1)),
        delayed,
        recleanRate: Number(recleanRate.toFixed(1)),
        inspectionPassRate: Number(inspectionPassRate.toFixed(1)),
        completionCredit: Number(completionCredit.toFixed(2)),
        riskRank: Number(riskRank.toFixed(2)),
      };
    })
    .sort((a, b) => b.riskRank - a.riskRank || b.delayed - a.delayed || b.total - a.total);

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
      className="chart-card flex flex-col overflow-hidden"
      style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderLeft: `4px solid ${accent}`, borderRadius: '12px' }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-3 shrink-0">
        <h3 className="font-serif font-semibold leading-snug flex items-center gap-2" style={{ fontSize: '0.9rem', color: titleText }}>
          <span className="font-mono shrink-0" style={{ fontSize: '0.62rem', letterSpacing: '0.04em', fontWeight: 700, color: accent, background: codeBg, border: `1px solid ${accent}40`, padding: '1px 5px', lineHeight: 1.4 }}>
            {codeLabel}
          </span>
          Hotel Performance Benchmark
        </h3>
      </div>

      <div className="px-4 pb-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Index', 'Hotel', 'Total Orders', 'Completed', 'Completion %', 'Avg Duration', 'On-Time %', 'Delayed', 'Re-clean %', 'Inspection Pass %', 'Completion Credit', 'Risk Rank'].map((label) => (
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
            {tableRows.length > 0 ? tableRows.map((row, rowIndex) => (
              <tr key={row.hotel}>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: accent, fontSize: '0.75rem', fontWeight: 700 }}>{String(rowIndex + 1).padStart(2, '0')}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.78rem', fontWeight: 700 }}>{row.hotel}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.total.toLocaleString()}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.completed.toLocaleString()}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.completionRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.avgDuration === null ? '-' : `${row.avgDuration.toFixed(2)} min`}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.onTimeRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.delayed.toLocaleString()}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.recleanRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.inspectionPassRate.toFixed(1)}%</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem' }}>{row.completionCredit.toFixed(2)}</td>
                <td style={{ padding: '9px 10px', borderBottom: `1px solid ${rule}`, color: titleText, fontSize: '0.75rem', fontWeight: 700 }}>{row.riskRank.toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={12} style={{ padding: '14px 10px', color: muted, fontSize: '0.75rem', textAlign: 'center' }}>
                  No hotel rows match the current Corp CO filter selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 pt-2.5 pb-3.5 space-y-1 shrink-0" style={{ borderTop: `1px solid ${rule}` }}>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Note</span>
          {' '}Executive hotel-level CO ACSR benchmark table for comparing speed, quality, completion, and workload risk across hotels.
        </p>
        <p className="font-sans leading-relaxed" style={{ fontSize: '0.67rem', color: muted }}>
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>Formula</span>
          {' '}
          <code className="font-mono" style={{ fontSize: '0.6rem', padding: '1px 5px', background: codeBg, color: accent, borderRadius: '2px' }}>
            Risk Rank = completion gap x 0.35 + delayed % x 0.25 + re-clean % x 0.20 + inspection gap x 0.15 + volume factor
          </code>
        </p>
      </div>
    </div>
  );
}

export function CoDashboardView({
  data,
  rows,
  chainEntries = [],
  myDash,
  myDashEmbed,
}: {
  data: CoDashboardJson;
  rows: CoRow[];
  chainEntries?: ChainEntry[];
  myDash?: MyDashOverride;
  myDashEmbed?: MyDashEmbed;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [dark, setDark] = useState(false);
  const orgTimezone = data.meta.timezone ?? 'UTC';
  const isCorp = String(data.meta.hotel_code ?? '').toUpperCase() === 'CORP';
  const [filtersOpen, setFiltersOpen] = useState(!isCorp);
  const [filters, setFilters] = useState<CoFilters>(() => {
    const min = formatDateInput(data.meta.date_range.min);
    const max = formatDateInput(data.meta.date_range.max);
    return { ...DEFAULT_FILTERS, dateFrom: min, dateTo: max };
  });
  const [hotelFilter, setHotelFilter] = useState('ALL');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    setDark(html.classList.contains('dark'));
    const observer = new MutationObserver(() => setDark(html.classList.contains('dark')));
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const min = formatDateInput(data.meta.date_range.min);
    const max = formatDateInput(data.meta.date_range.max);
    setFilters({ ...DEFAULT_FILTERS, dateFrom: min, dateTo: max });
  }, [data.meta.date_range.max, data.meta.date_range.min, data.meta.generated_at, data.meta.hotel_code]);

  useEffect(() => {
    if (!isCorp) setHotelFilter('ALL');
  }, [isCorp]);

  const themeTokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);

  const scopedRows = useMemo(() => {
    const hotelScopedRows = isCorp && hotelFilter !== 'ALL'
      ? rows.filter((row) => normKey(row.hotel_code) === normKey(hotelFilter))
      : rows;
    return hotelScopedRows.filter((row) => matchesRow(row, filters, orgTimezone));
  }, [rows, filters, isCorp, hotelFilter, orgTimezone]);
  // 24-hour distribution charts (⏰) intentionally ignore the date-range filter,
  // matching JO/MO's existing behavior — they always show the full upload period,
  // scoped only by the non-date filters (floor/attendant/room type/status/hotel).
  const isDateFiltered = useMemo(() => {
    const min = formatDateInput(data.meta.date_range.min);
    const max = formatDateInput(data.meta.date_range.max);
    return filters.dateFrom !== min || filters.dateTo !== max;
  }, [filters.dateFrom, filters.dateTo, data.meta.date_range.min, data.meta.date_range.max]);
  const hourFilters = useMemo(() => ({ ...filters, dateFrom: '', dateTo: '' }), [filters]);
  const hourPeriodRows = useMemo(() => {
    const hotelScopedRows = isCorp && hotelFilter !== 'ALL'
      ? rows.filter((row) => normKey(row.hotel_code) === normKey(hotelFilter))
      : rows;
    return hotelScopedRows.filter((row) => matchesRow(row, hourFilters, orgTimezone));
  }, [rows, hourFilters, isCorp, hotelFilter, orgTimezone]);
  const previousWindow = useMemo(() => previousRange(filters.dateFrom, filters.dateTo), [filters.dateFrom, filters.dateTo]);
  const previousRows = useMemo(() => {
    if (!previousWindow) return [];
    const hotelScopedRows = isCorp && hotelFilter !== 'ALL'
      ? rows.filter((row) => normKey(row.hotel_code) === normKey(hotelFilter))
      : rows;
    return hotelScopedRows.filter((row) => matchesRow(row, { ...filters, dateFrom: previousWindow.from, dateTo: previousWindow.to }, orgTimezone));
  }, [rows, filters, previousWindow, isCorp, hotelFilter, orgTimezone]);

  const filterSummary = useMemo(() => {
    const parts = [buildFilterSummary(filters)];
    if (isCorp && hotelFilter !== 'ALL') parts.push(`Hotel ${hotelFilter}`);
    return parts.filter(Boolean).join(' · ');
  }, [filters, isCorp, hotelFilter]);
  const filterClause = useMemo(() => {
    const clause = buildFilterClause(filters);
    if (isCorp && hotelFilter !== 'ALL') return `${clause} AND hotel_code = '${hotelFilter.replace(/'/g, "''")}'`;
    return clause;
  }, [filters, isCorp, hotelFilter]);
  const kpis = useMemo(() => buildKpis(scopedRows, previousRows, filters), [scopedRows, previousRows, filters]);
  const dateScopedCharts = useMemo(() => (isCorp ? buildCorpCharts(scopedRows, filters, orgTimezone) : buildCharts(scopedRows, filters, orgTimezone)), [scopedRows, filters, isCorp, orgTimezone]);
  const hourFullPeriodCharts = useMemo(() => (isCorp ? buildCorpCharts(hourPeriodRows, hourFilters, orgTimezone) : buildCharts(hourPeriodRows, hourFilters, orgTimezone)), [hourPeriodRows, hourFilters, isCorp, orgTimezone]);
  const charts = useMemo(() => {
    const fullById = new Map(hourFullPeriodCharts.map((c) => [c.id, c]));
    return dateScopedCharts.map((c) => (CO_24H_CHART_IDS.has(c.id) ? (fullById.get(c.id) ?? c) : c));
  }, [dateScopedCharts, hourFullPeriodCharts]);
  const localizedKpis = useMemo(() => kpis.map((kpi) => ({
    ...kpi,
    label: t(`kpi_labels_co.${kpi.id}`, kpi.label),
    note: t(`kpi_notes_co.${kpi.id}`, kpi.note),
  })), [kpis, t]);
  const localizedCharts = useMemo(() => charts.map((chart) => ({
    ...chart,
    title: t(`chart_titles_co.${chart.id}`, chart.title),
    note: t(`chart_notes_co.${chart.id}`, chart.note),
  })), [charts, t]);

  // ── Dashboard visibility config (from Configuration page) ────────────────
  const [dashConfig, setDashConfig] = useState<ModuleConfig>(() => defaultModuleConfig('co'));
  useEffect(() => {
    const reload = () => setDashConfig(loadModuleConfig('co'));
    reload(); // read on mount (and on router-cache revisit)
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);
  const visibleKpis   = useMemo(() => applyMyDashFilter(localizedKpis,   myDash?.kpis,   (id) => dashConfig.kpis[id]   !== false), [localizedKpis,   dashConfig, myDash]);
  const visibleCharts = useMemo(() => applyMyDashFilter(localizedCharts, myDash?.charts, (id) => dashConfig.charts[id] !== false), [localizedCharts, dashConfig, myDash]);
  // "Long Charts" — deep multi-level drilldowns that read better at full width, one per row.
  const simpleCharts = useMemo(() => visibleCharts.map((c, i) => ({ chart: c, index: i })).filter(({ chart }) => !LONG_CHART_IDS.has(chart.id)), [visibleCharts]);
  const longCharts   = useMemo(() => visibleCharts.map((c, i) => ({ chart: c, index: i })).filter(({ chart }) => LONG_CHART_IDS.has(chart.id)), [visibleCharts]);

  const hasFilteredData = scopedRows.length > 0;
  const dataQuality = useMemo(() => {
    const invalidDateRows = rows.filter((row) => !row.created_date && !row.completed_time && !row.start_time).length;
    const missingDurationRows = rows.filter((row) => row.actual_duration_minutes === null && row.duration_minutes === null && row.planned_duration_minutes === null).length;
    const missingAttendantRows = rows.filter((row) => !normText(row.attendant)).length;
    const missingStatusRows = rows.filter((row) => !normText(row.status) && !normText(row.status_normalized)).length;
    const unknownRoomTypeRows = rows.filter((row) => !normText(row.room_type)).length;
    const invalidDurationRows = rows.filter((row) => {
      const candidates = [row.actual_duration_minutes, row.duration_minutes, row.planned_duration_minutes];
      return candidates.some((value) => typeof value === 'number' && Number.isFinite(value) && value < 0);
    }).length;
    return {
      invalidDateRows,
      missingDurationRows,
      missingAttendantRows,
      missingStatusRows,
      unknownRoomTypeRows,
      invalidDurationRows,
      hasWarnings: invalidDateRows > 0 || missingDurationRows > 0 || missingAttendantRows > 0 || missingStatusRows > 0 || unknownRoomTypeRows > 0 || invalidDurationRows > 0,
    };
  }, [rows]);

  const floors = useMemo(() => ['ALL', ...sortedUnique(rows.map((row) => row.floor))], [rows]);
  const attendants = useMemo(() => ['ALL', ...sortedUnique(rows.map((row) => row.attendant))], [rows]);
  const roomTypes = useMemo(() => ['ALL', ...sortedUnique(rows.map((row) => row.room_type))], [rows]);
  const statuses = useMemo(() => ['ALL', ...sortedUnique(rows.map((row) => rowStatus(row)))], [rows]);
  const corpHotelOptions = useMemo(() => {
    if (!isCorp) return [] as Array<{ value: string; label: string }>;
    return chainEntries
      .filter((entry) => entry.hotel_code && entry.hotel_code !== 'CORP')
      .map((entry) => ({
        value: entry.hotel_code,
        label: entry.hotel_name ? `${entry.hotel_code} · ${entry.hotel_name}` : entry.hotel_code,
      }));
  }, [chainEntries, isCorp]);

  const contextTitle = data.meta.hotel_code === 'CORP'
    ? `${(data.meta.chain_code ?? 'CORP').toUpperCase()} · CO ACSR`
    : data.meta.hotel_name
      ? `${data.meta.hotel_name} · ${data.meta.hotel_code ?? ''} · CO ACSR${data.meta.country_code ? ` (${data.meta.country_code})` : ''}`
      : data.meta.source_name;

  const totalRows = rows.length;
  const filteredCount = scopedRows.length;
  const hotelCount = chainEntries.length;

  const setFilter = useCallback(<K extends keyof CoFilters,>(key: K, value: CoFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({
      ...DEFAULT_FILTERS,
      dateFrom: formatDateInput(data.meta.date_range.min),
      dateTo: formatDateInput(data.meta.date_range.max),
    });
  }, [data.meta.date_range.max, data.meta.date_range.min]);

  // Embedded fragment mode — shared date range from the My Dashboard page.
  const embedFrom = myDashEmbed?.range?.from;
  const embedTo   = myDashEmbed?.range?.to;
  useEffect(() => {
    if (!embedFrom || !embedTo) return;
    setFilters((current) => ({ ...current, dateFrom: embedFrom, dateTo: embedTo }));
  }, [embedFrom, embedTo]);

  // ── Embedded fragment mode (My Dashboard pooled grids) ────────────────────
  if (myDashEmbed) {
    if (myDashEmbed.part === 'kpis') {
      return (
        <>
          {visibleKpis.map((kpi) => (
            <CoKpiCard key={kpi.id} kpi={kpi} dark={dark} empty={!hasFilteredData} showDelta={false} />
          ))}
        </>
      );
    }
    return (
      <>
        {visibleCharts.map((chart, index) => (
          hasFilteredData ? (
            <HcChart key={chart.id} def={chart} dark={dark} index={index + 1} codeLabel={chart.id} fullPeriod={isDateFiltered && CO_24H_CHART_IDS.has(chart.id)} />
          ) : (
            <EmptyChartCard key={chart.id} title={chart.title} note={chart.note} formula={chart.formula} dark={dark} />
          )
        ))}
      </>
    );
  }

  return (
    <div ref={containerRef} className="min-h-[calc(100vh-3.5rem)]" style={{ background: themeTokens.dashboard.bg, color: themeTokens.dashboard.metaTitle }}>
      <div className="sticky top-0 z-20 border-b" style={{ background: themeTokens.dashboard.toolbarBg, borderColor: themeTokens.dashboard.toolbarBorder }}>
        <div className="px-6 py-3 flex flex-col gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h3 className="font-serif font-semibold truncate leading-snug" style={{ fontSize: '1.125rem', color: themeTokens.dashboard.metaTitle }}>{contextTitle}</h3>
              <p className="font-mono mt-0.5" style={{ fontSize: '0.6rem', letterSpacing: '0.05em', color: themeTokens.dashboard.metaSub }}>
                {filteredCount.toLocaleString()} {t('dashboard_ui.records_suffix', 'records')}
                {' · '}{t('dashboard_ui.generated_prefix', 'Generated')} {new Date(data.meta.generated_at).toLocaleString()}
                {' · '}CO ACSR Dashboard
                {hotelCount > 0 ? ` · ${hotelCount} hotels in scope` : ''}
              </p>
            </div>
            {!isCorp && (
              <button
                type="button"
                onClick={() => setFiltersOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors"
                style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText }}
                aria-expanded={filtersOpen}
                aria-label={filtersOpen ? 'Collapse filter panel' : 'Expand filter panel'}
              >
                {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Filters
              </button>
            )}
          </div>

          {isCorp ? (
            <div className="flex flex-wrap items-center gap-2">
              <CalendarDays size={13} style={{ color: themeTokens.accent }} />
              <input
                type="date"
                value={filters.dateFrom}
                min={formatDateInput(data.meta.date_range.min)}
                max={filters.dateTo || formatDateInput(data.meta.date_range.max)}
                onChange={(event) => setFilter('dateFrom', event.target.value)}
                className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1 w-[145px]"
                style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
              />
              <span className="font-mono text-[0.7rem]" style={{ color: themeTokens.dashboard.metaSub }}>→</span>
              <input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || formatDateInput(data.meta.date_range.min)}
                max={formatDateInput(data.meta.date_range.max)}
                onChange={(event) => setFilter('dateTo', event.target.value)}
                className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1 w-[145px]"
                style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={() => setFilters((current) => ({ ...current }))}
                className="px-3 py-1.5 font-mono uppercase"
                style={{ fontSize: '0.68rem', letterSpacing: '0.08em', background: themeTokens.accent, color: '#f8f7f2' }}
              >
                APPLY
              </button>
              <div className="flex items-center gap-2">
                {['ALL', '1D', '1W', '2W', '1M', '2M', '3M', '6M', '1Y'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      if (option === 'ALL') return resetFilters();
                      const end = parseDate(filters.dateTo) ?? parseDate(formatDateInput(data.meta.date_range.max)) ?? new Date();
                      const nextEnd = new Date(end);
                      const ranges: Record<string, number> = { '1D': 1, '1W': 7, '2W': 14, '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1Y': 365 };
                      const days = ranges[option] ?? 0;
                      const start = new Date(end);
                      start.setDate(start.getDate() - days);
                      setFilters((current) => ({ ...current, dateFrom: formatLocalDateKey(start), dateTo: formatLocalDateKey(nextEnd) }));
                    }}
                    className="px-2.5 py-1.5 font-mono uppercase"
                    style={{
                      fontSize: '0.66rem',
                      border: `1px solid ${themeTokens.dashboard.toolbarBorder}`,
                      background: themeTokens.dashboard.inputBg,
                      color: themeTokens.dashboard.inputText,
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[0.68rem]" style={{ color: themeTokens.dashboard.metaSub, letterSpacing: '0.05em' }}>
                  HOTEL
                </span>
                <select
                  value={hotelFilter}
                  onChange={(event) => setHotelFilter(event.target.value)}
                  className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1 w-[240px] min-w-[240px] max-w-[240px]"
                  style={{
                    background: themeTokens.dashboard.inputBg,
                    border: `1px solid ${themeTokens.dashboard.inputBorder}`,
                    color: themeTokens.dashboard.inputText,
                    '--tw-ring-color': themeTokens.accent,
                  } as React.CSSProperties}
                >
                  <option value="ALL">ALL</option>
                  {corpHotelOptions.map((hotel) => (
                    <option key={hotel.value} value={hotel.value}>{hotel.label}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : filtersOpen && (
            <div className="grid gap-3 xl:grid-cols-6 md:grid-cols-2">
              <label className="space-y-1">
                <span className="block font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: themeTokens.dashboard.metaSub }}>Date Range</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={filters.dateFrom}
                    min={formatDateInput(data.meta.date_range.min)}
                    max={filters.dateTo || formatDateInput(data.meta.date_range.max)}
                    onChange={(event) => setFilter('dateFrom', event.target.value)}
                    className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
                    style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
                  />
                  <input
                    type="date"
                    value={filters.dateTo}
                    min={filters.dateFrom || formatDateInput(data.meta.date_range.min)}
                    max={formatDateInput(data.meta.date_range.max)}
                    onChange={(event) => setFilter('dateTo', event.target.value)}
                    className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
                    style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
                  />
                </div>
              </label>
              <label className="space-y-1">
                <span className="block font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: themeTokens.dashboard.metaSub }}>Floor</span>
                <select
                  value={filters.floor}
                  onChange={(event) => setFilter('floor', event.target.value)}
                  className="w-full font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
                  style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
                >
                  {floors.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: themeTokens.dashboard.metaSub }}>Attendant</span>
                <select
                  value={filters.attendant}
                  onChange={(event) => setFilter('attendant', event.target.value)}
                  className="w-full font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
                  style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
                >
                  {attendants.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: themeTokens.dashboard.metaSub }}>Room Type</span>
                <select
                  value={filters.roomType}
                  onChange={(event) => setFilter('roomType', event.target.value)}
                  className="w-full font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
                  style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
                >
                  {roomTypes.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: themeTokens.dashboard.metaSub }}>Status</span>
                <select
                  value={filters.status}
                  onChange={(event) => setFilter('status', event.target.value)}
                  className="w-full font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
                  style={{ background: themeTokens.dashboard.inputBg, border: `1px solid ${themeTokens.dashboard.inputBorder}`, color: themeTokens.dashboard.inputText, '--tw-ring-color': themeTokens.accent } as React.CSSProperties}
                >
                  {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="w-full px-3 py-1.5 font-mono uppercase"
                  style={{
                    background: themeTokens.accentTint,
                    border: `1px solid ${themeTokens.dashboard.inputBorder}`,
                    color: themeTokens.dashboard.inputText,
                    fontSize: '0.68rem',
                    letterSpacing: '0.08em',
                  }}
                >
                  Reset Filters
                </button>
              </div>
            </div>
          )}
          {!isCorp && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase" style={{ color: themeTokens.dashboard.metaSub }}>
              <span>{filteredCount.toLocaleString()} of {totalRows.toLocaleString()} orders</span>
              <span>•</span>
              <span>{filterClause}</span>
            </div>
          )}
          {dataQuality.hasWarnings && (
            <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: themeTokens.dashboard.inputBorder, background: themeTokens.accentTint, color: themeTokens.dashboard.metaTitle }}>
              <div className="font-mono uppercase tracking-wide" style={{ fontSize: '0.62rem', color: themeTokens.dashboard.metaSub }}>Data quality warning</div>
              <div className="mt-1 space-y-1 font-sans" style={{ fontSize: '0.84rem' }}>
                {dataQuality.invalidDateRows > 0 && <p>{dataQuality.invalidDateRows} rows are missing valid dates; those rows are kept in the dashboard and excluded from date-range comparisons when needed.</p>}
                {dataQuality.missingDurationRows > 0 && <p>{dataQuality.missingDurationRows} rows are missing duration fields; duration KPIs fall back to available timing fields and skip rows with no usable duration.</p>}
                {dataQuality.missingAttendantRows > 0 && <p>{dataQuality.missingAttendantRows} rows are missing attendant names; they are grouped under Unknown in filters and charts.</p>}
                {dataQuality.missingStatusRows > 0 && <p>{dataQuality.missingStatusRows} rows are missing status fields; the dashboard derives a fallback status from completion, inspection, and reclean signals.</p>}
                {dataQuality.unknownRoomTypeRows > 0 && <p>{dataQuality.unknownRoomTypeRows} rows are missing room type; they are grouped under Unknown Room Type.</p>}
                {dataQuality.invalidDurationRows > 0 && <p>{dataQuality.invalidDurationRows} rows have invalid duration values; negative values are ignored during KPI and chart calculations.</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pt-1 pb-5 space-y-7 max-w-screen-2xl mx-auto">
        <div className="print-title hidden" style={{ borderBottom: '2px solid #0E7470', paddingBottom: '6mm' }}>
          <p className="font-serif font-bold" style={{ fontSize: '1.1rem', color: '#1A1714' }}>
            {data.meta.chain_code} — {data.meta.hotel_code} — {data.meta.hotel_name}
            {data.meta.country_code ? ` (${data.meta.country_code})` : ''}
          </p>
          <p className="font-mono" style={{ fontSize: '0.6rem', color: '#6B6560', marginTop: '3px', letterSpacing: '0.06em' }}>
            {t('dashboard_label_co', 'CO ACSR Dashboard')} · {data.meta.total_records.toLocaleString()} {t('dashboard_ui.records_suffix', 'records')} ·
            {t('dashboard_ui.generated_prefix', 'Generated')} {new Date(data.meta.generated_at).toLocaleDateString()}
          </p>
        </div>

        <section className="kpi-print-section">
          <SectionHead label={t('dashboard_ui.section_kpi', 'KPI')} dark={dark} />
          <div className="kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {visibleKpis.map((kpi) => (
              <CoKpiCard key={kpi.id} kpi={kpi} dark={dark} empty={!hasFilteredData} showDelta={false} />
            ))}
          </div>
          {filteredCount !== totalRows && (
            <p className="mt-1 font-mono" style={{ fontSize: '0.6rem', color: themeTokens.dashboard.metaSub }}>
              KPIs filtered to {filters.dateFrom} → {filters.dateTo}
            </p>
          )}
        </section>

        <section>
          <SectionHead label={t('dashboard_ui.section_simple_charts', 'Simple Charts')} dark={dark} />
          <div className="chart-grid mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {simpleCharts.map(({ chart, index }) => (
              hasFilteredData ? (
                <HcChart
                  key={chart.id}
                  def={chart}
                  dark={dark}
                  index={index + 1}
                  codeLabel={`${isCorp ? 'CCO' : 'CO'}-${String(index + 1).padStart(2, '0')}`}
                  fullPeriod={isDateFiltered && CO_24H_CHART_IDS.has(chart.id)}
                />
              ) : (
                <EmptyChartCard
                  key={chart.id}
                  title={chart.title}
                  note={chart.note}
                  formula={chart.formula}
                  dark={dark}
                />
              )
            ))}
            {simpleCharts.length === 0 && longCharts.length === 0 && (
              <p className="col-span-2 font-mono text-center py-8" style={{ color: themeTokens.dashboard.metaSub, fontSize: '0.75rem' }}>
                All charts are hidden. Go to <strong>Configuration → CO</strong> and click <strong>Select All</strong> to restore them.
              </p>
            )}
          </div>
        </section>

        {(longCharts.length > 0 || isCorp) && (
          <section>
            <SectionHead label={t('dashboard_ui.section_long_charts', 'Long Charts')} dark={dark} />
            <div className="chart-grid-long mt-5 grid grid-cols-1 gap-4">
              {longCharts.map(({ chart, index }) => (
                hasFilteredData ? (
                  <HcChart
                    key={chart.id}
                    def={chart}
                    dark={dark}
                    index={index + 1}
                    codeLabel={`${isCorp ? 'CCO' : 'CO'}-${String(index + 1).padStart(2, '0')}`}
                    fullPeriod={isDateFiltered && CO_24H_CHART_IDS.has(chart.id)}
                  />
                ) : (
                  <EmptyChartCard
                    key={chart.id}
                    title={chart.title}
                    note={chart.note}
                    formula={chart.formula}
                    dark={dark}
                  />
                )
              ))}
            </div>
          </section>
        )}

        {isCorp && (
          <section>
            <SectionHead label={t('dashboard_ui.section_performance', 'Performance')} dark={dark} />
            <div className="mt-5">
              <CorpCoPerformanceTable
                rows={scopedRows}
                dark={dark}
                codeLabel={`CCO-${String(charts.length + 1).padStart(2, '0')}`}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
