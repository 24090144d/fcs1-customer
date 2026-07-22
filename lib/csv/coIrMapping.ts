import type { CoIrRow } from '@/types/csv';
import { localDateKey, parseCsvDate } from '@/lib/timezone';

const CO_IR_ALIASES: Record<string, string> = {
  date: 'inspection_date',
  inspection_date: 'inspection_date',
  inspector: 'inspector',
  location: 'location',
  room: 'location',
  room_no: 'location',
  start_time: 'start_time',
  complete_time: 'complete_time',
  completed_time: 'complete_time',
  cleaned_by: 'cleaned_by',
  turn_over_time: 'turn_over_time',
  turnover_time: 'turn_over_time',
  turn_over_minutes: 'turn_over_time',
  pass_conditional_pass_fail: 'inspection_result',
  inspection_result: 'inspection_result',
  inspection_score: 'inspection_score',
  room_status: 'room_status',
  inspection_credit: 'inspection_credit',
  report_variant: 'report_variant',
};

function canonical(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return CO_IR_ALIASES[key] ?? key;
}

export function normaliseCoIrKeys(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [canonical(key), value]));
}

export function isCoIrShape(raw: Record<string, unknown>): boolean {
  const row = normaliseCoIrKeys(raw);
  return String(row.report_variant ?? '').toUpperCase() === 'IR'
    || ('inspection_result' in row && 'inspection_credit' in row && 'room_status' in row && 'inspector' in row);
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized && normalized !== '-' ? normalized : null;
}

function number(value: unknown): number | null {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value: unknown, timezone: string): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = parseCsvDate(normalized, timezone);
  return parsed ? parsed.toISOString() : null;
}

function durationMinutes(value: unknown): number | null {
  const normalized = text(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] ?? 0) / 60;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function result(value: unknown): string {
  const normalized = text(value) ?? 'Unknown';
  if (/conditional/i.test(normalized)) return 'Conditional Pass';
  if (/^pass/i.test(normalized)) return 'Pass';
  if (/^fail/i.test(normalized)) return 'Fail';
  return normalized;
}

export function buildCoIrRow(raw: Record<string, unknown>, rowNumber: number, timezone = 'UTC'): CoIrRow {
  const row = normaliseCoIrKeys(raw);
  const startTime = dateTime(row.start_time, timezone);
  const completeTime = dateTime(row.complete_time, timezone);
  const turnover = durationMinutes(row.turn_over_time);
  let calculated: number | null = null;
  if (startTime && completeTime) {
    const start = new Date(startTime).getTime();
    const complete = new Date(completeTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(complete) && complete >= start) {
      calculated = (complete - start) / 60_000;
    }
  }
  const inspectionDuration = calculated ?? turnover;
  const rawInspectionDate = text(row.inspection_date);
  const parsedInspectionDate = rawInspectionDate
    ? parseCsvDate(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(rawInspectionDate) ? `${rawInspectionDate} 00:00:00` : rawInspectionDate, timezone)
    : null;
  const fallbackDate = startTime ?? completeTime;
  const inspectionDate = parsedInspectionDate
    ? localDateKey(parsedInspectionDate, timezone)
    : fallbackDate ? localDateKey(new Date(fallbackDate), timezone) : null;
  const inspector = text(row.inspector) ?? 'Inspector';
  const location = text(row.location) ?? 'Unknown Room';
  const inspectionResult = result(row.inspection_result);

  return {
    row_key: `${inspectionDate ?? ''}::${location}::${inspector}::${startTime ?? completeTime ?? rowNumber}`,
    row_number: rowNumber,
    report_variant: 'IR',
    inspection_date: inspectionDate,
    inspector,
    location,
    start_time: startTime,
    complete_time: completeTime,
    cleaned_by: text(row.cleaned_by),
    turn_over_minutes: turnover,
    inspection_duration_minutes: inspectionDuration,
    duration_source: calculated !== null ? 'TIMESTAMP_DIFF' : turnover !== null ? 'TURN_OVER_TIME' : null,
    inspection_result: inspectionResult,
    inspection_score: number(row.inspection_score),
    room_status: text(row.room_status)?.toUpperCase() ?? 'Unknown',
    inspection_credit: number(row.inspection_credit),
  };
}
