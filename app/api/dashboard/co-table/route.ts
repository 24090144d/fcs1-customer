import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/supabaseCompat';
import { resolveLiveTimezone } from '@/lib/dashboard-fetch';

type TableLevel = 'hotels' | 'cleaning_types' | 'stay_statuses' | 'attendants' | 'details';

const LEVELS = new Set<TableLevel>(['hotels', 'cleaning_types', 'stay_statuses', 'attendants', 'details']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: string | null, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const level = clean(url.searchParams.get('level'), 24) as TableLevel;
    const chain = clean(url.searchParams.get('chain'), 32).toUpperCase();
    const hotel = clean(url.searchParams.get('hotel'), 64).toUpperCase();
    const cleaningType = clean(url.searchParams.get('cleaning_type'));
    const stayStatus = clean(url.searchParams.get('stay_status'));
    const attendant = clean(url.searchParams.get('attendant'));
    const from = clean(url.searchParams.get('from'), 10);
    const to = clean(url.searchParams.get('to'), 10);
    const floorFilter = clean(url.searchParams.get('floor'));
    const attendantFilter = clean(url.searchParams.get('filter_attendant'));
    const roomTypeFilter = clean(url.searchParams.get('room_type'));
    const statusFilter = clean(url.searchParams.get('status_filter'));

    if (!LEVELS.has(level) || !chain) {
      return NextResponse.json({ error: 'Valid level and chain are required.' }, { status: 400 });
    }
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'Invalid date range.' }, { status: 400 });
    }
    if (level !== 'hotels' && !hotel) {
      return NextResponse.json({ error: 'hotel is required for this level.' }, { status: 400 });
    }
    if (['stay_statuses', 'attendants', 'details'].includes(level) && !cleaningType) {
      return NextResponse.json({ error: 'cleaning_type is required for this level.' }, { status: 400 });
    }
    if (['attendants', 'details'].includes(level) && !stayStatus) {
      return NextResponse.json({ error: 'stay_status is required for this level.' }, { status: 400 });
    }
    if (level === 'details' && !attendant) {
      return NextResponse.json({ error: 'attendant is required for details.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const timezone = await resolveLiveTimezone(supabase, 'co_records', hotel ? [hotel] : [], chain);
    const params: unknown[] = [chain];
    const scopedWhere: string[] = [];
    const add = (value: unknown, sql: (index: number) => string) => {
      params.push(value);
      scopedWhere.push(sql(params.length));
    };

    if (hotel && hotel !== 'ALL') add(hotel, (i) => `hotel_code = $${i}`);
    if (cleaningType) add(cleaningType, (i) => `cleaning_type_key = $${i}`);
    if (stayStatus) add(stayStatus, (i) => `stay_status_key = $${i}`);
    if (attendant) add(attendant, (i) => `attendant_key = $${i}`);
    if (floorFilter && floorFilter !== 'ALL') add(floorFilter, (i) => `floor_key = $${i}`);
    if (attendantFilter && attendantFilter !== 'ALL') add(attendantFilter, (i) => `attendant_key = $${i}`);
    if (roomTypeFilter && roomTypeFilter !== 'ALL') add(roomTypeFilter, (i) => `room_type_key = $${i}`);
    if (statusFilter && statusFilter !== 'ALL') add(statusFilter, (i) => `derived_status = $${i}`);
    if (from) {
      params.push(timezone, from);
      scopedWhere.push(`(event_datetime AT TIME ZONE $${params.length - 1})::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(timezone, to);
      scopedWhere.push(`(event_datetime AT TIME ZONE $${params.length - 1})::date <= $${params.length}::date`);
    }

    const base = `
      WITH source AS (
        SELECT
          hotel_code,
          COALESCE(NULLIF(BTRIM(cleaning_type), ''), NULLIF(BTRIM(task_type), ''), 'Unknown Cleaning Type') AS cleaning_type_key,
          COALESCE(NULLIF(BTRIM(stay_status), ''), 'Unknown Stay Status') AS stay_status_key,
          COALESCE(NULLIF(BTRIM(attendant), ''), 'Unknown Attendant') AS attendant_key,
          COALESCE(NULLIF(BTRIM(floor), ''), 'Unknown Floor') AS floor_key,
          COALESCE(NULLIF(BTRIM(room_type), ''), 'Unknown Room Type') AS room_type_key,
          COALESCE(created_date, completed_time, start_time) AS event_datetime,
          COALESCE(is_completed, false) OR completed_time IS NOT NULL AS completed_flag,
          (COALESCE(is_completed, false) OR completed_time IS NOT NULL) AND (
            NOT COALESCE(is_on_time, false)
            OR COALESCE(duration_variance_minutes, 0) > 0
            OR COALESCE(ahead_behind_minutes, 0) > 0
            OR (actual_duration_minutes IS NOT NULL AND planned_duration_minutes IS NOT NULL AND actual_duration_minutes > planned_duration_minutes)
          ) AS behind_flag,
          COALESCE(actual_duration_minutes, duration_minutes, planned_duration_minutes,
            CASE WHEN ahead_behind_minutes IS NOT NULL THEN GREATEST(0, ahead_behind_minutes * -1) END
          )::numeric AS time_spent_minutes,
          planned_duration_minutes::numeric AS standard_minutes,
          COALESCE(duration_variance_minutes, ahead_behind_minutes,
            CASE WHEN actual_duration_minutes IS NOT NULL AND planned_duration_minutes IS NOT NULL
              THEN actual_duration_minutes - planned_duration_minutes END
          )::numeric AS variance_minutes,
          CASE
            WHEN COALESCE(reclean_flag, false) THEN 'Re-clean'
            WHEN (COALESCE(is_completed, false) OR completed_time IS NOT NULL) AND (
              NOT COALESCE(is_on_time, false)
              OR COALESCE(duration_variance_minutes, 0) > 0
              OR COALESCE(ahead_behind_minutes, 0) > 0
              OR (actual_duration_minutes IS NOT NULL AND planned_duration_minutes IS NOT NULL AND actual_duration_minutes > planned_duration_minutes)
            ) THEN 'Delayed'
            WHEN COALESCE(is_completed, false) OR completed_time IS NOT NULL THEN 'Completed'
            WHEN start_time IS NOT NULL AND completed_time IS NULL THEN 'In Progress'
            ELSE COALESCE(NULLIF(BTRIM(status_normalized), ''), NULLIF(BTRIM(pass_fail), ''), NULLIF(BTRIM(additional_task_status), ''), NULLIF(BTRIM(status), ''), 'Unknown')
          END AS derived_status,
          cleaning_order_no,
          room_no,
          service_round,
          start_time,
          completed_time,
          cleaning_credit,
          row_number
        FROM co_records
        WHERE chain_code = $1
      ), base AS (
        SELECT * FROM source WHERE ${scopedWhere.length > 0 ? scopedWhere.join(' AND ') : 'TRUE'}
      )`;

    const validDuration = `time_spent_minutes IS NOT NULL AND time_spent_minutes >= 0 AND time_spent_minutes < 10080`;
    let sql = '';

    if (level === 'hotels') {
      sql = `${base}
        SELECT
          hotel_code AS name,
          COUNT(*) FILTER (WHERE completed_flag)::int AS rooms_cleaned,
          COUNT(DISTINCT cleaning_type_key) FILTER (WHERE completed_flag)::int AS cleaning_types,
          COUNT(DISTINCT attendant_key) FILTER (WHERE completed_flag)::int AS attendants,
          ROUND(COALESCE(SUM(cleaning_credit) FILTER (WHERE completed_flag), 0), 1)::float8 AS credits,
          ROUND(AVG(time_spent_minutes) FILTER (WHERE completed_flag AND ${validDuration}), 1)::float8 AS avg_time_minutes
        FROM base
        GROUP BY hotel_code
        ORDER BY rooms_cleaned DESC, name ASC`;
    } else if (level === 'cleaning_types') {
      sql = `${base}, grouped AS (
        SELECT
          cleaning_type_key AS name,
          COUNT(*)::int AS cleaning_records,
          COUNT(DISTINCT attendant_key)::int AS attendants,
          ROUND(AVG(time_spent_minutes) FILTER (WHERE completed_flag AND ${validDuration}), 1)::float8 AS avg_time_minutes,
          ROUND(COALESCE(SUM(cleaning_credit) FILTER (WHERE completed_flag), 0), 1)::float8 AS credits
        FROM base
        GROUP BY cleaning_type_key
      )
      SELECT *, ROUND(100.0 * cleaning_records / NULLIF(SUM(cleaning_records) OVER (), 0), 1)::float8 AS share
      FROM grouped ORDER BY cleaning_records DESC, name ASC`;
    } else if (level === 'stay_statuses') {
      sql = `${base}, grouped AS (
        SELECT
          stay_status_key AS name,
          COUNT(*)::int AS rooms,
          COUNT(DISTINCT attendant_key)::int AS attendants,
          ROUND(AVG(time_spent_minutes) FILTER (WHERE completed_flag AND ${validDuration}), 1)::float8 AS avg_time_minutes,
          ROUND(COALESCE(SUM(cleaning_credit) FILTER (WHERE completed_flag), 0), 1)::float8 AS credits,
          COUNT(*) FILTER (WHERE behind_flag)::int AS behind_target
        FROM base
        GROUP BY stay_status_key
      )
      SELECT *, ROUND(100.0 * rooms / NULLIF(SUM(rooms) OVER (), 0), 1)::float8 AS share
      FROM grouped ORDER BY rooms DESC, name ASC`;
    } else if (level === 'attendants') {
      sql = `${base}
        SELECT
          attendant_key AS name,
          COUNT(*)::int AS rooms,
          COUNT(DISTINCT floor_key)::int AS floors,
          ROUND(AVG(time_spent_minutes) FILTER (WHERE completed_flag AND ${validDuration}), 1)::float8 AS avg_time_minutes,
          ROUND(COALESCE(SUM(cleaning_credit) FILTER (WHERE completed_flag), 0), 1)::float8 AS cleaning_credits,
          ROUND(COALESCE(SUM(cleaning_credit) FILTER (WHERE completed_flag), 0) / NULLIF(COUNT(*) FILTER (WHERE completed_flag), 0), 2)::float8 AS credits_per_room,
          COUNT(*) FILTER (WHERE behind_flag)::int AS behind_target
        FROM base
        GROUP BY attendant_key
        ORDER BY rooms DESC, name ASC`;
    } else {
      sql = `${base}
        SELECT
          COALESCE(NULLIF(BTRIM(cleaning_order_no), ''), 'Unknown Order') AS cleaning_order_no,
          COALESCE(NULLIF(BTRIM(room_no), ''), '—') AS room,
          floor_key AS floor,
          COALESCE(NULLIF(BTRIM(service_round), ''), '—') AS service_round,
          start_time,
          completed_time,
          CASE WHEN ${validDuration} THEN ROUND(time_spent_minutes, 1)::float8 END AS time_spent_minutes,
          CASE WHEN standard_minutes IS NOT NULL AND standard_minutes >= 0 THEN ROUND(standard_minutes, 1)::float8 END AS standard_minutes,
          CASE WHEN variance_minutes IS NOT NULL THEN ROUND(variance_minutes, 1)::float8 END AS variance_minutes,
          ROUND(COALESCE(cleaning_credit, 0), 2)::float8 AS credit,
          CASE
            WHEN NOT completed_flag OR variance_minutes IS NULL THEN 'watch'
            WHEN variance_minutes <= 0 THEN 'good'
            WHEN variance_minutes <= 15 THEN 'watch'
            ELSE 'bad'
          END AS flag
        FROM base
        ORDER BY cleaning_order_no ASC, row_number ASC`;
    }

    const result = await getPool().query(sql, params);
    return NextResponse.json({ level, timezone, rows: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load CO table data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
