// ---------------------------------------------------------------------------
// Shared dashboard data fetchers — used by /dashboard and /my-dashboard pages.
// Moved verbatim from app/dashboard/page.tsx (v1.0.45).
// ---------------------------------------------------------------------------

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/supabaseCompat';
import type { DashboardJson, ImDashboardJson, MoDashboardJson, CoDashboardJson, ChainEntry, DailyBucket, HotelSummary } from '@/types/dashboard';
import type { CoRow } from '@/types/csv';
import { localHour } from '@/lib/timezone';

type SbResult<T> = { data: T | null; error: { message: string } | null };

const TIMEZONE_TABLES = new Set(['jo_records', 'mo_records', 'co_records', 'im_records']);

/**
 * Resolve the org timezone live, at request time, so a Configuration →
 * System Settings change takes effect immediately across all modules
 * without needing a CSV re-upload or manual backfill.
 * Stage 1: chain-code match on organizations.organization_code — this is the
 * authoritative method: it's what the hotel-level live IM route
 * (app/api/dashboard/im-scope/route.ts) has always used, and per-hotel
 * organization_id links can point to a stale/different org row than the one
 * actually edited in Configuration → System Settings (organization_id is set
 * once at CSV upload time and never re-linked when orgs are consolidated).
 * Stage 2: organization_id UUID from the module's own record table, only as a
 * fallback when no chain-code match exists.
 * Stage 3: hard default (UTC+8) per product decision.
 */
export async function resolveLiveTimezone(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'jo_records' | 'mo_records' | 'co_records' | 'im_records',
  hotelCodes: string[],
  chainCode?: string | null,
): Promise<string> {
  const code = String(chainCode ?? '').trim().toUpperCase();
  if (code) {
    const tzRes = await supabase
      .from('organizations')
      .select('timezone')
      .ilike('organization_code', code)
      .maybeSingle() as unknown as SbResult<{ timezone: string | null }>;
    if (tzRes.data?.timezone) return tzRes.data.timezone;
  }
  // `table` is always one of our own literal union values, never user input — safe to interpolate
  // after this allowlist check, and required here since the compat query builder has no join support.
  if (hotelCodes.length > 0 && TIMEZONE_TABLES.has(table)) {
    try {
      const pool = getPool();
      const joined = await pool.query<{ timezone: string | null }>(
        `SELECT o.timezone FROM "${table}" r JOIN organizations o ON o.id = r.organization_id WHERE r.hotel_code = ANY($1) AND r.organization_id IS NOT NULL LIMIT 1`,
        [hotelCodes],
      );
      if (joined.rows[0]?.timezone) return joined.rows[0].timezone;
    } catch {
      // fall through to hard default
    }
  }
  return 'Asia/Hong_Kong';
}

function parseDurationMinutes(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = m[3] ? parseInt(m[3], 10) : 0;
    return hh * 60 + mm + Math.floor(ss / 60);
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function joDurBucket(mins: number): string {
  if (mins < 15) return '< 15 min';
  if (mins < 30) return '15–30 min';
  if (mins < 60) return '30–60 min';
  if (mins < 120) return '1–2 h';
  if (mins < 240) return '2–4 h';
  if (mins < 480) return '4–8 h';
  return '8+ h';
}

function isVipLike(v: string | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return !!s && s !== '-';
}

type JoHourSourceRow = {
  job_status: string | null;
  service_item_category: string | null;
  service_item: string | null;
  delay_duration: string | number | null;
  escalation_group: string | null;
  vip_code: string | null;
  created_datetime: string | null;
  acknowledged_datetime: string | null;
  completed_datetime: string | null;
};

/**
 * Recomputes every JO 24-hour-distribution map live, from raw jo_records.
 * created_datetime is true UTC (post-ingestion-fix) — converted to the org's
 * configured timezone (tz) for the local hour-of-day.
 */
function computeJoHourMaps(rows: JoHourSourceRow[], tz: string): Partial<HotelSummary> {
  const hourCompleted: Record<string, number> = {};
  const hourCompBkt: Record<string, Record<string, number>> = {};
  const hourAcknowledged: Record<string, number> = {};
  const hourRespBkt: Record<string, Record<string, number>> = {};
  const hourEsc: Record<string, number> = {};
  const hourEscBkt: Record<string, Record<string, number>> = {};
  const hourSlaTotal: Record<string, number> = {};
  const hourSlaComp: Record<string, number> = {};
  const hourSlaCatTotal: Record<string, Record<string, number>> = {};
  const hourSlaCatComp: Record<string, Record<string, number>> = {};
  const statusHourMap: Record<string, Record<string, number>> = {};
  const escGroupHourMap: Record<string, Record<string, number>> = {};
  const overdueCatHourMap: Record<string, Record<string, number>> = {};
  const catHourMap: Record<string, Record<string, number>> = {};
  const hourDelayed: Record<string, number> = {};
  const hourDelayedItem: Record<string, Record<string, number>> = {};
  const hourTimeout: Record<string, number> = {};
  const hourItemCount: Record<string, Record<string, number>> = {};
  const vipHourCount: Record<string, number> = {};
  const vipHourItemCount: Record<string, Record<string, number>> = {};

  for (const r of rows) {
    const statusRaw = (r.job_status ?? '').trim().toLowerCase();
    const status = r.job_status ?? 'Unknown';
    const category = r.service_item_category ?? 'Unknown';
    const item = r.service_item ?? 'Unknown';
    const completedFlag = statusRaw.includes('complete') || statusRaw.includes('close') || statusRaw.includes('done') || statusRaw.includes('finish');
    const timeoutFlag = statusRaw.includes('timeout');
    const delayMin = parseDurationMinutes(r.delay_duration);
    const escalatedFlag = !!(r.escalation_group && String(r.escalation_group).trim()) || (delayMin !== null && delayMin > 0);

    const createdAt = r.created_datetime ? new Date(r.created_datetime) : null;
    const ackAt = r.acknowledged_datetime ? new Date(r.acknowledged_datetime) : null;
    const completedAt = r.completed_datetime ? new Date(r.completed_datetime) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    const h = String(localHour(createdAt, tz));

    hourSlaTotal[h] = (hourSlaTotal[h] ?? 0) + 1;
    if (!hourItemCount[h]) hourItemCount[h] = {};
    hourItemCount[h][item] = (hourItemCount[h][item] ?? 0) + 1;

    let resolutionMin: number | null = null;
    if (completedAt && !Number.isNaN(completedAt.getTime()) && completedAt.getTime() >= createdAt.getTime()) {
      resolutionMin = (completedAt.getTime() - createdAt.getTime()) / 60_000;
    }

    if (completedFlag) {
      hourCompleted[h] = (hourCompleted[h] ?? 0) + 1;
      if (resolutionMin !== null) {
        const bkt = joDurBucket(resolutionMin);
        if (!hourCompBkt[h]) hourCompBkt[h] = {};
        hourCompBkt[h][bkt] = (hourCompBkt[h][bkt] ?? 0) + 1;
      }
      const isSlaCompliant = !(delayMin !== null && delayMin > 0);
      if (isSlaCompliant) hourSlaComp[h] = (hourSlaComp[h] ?? 0) + 1;
      if (!hourSlaCatTotal[h]) hourSlaCatTotal[h] = {};
      hourSlaCatTotal[h][category] = (hourSlaCatTotal[h][category] ?? 0) + 1;
      if (isSlaCompliant) {
        if (!hourSlaCatComp[h]) hourSlaCatComp[h] = {};
        hourSlaCatComp[h][category] = (hourSlaCatComp[h][category] ?? 0) + 1;
      }
    }

    if (ackAt && !Number.isNaN(ackAt.getTime()) && ackAt.getTime() >= createdAt.getTime()) {
      const respMin = (ackAt.getTime() - createdAt.getTime()) / 60_000;
      hourAcknowledged[h] = (hourAcknowledged[h] ?? 0) + 1;
      const bkt = joDurBucket(respMin);
      if (!hourRespBkt[h]) hourRespBkt[h] = {};
      hourRespBkt[h][bkt] = (hourRespBkt[h][bkt] ?? 0) + 1;
    }

    if (escalatedFlag) {
      hourEsc[h] = (hourEsc[h] ?? 0) + 1;
      if (delayMin !== null) {
        const bkt = joDurBucket(delayMin);
        if (!hourEscBkt[h]) hourEscBkt[h] = {};
        hourEscBkt[h][bkt] = (hourEscBkt[h][bkt] ?? 0) + 1;
      }
    }

    const statusKey = (status || 'Unknown').trim();
    if (!statusHourMap[statusKey]) statusHourMap[statusKey] = {};
    statusHourMap[statusKey][h] = (statusHourMap[statusKey][h] ?? 0) + 1;

    const escGroupKey = (r.escalation_group ?? '').toString().trim();
    if (escGroupKey) {
      if (!escGroupHourMap[escGroupKey]) escGroupHourMap[escGroupKey] = {};
      escGroupHourMap[escGroupKey][h] = (escGroupHourMap[escGroupKey][h] ?? 0) + 1;
    }

    if (!catHourMap[category]) catHourMap[category] = {};
    catHourMap[category][h] = (catHourMap[category][h] ?? 0) + 1;

    if (delayMin !== null && delayMin > 0) {
      if (!overdueCatHourMap[category]) overdueCatHourMap[category] = {};
      overdueCatHourMap[category][h] = (overdueCatHourMap[category][h] ?? 0) + 1;
      hourDelayed[h] = (hourDelayed[h] ?? 0) + 1;
      if (!hourDelayedItem[h]) hourDelayedItem[h] = {};
      hourDelayedItem[h][item] = (hourDelayedItem[h][item] ?? 0) + 1;
    }

    if (timeoutFlag) hourTimeout[h] = (hourTimeout[h] ?? 0) + 1;

    if (isVipLike(r.vip_code)) {
      vipHourCount[h] = (vipHourCount[h] ?? 0) + 1;
      if (!vipHourItemCount[h]) vipHourItemCount[h] = {};
      vipHourItemCount[h][item] = (vipHourItemCount[h][item] ?? 0) + 1;
    }
  }

  return {
    jo_hour_comp_map: hourCompleted,
    jo_hour_comp_bkt_map: hourCompBkt,
    jo_hour_resp_bkt_map: hourRespBkt,
    jo_hour_esc_map: hourEsc,
    jo_hour_esc_bkt_map: hourEscBkt,
    jo_hour_sla_total_map: hourSlaTotal,
    jo_hour_sla_comp_map: hourSlaComp,
    jo_hour_sla_cat_total_map: hourSlaCatTotal,
    jo_hour_sla_cat_comp_map: hourSlaCatComp,
    jo_status_hour_map: statusHourMap,
    jo_escgroup_hour_map: escGroupHourMap,
    jo_overdue_cat_hour_map: overdueCatHourMap,
    jo_cat_hour_map: catHourMap,
    jo_hour_delayed_map: hourDelayed,
    jo_hour_delayed_item_map: hourDelayedItem,
    jo_hour_timeout_map: hourTimeout,
    jo_hour_item_map: hourItemCount,
    jo_vip_hour_map: vipHourCount,
    jo_vip_hour_item_map: vipHourItemCount,
  };
}

type MoHourSourceRow = {
  created_datetime: string | null;
  resolution_minutes: number | string | null;
  defect: string | null;
  asset: string | null;
  job_order: string | null;
};

/**
 * MO's CSV source stores created date-time as local wall-clock time already
 * (not UTC) — the hour is read via getUTCHours() with no timezone conversion.
 */
function computeMoHourMaps(rows: MoHourSourceRow[], tz: string): Partial<HotelSummary> {
  const hourMap: Record<string, number> = {};
  const item24hHourMap: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!r.created_datetime) continue;
    const d = new Date(r.created_datetime);
    if (Number.isNaN(d.getTime())) continue;
    const h = String(localHour(d, tz));
    hourMap[h] = (hourMap[h] ?? 0) + 1;
    const resMin = r.resolution_minutes !== null ? Number(r.resolution_minutes) : null;
    if (resMin !== null && Number.isFinite(resMin) && resMin >= 1440) {
      const item = (r.defect && r.defect.trim()) || (r.asset && r.asset.trim()) || (r.job_order && r.job_order.trim()) || 'Unknown';
      if (!item24hHourMap[item]) item24hHourMap[item] = {};
      item24hHourMap[item][h] = (item24hHourMap[item][h] ?? 0) + 1;
    }
  }
  return { mo_hour_map: hourMap, mo_item_24h_hour_map: item24hHourMap };
}

type ImHourSourceRow = {
  department: string | null;
  incident_category: string | null;
  incident_item_name: string | null;
  vip_code: string | null;
  created_date: string | null;
  incident_datetime: string | null;
};

/**
 * Recomputes hotel-level IM 24-hour-distribution maps live, from raw im_records.
 * created_date/incident_datetime are true UTC (post-ingestion-fix) — converted
 * to the org's configured timezone (tz) for the local hour-of-day.
 */
function computeImHourMaps(rows: ImHourSourceRow[], tz: string): Partial<HotelSummary> {
  const hourMap: Record<string, number> = {};
  const hourCategoryMap: Record<string, Record<string, number>> = {};
  const hourDeptMap: Record<string, Record<string, number>> = {};
  const hourCategoryItemMap: Record<string, Record<string, Record<string, number>>> = {};
  const hourDeptItemMap: Record<string, Record<string, Record<string, number>>> = {};
  const vipHourMap: Record<string, number> = {};
  for (const r of rows) {
    const rawDate = r.created_date ?? r.incident_datetime;
    if (!rawDate) continue;
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) continue;
    const h = String(localHour(d, tz));
    const cat = r.incident_category ?? 'Unknown';
    const dept = r.department ?? 'Unknown';
    const item = r.incident_item_name ?? 'Unknown';
    hourMap[h] = (hourMap[h] ?? 0) + 1;
    if (!hourCategoryMap[h]) hourCategoryMap[h] = {};
    hourCategoryMap[h][cat] = (hourCategoryMap[h][cat] ?? 0) + 1;
    if (!hourDeptMap[h]) hourDeptMap[h] = {};
    hourDeptMap[h][dept] = (hourDeptMap[h][dept] ?? 0) + 1;
    if (!hourCategoryItemMap[h]) hourCategoryItemMap[h] = {};
    if (!hourCategoryItemMap[h][cat]) hourCategoryItemMap[h][cat] = {};
    hourCategoryItemMap[h][cat][item] = (hourCategoryItemMap[h][cat][item] ?? 0) + 1;
    if (!hourDeptItemMap[h]) hourDeptItemMap[h] = {};
    if (!hourDeptItemMap[h][dept]) hourDeptItemMap[h][dept] = {};
    hourDeptItemMap[h][dept][item] = (hourDeptItemMap[h][dept][item] ?? 0) + 1;
    if (isVipLike(r.vip_code)) vipHourMap[h] = (vipHourMap[h] ?? 0) + 1;
  }
  return {
    im_hour_map: hourMap,
    im_hour_category_map: hourCategoryMap,
    im_hour_dept_map: hourDeptMap,
    im_hour_category_item_map: hourCategoryItemMap,
    im_hour_dept_item_map: hourDeptItemMap,
    im_vip_hour_map: vipHourMap,
  };
}

type ImHotelDimSourceRow = {
  department: string | null;
  incident_item_name: string | null;
  vip_code: string | null;
  created_date: string | null;
  incident_datetime: string | null;
  room_no: string | null;
  incident_status: string | null;
  investigation_updated_on_1: string | null;
  investigation_updated_on_2: string | null;
  incident_category: string | null;
  severity: string | null;
  source_of_complaint: string | null;
  booking_source: string | null;
  profile_type: string | null;
  guest_name: string | null;
  created_by: string | null;
};

const IM_HOTEL_DIM_KEYS = ['dept', 'vip', 'category', 'severity', 'source', 'booking', 'durbkt', 'hour', 'month', 'profile', 'status', 'guestname', 'createdby', 'all'] as const;
type ImHotelDimKey = typeof IM_HOTEL_DIM_KEYS[number];
const IM_HOTEL_DUR_BUCKETS = ['< 1h', '1-2h', '2-4h', '4-8h', '8-24h', '24h+'];
function imHotelDurBucketLabel(hours: number): string {
  if (hours < 1) return IM_HOTEL_DUR_BUCKETS[0];
  if (hours < 2) return IM_HOTEL_DUR_BUCKETS[1];
  if (hours < 4) return IM_HOTEL_DUR_BUCKETS[2];
  if (hours < 8) return IM_HOTEL_DUR_BUCKETS[3];
  if (hours < 24) return IM_HOTEL_DUR_BUCKETS[4];
  return IM_HOTEL_DUR_BUCKETS[5];
}

// im-01/02/03/05/06/07/08/09/10/11/12/14 (hotel scope): dept/vip/category/
// severity/source/booking/durbkt/hour/month slices of im_dim_item_stats_map,
// same { count, repeat, avgDurationHours, closed } shape as the corp version in
// the im-scoped block above, computed live from raw im_records for a single hotel.
function computeImHotelDimStats(rows: ImHotelDimSourceRow[], tz: string): Record<ImHotelDimKey, Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>>> {
  const counts: Record<ImHotelDimKey, Record<string, Record<string, number>>> = Object.fromEntries(IM_HOTEL_DIM_KEYS.map((k) => [k, {}])) as Record<ImHotelDimKey, Record<string, Record<string, number>>>;
  const roomCounts: Record<ImHotelDimKey, Record<string, Record<string, Record<string, number>>>> = Object.fromEntries(IM_HOTEL_DIM_KEYS.map((k) => [k, {}])) as Record<ImHotelDimKey, Record<string, Record<string, Record<string, number>>>>;
  const durations: Record<ImHotelDimKey, Record<string, Record<string, { sum: number; count: number }>>> = Object.fromEntries(IM_HOTEL_DIM_KEYS.map((k) => [k, {}])) as Record<ImHotelDimKey, Record<string, Record<string, { sum: number; count: number }>>>;
  const closedCounts: Record<ImHotelDimKey, Record<string, Record<string, number>>> = Object.fromEntries(IM_HOTEL_DIM_KEYS.map((k) => [k, {}])) as Record<ImHotelDimKey, Record<string, Record<string, number>>>;

  const add = (dim: ImHotelDimKey, dimValue: string, item: string, room: string, hours: number | null, isClosed: boolean) => {
    if (!counts[dim][dimValue]) counts[dim][dimValue] = {};
    counts[dim][dimValue][item] = (counts[dim][dimValue][item] ?? 0) + 1;
    if (!roomCounts[dim][dimValue]) roomCounts[dim][dimValue] = {};
    if (!roomCounts[dim][dimValue][item]) roomCounts[dim][dimValue][item] = {};
    roomCounts[dim][dimValue][item][room] = (roomCounts[dim][dimValue][item][room] ?? 0) + 1;
    if (hours !== null) {
      if (!durations[dim][dimValue]) durations[dim][dimValue] = {};
      if (!durations[dim][dimValue][item]) durations[dim][dimValue][item] = { sum: 0, count: 0 };
      durations[dim][dimValue][item].sum += hours;
      durations[dim][dimValue][item].count += 1;
    }
    if (isClosed) {
      if (!closedCounts[dim][dimValue]) closedCounts[dim][dimValue] = {};
      closedCounts[dim][dimValue][item] = (closedCounts[dim][dimValue][item] ?? 0) + 1;
    }
  };

  for (const r of rows) {
    const dept = r.department === null || r.department === undefined || String(r.department).trim() === '' ? 'Unknown Department' : String(r.department);
    const item = r.incident_item_name === null || r.incident_item_name === undefined || String(r.incident_item_name).trim() === '' ? 'Unknown Item' : String(r.incident_item_name);
    const room = r.room_no === null || r.room_no === undefined || String(r.room_no).trim() === '' ? 'Unknown Room' : String(r.room_no);
    const vipLabel = isVipLike(r.vip_code) ? 'VIP' : 'Non-VIP';
    const cat = r.incident_category === null || r.incident_category === undefined || String(r.incident_category).trim() === '' ? 'Uncategorized' : String(r.incident_category);
    const sevLabel = r.severity === null || r.severity === undefined || String(r.severity).trim() === '' ? 'Unknown' : String(r.severity);
    const srcLabel = r.source_of_complaint === null || r.source_of_complaint === undefined ? 'Unknown' : String(r.source_of_complaint);
    const bookingLabel = r.booking_source === null || r.booking_source === undefined ? 'Unknown' : String(r.booking_source);
    const statusLabel = r.incident_status === null || r.incident_status === undefined || String(r.incident_status).trim() === '' ? 'Unknown' : String(r.incident_status);
    const isClosed = statusLabel === 'Completed';
    const profileLabel = r.profile_type === null || r.profile_type === undefined || String(r.profile_type).trim() === '' ? 'Unknown' : String(r.profile_type);
    const guestLabel = r.guest_name === null || r.guest_name === undefined || String(r.guest_name).trim() === '' ? 'Unknown Guest' : String(r.guest_name);
    const createdByLabel = r.created_by === null || r.created_by === undefined || String(r.created_by).trim() === '' ? 'Unknown' : String(r.created_by);
    const rawDate = r.incident_datetime ?? r.created_date;
    const endRaw = r.investigation_updated_on_2 ?? r.investigation_updated_on_1;
    let hours: number | null = null;
    if (rawDate) {
      const start = new Date(rawDate).getTime();
      const h = endRaw ? (new Date(endRaw).getTime() - start) / 3_600_000 : 48;
      if (Number.isFinite(h) && h >= 0 && h < 3650 * 24) hours = h;
    }
    add('dept', dept, item, room, hours, isClosed);
    add('vip', vipLabel, item, room, hours, isClosed);
    add('category', cat, item, room, hours, isClosed);
    add('severity', sevLabel, item, room, hours, isClosed);
    add('source', srcLabel, item, room, hours, isClosed);
    add('booking', bookingLabel, item, room, hours, isClosed);
    add('profile', profileLabel, item, room, hours, isClosed);
    add('status', statusLabel, item, room, hours, isClosed);
    add('guestname', guestLabel, item, room, hours, isClosed);
    add('createdby', createdByLabel, item, room, hours, isClosed);
    add('all', 'ALL', item, room, hours, isClosed);
    if (hours !== null) add('durbkt', imHotelDurBucketLabel(hours), item, room, hours, isClosed);
    const hourRawDate = r.created_date ?? r.incident_datetime;
    if (hourRawDate) {
      const hd = new Date(hourRawDate);
      if (!Number.isNaN(hd.getTime())) add('hour', String(localHour(hd, tz)).padStart(2, '0'), item, room, hours, isClosed);
    }
    if (rawDate) {
      const dateStr = new Date(rawDate).toISOString();
      add('month', dateStr.slice(0, 7), item, room, hours, isClosed);
    }
  }

  const buildDim = (dim: ImHotelDimKey) => {
    const out: Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>> = {};
    for (const [dimValue, items] of Object.entries(counts[dim])) {
      out[dimValue] = {};
      for (const [item, count] of Object.entries(items)) {
        const roomCountsForItem = Object.values(roomCounts[dim][dimValue]?.[item] ?? {});
        const repeat = roomCountsForItem.reduce((s, c) => s + (c >= 2 ? c : 0), 0);
        const dur = durations[dim][dimValue]?.[item];
        out[dimValue][item] = {
          count,
          repeat,
          avgDurationHours: dur && dur.count > 0 ? dur.sum / dur.count : 0,
          closed: closedCounts[dim][dimValue]?.[item] ?? 0,
        };
      }
    }
    return out;
  };

  return Object.fromEntries(IM_HOTEL_DIM_KEYS.map((d) => [d, buildDim(d)])) as Record<ImHotelDimKey, Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>>>;
}

// im-13 (hotel scope): month → department → { count, repeat, avgDurationHours,
// closed }, one level shallower than im_dim_item_stats_map (no per-item
// breakdown — im-13's leaf is per-department, not per-item). "repeat" here is
// same-room recurrence within that month+department combo, the closest
// analogue of the room+item repeat definition used elsewhere at this
// department-only granularity.
function computeImMonthDeptStats(rows: ImHotelDimSourceRow[]): Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>> {
  const counts: Record<string, Record<string, number>> = {};
  const roomCounts: Record<string, Record<string, Record<string, number>>> = {};
  const durations: Record<string, Record<string, { sum: number; count: number }>> = {};
  const closedCounts: Record<string, Record<string, number>> = {};

  for (const r of rows) {
    const rawDate = r.incident_datetime ?? r.created_date;
    if (!rawDate) continue;
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) continue;
    const month = d.toISOString().slice(0, 7);
    const dept = r.department === null || r.department === undefined || String(r.department).trim() === '' ? 'Unknown Department' : String(r.department);
    const room = r.room_no === null || r.room_no === undefined || String(r.room_no).trim() === '' ? 'Unknown Room' : String(r.room_no);
    const statusLabel = r.incident_status === null || r.incident_status === undefined || String(r.incident_status).trim() === '' ? 'Unknown' : String(r.incident_status);
    const isClosed = statusLabel === 'Completed';
    const endRaw = r.investigation_updated_on_2 ?? r.investigation_updated_on_1;
    const h = endRaw ? (new Date(endRaw).getTime() - d.getTime()) / 3_600_000 : 48;
    const hours = Number.isFinite(h) && h >= 0 && h < 3650 * 24 ? h : null;

    if (!counts[month]) counts[month] = {};
    counts[month][dept] = (counts[month][dept] ?? 0) + 1;
    if (!roomCounts[month]) roomCounts[month] = {};
    if (!roomCounts[month][dept]) roomCounts[month][dept] = {};
    roomCounts[month][dept][room] = (roomCounts[month][dept][room] ?? 0) + 1;
    if (hours !== null) {
      if (!durations[month]) durations[month] = {};
      if (!durations[month][dept]) durations[month][dept] = { sum: 0, count: 0 };
      durations[month][dept].sum += hours;
      durations[month][dept].count += 1;
    }
    if (isClosed) {
      if (!closedCounts[month]) closedCounts[month] = {};
      closedCounts[month][dept] = (closedCounts[month][dept] ?? 0) + 1;
    }
  }

  const out: Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>> = {};
  for (const [month, depts] of Object.entries(counts)) {
    out[month] = {};
    for (const [dept, count] of Object.entries(depts)) {
      const roomCountsForDept = Object.values(roomCounts[month]?.[dept] ?? {});
      const repeat = roomCountsForDept.reduce((s, c) => s + (c >= 2 ? c : 0), 0);
      const dur = durations[month]?.[dept];
      out[month][dept] = {
        count,
        repeat,
        avgDurationHours: dur && dur.count > 0 ? dur.sum / dur.count : 0,
        closed: closedCounts[month]?.[dept] ?? 0,
      };
    }
  }
  return out;
}

function resolveDashboardTable(moduleCode?: string): 'im_dashboard_json' | 'jo_dashboard_json' | 'mo_dashboard_json' | 'co_dashboard_json' {
  const mod = String(moduleCode ?? '').toLowerCase();
  if (mod === 'jo') return 'jo_dashboard_json';
  if (mod === 'mo') return 'mo_dashboard_json';
  if (mod === 'co') return 'co_dashboard_json';
  return 'im_dashboard_json';
}

export async function fetchDashboard(hotelCode?: string, moduleCode?: string): Promise<DashboardJson | null> {
  noStore();
  try {
    const supabase = createAdminClient();
    type DashRow = { generated_json: DashboardJson };
    const table = resolveDashboardTable(moduleCode);
    const isJo = String(moduleCode ?? '').toLowerCase() === 'jo';
    const normalizedModule = String(moduleCode ?? '').toLowerCase();
    const expectedSchema = normalizedModule === 'jo'
      ? 'jo-v1'
      : normalizedModule === 'mo'
        ? 'mo-v1'
        : normalizedModule === 'co'
          ? 'co-v1'
          : 'im-v1';
    const isCo = normalizedModule === 'co';
    const base = supabase
      .from(table)
      .select('generated_json')
      .filter('generated_json->meta->>schema', 'eq', expectedSchema)
      .order('created_at', { ascending: false });
    let result = await (
      hotelCode
        ? base.filter('generated_json->meta->>hotel_code', 'eq', hotelCode)
        : base
    ).limit(1).maybeSingle() as unknown as SbResult<DashRow>;
    if (result.error) {
      console.error('[dashboard/fetchDashboard] primary query failed', {
        hotelCode,
        moduleCode,
        table,
        expectedSchema,
        error: result.error,
      });
    }
    if (!result.data && isJo && hotelCode) {
      // Some historical JO rows may lack parsed hotel_code due to file-hash dedupe.
      // Fallback to latest JO dashboard row so user still sees JO data.
      result = await base.limit(1).maybeSingle() as unknown as SbResult<DashRow>;
      if (result.error) {
        console.error('[dashboard/fetchDashboard] jo fallback query failed', {
          hotelCode,
          moduleCode,
          table,
          expectedSchema,
          error: result.error,
        });
      }
    }
    const data = result.data?.generated_json ?? null;
    if (!data) return null;
    const isMo = normalizedModule === 'mo';
    const recordTable = isJo ? 'jo_records' : isMo ? 'mo_records' : isCo ? 'co_records' : 'im_records';
    const hotelUpper = hotelCode ? hotelCode.toUpperCase() : (data.meta.hotel_code ?? '').toUpperCase();
    const timezone = await resolveLiveTimezone(supabase, recordTable, hotelUpper ? [hotelUpper] : [], data.meta.chain_code);

    if (isJo && hotelCode) {
      type JoLiveKpiRow = JoHourSourceRow & { quantity: number | string | null };
      const joResult = await supabase
        .from('jo_records')
        .select('quantity, job_status, service_item_category, service_item, delay_duration, escalation_group, vip_code, created_datetime, acknowledged_datetime, completed_datetime')
        .eq('hotel_code', hotelUpper) as unknown as SbResult<JoLiveKpiRow[]>;
      const joRows = joResult.data ?? [];
      const currentKpis = Array.isArray(data.kpis) ? [...data.kpis] : [];
      const totalQtyIdx = currentKpis.findIndex((k) => k.id === 'kpi_10');
      if (totalQtyIdx >= 0) {
        const totalQuantity = joRows.reduce((sum, row) => {
          const num = Number(row.quantity ?? 0);
          return sum + (Number.isFinite(num) ? num : 0);
        }, 0);
        currentKpis[totalQtyIdx] = {
          ...currentKpis[totalQtyIdx],
          value: Math.round(totalQuantity),
          unit: 'qty',
          fmt: 'integer',
        };
      }
      const hourMaps = joRows.length > 0 ? computeJoHourMaps(joRows, timezone) : {};
      return {
        ...data,
        meta: {
          ...data.meta,
          timezone,
        },
        kpis: currentKpis,
        summary: { ...data.summary, ...hourMaps },
      } as DashboardJson;
    }

    if (isMo && hotelCode) {
      let moResult = await supabase
        .from('mo_records')
        .select('created_datetime, resolution_minutes, defect, asset, job_order')
        .eq('hotel_code', hotelUpper)
        .eq('type', 'MO') as unknown as SbResult<MoHourSourceRow[]>;
      let moRows = moResult.data ?? [];
      if (moRows.length === 0) {
        moResult = await supabase
          .from('mo_records')
          .select('created_datetime, resolution_minutes, defect, asset, job_order')
          .eq('hotel_code', hotelUpper) as unknown as SbResult<MoHourSourceRow[]>;
        moRows = moResult.data ?? [];
      }
      const hourMaps = moRows.length > 0 ? computeMoHourMaps(moRows, timezone) : {};
      const moData = data as MoDashboardJson;
      const summaryByType = moData.summary_by_type ? { ...moData.summary_by_type } : undefined;
      if (summaryByType?.MO) {
        summaryByType.MO = { ...summaryByType.MO, ...hourMaps };
      }
      return {
        ...data,
        meta: {
          ...data.meta,
          timezone,
        },
        summary: { ...data.summary, ...hourMaps },
        ...(summaryByType ? { summary_by_type: summaryByType } : {}),
      } as MoDashboardJson;
    }

    if (isCo && hotelCode) {
      return {
        ...data,
        meta: {
          ...data.meta,
          timezone,
        },
      } as CoDashboardJson;
    }

    // IM (default)
    if (hotelCode) {
      const imResult = await supabase
        .from('im_records')
        .select('department, incident_category, incident_item_name, vip_code, created_date, incident_datetime, room_no, incident_status, investigation_updated_on_1, investigation_updated_on_2, severity, source_of_complaint, booking_source, profile_type, guest_name, created_by')
        .eq('hotel_code', hotelUpper) as unknown as SbResult<(ImHourSourceRow & ImHotelDimSourceRow)[]>;
      const imRows = imResult.data ?? [];
      const hourMaps = imRows.length > 0 ? computeImHourMaps(imRows, timezone) : {};
      const im_dim_item_stats_map = imRows.length > 0 ? computeImHotelDimStats(imRows, timezone) : undefined;
      const im_month_dept_stats_map = imRows.length > 0 ? computeImMonthDeptStats(imRows) : undefined;
      return {
        ...data,
        meta: {
          ...data.meta,
          timezone,
        },
        summary: { ...data.summary, ...hourMaps, ...(im_dim_item_stats_map ? { im_dim_item_stats_map } : {}), ...(im_month_dept_stats_map ? { im_month_dept_stats_map } : {}) },
      } as DashboardJson;
    }
    return {
      ...data,
      meta: {
        ...data.meta,
        timezone,
      },
    } as DashboardJson;
  } catch (error) {
    console.error('[dashboard/fetchDashboard] unexpected failure', { hotelCode, moduleCode, error });
    return null;
  }
}

export async function fetchCoRows(hotelCode?: string, chainCode?: string): Promise<CoRow[]> {
  noStore();
  try {
    const scopeHotel = String(hotelCode ?? '').trim().toUpperCase();
    const scopeChain = String(chainCode ?? '').trim().toUpperCase();
    if (!scopeHotel && !scopeChain) return [];
    const supabase = createAdminClient();
    const selectColumns = [
      'row_key',
      'row_number',
      'report_variant',
      'chain_code',
      'hotel_code',
      'created_date',
      'cleaning_order_no',
      'room_no',
      'room_type',
      'floor',
      'building',
      'status',
      'status_normalized',
      'priority',
      'priority_normalized',
      'stay_status',
      'attendant',
      'supervisor',
      'department',
      'task_type',
      'cleaning_type',
      'start_time',
      'end_time',
      'completed_time',
      'duration_minutes',
      'planned_duration_minutes',
      'actual_duration_minutes',
      'duration_variance_minutes',
      'ahead_behind_minutes',
      'inspection_status',
      'pass_fail',
      'reclean_flag',
      'remarks',
      'created_by',
      'updated_by',
      'updated_on',
      'cleaning_credit',
      'productivity_per_hour',
      'is_completed',
      'is_on_time',
      'additional_task_status',
    ].join(',');
    const normalizeRow = (row: Record<string, unknown>): CoRow => ({
      ...(row as Omit<CoRow, 'is_passed'>),
      report_variant: 'ACSR',
      chain_code: toStringOrNull(row.chain_code),
      hotel_code: toStringOrNull(row.hotel_code),
      is_passed: String(row.pass_fail ?? row.inspection_status ?? '').trim().toLowerCase() === 'pass',
      duration_minutes: toNumberOrNull(row.duration_minutes),
      planned_duration_minutes: toNumberOrNull(row.planned_duration_minutes),
      actual_duration_minutes: toNumberOrNull(row.actual_duration_minutes),
      duration_variance_minutes: toNumberOrNull(row.duration_variance_minutes),
      ahead_behind_minutes: toNumberOrNull(row.ahead_behind_minutes),
      cleaning_credit: toNumberOrNull(row.cleaning_credit),
      productivity_per_hour: toNumberOrNull(row.productivity_per_hour),
    });
    const runQuery = async (builder: ReturnType<typeof supabase.from>) => {
      const result = await builder.select(selectColumns).order('created_date', { ascending: true });
      return result as { data: Record<string, unknown>[] | null; error: { message: string } | null };
    };
    const scopedQuery = scopeHotel && scopeHotel !== 'CORP'
      ? supabase.from('co_records').eq('report_variant', 'ACSR').eq('hotel_code', scopeHotel)
      : scopeChain
        ? supabase.from('co_records').eq('report_variant', 'ACSR').eq('chain_code', scopeChain)
        : null;
    if (!scopedQuery) return [];
    const { data, error } = await runQuery(scopedQuery);
    if (error) {
      console.error('[dashboard/fetchCoRows] query failed', { hotelCode: scopeHotel, chainCode: scopeChain, error });
    }
    const primaryRows = (data ?? []).map(normalizeRow);
    if (primaryRows.length > 0) return primaryRows;
    const fallbackQuery = scopeHotel && scopeHotel !== 'CORP'
      ? supabase.from('co_records').eq('hotel_code', scopeHotel)
      : scopeChain
        ? supabase.from('co_records').eq('chain_code', scopeChain)
        : null;
    if (!fallbackQuery) return [];
    const { data: fallbackData, error: fallbackError } = await runQuery(fallbackQuery);
    if (fallbackError) {
      console.error('[dashboard/fetchCoRows] fallback query failed', { hotelCode: scopeHotel, chainCode: scopeChain, error: fallbackError });
      return [];
    }
    return (fallbackData ?? []).map(normalizeRow);
  } catch (error) {
    console.error('[dashboard/fetchCoRows] unexpected failure', { hotelCode, chainCode, error });
    return [];
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return text ? text : null;
}

export async function fetchChainEntries(chainCode: string, currentHotelCode: string, moduleCode?: string): Promise<ChainEntry[]> {
  noStore();
  try {
    const supabase = createAdminClient();
    type DashRow = { generated_json: DashboardJson; created_at: string };
    const table = resolveDashboardTable(moduleCode);
    const isCo = String(moduleCode ?? '').toLowerCase() === 'co';
    const { data: rows } = await supabase
      .from(table)
      .select('generated_json, created_at')
      .filter('generated_json->meta->>chain_code', 'eq', chainCode)
      .order('created_at', { ascending: false }) as unknown as SbResult<DashRow[]>;
    if (!rows || rows.length === 0) return [];
    const seen = new Map<string, ChainEntry>();
    for (const row of rows) {
      const json = row.generated_json;
      if (!json?.meta?.hotel_code) continue;
      if (seen.has(json.meta.hotel_code)) continue;
      if (!json.summary) continue;
      seen.set(json.meta.hotel_code, {
        hotel_code:   json.meta.hotel_code,
        hotel_name:   json.meta.hotel_name,
        country_code: json.meta.country_code ?? '',
        summary:      json.summary,
        raw_daily:    json.raw_daily ?? [],
        kpis_by_type: 'kpis_by_type' in json ? json.kpis_by_type : undefined,
        raw_daily_by_type: 'raw_daily_by_type' in json ? json.raw_daily_by_type : undefined,
        summary_by_type: 'summary_by_type' in json ? json.summary_by_type : undefined,
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.hotel_code.localeCompare(b.hotel_code));
  } catch (error) {
    console.error('[dashboard/fetchChainEntries] unexpected failure', { chainCode, currentHotelCode, moduleCode, error });
    return [];
  }
}

function mergeNumMap(target: Record<string, number>, source: Record<string, number> | undefined) {
  if (!source) return;
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}
function mergeNestedNumMap(
  target: Record<string, Record<string, number>>,
  source: Record<string, Record<string, number>> | undefined,
) {
  if (!source) return;
  for (const [k, inner] of Object.entries(source)) {
    if (!target[k]) target[k] = {};
    mergeNumMap(target[k], inner);
  }
}

function mergeRawDaily(allDaily: DailyBucket[][]): DailyBucket[] {
  const byDate = new Map<string, DailyBucket>();
  for (const daily of allDaily) {
    for (const d of daily) {
      if (!byDate.has(d.date)) {
        byDate.set(d.date, {
          date: d.date,
          total: 0,
          completed: 0,
          cancelled: 0,
          pending: 0,
          high_crit: 0,
          severity_sum: 0,
          vip: 0,
          by_severity: {},
          by_category: {},
          by_status: {},
        });
      }
      const t = byDate.get(d.date)!;
      t.total += d.total;
      t.completed += d.completed;
      t.cancelled += d.cancelled;
      t.pending += d.pending;
      t.high_crit += d.high_crit;
      t.severity_sum += d.severity_sum;
      t.vip += d.vip ?? 0;
      mergeNumMap(t.by_severity, d.by_severity);
      mergeNumMap(t.by_category, d.by_category);
      mergeNumMap(t.by_status, d.by_status);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function mergeSummary(summaries: HotelSummary[]): HotelSummary {
  const out: HotelSummary = {
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
  for (const s of summaries) {
    out.total += s.total;
    out.completed += s.completed;
    out.cancelled += s.cancelled;
    out.pending += s.pending;
    out.vip_total += s.vip_total;
    out.vip_completed += s.vip_completed;
    out.vip_cancelled += s.vip_cancelled;
    out.severity_sum += s.severity_sum;
    out.repeat_count += s.repeat_count;
    mergeNumMap(out.status_map, s.status_map);
    mergeNumMap(out.dept_map, s.dept_map);
    mergeNumMap(out.category_map, s.category_map);
    mergeNumMap(out.item_map, s.item_map);
    mergeNestedNumMap(out.dept_item_map, s.dept_item_map);
    mergeNestedNumMap(out.dept_category_map, s.dept_category_map);
    mergeNumMap(out.week_map, s.week_map);
    mergeNestedNumMap(out.week_source_map, s.week_source_map);
    mergeNestedNumMap(out.dept_source_map, s.dept_source_map);
    mergeNumMap(out.booking_map, s.booking_map);
    mergeNumMap(out.source_map, s.source_map);
    mergeNumMap(out.severity_map, s.severity_map);
  }
  return out;
}

function buildCorpKpis(template: ImDashboardJson, summary: HotelSummary): ImDashboardJson['kpis'] {
  const total = summary.total;
  const completed = summary.completed;
  const cancelled = summary.cancelled;
  const pending = summary.pending;
  const closureRate = total > 0 ? (completed / total) * 100 : 0;
  const backlogRate = total > 0 ? (pending / total) * 100 : 0;
  const timeoutRate = backlogRate;
  // For JO: kpi_05 (Escalation Rate) maps to cancelled/total; status_map['Escalated'] is never
  // populated in JO data so use cancelled directly — same formula as recomputeJoKpis.
  const escalationRate = total > 0 ? (cancelled / total) * 100 : 0;
  const reassignmentRate = total > 0 ? (summary.repeat_count / total) * 100 : 0;
  const avgSeverity = total > 0 ? (summary.severity_sum / total) : 0;
  const vipShare = total > 0 ? (summary.vip_total / total) * 100 : 0;

  return template.kpis.map((k) => {
    if (k.id === 'kpi_01') return { ...k, value: total };
    if (k.id === 'kpi_02') return { ...k, value: Number(closureRate.toFixed(1)) };
    if (k.id === 'kpi_03') return { ...k, value: Number(backlogRate.toFixed(1)) };
    if (k.id === 'kpi_04') return { ...k, value: Number(timeoutRate.toFixed(1)) };   // % not raw count
    if (k.id === 'kpi_05') return { ...k, value: Number(escalationRate.toFixed(1)) }; // % not raw count
    if (k.id === 'kpi_06') return { ...k, value: Number(vipShare.toFixed(1)) };
    if (k.id === 'kpi_07') return { ...k, value: k.value === null ? null : k.value };
    if (k.id === 'kpi_08') return { ...k, value: Number(reassignmentRate.toFixed(2)) };
    if (k.id === 'kpi_09') return { ...k, value: k.value === null ? null : k.value };
    if (k.id === 'kpi_10') return { ...k, value: Number(avgSeverity.toFixed(2)) };
    // JO-safe fallbacks
    if ((k.label ?? '').toLowerCase().includes('timeout')) return { ...k, value: Number(timeoutRate.toFixed(1)) };
    if ((k.label ?? '').toLowerCase().includes('escalation')) return { ...k, value: Number(escalationRate.toFixed(1)) };
    if ((k.label ?? '').toLowerCase().includes('reassignment')) return { ...k, value: Number(reassignmentRate.toFixed(1)) };
    return k;
  });
}

function sumChainKpiValue(entries: ChainEntry[], id: string): number {
  return entries.reduce((sum, entry) => {
    const raw = entry.kpis?.find((k) => k.id === id)?.value;
    const num = Number(raw ?? 0);
    return sum + (Number.isFinite(num) ? num : 0);
  }, 0);
}

/**
 * Corp JO KPIs — aggregate each hotel's already-correct JO KPI values with the
 * proper weighting. Rate KPIs of the form X/total are weighted by total; SLA
 * Compliance and resolution time (defined over completed jobs) are weighted by
 * completed. This avoids the IM-semantics bug in buildCorpKpis, which filled
 * JO's kpi_03 (SLA Compliance) slot with IM's Open Backlog Rate (pending/total).
 *
 * The template is itself a JO dashboard, so labels/units/benchmarks are already
 * JO-correct — only the numeric values are overridden.
 */
function buildCorpJoKpis(template: ImDashboardJson, entries: ChainEntry[]): ImDashboardJson['kpis'] {
  const totalSum = entries.reduce((s, e) => s + (e.summary.total ?? 0), 0);
  const kpiVal = (e: ChainEntry, id: string): number | null => {
    const v = e.kpis?.find((k) => k.id === id)?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  // Weighted average of per-hotel KPI values; weight selector returns the denominator.
  const wAvg = (id: string, weight: (e: ChainEntry) => number): number => {
    let num = 0;
    let den = 0;
    for (const e of entries) {
      const v = kpiVal(e, id);
      const w = weight(e);
      if (v !== null && w > 0) { num += v * w; den += w; }
    }
    return den > 0 ? num / den : 0;
  };
  const byTotal = (e: ChainEntry) => e.summary.total ?? 0;
  const byCompleted = (e: ChainEntry) => e.summary.completed ?? 0;

  return template.kpis.map((k) => {
    switch (k.id) {
      case 'kpi_01': return { ...k, value: totalSum };                                        // Total Job Orders
      case 'kpi_02': return { ...k, value: Number(wAvg('kpi_02', byTotal).toFixed(1)) };       // Completion Rate
      case 'kpi_03': return { ...k, value: Number(wAvg('kpi_03', byCompleted).toFixed(1)) };   // SLA Compliance
      case 'kpi_04': return { ...k, value: Number(wAvg('kpi_04', byTotal).toFixed(1)) };       // Timeout Rate
      case 'kpi_05': return { ...k, value: Number(wAvg('kpi_05', byTotal).toFixed(1)) };       // Escalation Rate
      case 'kpi_06': return { ...k, value: Number(wAvg('kpi_06', byTotal).toFixed(1)) };       // Reassignment Rate
      case 'kpi_07': return { ...k, value: Number(wAvg('kpi_07', byTotal).toFixed(2)) };       // Avg Response (min)
      case 'kpi_08': return { ...k, value: Number(wAvg('kpi_08', byTotal).toFixed(2)) };       // P90 Response (approx)
      case 'kpi_09': return { ...k, value: Number(wAvg('kpi_09', byCompleted).toFixed(2)) };   // Avg Resolution (min)
      case 'kpi_10': return { ...k, value: Math.round(sumChainKpiValue(entries, 'kpi_10')), unit: 'qty', fmt: 'integer' };
      default: return k;
    }
  });
}

export async function fetchCorpDashboard(chainCode?: string, moduleCode?: string): Promise<{ data: DashboardJson | null; chainEntries: ChainEntry[] }> {
  noStore();
  if (!chainCode) return { data: null, chainEntries: [] };
  try {
    const supabase = createAdminClient();
    const normalizedModule = String(moduleCode ?? '').toLowerCase();
    const isMo = normalizedModule === 'mo';
    const isCo = normalizedModule === 'co';
    const isJo = normalizedModule === 'jo';
    const recordTable = isJo ? 'jo_records' : isMo ? 'mo_records' : isCo ? 'co_records' : 'im_records';
    type DashRow = { generated_json: DashboardJson; created_at: string };
    const table = resolveDashboardTable(moduleCode);
    const rowsResult = await supabase
      .from(table)
      .select('generated_json, created_at')
      .filter('generated_json->meta->>chain_code', 'eq', chainCode.toUpperCase())
      .order('created_at', { ascending: false }) as unknown as SbResult<DashRow[]>;
    if (rowsResult.error) {
      console.error('[dashboard/fetchCorpDashboard] query failed', {
        chainCode,
        moduleCode,
        table,
        error: rowsResult.error,
      });
    }

    const rows = rowsResult.data ?? [];
    if (rows.length === 0) return { data: null, chainEntries: [] };

    const latestByHotel = new Map<string, DashboardJson>();
    for (const row of rows) {
      const json = row.generated_json;
      const hotelCode = (json?.meta?.hotel_code ?? '').trim().toUpperCase();
      if (!hotelCode || latestByHotel.has(hotelCode)) continue;
      if (!json.summary) continue;
      latestByHotel.set(hotelCode, json);
    }

    const dashboards = Array.from(latestByHotel.values());
    if (dashboards.length < 2) return { data: null, chainEntries: [] };

    const template = dashboards[0];
    const chainEntries: ChainEntry[] = dashboards.map((d) => {
      const maintenance = (d.meta.schema === 'mo-v1' || d.meta.schema === 'co-v1') ? d as MoDashboardJson | CoDashboardJson : null;
      return {
        hotel_code: d.meta.hotel_code,
        hotel_name: d.meta.hotel_name,
        country_code: d.meta.country_code ?? '',
        kpis: d.kpis ?? [],
        summary: d.summary,
        raw_daily: d.raw_daily ?? [],
        kpis_by_type: maintenance?.kpis_by_type,
        raw_daily_by_type: maintenance?.raw_daily_by_type,
        summary_by_type: maintenance?.summary_by_type,
      };
    }).sort((a, b) => a.hotel_code.localeCompare(b.hotel_code));

    // Resolve the org timezone live, at request time, matching the chain-code lookup
    // that Configuration → System Settings and the hotel-level live IM route both use,
    // so a timezone change takes effect immediately across JO/MO/CO/IM without a CSV
    // re-upload — and so corp views agree with hotel-level views for the same hotel.
    const allHotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
    const orgTimezone = await resolveLiveTimezone(supabase, recordTable, allHotelCodes, chainCode);

    // Build accurate department->source_of_complaint and department->item maps
    // from live IM records so corp charts remain correct even for legacy summaries.
    if (!isMo && !isCo && !isJo) {
      type SrcRow = {
        hotel_code: string | null;
        department: string | null;
        incident_category: string | null;
        source_of_complaint: string | null;
        incident_item_name: string | null;
        booking_source: string | null;
        created_date: string | null;
        incident_datetime: string | null;
        investigation_updated_on_1: string | null;
        investigation_updated_on_2: string | null;
        organization_id: string | null;
        room_no: string | null;
        vip_code: string | null;
        severity: string | null;
        profile_type: string | null;
        incident_status: string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const mapByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const deptCategoryByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const itemByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const categoryItemByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const hourByHotel: Record<string, Record<string, number>> = {};
        const hourCategoryByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const hourDeptByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const hourCategoryItemByHotel: Record<string, Record<string, Record<string, Record<string, number>>>> = {};
        const hourDeptItemByHotel: Record<string, Record<string, Record<string, Record<string, number>>>> = {};
        const itemDurationByHotel: Record<string, Record<string, { sum: number; count: number }>> = {};
        const bookingByHotel: Record<string, Record<string, number>> = {};
        // cim-15: category → item → room_no → count, and category → item → {sum,count}
        // duration, both keyed by hotel — used to derive per-item repeat rate (same
        // room+category+item combo appearing 2+ times, matching the repeat_count KPI's
        // definition) and average resolution duration.
        const catItemRoomByHotel: Record<string, Record<string, Record<string, Record<string, number>>>> = {};
        const catItemDurationByHotel: Record<string, Record<string, Record<string, { sum: number; count: number }>>> = {};

        // cim-16..28: generic dimension → dimension-value → item accumulator, shared
        // across all 11 dimension charts (dept/vip/source/booking/severity/hour/durbkt/
        // profile/status/repeatbkt/month/day). counts/rooms/durations mirror the
        // cat-item-* structures above, just keyed by an extra "dim" level so one loop
        // can feed every chart instead of duplicating the row scan per dimension.
        const DIM_KEYS = ['dept', 'vip', 'source', 'booking', 'severity', 'hour', 'durbkt', 'profile', 'status', 'repeatbkt', 'month', 'day', 'category'] as const;
        type DimKey = typeof DIM_KEYS[number];
        const dimCounts: Record<DimKey, Record<string, Record<string, Record<string, number>>>> = Object.fromEntries(DIM_KEYS.map((k) => [k, {}])) as Record<DimKey, Record<string, Record<string, Record<string, number>>>>;
        const dimRooms: Record<DimKey, Record<string, Record<string, Record<string, Record<string, number>>>>> = Object.fromEntries(DIM_KEYS.map((k) => [k, {}])) as Record<DimKey, Record<string, Record<string, Record<string, Record<string, number>>>>>;
        const dimDurations: Record<DimKey, Record<string, Record<string, Record<string, { sum: number; count: number }>>>> = Object.fromEntries(DIM_KEYS.map((k) => [k, {}])) as Record<DimKey, Record<string, Record<string, Record<string, { sum: number; count: number }>>>>;
        // cim-01/02: closed (status === 'Completed') count per dim/item, same shape as dimDurations.
        const dimClosed: Record<DimKey, Record<string, Record<string, Record<string, number>>>> = Object.fromEntries(DIM_KEYS.map((k) => [k, {}])) as Record<DimKey, Record<string, Record<string, Record<string, number>>>>;
        const DUR_BUCKETS_IM = ['< 1h', '1-2h', '2-4h', '4-8h', '8-24h', '24h+'];
        const durBucketLabel = (hours: number): string => {
          if (hours < 1) return DUR_BUCKETS_IM[0];
          if (hours < 2) return DUR_BUCKETS_IM[1];
          if (hours < 4) return DUR_BUCKETS_IM[2];
          if (hours < 8) return DUR_BUCKETS_IM[3];
          if (hours < 24) return DUR_BUCKETS_IM[4];
          return DUR_BUCKETS_IM[5];
        };
        const repeatCountBucketLabel = (n: number): string => {
          if (n <= 1) return '1';
          if (n <= 3) return '2-3';
          if (n <= 6) return '4-6';
          if (n <= 10) return '7-10';
          return '11+';
        };
        const addDim = (dim: DimKey, hotel: string, dimValue: string, item: string, room: string, hours: number | null, isClosed: boolean = false) => {
          const counts = dimCounts[dim];
          if (!counts[hotel]) counts[hotel] = {};
          if (!counts[hotel][dimValue]) counts[hotel][dimValue] = {};
          counts[hotel][dimValue][item] = (counts[hotel][dimValue][item] ?? 0) + 1;
          const rooms = dimRooms[dim];
          if (!rooms[hotel]) rooms[hotel] = {};
          if (!rooms[hotel][dimValue]) rooms[hotel][dimValue] = {};
          if (!rooms[hotel][dimValue][item]) rooms[hotel][dimValue][item] = {};
          rooms[hotel][dimValue][item][room] = (rooms[hotel][dimValue][item][room] ?? 0) + 1;
          if (hours !== null) {
            const durations = dimDurations[dim];
            if (!durations[hotel]) durations[hotel] = {};
            if (!durations[hotel][dimValue]) durations[hotel][dimValue] = {};
            if (!durations[hotel][dimValue][item]) durations[hotel][dimValue][item] = { sum: 0, count: 0 };
            durations[hotel][dimValue][item].sum += hours;
            durations[hotel][dimValue][item].count += 1;
          }
          if (isClosed) {
            const closed = dimClosed[dim];
            if (!closed[hotel]) closed[hotel] = {};
            if (!closed[hotel][dimValue]) closed[hotel][dimValue] = {};
            closed[hotel][dimValue][item] = (closed[hotel][dimValue][item] ?? 0) + 1;
          }
        };

        const batch = await supabase
          .from('im_records')
          .select('hotel_code, department, incident_category, source_of_complaint, incident_item_name, booking_source, created_date, incident_datetime, investigation_updated_on_1, investigation_updated_on_2, organization_id, room_no, vip_code, severity, profile_type, incident_status')
          .in('hotel_code', hotelCodes) as unknown as SbResult<SrcRow[]>;
        const rows = batch.data ?? [];
        // orgTimezone is resolved live above (shared across all modules in this request).
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const deptRaw = r.department;
          const dept = deptRaw === null || deptRaw === undefined || String(deptRaw).trim() === '' ? 'Unknown Department' : String(deptRaw);
          const catRaw = r.incident_category;
          const cat = catRaw === null || catRaw === undefined || String(catRaw).trim() === '' ? 'Uncategorized' : String(catRaw);
          const src = r.source_of_complaint === null ? 'Unknown' : String(r.source_of_complaint);
          const itemRaw = r.incident_item_name;
          const item = itemRaw === null || itemRaw === undefined || String(itemRaw).trim() === '' ? 'Unknown Item' : String(itemRaw);
          if (!mapByHotel[hotel]) mapByHotel[hotel] = {};
          if (!mapByHotel[hotel][dept]) mapByHotel[hotel][dept] = {};
          mapByHotel[hotel][dept][src] = (mapByHotel[hotel][dept][src] ?? 0) + 1;
          if (!deptCategoryByHotel[hotel]) deptCategoryByHotel[hotel] = {};
          if (!deptCategoryByHotel[hotel][dept]) deptCategoryByHotel[hotel][dept] = {};
          deptCategoryByHotel[hotel][dept][cat] = (deptCategoryByHotel[hotel][dept][cat] ?? 0) + 1;
          if (!itemByHotel[hotel]) itemByHotel[hotel] = {};
          if (!itemByHotel[hotel][dept]) itemByHotel[hotel][dept] = {};
          itemByHotel[hotel][dept][item] = (itemByHotel[hotel][dept][item] ?? 0) + 1;
          if (!categoryItemByHotel[hotel]) categoryItemByHotel[hotel] = {};
          if (!categoryItemByHotel[hotel][cat]) categoryItemByHotel[hotel][cat] = {};
          categoryItemByHotel[hotel][cat][item] = (categoryItemByHotel[hotel][cat][item] ?? 0) + 1;
          const roomRaw = r.room_no;
          const room = roomRaw === null || roomRaw === undefined || String(roomRaw).trim() === '' ? 'Unknown Room' : String(roomRaw);
          if (!catItemRoomByHotel[hotel]) catItemRoomByHotel[hotel] = {};
          if (!catItemRoomByHotel[hotel][cat]) catItemRoomByHotel[hotel][cat] = {};
          if (!catItemRoomByHotel[hotel][cat][item]) catItemRoomByHotel[hotel][cat][item] = {};
          catItemRoomByHotel[hotel][cat][item][room] = (catItemRoomByHotel[hotel][cat][item][room] ?? 0) + 1;
          const rawDate = r.incident_datetime ?? r.created_date;
          const hourRawDate = r.created_date ?? r.incident_datetime;
          if (hourRawDate) {
            const d = new Date(hourRawDate);
            if (!Number.isNaN(d.getTime())) {
              // created_date/incident_datetime are true UTC (post-ingestion-fix) —
              // convert to the org's configured timezone for the local hour-of-day.
              const hour = String(localHour(d, orgTimezone));
              if (!hourByHotel[hotel]) hourByHotel[hotel] = {};
              hourByHotel[hotel][hour] = (hourByHotel[hotel][hour] ?? 0) + 1;
              if (!hourCategoryByHotel[hotel]) hourCategoryByHotel[hotel] = {};
              if (!hourCategoryByHotel[hotel][hour]) hourCategoryByHotel[hotel][hour] = {};
              hourCategoryByHotel[hotel][hour][cat] = (hourCategoryByHotel[hotel][hour][cat] ?? 0) + 1;
              if (!hourDeptByHotel[hotel]) hourDeptByHotel[hotel] = {};
              if (!hourDeptByHotel[hotel][hour]) hourDeptByHotel[hotel][hour] = {};
              hourDeptByHotel[hotel][hour][dept] = (hourDeptByHotel[hotel][hour][dept] ?? 0) + 1;
              if (!hourCategoryItemByHotel[hotel]) hourCategoryItemByHotel[hotel] = {};
              if (!hourCategoryItemByHotel[hotel][hour]) hourCategoryItemByHotel[hotel][hour] = {};
              if (!hourCategoryItemByHotel[hotel][hour][cat]) hourCategoryItemByHotel[hotel][hour][cat] = {};
              hourCategoryItemByHotel[hotel][hour][cat][item] = (hourCategoryItemByHotel[hotel][hour][cat][item] ?? 0) + 1;
              if (!hourDeptItemByHotel[hotel]) hourDeptItemByHotel[hotel] = {};
              if (!hourDeptItemByHotel[hotel][hour]) hourDeptItemByHotel[hotel][hour] = {};
              if (!hourDeptItemByHotel[hotel][hour][dept]) hourDeptItemByHotel[hotel][hour][dept] = {};
              hourDeptItemByHotel[hotel][hour][dept][item] = (hourDeptItemByHotel[hotel][hour][dept][item] ?? 0) + 1;
            }
          }
          // Close time: investigation_updated_on_2, falling back to
          // investigation_updated_on_1 when cycle 2 was never filled in. If
          // neither is present, assume a fixed 48h duration rather than
          // dropping the record — matches app/api/uploads/finalize/route.ts.
          const endRaw = r.investigation_updated_on_2 ?? r.investigation_updated_on_1;
          let hours: number | null = null;
          if (rawDate) {
            const start = new Date(rawDate).getTime();
            const h = endRaw ? (new Date(endRaw).getTime() - start) / 3_600_000 : 48;
            if (Number.isFinite(h) && h >= 0 && h < 3650 * 24) {
              hours = h;
              if (!itemDurationByHotel[hotel]) itemDurationByHotel[hotel] = {};
              if (!itemDurationByHotel[hotel][item]) itemDurationByHotel[hotel][item] = { sum: 0, count: 0 };
              itemDurationByHotel[hotel][item].sum += hours;
              itemDurationByHotel[hotel][item].count += 1;
              if (!catItemDurationByHotel[hotel]) catItemDurationByHotel[hotel] = {};
              if (!catItemDurationByHotel[hotel][cat]) catItemDurationByHotel[hotel][cat] = {};
              if (!catItemDurationByHotel[hotel][cat][item]) catItemDurationByHotel[hotel][cat][item] = { sum: 0, count: 0 };
              catItemDurationByHotel[hotel][cat][item].sum += hours;
              catItemDurationByHotel[hotel][cat][item].count += 1;
            }
          }
          const bookingRaw = r.booking_source;
          const booking = bookingRaw === null || bookingRaw === undefined ? 'Unknown' : String(bookingRaw);
          if (!bookingByHotel[hotel]) bookingByHotel[hotel] = {};
          bookingByHotel[hotel][booking] = (bookingByHotel[hotel][booking] ?? 0) + 1;

          // cim-16..28: feed the generic per-dimension accumulators from this same row.
          const vipLabel = isVipLike(r.vip_code) ? 'VIP' : 'Non-VIP';
          const severityLabel = r.severity === null || r.severity === undefined || String(r.severity).trim() === '' ? 'Unknown' : String(r.severity);
          const profileLabel = r.profile_type === null || r.profile_type === undefined || String(r.profile_type).trim() === '' ? 'Unknown' : String(r.profile_type);
          const statusLabel = r.incident_status === null || r.incident_status === undefined || String(r.incident_status).trim() === '' ? 'Unknown' : String(r.incident_status);
          const isClosed = statusLabel === 'Completed';
          addDim('dept', hotel, dept, item, room, hours, isClosed);
          addDim('vip', hotel, vipLabel, item, room, hours, isClosed);
          addDim('source', hotel, src, item, room, hours, isClosed);
          addDim('category', hotel, cat, item, room, hours, isClosed);
          addDim('booking', hotel, booking, item, room, hours, isClosed);
          addDim('severity', hotel, severityLabel, item, room, hours);
          addDim('profile', hotel, profileLabel, item, room, hours);
          addDim('status', hotel, statusLabel, item, room, hours);
          if (hourRawDate) {
            const d = new Date(hourRawDate);
            if (!Number.isNaN(d.getTime())) addDim('hour', hotel, String(localHour(d, orgTimezone)).padStart(2, '0'), item, room, hours, isClosed);
          }
          if (hours !== null) addDim('durbkt', hotel, durBucketLabel(hours), item, room, hours, isClosed);
          if (rawDate) {
            // rawDate may arrive as a genuine Date object (not a string) depending
            // on the driver, so String(rawDate) would yield Date.toString() (e.g.
            // "Fri Jan 02 2026...") instead of an ISO date — always route through
            // Date + toISOString() first to guarantee a 'YYYY-MM-DD...' string.
            const dateStr = new Date(rawDate).toISOString();
            addDim('month', hotel, dateStr.slice(0, 7), item, room, hours, isClosed);
            addDim('day', hotel, dateStr.slice(0, 10), item, room, hours, isClosed);
          }
        }

        // cim-26: repeat-count bucket needs each row's own room+category+item combo
        // TOTAL, which is only known after catItemRoomByHotel is fully built above —
        // second pass over the same rows.
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const catRaw = r.incident_category;
          const cat = catRaw === null || catRaw === undefined || String(catRaw).trim() === '' ? 'Uncategorized' : String(catRaw);
          const itemRaw = r.incident_item_name;
          const item = itemRaw === null || itemRaw === undefined || String(itemRaw).trim() === '' ? 'Unknown Item' : String(itemRaw);
          const roomRaw = r.room_no;
          const room = roomRaw === null || roomRaw === undefined || String(roomRaw).trim() === '' ? 'Unknown Room' : String(roomRaw);
          const comboTotal = catItemRoomByHotel[hotel]?.[cat]?.[item]?.[room] ?? 0;
          const rawDate = r.incident_datetime ?? r.created_date;
          const endRaw = r.investigation_updated_on_2 ?? r.investigation_updated_on_1;
          let hours: number | null = null;
          if (rawDate) {
            const start = new Date(rawDate).getTime();
            const h = endRaw ? (new Date(endRaw).getTime() - start) / 3_600_000 : 48;
            if (Number.isFinite(h) && h >= 0 && h < 3650 * 24) hours = h;
          }
          const repeatbktStatusLabel = r.incident_status === null || r.incident_status === undefined || String(r.incident_status).trim() === '' ? 'Unknown' : String(r.incident_status);
          addDim('repeatbkt', hotel, repeatCountBucketLabel(comboTotal), item, room, hours, repeatbktStatusLabel === 'Completed');
        }

        for (const entry of chainEntries) {
          // Non-timezone-dependent maps: always update from live records.
          entry.summary.dept_source_map = mapByHotel[entry.hotel_code] ?? entry.summary.dept_source_map ?? {};
          entry.summary.dept_category_map = deptCategoryByHotel[entry.hotel_code] ?? entry.summary.dept_category_map ?? {};
          entry.summary.dept_item_map = itemByHotel[entry.hotel_code] ?? entry.summary.dept_item_map ?? {};
          entry.summary.category_item_map = categoryItemByHotel[entry.hotel_code] ?? entry.summary.category_item_map ?? {};
          const durations = itemDurationByHotel[entry.hotel_code] ?? {};
          entry.summary.im_item_duration_map = Object.fromEntries(
            Object.entries(durations).map(([item, v]) => [item, v.count > 0 ? v.sum / v.count : 0]),
          );
          entry.summary.booking_map = bookingByHotel[entry.hotel_code] ?? entry.summary.booking_map ?? {};
          // Timezone-dependent hour maps: recomputed live above using the current org timezone.
          entry.summary.im_hour_map = hourByHotel[entry.hotel_code] ?? entry.summary.im_hour_map ?? {};
          entry.summary.im_hour_category_map = hourCategoryByHotel[entry.hotel_code] ?? entry.summary.im_hour_category_map ?? {};
          entry.summary.im_hour_dept_map = hourDeptByHotel[entry.hotel_code] ?? entry.summary.im_hour_dept_map ?? {};
          entry.summary.im_hour_category_item_map = hourCategoryItemByHotel[entry.hotel_code] ?? entry.summary.im_hour_category_item_map ?? {};
          entry.summary.im_hour_dept_item_map = hourDeptItemByHotel[entry.hotel_code] ?? entry.summary.im_hour_dept_item_map ?? {};
          // cim-15: category → item → { count, repeat, avgDurationHours }. Repeat
          // uses the same room+category+item combo definition as the repeat_count
          // KPI: a room's incidents all count as "repeat" once that combo hits 2+.
          const catItemCounts = categoryItemByHotel[entry.hotel_code] ?? {};
          const catItemRooms = catItemRoomByHotel[entry.hotel_code] ?? {};
          const catItemDur = catItemDurationByHotel[entry.hotel_code] ?? {};
          const statsMap: Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number }>> = {};
          for (const [cat, items] of Object.entries(catItemCounts)) {
            statsMap[cat] = {};
            for (const [item, count] of Object.entries(items)) {
              const roomCounts = Object.values(catItemRooms[cat]?.[item] ?? {});
              const repeat = roomCounts.reduce((s, c) => s + (c >= 2 ? c : 0), 0);
              const dur = catItemDur[cat]?.[item];
              statsMap[cat][item] = {
                count,
                repeat,
                avgDurationHours: dur && dur.count > 0 ? dur.sum / dur.count : 0,
              };
            }
          }
          entry.summary.im_cat_item_stats_map = statsMap;

          // cim-16..28: same { count, repeat, avgDurationHours } shape as
          // im_cat_item_stats_map above, one slice per generic dimension key.
          // cim-01/02 additionally read `closed` (status === 'Completed' count) for
          // their leaf's Closing Rate (%) series — populated for every dim, though
          // only dept/vip currently surface it in a chart.
          const dimStatsMap: Record<string, Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>>> = {};
          for (const dim of DIM_KEYS) {
            const counts = dimCounts[dim][entry.hotel_code] ?? {};
            const rooms = dimRooms[dim][entry.hotel_code] ?? {};
            const durations = dimDurations[dim][entry.hotel_code] ?? {};
            const closedCounts = dimClosed[dim][entry.hotel_code] ?? {};
            const dimMap: Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>> = {};
            for (const [dimValue, items] of Object.entries(counts)) {
              dimMap[dimValue] = {};
              for (const [item, count] of Object.entries(items)) {
                const roomCounts = Object.values(rooms[dimValue]?.[item] ?? {});
                const repeat = roomCounts.reduce((s, c) => s + (c >= 2 ? c : 0), 0);
                const dur = durations[dimValue]?.[item];
                dimMap[dimValue][item] = {
                  count,
                  repeat,
                  avgDurationHours: dur && dur.count > 0 ? dur.sum / dur.count : 0,
                  closed: closedCounts[dimValue]?.[item] ?? 0,
                };
              }
            }
            dimStatsMap[dim] = dimMap;
          }
          entry.summary.im_dim_item_stats_map = dimStatsMap;
        }
      }
    } else if (String(moduleCode ?? '').toLowerCase() === 'jo') {
      type QtyRow = {
        hotel_code: string | null;
        quantity: number | string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const qtyByHotel: Record<string, number> = {};
        const batch = await supabase
          .from('jo_records')
          .select('hotel_code, quantity')
          .in('hotel_code', hotelCodes) as unknown as SbResult<QtyRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const qty = Number(r.quantity ?? 0);
          qtyByHotel[hotel] = (qtyByHotel[hotel] ?? 0) + (Number.isFinite(qty) ? qty : 0);
        }
        for (const entry of chainEntries) {
          const totalQty = Math.round(qtyByHotel[entry.hotel_code] ?? 0);
          const kpis = Array.isArray(entry.kpis) ? [...entry.kpis] : [];
          const idx = kpis.findIndex((k) => k.id === 'kpi_10');
          if (idx >= 0) {
            kpis[idx] = { ...kpis[idx], value: totalQty, unit: 'qty', fmt: 'integer' };
          }
          entry.kpis = kpis;
        }
      }

      type JoLiveRow = {
        hotel_code: string | null;
        assigned_to_department: string | null;
        created_by_department: string | null;
        completed_by_department: string | null;
        location: string | null;
      };
      if (hotelCodes.length > 0) {
        const assignedByHotel: Record<string, Record<string, number>> = {};
        const createdByHotel: Record<string, Record<string, number>> = {};
        const completedByHotel: Record<string, Record<string, number>> = {};
        const locationByHotel: Record<string, Record<string, number>> = {};
        const batch = await supabase
          .from('jo_records')
          .select('hotel_code, assigned_to_department, created_by_department, completed_by_department, location')
          .in('hotel_code', hotelCodes) as unknown as SbResult<JoLiveRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const assigned = r.assigned_to_department === null || String(r.assigned_to_department).trim() === '' ? 'Unknown Assigned Dept' : String(r.assigned_to_department);
          const createdBy = r.created_by_department === null || String(r.created_by_department).trim() === '' ? 'Unknown Source Dept' : String(r.created_by_department);
          const completedBy = r.completed_by_department === null || String(r.completed_by_department).trim() === '' ? 'Unknown Completed Dept' : String(r.completed_by_department);
          const location = r.location === null || String(r.location).trim() === '' ? 'Unknown Location' : String(r.location);
          if (!assignedByHotel[hotel]) assignedByHotel[hotel] = {};
          if (!createdByHotel[hotel]) createdByHotel[hotel] = {};
          if (!completedByHotel[hotel]) completedByHotel[hotel] = {};
          if (!locationByHotel[hotel]) locationByHotel[hotel] = {};
          assignedByHotel[hotel][assigned] = (assignedByHotel[hotel][assigned] ?? 0) + 1;
          createdByHotel[hotel][createdBy] = (createdByHotel[hotel][createdBy] ?? 0) + 1;
          completedByHotel[hotel][completedBy] = (completedByHotel[hotel][completedBy] ?? 0) + 1;
          locationByHotel[hotel][location] = (locationByHotel[hotel][location] ?? 0) + 1;
        }

        for (const entry of chainEntries) {
          entry.summary.assigned_dept_map = assignedByHotel[entry.hotel_code] ?? entry.summary.assigned_dept_map ?? {};
          entry.summary.created_by_dept_map = createdByHotel[entry.hotel_code] ?? entry.summary.created_by_dept_map ?? {};
          entry.summary.completed_by_dept_map = completedByHotel[entry.hotel_code] ?? entry.summary.completed_by_dept_map ?? {};
          entry.summary.location_map = locationByHotel[entry.hotel_code] ?? entry.summary.location_map ?? {};
        }
      }
      // jo_status_dur_bkt_map: status → durBucket → completed count (live from jo_records)
      if (hotelCodes.length > 0) {
        type DurRow = { hotel_code: string | null; job_status: string | null; actual_duration: number | null };
        const JO_DUR_ORDER = ['< 15 min', '15–30 min', '30–60 min', '1–2 h', '2–4 h', '4–8 h', '8+ h'] as const;
        const durBatch = await supabase
          .from('jo_records')
          .select('hotel_code, job_status, actual_duration')
          .in('hotel_code', hotelCodes) as unknown as SbResult<DurRow[]>;
        const statusDurByHotel: Record<string, Record<string, Record<string, number>>> = {};
        for (const r of durBatch.data ?? []) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          const status = (r.job_status ?? '').trim() || 'Unknown';
          const dur = Number(r.actual_duration);
          if (!hotel || !Number.isFinite(dur) || dur < 0) continue;
          const bkt = joDurBucket(dur);
          if (!statusDurByHotel[hotel]) statusDurByHotel[hotel] = {};
          if (!statusDurByHotel[hotel][status]) statusDurByHotel[hotel][status] = {};
          statusDurByHotel[hotel][status][bkt] = (statusDurByHotel[hotel][status][bkt] ?? 0) + 1;
        }
        for (const entry of chainEntries) {
          entry.summary.jo_status_dur_bkt_map = statusDurByHotel[entry.hotel_code] ?? entry.summary.jo_status_dur_bkt_map ?? {};
        }
        void JO_DUR_ORDER; // referenced in DashboardClient
      }
      // 24-hour distribution maps (jo-01/02/06/27/28, cjo-12/13/14/22..28): live from jo_records, per hotel.
      if (hotelCodes.length > 0) {
        type JoHourRow = JoHourSourceRow & { hotel_code: string | null };
        const hourBatch = await supabase
          .from('jo_records')
          .select('hotel_code, job_status, service_item_category, service_item, delay_duration, escalation_group, vip_code, created_datetime, acknowledged_datetime, completed_datetime')
          .in('hotel_code', hotelCodes) as unknown as SbResult<JoHourRow[]>;
        const rowsByHotel: Record<string, JoHourSourceRow[]> = {};
        for (const r of hourBatch.data ?? []) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          if (!rowsByHotel[hotel]) rowsByHotel[hotel] = [];
          rowsByHotel[hotel].push(r);
        }
        for (const entry of chainEntries) {
          const hotelRows = rowsByHotel[entry.hotel_code];
          if (hotelRows && hotelRows.length > 0) {
            Object.assign(entry.summary, computeJoHourMaps(hotelRows, orgTimezone));
          }
        }
      }
      // cjo-01/cjo-21: department (falling back to assigned department when the
      // source system's "Unacknowledged Orders" placeholder shows up, same rule as
      // the jo-09/jo-20 department fix) → service item, and separately service
      // category → service item, both → { count, avgResponseMins, avgCompletionMins,
      // delayRate }. Both maps come from the same row scan. Live from jo_records,
      // per hotel.
      if (hotelCodes.length > 0) {
        type JoDeptItemRow = {
          hotel_code: string | null;
          department_name: string | null;
          assigned_to_department: string | null;
          service_item_category: string | null;
          service_item: string | null;
          job_status: string | null;
          vip_code: string | null;
          escalation_group: string | null;
          created_datetime: string | null;
          acknowledged_datetime: string | null;
          completed_datetime: string | null;
          delay_duration: string | number | null;
        };
        const diBatch = await supabase
          .from('jo_records')
          .select('hotel_code, department_name, assigned_to_department, service_item_category, service_item, job_status, vip_code, escalation_group, created_datetime, acknowledged_datetime, completed_datetime, delay_duration')
          .in('hotel_code', hotelCodes) as unknown as SbResult<JoDeptItemRow[]>;
        type DeptItemAcc = { count: number; responseSum: number; responseCount: number; completionSum: number; completionCount: number; delayedCount: number };
        const deptItemByHotel: Record<string, Record<string, Record<string, DeptItemAcc>>> = {};
        const catItemByHotel: Record<string, Record<string, Record<string, DeptItemAcc>>> = {};
        // cjo-22..29: generic dimension → dimension-value → item accumulator, one
        // slice per dimension (status/vip/ontime/escgroup/hour/compbkt/delayeddept),
        // sharing the same row scan as dept/category above.
        const JO_DIM_KEYS = ['status', 'vip', 'ontime', 'escgroup', 'hour', 'compbkt', 'delayeddept'] as const;
        type JoDimKey = typeof JO_DIM_KEYS[number];
        const dimItemByHotel: Record<JoDimKey, Record<string, Record<string, Record<string, DeptItemAcc>>>> = Object.fromEntries(JO_DIM_KEYS.map((k) => [k, {}])) as Record<JoDimKey, Record<string, Record<string, Record<string, DeptItemAcc>>>>;
        // cjo-30: item's own aggregate (no dimension), keyed hotel → item.
        const itemGlobalByHotel: Record<string, Record<string, DeptItemAcc>> = {};
        const bumpAcc = (map: Record<string, Record<string, Record<string, DeptItemAcc>>>, hotel: string, key: string, item: string, createdAt: Date | null, ackAt: Date | null, completedAt: Date | null, delayMin: number | null) => {
          if (!map[hotel]) map[hotel] = {};
          if (!map[hotel][key]) map[hotel][key] = {};
          if (!map[hotel][key][item]) map[hotel][key][item] = { count: 0, responseSum: 0, responseCount: 0, completionSum: 0, completionCount: 0, delayedCount: 0 };
          const acc = map[hotel][key][item];
          acc.count += 1;
          if (createdAt && !Number.isNaN(createdAt.getTime())) {
            if (ackAt && !Number.isNaN(ackAt.getTime()) && ackAt.getTime() >= createdAt.getTime()) {
              acc.responseSum += (ackAt.getTime() - createdAt.getTime()) / 60_000;
              acc.responseCount += 1;
            }
            if (completedAt && !Number.isNaN(completedAt.getTime()) && completedAt.getTime() >= createdAt.getTime()) {
              acc.completionSum += (completedAt.getTime() - createdAt.getTime()) / 60_000;
              acc.completionCount += 1;
            }
          }
          if (delayMin !== null && delayMin > 0) acc.delayedCount += 1;
        };
        const bumpFlat = (map: Record<string, Record<string, DeptItemAcc>>, hotel: string, item: string, createdAt: Date | null, ackAt: Date | null, completedAt: Date | null, delayMin: number | null) => {
          if (!map[hotel]) map[hotel] = {};
          if (!map[hotel][item]) map[hotel][item] = { count: 0, responseSum: 0, responseCount: 0, completionSum: 0, completionCount: 0, delayedCount: 0 };
          const acc = map[hotel][item];
          acc.count += 1;
          if (createdAt && !Number.isNaN(createdAt.getTime())) {
            if (ackAt && !Number.isNaN(ackAt.getTime()) && ackAt.getTime() >= createdAt.getTime()) {
              acc.responseSum += (ackAt.getTime() - createdAt.getTime()) / 60_000;
              acc.responseCount += 1;
            }
            if (completedAt && !Number.isNaN(completedAt.getTime()) && completedAt.getTime() >= createdAt.getTime()) {
              acc.completionSum += (completedAt.getTime() - createdAt.getTime()) / 60_000;
              acc.completionCount += 1;
            }
          }
          if (delayMin !== null && delayMin > 0) acc.delayedCount += 1;
        };
        for (const r of diBatch.data ?? []) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const assignedDept = r.assigned_to_department === null || String(r.assigned_to_department).trim() === '' ? 'Unknown' : String(r.assigned_to_department);
          const deptRaw = r.department_name === null || String(r.department_name).trim() === '' ? 'Unknown' : String(r.department_name);
          const dept = deptRaw === 'Unacknowledged Orders' ? assignedDept : deptRaw;
          const category = r.service_item_category === null || String(r.service_item_category).trim() === '' ? 'Uncategorized' : String(r.service_item_category);
          const item = r.service_item === null || String(r.service_item).trim() === '' ? 'Unknown Item' : String(r.service_item);
          const createdAt = r.created_datetime ? new Date(r.created_datetime) : null;
          const ackAt = r.acknowledged_datetime ? new Date(r.acknowledged_datetime) : null;
          const completedAt = r.completed_datetime ? new Date(r.completed_datetime) : null;
          const delayMin = parseDurationMinutes(r.delay_duration);
          bumpAcc(deptItemByHotel, hotel, dept, item, createdAt, ackAt, completedAt, delayMin);
          bumpAcc(catItemByHotel, hotel, category, item, createdAt, ackAt, completedAt, delayMin);
          bumpFlat(itemGlobalByHotel, hotel, item, createdAt, ackAt, completedAt, delayMin);

          const statusLabel = r.job_status === null || String(r.job_status).trim() === '' ? 'Unknown' : String(r.job_status);
          bumpAcc(dimItemByHotel.status, hotel, statusLabel, item, createdAt, ackAt, completedAt, delayMin);
          const vipLabel = isVipLike(r.vip_code) ? 'VIP' : 'Non-VIP';
          bumpAcc(dimItemByHotel.vip, hotel, vipLabel, item, createdAt, ackAt, completedAt, delayMin);
          const ontimeLabel = delayMin !== null && delayMin > 0 ? 'Delayed' : 'On Time';
          bumpAcc(dimItemByHotel.ontime, hotel, ontimeLabel, item, createdAt, ackAt, completedAt, delayMin);
          const escGroupLabel = r.escalation_group === null || String(r.escalation_group).trim() === '' ? 'None' : String(r.escalation_group);
          bumpAcc(dimItemByHotel.escgroup, hotel, escGroupLabel, item, createdAt, ackAt, completedAt, delayMin);
          if (createdAt && !Number.isNaN(createdAt.getTime())) {
            bumpAcc(dimItemByHotel.hour, hotel, String(localHour(createdAt, orgTimezone)).padStart(2, '0'), item, createdAt, ackAt, completedAt, delayMin);
          }
          if (createdAt && !Number.isNaN(createdAt.getTime()) && completedAt && !Number.isNaN(completedAt.getTime()) && completedAt.getTime() >= createdAt.getTime()) {
            const completionMin = (completedAt.getTime() - createdAt.getTime()) / 60_000;
            bumpAcc(dimItemByHotel.compbkt, hotel, joDurBucket(completionMin), item, createdAt, ackAt, completedAt, delayMin);
          }
          if (delayMin !== null && delayMin > 0) {
            bumpAcc(dimItemByHotel.delayeddept, hotel, dept, item, createdAt, ackAt, completedAt, delayMin);
          }
        }
        const toStatsMap = (map: Record<string, Record<string, DeptItemAcc>>) => {
          const statsMap: Record<string, Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }>> = {};
          for (const [key, items] of Object.entries(map)) {
            statsMap[key] = {};
            for (const [item, acc] of Object.entries(items)) {
              statsMap[key][item] = {
                count: acc.count,
                avgResponseMins: acc.responseCount > 0 ? Number((acc.responseSum / acc.responseCount).toFixed(1)) : 0,
                avgCompletionMins: acc.completionCount > 0 ? Number((acc.completionSum / acc.completionCount).toFixed(1)) : 0,
                delayRate: acc.count > 0 ? Number(((acc.delayedCount / acc.count) * 100).toFixed(1)) : 0,
              };
            }
          }
          return statsMap;
        };
        const toFlatStatsMap = (map: Record<string, DeptItemAcc>) => {
          const statsMap: Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }> = {};
          for (const [item, acc] of Object.entries(map)) {
            statsMap[item] = {
              count: acc.count,
              avgResponseMins: acc.responseCount > 0 ? Number((acc.responseSum / acc.responseCount).toFixed(1)) : 0,
              avgCompletionMins: acc.completionCount > 0 ? Number((acc.completionSum / acc.completionCount).toFixed(1)) : 0,
              delayRate: acc.count > 0 ? Number(((acc.delayedCount / acc.count) * 100).toFixed(1)) : 0,
            };
          }
          return statsMap;
        };
        for (const entry of chainEntries) {
          entry.summary.jo_dept_item_stats_map = toStatsMap(deptItemByHotel[entry.hotel_code] ?? {});
          entry.summary.jo_cat_item_stats_map = toStatsMap(catItemByHotel[entry.hotel_code] ?? {});
          entry.summary.jo_item_stats_map = toFlatStatsMap(itemGlobalByHotel[entry.hotel_code] ?? {});
          const dimStatsMap: Record<string, Record<string, Record<string, { count: number; avgResponseMins: number; avgCompletionMins: number; delayRate: number }>>> = {};
          for (const dim of JO_DIM_KEYS) {
            dimStatsMap[dim] = toStatsMap(dimItemByHotel[dim][entry.hotel_code] ?? {});
          }
          entry.summary.jo_dim_item_stats_map = dimStatsMap;
        }
      }
    } else if (String(moduleCode ?? '').toLowerCase() === 'im') {
      type JoLiveRow = {
        hotel_code: string | null;
        assigned_to_department: string | null;
        created_by_department: string | null;
        completed_by_department: string | null;
        location: string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const assignedByHotel: Record<string, Record<string, number>> = {};
        const createdByHotel: Record<string, Record<string, number>> = {};
        const completedByHotel: Record<string, Record<string, number>> = {};
        const locationByHotel: Record<string, Record<string, number>> = {};
        const batch = await supabase
          .from('jo_records')
          .select('hotel_code, assigned_to_department, created_by_department, completed_by_department, location')
          .in('hotel_code', hotelCodes) as unknown as SbResult<JoLiveRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const assigned = r.assigned_to_department === null || String(r.assigned_to_department).trim() === '' ? 'Unknown Assigned Dept' : String(r.assigned_to_department);
          const createdBy = r.created_by_department === null || String(r.created_by_department).trim() === '' ? 'Unknown Source Dept' : String(r.created_by_department);
          const completedBy = r.completed_by_department === null || String(r.completed_by_department).trim() === '' ? 'Unknown Completed Dept' : String(r.completed_by_department);
          const location = r.location === null || String(r.location).trim() === '' ? 'Unknown Location' : String(r.location);
          if (!assignedByHotel[hotel]) assignedByHotel[hotel] = {};
          if (!createdByHotel[hotel]) createdByHotel[hotel] = {};
          if (!completedByHotel[hotel]) completedByHotel[hotel] = {};
          if (!locationByHotel[hotel]) locationByHotel[hotel] = {};
          assignedByHotel[hotel][assigned] = (assignedByHotel[hotel][assigned] ?? 0) + 1;
          createdByHotel[hotel][createdBy] = (createdByHotel[hotel][createdBy] ?? 0) + 1;
          completedByHotel[hotel][completedBy] = (completedByHotel[hotel][completedBy] ?? 0) + 1;
          locationByHotel[hotel][location] = (locationByHotel[hotel][location] ?? 0) + 1;
        }

        for (const entry of chainEntries) {
          entry.summary.assigned_dept_map = assignedByHotel[entry.hotel_code] ?? entry.summary.assigned_dept_map ?? {};
          entry.summary.created_by_dept_map = createdByHotel[entry.hotel_code] ?? entry.summary.created_by_dept_map ?? {};
          entry.summary.completed_by_dept_map = completedByHotel[entry.hotel_code] ?? entry.summary.completed_by_dept_map ?? {};
          entry.summary.location_map = locationByHotel[entry.hotel_code] ?? entry.summary.location_map ?? {};
        }
      }
    }

    if (isMo || isCo) {
      type MoLiveRow = {
        hotel_code: string | null;
        type: string | null;
        location: string | null;
        building: string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const locationByHotel: Record<string, Record<string, number>> = {};
        const maintenanceTable = isCo ? 'co_records' : 'mo_records';
        const batch = await supabase
          .from(maintenanceTable)
          .select('hotel_code, type, location, building')
          .in('hotel_code', hotelCodes)
          .in('type', isCo ? ['MO', 'CO'] : ['MO']) as unknown as SbResult<MoLiveRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const location = r.location === null || String(r.location).trim() === ''
            ? (r.building === null || String(r.building).trim() === '' ? 'Unknown Location' : String(r.building))
            : String(r.location);
          if (!locationByHotel[hotel]) locationByHotel[hotel] = {};
          locationByHotel[hotel][location] = (locationByHotel[hotel][location] ?? 0) + 1;
        }
        for (const entry of chainEntries) {
          for (const maintenanceType of ['MO', 'PM'] as const) {
            if (!entry.summary_by_type?.[maintenanceType]) continue;
            entry.summary_by_type[maintenanceType].location_map =
              locationByHotel[entry.hotel_code] ?? entry.summary_by_type[maintenanceType].location_map ?? {};
          }
        }
      }

      // 24-hour distribution maps (mo-10/11, cmo-10/11): live from mo_records, per hotel.
      // CO is skipped here — CoDashboardView rebuilds all its charts client-side from raw rows already.
      if (isMo && hotelCodes.length > 0) {
        const hourBatch = await supabase
          .from('mo_records')
          .select('hotel_code, created_datetime, resolution_minutes, defect, asset, job_order')
          .in('hotel_code', hotelCodes)
          .eq('type', 'MO') as unknown as SbResult<(MoHourSourceRow & { hotel_code: string | null })[]>;
        const rowsByHotel: Record<string, MoHourSourceRow[]> = {};
        for (const r of hourBatch.data ?? []) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          if (!rowsByHotel[hotel]) rowsByHotel[hotel] = [];
          rowsByHotel[hotel].push(r);
        }
        for (const entry of chainEntries) {
          const hotelRows = rowsByHotel[entry.hotel_code];
          if (!hotelRows || hotelRows.length === 0) continue;
          const hourMaps = computeMoHourMaps(hotelRows, orgTimezone);
          Object.assign(entry.summary, hourMaps);
          if (entry.summary_by_type?.MO) Object.assign(entry.summary_by_type.MO, hourMaps);
        }
      }

      const scopedEntriesByType = {
        MO: chainEntries.map((entry) => ({
          ...entry,
          summary: entry.summary_by_type?.MO ?? entry.summary,
          raw_daily: entry.raw_daily_by_type?.MO ?? entry.raw_daily ?? [],
        })),
        PM: chainEntries.map((entry) => ({
          ...entry,
          summary: entry.summary_by_type?.PM ?? entry.summary,
          raw_daily: entry.raw_daily_by_type?.PM ?? entry.raw_daily ?? [],
        })),
      };

      const scopedSummaryByType = {
        MO: mergeSummary(scopedEntriesByType.MO.map((e) => e.summary)),
        PM: mergeSummary(scopedEntriesByType.PM.map((e) => e.summary)),
      };
      const scopedRawDailyByType = {
        MO: mergeRawDaily(scopedEntriesByType.MO.map((e) => e.raw_daily ?? [])),
        PM: mergeRawDaily(scopedEntriesByType.PM.map((e) => e.raw_daily ?? [])),
      };
      const scopedDates = scopedRawDailyByType.MO.map((d) => d.date);
      const scopedDateMin = scopedDates.length > 0 ? scopedDates[0] : null;
      const scopedDateMax = scopedDates.length > 0 ? scopedDates[scopedDates.length - 1] : null;
      const scopedTotalRecords = scopedEntriesByType.MO.reduce((sum, entry) => sum + (entry.summary.total ?? 0), 0);

      if (isCo) {
        const coTemplate = template as CoDashboardJson;
        const corpCoData: CoDashboardJson = {
          ...coTemplate,
        meta: {
          ...coTemplate.meta,
          source_name: `${chainCode.toUpperCase()} Corp`,
          chain_code: chainCode.toUpperCase(),
          hotel_code: 'CORP',
          hotel_name: 'Corp',
          timezone: orgTimezone,
          total_records: scopedTotalRecords,
          date_range: { min: scopedDateMin, max: scopedDateMax },
          generated_at: new Date().toISOString(),
          schema: 'co-v1',
        },
          kpis: coTemplate.kpis ?? [],
          eac: coTemplate.eac ?? [],
          charts: coTemplate.charts ?? [],
          raw_daily: scopedRawDailyByType.MO,
          summary: scopedSummaryByType.MO,
          kpis_by_type: {
            ...coTemplate.kpis_by_type,
            MO: coTemplate.kpis_by_type?.MO ?? [],
            PM: coTemplate.kpis_by_type?.PM ?? [],
          },
          charts_by_type: {
            ...coTemplate.charts_by_type,
            MO: coTemplate.charts_by_type?.MO ?? [],
            PM: coTemplate.charts_by_type?.PM ?? [],
          },
          raw_daily_by_type: {
            ...coTemplate.raw_daily_by_type,
            MO: scopedRawDailyByType.MO,
            PM: scopedRawDailyByType.PM,
          },
          summary_by_type: {
            ...coTemplate.summary_by_type,
            MO: scopedSummaryByType.MO,
            PM: scopedSummaryByType.PM,
          },
        };

        return { data: corpCoData, chainEntries };
      }

      const moTemplate = template as MoDashboardJson;
      const corpMoData: MoDashboardJson = {
        ...moTemplate,
        meta: {
          ...moTemplate.meta,
          source_name: `${chainCode.toUpperCase()} Corp`,
          chain_code: chainCode.toUpperCase(),
          hotel_code: 'CORP',
          hotel_name: 'Corp',
          timezone: orgTimezone,
          total_records: scopedTotalRecords,
          date_range: { min: scopedDateMin, max: scopedDateMax },
          generated_at: new Date().toISOString(),
          schema: 'mo-v1',
        },
        kpis: moTemplate.kpis ?? [],
        eac: moTemplate.eac ?? [],
        charts: moTemplate.charts ?? [],
        raw_daily: scopedRawDailyByType.MO,
        summary: scopedSummaryByType.MO,
        kpis_by_type: {
          ...moTemplate.kpis_by_type,
          MO: moTemplate.kpis_by_type?.MO ?? [],
          PM: moTemplate.kpis_by_type?.PM ?? [],
        },
        charts_by_type: {
          ...moTemplate.charts_by_type,
          MO: moTemplate.charts_by_type?.MO ?? [],
          PM: moTemplate.charts_by_type?.PM ?? [],
        },
        raw_daily_by_type: {
          ...moTemplate.raw_daily_by_type,
          MO: scopedRawDailyByType.MO,
          PM: scopedRawDailyByType.PM,
        },
        summary_by_type: {
          ...moTemplate.summary_by_type,
          MO: scopedSummaryByType.MO,
          PM: scopedSummaryByType.PM,
        },
      };

      return { data: corpMoData, chainEntries };
    }

    const imTemplate = template as ImDashboardJson;
    const summary = mergeSummary(dashboards.map((d) => d.summary));
    // Re-merge summary from chainEntries in case live IM maps were enriched above.
    const enrichedSummary = mergeSummary(chainEntries.map((e) => e.summary));
    const rawDaily = mergeRawDaily(dashboards.map((d) => d.raw_daily ?? []));
    const dates = rawDaily.map((d) => d.date);
    const dateMin = dates.length > 0 ? dates[0] : null;
    const dateMax = dates.length > 0 ? dates[dates.length - 1] : null;
    const totalRecords = dashboards.reduce((s, d) => s + (d.meta.total_records ?? 0), 0);

    const data: ImDashboardJson = {
      ...imTemplate,
      meta: {
        ...imTemplate.meta,
        source_name: `${chainCode.toUpperCase()} Corp`,
        chain_code: chainCode.toUpperCase(),
        hotel_code: 'CORP',
        hotel_name: 'Corp',
        timezone: orgTimezone,
        total_records: totalRecords,
        date_range: { min: dateMin, max: dateMax },
        generated_at: new Date().toISOString(),
      },
      kpis: moduleCode?.toLowerCase() === 'jo'
        ? buildCorpJoKpis(imTemplate, chainEntries)
        : buildCorpKpis(imTemplate, summary),
      raw_daily: rawDaily,
      summary: enrichedSummary,
    };

    return { data, chainEntries };
  } catch (error) {
    console.error('[dashboard/fetchCorpDashboard] unexpected failure', { chainCode, moduleCode, error });
    return { data: null, chainEntries: [] };
  }
}
