import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLiveTimezone } from '@/lib/dashboard-fetch';
import { localHour, localDateKey } from '@/lib/timezone';

type ImRow = {
  created_date: string | null;
  incident_datetime: string | null;
  investigation_updated_on_1: string | null;
  investigation_updated_on_2: string | null;
  incident_status: string | null;
  severity: string | null;
  vip_code: string | null;
  incident_category: string | null;
  incident_item_name: string | null;
  source_of_complaint: string | null;
  booking_source: string | null;
  department: string | null;
  room_no: string | null;
  incident_location: string | null;
  profile_type: string | null;
  guest_name: string | null;
  created_by: string | null;
};

type DailyBucket = {
  date: string;
  total: number;
  completed: number;
  cancelled: number;
  pending: number;
  high_crit: number;
  severity_sum: number;
  vip: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
};

function isVip(v: string | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  return s !== '-';
}

function toDateOnly(v: string | null | undefined, tz: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return localDateKey(d, tz);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const chain = (url.searchParams.get('chain') ?? '').toUpperCase();
    const hotel = (url.searchParams.get('hotel') ?? '').toUpperCase();
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const department = url.searchParams.get('department') ?? 'ALL';

    if (!chain || !hotel) {
      return NextResponse.json({ error: 'chain and hotel are required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const tz = await resolveLiveTimezone(supabase, 'im_records', [hotel], chain);

    const q = await supabase
      .from('im_records')
      .select('created_date, incident_datetime, investigation_updated_on_1, investigation_updated_on_2, incident_status, severity, vip_code, incident_category, incident_item_name, source_of_complaint, booking_source, department, room_no, incident_location, profile_type, guest_name, created_by')
      .eq('chain_code', chain)
      .eq('hotel_code', hotel) as unknown as { data: ImRow[] | null; error: { message: string } | null };

    if (q.error) {
      return NextResponse.json({ error: q.error.message }, { status: 500 });
    }

    const rows = (q.data ?? []).filter((r) => {
      const d = toDateOnly(r.created_date, tz) ?? toDateOnly(r.incident_datetime, tz);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (department !== 'ALL') {
        const dep = (r.department ?? 'Unknown Department').trim() || 'Unknown Department';
        if (dep !== department) return false;
      }
      return true;
    });

    // ⏰ 24-hour distribution fields (hour_map and friends) intentionally ignore
    // the date-range filter, matching JO/MO's established behavior — they always
    // reflect the full upload period, scoped only by the department filter.
    const hourRows = (q.data ?? []).filter((r) => {
      if (department !== 'ALL') {
        const dep = (r.department ?? 'Unknown Department').trim() || 'Unknown Department';
        if (dep !== department) return false;
      }
      return true;
    });

    const status_map: Record<string, number> = {};
    const severity_map: Record<string, number> = {};
    const category_map: Record<string, number> = {};
    const item_map: Record<string, number> = {};
    const source_map: Record<string, number> = {};
    const booking_map: Record<string, number> = {};
    const dept_map: Record<string, number> = {};
    const hour_map: Record<number, number> = {};
    const room_map: Record<string, number> = {};
    const location_map: Record<string, number> = {};
    const dept_category_map: Record<string, Record<string, number>> = {};
    const category_item_map: Record<string, Record<string, number>> = {};
    const dept_category_item_map: Record<string, Record<string, Record<string, number>>> = {};
    const item_location_map: Record<string, Record<string, number>> = {};
    const room_item_map: Record<string, Record<string, number>> = {};
    const status_dept_map: Record<string, Record<string, number>> = {};
    const source_dept_map: Record<string, Record<string, number>> = {};
    const location_dept_map: Record<string, Record<string, number>> = {};
    const severity_category_map: Record<string, Record<string, number>> = {};
    const category_status_map: Record<string, Record<string, number>> = {};
    const vip_item_map: Record<string, Record<string, number>> = { VIP: {}, 'Non-VIP': {} };
    const vip_category_map: Record<string, Record<string, number>> = { VIP: {}, 'Non-VIP': {} };
    const category_duration_map: Record<string, { sum: number; count: number }> = {};
    const category_item_duration_map: Record<string, Record<string, { sum: number; count: number }>> = {};
    const hour_category_map: Record<string, Record<string, number>> = {};
    const hour_dept_map: Record<string, Record<string, number>> = {};
    const hour_category_item_map: Record<string, Record<string, Record<string, number>>> = {};
    const hour_dept_item_map: Record<string, Record<string, Record<string, number>>> = {};
    // im-01/02/03/05/06/07/08/09/10/11/12/14: dept/vip/category/severity/
    // source/booking/durbkt/hour/month slices of im_dim_item_stats_map (same
    // shape as the corp/hotel-fetch versions), scoped to this route's own
    // filtered `rows` — except 'hour', computed from `hourRows` below (ignores
    // the date-range filter, matching hour_map's established full-period convention).
    type DimStatAcc = { count: number; roomCounts: Record<string, number>; durSum: number; durCount: number; closed: number };
    const IM_SCOPE_DIM_KEYS = ['dept', 'vip', 'category', 'severity', 'source', 'booking', 'durbkt', 'hour', 'month', 'profile', 'status', 'guestname', 'createdby', 'all'] as const;
    type ImScopeDimKey = typeof IM_SCOPE_DIM_KEYS[number];
    const dimItemStatsAcc: Record<ImScopeDimKey, Record<string, Record<string, DimStatAcc>>> = Object.fromEntries(IM_SCOPE_DIM_KEYS.map((k) => [k, {}])) as Record<ImScopeDimKey, Record<string, Record<string, DimStatAcc>>>;
    const IM_SCOPE_DUR_BUCKETS = ['< 1h', '1-2h', '2-4h', '4-8h', '8-24h', '24h+'];
    function imScopeDurBucketLabel(hours: number): string {
      if (hours < 1) return IM_SCOPE_DUR_BUCKETS[0];
      if (hours < 2) return IM_SCOPE_DUR_BUCKETS[1];
      if (hours < 4) return IM_SCOPE_DUR_BUCKETS[2];
      if (hours < 8) return IM_SCOPE_DUR_BUCKETS[3];
      if (hours < 24) return IM_SCOPE_DUR_BUCKETS[4];
      return IM_SCOPE_DUR_BUCKETS[5];
    }
    const addDimStat = (dim: ImScopeDimKey, dimValue: string, item: string, room: string, hours: number | null, isClosed: boolean) => {
      if (!dimItemStatsAcc[dim][dimValue]) dimItemStatsAcc[dim][dimValue] = {};
      if (!dimItemStatsAcc[dim][dimValue][item]) dimItemStatsAcc[dim][dimValue][item] = { count: 0, roomCounts: {}, durSum: 0, durCount: 0, closed: 0 };
      const acc = dimItemStatsAcc[dim][dimValue][item];
      acc.count += 1;
      acc.roomCounts[room] = (acc.roomCounts[room] ?? 0) + 1;
      if (hours !== null) { acc.durSum += hours; acc.durCount += 1; }
      if (isClosed) acc.closed += 1;
    };
    // im-13: month → department → { count, repeat, avgDurationHours, closed },
    // one level shallower (no per-item breakdown), scoped to `rows` like the
    // other date-filtered dims.
    type MonthDeptAcc = { count: number; roomCounts: Record<string, number>; durSum: number; durCount: number; closed: number };
    const monthDeptAcc: Record<string, Record<string, MonthDeptAcc>> = {};

    let total = 0;
    let completed = 0;
    let cancelled = 0;
    let pending = 0;
    let vip_total = 0;
    let vip_completed = 0;
    let vip_cancelled = 0;
    let severity_sum = 0;
    let response_sum_min = 0;
    let response_count = 0;
    const repeatKeyCount: Record<string, number> = {};
    const byDate = new Map<string, DailyBucket>();

    const sevWeight: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
    for (const r of rows) {
      total += 1;
      const status = (r.incident_status ?? 'Unknown').trim() || 'Unknown';
      const sev = (r.severity ?? 'Unknown').trim() || 'Unknown';
      const cat = (r.incident_category ?? 'Uncategorized').trim() || 'Uncategorized';
      const item = (r.incident_item_name ?? 'Unknown Item').trim() || 'Unknown Item';
      const source = r.source_of_complaint === null ? 'Unknown' : String(r.source_of_complaint);
      const booking = r.booking_source === null ? 'Unknown' : String(r.booking_source);
      const dept = (r.department ?? 'Unknown Department').trim() || 'Unknown Department';
      const room = (r.room_no ?? 'Unknown Room').trim() || 'Unknown Room';
      const location = (r.incident_location ?? 'Unknown Location').trim() || 'Unknown Location';

      status_map[status] = (status_map[status] ?? 0) + 1;
      severity_map[sev] = (severity_map[sev] ?? 0) + 1;
      category_map[cat] = (category_map[cat] ?? 0) + 1;
      item_map[item] = (item_map[item] ?? 0) + 1;
      source_map[source] = (source_map[source] ?? 0) + 1;
      booking_map[booking] = (booking_map[booking] ?? 0) + 1;
      dept_map[dept] = (dept_map[dept] ?? 0) + 1;
      room_map[room] = (room_map[room] ?? 0) + 1;
      location_map[location] = (location_map[location] ?? 0) + 1;
      if (!dept_category_map[dept]) dept_category_map[dept] = {};
      dept_category_map[dept][cat] = (dept_category_map[dept][cat] ?? 0) + 1;
      if (!dept_category_item_map[dept]) dept_category_item_map[dept] = {};
      if (!dept_category_item_map[dept][cat]) dept_category_item_map[dept][cat] = {};
      dept_category_item_map[dept][cat][item] = (dept_category_item_map[dept][cat][item] ?? 0) + 1;
      if (!category_item_map[cat]) category_item_map[cat] = {};
      category_item_map[cat][item] = (category_item_map[cat][item] ?? 0) + 1;
      if (!item_location_map[item]) item_location_map[item] = {};
      item_location_map[item][location] = (item_location_map[item][location] ?? 0) + 1;
      if (!room_item_map[room]) room_item_map[room] = {};
      room_item_map[room][item] = (room_item_map[room][item] ?? 0) + 1;
      if (!status_dept_map[status]) status_dept_map[status] = {};
      status_dept_map[status][dept] = (status_dept_map[status][dept] ?? 0) + 1;
      if (!source_dept_map[source]) source_dept_map[source] = {};
      source_dept_map[source][dept] = (source_dept_map[source][dept] ?? 0) + 1;
      if (!location_dept_map[location]) location_dept_map[location] = {};
      location_dept_map[location][dept] = (location_dept_map[location][dept] ?? 0) + 1;
      if (!severity_category_map[sev]) severity_category_map[sev] = {};
      severity_category_map[sev][cat] = (severity_category_map[sev][cat] ?? 0) + 1;
      if (!category_status_map[cat]) category_status_map[cat] = {};
      category_status_map[cat][status] = (category_status_map[cat][status] ?? 0) + 1;
      if (!category_duration_map[cat]) category_duration_map[cat] = { sum: 0, count: 0 };
      if (!category_item_duration_map[cat]) category_item_duration_map[cat] = {};
      const vipSeg = isVip(r.vip_code) ? 'VIP' : 'Non-VIP';
      vip_item_map[vipSeg][item] = (vip_item_map[vipSeg][item] ?? 0) + 1;
      vip_category_map[vipSeg][cat] = (vip_category_map[vipSeg][cat] ?? 0) + 1;

      if (/completed|closed/i.test(status)) completed += 1;
      else if (/cancel/i.test(status)) cancelled += 1;
      else pending += 1;

      if (isVip(r.vip_code)) {
        vip_total += 1;
        if (/completed|closed/i.test(status)) vip_completed += 1;
        else if (/cancel/i.test(status)) vip_cancelled += 1;
      }

      severity_sum += sevWeight[sev] ?? 0;

      const created = r.created_date ? new Date(r.created_date) : null;
      const first = r.investigation_updated_on_1 ? new Date(r.investigation_updated_on_1) : null;
      if (created && first && !Number.isNaN(created.getTime()) && !Number.isNaN(first.getTime())) {
        const mins = (first.getTime() - created.getTime()) / 60000;
        if (mins >= 0 && mins < 60 * 24 * 30) {
          response_sum_min += mins;
          response_count += 1;
        }
      }

      const day = toDateOnly(r.created_date, tz) ?? toDateOnly(r.incident_datetime, tz);
      if (day) {
        if (!byDate.has(day)) {
          byDate.set(day, {
            date: day,
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
        const b = byDate.get(day)!;
        b.total += 1;
        if (/completed|closed/i.test(status)) b.completed += 1;
        else if (/cancel/i.test(status)) b.cancelled += 1;
        else b.pending += 1;
        if (/critical|high/i.test(sev)) b.high_crit += 1;
        b.severity_sum += sevWeight[sev] ?? 0;
        if (isVip(r.vip_code)) b.vip += 1;
        b.by_status[status] = (b.by_status[status] ?? 0) + 1;
        b.by_severity[sev] = (b.by_severity[sev] ?? 0) + 1;
        b.by_category[cat] = (b.by_category[cat] ?? 0) + 1;
      }

      // Close time: investigation_updated_on_2, falling back to
      // investigation_updated_on_1 when cycle 2 was never filled in. If
      // neither is present, assume a fixed 48h duration rather than
      // dropping the record — matches app/api/uploads/finalize/route.ts.
      const dt = r.incident_datetime ? new Date(r.incident_datetime) : (r.created_date ? new Date(r.created_date) : null);
      const endRaw = r.investigation_updated_on_2 ?? r.investigation_updated_on_1;
      const end = endRaw ? new Date(endRaw) : null;
      let rowHours: number | null = null;
      if (dt && !Number.isNaN(dt.getTime())) {
        const hours = end && !Number.isNaN(end.getTime()) ? (end.getTime() - dt.getTime()) / 3_600_000 : 48;
        if (Number.isFinite(hours) && hours >= 0 && hours < 3650 * 24) {
          rowHours = hours;
          category_duration_map[cat].sum += hours;
          category_duration_map[cat].count += 1;
          if (!category_item_duration_map[cat][item]) category_item_duration_map[cat][item] = { sum: 0, count: 0 };
          category_item_duration_map[cat][item].sum += hours;
          category_item_duration_map[cat][item].count += 1;
        }
      }

      // im-01/02/03/05/06/07/08/09/10/12/14 dim/item stats: same count/repeat/duration/closed shape as elsewhere.
      // durbkt/month are only known once rowHours/dt are computed, so they're skipped when null (unlike the other dims).
      const isClosed = /completed|closed/i.test(status);
      const monthKey = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString().slice(0, 7) : null;
      const profileLabel = r.profile_type === null || r.profile_type === undefined || String(r.profile_type).trim() === '' ? 'Unknown' : String(r.profile_type);
      const guestLabel = r.guest_name === null || r.guest_name === undefined || String(r.guest_name).trim() === '' ? 'Unknown Guest' : String(r.guest_name);
      const createdByLabel = r.created_by === null || r.created_by === undefined || String(r.created_by).trim() === '' ? 'Unknown' : String(r.created_by);
      const dimValueByKey: Partial<Record<ImScopeDimKey, string>> = { dept, vip: vipSeg, category: cat, severity: sev, source, booking, profile: profileLabel, status, guestname: guestLabel, createdby: createdByLabel, all: 'ALL' };
      if (rowHours !== null) dimValueByKey.durbkt = imScopeDurBucketLabel(rowHours);
      if (monthKey) dimValueByKey.month = monthKey;
      IM_SCOPE_DIM_KEYS.forEach((dim) => {
        if (dim === 'hour') return; // computed from hourRows below, not this date-filtered pass
        const dimValue = dimValueByKey[dim];
        if (dimValue === undefined) return;
        addDimStat(dim, dimValue, item, room, rowHours, isClosed);
      });

      // im-13: month → department cross-tab (no per-item breakdown).
      if (monthKey) {
        if (!monthDeptAcc[monthKey]) monthDeptAcc[monthKey] = {};
        if (!monthDeptAcc[monthKey][dept]) monthDeptAcc[monthKey][dept] = { count: 0, roomCounts: {}, durSum: 0, durCount: 0, closed: 0 };
        const mdAcc = monthDeptAcc[monthKey][dept];
        mdAcc.count += 1;
        mdAcc.roomCounts[room] = (mdAcc.roomCounts[room] ?? 0) + 1;
        if (rowHours !== null) { mdAcc.durSum += rowHours; mdAcc.durCount += 1; }
        if (isClosed) mdAcc.closed += 1;
      }

      const rk = `${r.room_no ?? 'unknown'}|${cat}|${item}`;
      repeatKeyCount[rk] = (repeatKeyCount[rk] ?? 0) + 1;
    }

    // ⏰ 24-hour distribution — computed from hourRows (department-filtered only,
    // date filter ignored) so it always reflects the full upload period.
    for (const r of hourRows) {
      const cat = (r.incident_category ?? 'Uncategorized').trim() || 'Uncategorized';
      const item = (r.incident_item_name ?? 'Unknown Item').trim() || 'Unknown Item';
      const dept = (r.department ?? 'Unknown Department').trim() || 'Unknown Department';
      const dt = r.created_date ? new Date(r.created_date) : (r.incident_datetime ? new Date(r.incident_datetime) : null);
      if (!dt || Number.isNaN(dt.getTime())) continue;
      // created_date/incident_datetime are true UTC (post-ingestion-fix) —
      // convert to the org's configured timezone for the local hour-of-day.
      const h = localHour(dt, tz);
      hour_map[h] = (hour_map[h] ?? 0) + 1;
      const hourKey = String(h);
      if (!hour_category_map[hourKey]) hour_category_map[hourKey] = {};
      hour_category_map[hourKey][cat] = (hour_category_map[hourKey][cat] ?? 0) + 1;
      if (!hour_dept_map[hourKey]) hour_dept_map[hourKey] = {};
      hour_dept_map[hourKey][dept] = (hour_dept_map[hourKey][dept] ?? 0) + 1;
      if (!hour_category_item_map[hourKey]) hour_category_item_map[hourKey] = {};
      if (!hour_category_item_map[hourKey][cat]) hour_category_item_map[hourKey][cat] = {};
      hour_category_item_map[hourKey][cat][item] = (hour_category_item_map[hourKey][cat][item] ?? 0) + 1;
      if (!hour_dept_item_map[hourKey]) hour_dept_item_map[hourKey] = {};
      if (!hour_dept_item_map[hourKey][dept]) hour_dept_item_map[hourKey][dept] = {};
      hour_dept_item_map[hourKey][dept][item] = (hour_dept_item_map[hourKey][dept][item] ?? 0) + 1;

      // im-11: hour slice of im_dim_item_stats_map — full period, matching hour_map above.
      const hourRoom = (r.room_no ?? 'Unknown Room').trim() || 'Unknown Room';
      const hourStatus = (r.incident_status ?? 'Unknown').trim() || 'Unknown';
      const hourIsClosed = /completed|closed/i.test(hourStatus);
      const hourEndRaw = r.investigation_updated_on_2 ?? r.investigation_updated_on_1;
      const hourEnd = hourEndRaw ? new Date(hourEndRaw) : null;
      const hourDurRaw = hourEnd && !Number.isNaN(hourEnd.getTime()) ? (hourEnd.getTime() - dt.getTime()) / 3_600_000 : 48;
      const hourDur = Number.isFinite(hourDurRaw) && hourDurRaw >= 0 && hourDurRaw < 3650 * 24 ? hourDurRaw : null;
      addDimStat('hour', hourKey, item, hourRoom, hourDur, hourIsClosed);
    }

    const im_dim_item_stats_map = Object.fromEntries(IM_SCOPE_DIM_KEYS.map((dim) => [
      dim,
      Object.fromEntries(Object.entries(dimItemStatsAcc[dim]).map(([dimValue, items]) => [
        dimValue,
        Object.fromEntries(Object.entries(items).map(([itemName, acc]) => [
          itemName,
          {
            count: acc.count,
            repeat: Object.values(acc.roomCounts).reduce((s, c) => s + (c >= 2 ? c : 0), 0),
            avgDurationHours: acc.durCount > 0 ? acc.durSum / acc.durCount : 0,
            closed: acc.closed,
          },
        ])),
      ])),
    ])) as Record<ImScopeDimKey, Record<string, Record<string, { count: number; repeat: number; avgDurationHours: number; closed: number }>>>;

    const im_month_dept_stats_map = Object.fromEntries(Object.entries(monthDeptAcc).map(([month, depts]) => [
      month,
      Object.fromEntries(Object.entries(depts).map(([dept, acc]) => [
        dept,
        {
          count: acc.count,
          repeat: Object.values(acc.roomCounts).reduce((s, c) => s + (c >= 2 ? c : 0), 0),
          avgDurationHours: acc.durCount > 0 ? acc.durSum / acc.durCount : 0,
          closed: acc.closed,
        },
      ])),
    ]));

    const repeat_count = Object.values(repeatKeyCount).filter((v) => v > 1).reduce((s, v) => s + v, 0);
    const avg_first_response = response_count > 0 ? response_sum_min / response_count : null;
    let peak_hour = 0;
    let peak_hour_share = 0;
    const hours = Object.entries(hour_map);
    if (hours.length > 0) {
      hours.sort((a, b) => b[1] - a[1]);
      peak_hour = Number(hours[0][0]);
      peak_hour_share = total > 0 ? (hours[0][1] / total) * 100 : 0;
    }

    return NextResponse.json({
      total,
      completed,
      cancelled,
      pending,
      vip_total,
      vip_completed,
      vip_cancelled,
      severity_sum,
      repeat_count,
      im_dim_item_stats_map,
      im_month_dept_stats_map,
      status_map,
      severity_map,
      category_map,
      item_map,
      source_map,
      booking_map,
      dept_map,
      room_map,
      location_map,
      dept_category_map,
      category_item_map,
      dept_category_item_map,
      item_location_map,
      room_item_map,
      status_dept_map,
      source_dept_map,
      location_dept_map,
      severity_category_map,
      category_status_map,
      vip_item_map,
      vip_category_map,
      category_duration_map: Object.fromEntries(Object.entries(category_duration_map).map(([cat, v]) => [cat, v.count > 0 ? v.sum / v.count : 0])),
      category_item_duration_map: Object.fromEntries(Object.entries(category_item_duration_map).map(([cat, items]) => [cat, Object.fromEntries(Object.entries(items).map(([itemName, v]) => [itemName, v.count > 0 ? v.sum / v.count : 0]))])),
      hour_category_map,
      hour_dept_map,
      hour_category_item_map,
      hour_dept_item_map,
      avg_first_response,
      peak_hour,
      peak_hour_share,
      hour_map,
      raw_daily: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
