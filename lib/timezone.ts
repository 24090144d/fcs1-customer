// ---------------------------------------------------------------------------
// Shared date/time helpers used across JO/MO/CO/IM ingestion and display
// code.
//
// Per explicit user instruction (2026-07-10): CSV date/time values are
// stored and displayed EXACTLY as they appear in the source CSV — no
// timezone conversion in either direction. Ingestion parses the raw digits
// and stores them verbatim (treating them as if they were already UTC, so
// no offset is applied); display reads those same digits straight back with
// no shift. The `tz`/`timeZone` parameters below are kept on every function
// signature for call-site compatibility across the JO/MO/CO/IM ingestion
// and dashboard code (which all still pass the org's configured timezone),
// but they are intentionally unused — every function reads/writes the raw
// digits directly via UTC getters, so "UTC" here just means "the digits as
// literally written," not a true UTC instant.
//
// (This module has flip-flopped between conversion and no-conversion more
// than once in this project's history — see CLAUDE.md's version history for
// v1.0.92–v1.0.99 and v1.1.3. This is the current, explicitly-requested
// state: no conversion, anywhere, for any module.)
// ---------------------------------------------------------------------------

/** Hour-of-day (0-23) — reads the stored digits directly, no timezone shift. */
export function localHour(d: Date, _tz: string): number {
  return d.getUTCHours();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar date ("YYYY-MM-DD") — reads the stored digits directly, no timezone shift. */
export function localDateKey(d: Date, _tz: string): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Day-of-week (0=Sun..6=Sat) — reads the stored digits directly, no timezone shift. */
export function localWeekday(d: Date, _tz: string): number {
  return d.getUTCDay();
}

/**
 * Takes local wall-clock date/time components as read literally off a CSV
 * and stores them as-is — the returned Date's UTC digits are exactly the
 * CSV's digits, unshifted. `tz` is accepted for call-site compatibility but
 * intentionally ignored (no conversion is applied).
 */
export function zonedTimeToUtc(
  year: number, month0: number, day: number,
  hour: number, minute: number, second: number,
  _tz: string,
): Date {
  return new Date(Date.UTC(year, month0, day, hour, minute, second));
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
// Matches the naive "DD Mon YYYY HH:mm[:ss]" format CSV exports use — JO/IM
// export 3-letter abbreviations (e.g. "01 Jul 2026 10:24"), CO exports full
// month names (e.g. "04 June 2026 11:39:28") — hence {3,9} to accept "May"
// through "September"/"November"/"December".
const NAIVE_DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
// Matches naive ISO-shaped strings with no "Z"/offset suffix (e.g.
// "2026-07-01 10:24:00" or "2026-07-01T10:24").
const NAIVE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses a raw CSV date value and stores its digits verbatim (no timezone
 * conversion — see module header). `tz` is accepted for call-site
 * compatibility but intentionally unused.
 */
export function parseCsvDate(val: unknown, tz: string): Date | null {
  if (val === null || val === undefined || val === '') return null;
  const raw = String(val).trim();

  const naive = raw.match(NAIVE_DATE_RE);
  if (naive) {
    const [, day, monAbbr, year, hour, minute, second] = naive;
    const month = MONTH_ABBR[monAbbr.toLowerCase()];
    if (month !== undefined) {
      const d = zonedTimeToUtc(Number(year), month, Number(day), Number(hour), Number(minute), Number(second ?? 0), tz);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const naiveIso = raw.match(NAIVE_ISO_RE);
  if (naiveIso) {
    const [, year, month, day, hour, minute, second] = naiveIso;
    const d = zonedTimeToUtc(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0), tz);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
