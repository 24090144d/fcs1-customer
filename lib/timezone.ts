// ---------------------------------------------------------------------------
// Shared timezone conversion helpers used across JO/MO/CO/IM ingestion and
// display code. CSV sources store local wall-clock time for the org's
// configured timezone (Configuration → System, e.g. Asia/Hong_Kong,
// Asia/Macau, Asia/Shanghai). Ingestion converts that local time to a true
// UTC instant for storage; display converts the stored UTC instant back to
// the org's local timezone for hour/day/week/month bucketing. Both
// directions must go through here so they stay inverses of each other.
// ---------------------------------------------------------------------------

const hourFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getHourFormatter(tz: string): Intl.DateTimeFormat {
  let f = hourFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz });
    hourFormatterCache.set(tz, f);
  }
  return f;
}

/** Hour-of-day (0-23) that a UTC instant falls on in the given IANA timezone. */
export function localHour(d: Date, tz: string): number {
  try {
    const s = getHourFormatter(tz).format(d);
    const h = parseInt(s, 10);
    if (!isNaN(h)) return h === 24 ? 0 : h;
  } catch { /* fall through */ }
  return d.getUTCHours();
}

const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getDateKeyFormatter(tz: string): Intl.DateTimeFormat {
  let f = dateKeyFormatterCache.get(tz);
  if (!f) {
    // en-CA formats as YYYY-MM-DD directly.
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateKeyFormatterCache.set(tz, f);
  }
  return f;
}

/** Calendar date ("YYYY-MM-DD") that a UTC instant falls on in the given IANA timezone. */
export function localDateKey(d: Date, tz: string): string {
  try {
    return getDateKeyFormatter(tz).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getPartsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatterCache.set(tz, f);
  }
  return f;
}

/** Day-of-week (0=Sun..6=Sat) that a UTC instant falls on in the given IANA timezone. */
export function localWeekday(d: Date, tz: string): number {
  try {
    const key = getDateKeyFormatter(tz).format(d); // YYYY-MM-DD
    // Constructing a UTC midnight from the local calendar date gives the
    // correct weekday without re-running a full timezone conversion.
    return new Date(`${key}T00:00:00Z`).getUTCDay();
  } catch {
    return d.getUTCDay();
  }
}

/**
 * Converts local wall-clock date/time components (as read literally off a
 * CSV, in the org's configured timezone) into the true UTC instant they
 * represent. DST-safe: uses a round-trip through Intl.DateTimeFormat rather
 * than a fixed offset, so it works correctly for timezones that observe DST
 * (not just fixed-offset zones like Asia/Hong_Kong).
 */
export function zonedTimeToUtc(
  year: number, month0: number, day: number,
  hour: number, minute: number, second: number,
  tz: string,
): Date {
  const guessMs = Date.UTC(year, month0, day, hour, minute, second);
  try {
    const parts = getPartsFormatter(tz).formatToParts(new Date(guessMs));
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const hh = p.hour === '24' ? 0 : Number(p.hour);
    const asLocalMs = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hh, Number(p.minute), Number(p.second));
    const offsetMs = asLocalMs - guessMs; // how far ahead of UTC `tz` is at this instant
    return new Date(guessMs - offsetMs);
  } catch {
    return new Date(guessMs);
  }
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
// Matches the naive "DD Mon YYYY HH:mm[:ss]" format CSV exports use (e.g.
// "01 Jul 2026 10:24") — no timezone/offset marker, so it must be interpreted
// as being in the org's configured timezone, not the server's ambient one.
const NAIVE_DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
// Matches naive ISO-shaped strings with no "Z"/offset suffix (e.g.
// "2026-07-01 10:24:00" or "2026-07-01T10:24"), which JS would otherwise
// parse as local time in the server's ambient timezone.
const NAIVE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses a raw CSV date value into the true UTC instant it represents.
 * Naive strings with no timezone marker are interpreted as local wall-clock
 * time in `tz` (via zonedTimeToUtc). Already-unambiguous strings (ISO with
 * a "Z"/offset suffix) are parsed as-is — those never depended on the
 * server's ambient timezone and don't need conversion.
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
