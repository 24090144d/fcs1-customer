import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/supabaseCompat';
import { resolveLiveTimezone } from '@/lib/dashboard-fetch';

type TableLevel = 'hotels' | 'dists' | 'items' | 'dates' | 'details';

const LEVELS = new Set<TableLevel>(['hotels', 'dists', 'items', 'dates', 'details']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: string | null, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInt(value: string | null): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const level = clean(url.searchParams.get('level'), 24) as TableLevel;
    const chain = clean(url.searchParams.get('chain'), 32).toUpperCase();
    const hotel = clean(url.searchParams.get('hotel'), 64).toUpperCase();
    const item = clean(url.searchParams.get('item'));
    const date = clean(url.searchParams.get('date'), 10);
    const from = clean(url.searchParams.get('from'), 10);
    const to = clean(url.searchParams.get('to'), 10);
    const distStart = positiveInt(url.searchParams.get('dist_start'));
    const distEnd = positiveInt(url.searchParams.get('dist_end'));
    const floor = clean(url.searchParams.get('floor'));
    const attendant = clean(url.searchParams.get('filter_attendant'));
    const roomType = clean(url.searchParams.get('room_type'));
    const status = clean(url.searchParams.get('status_filter'));

    if (!LEVELS.has(level) || !chain) {
      return NextResponse.json({ error: 'Valid level and chain are required.' }, { status: 400 });
    }
    if ([from, to, date].some((value) => value && !DATE_RE.test(value)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'Invalid date selection.' }, { status: 400 });
    }
    if (level !== 'hotels' && !hotel) {
      return NextResponse.json({ error: 'hotel is required for this level.' }, { status: 400 });
    }
    if (level === 'items' && (!distStart || !distEnd || distStart > distEnd)) {
      return NextResponse.json({ error: 'A valid attendant distribution range is required.' }, { status: 400 });
    }
    if (['dates', 'details'].includes(level) && !item) {
      return NextResponse.json({ error: 'item is required for this level.' }, { status: 400 });
    }
    if (level === 'details' && !date) {
      return NextResponse.json({ error: 'date is required for details.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const timezone = await resolveLiveTimezone(supabase, 'co_records', hotel ? [hotel] : [], chain);
    const params: unknown[] = [chain];
    const scopedWhere: string[] = [];
    const add = (value: unknown, sql: (index: number) => string) => {
      params.push(value);
      scopedWhere.push(sql(params.length));
    };

    if (hotel && hotel !== 'ALL') add(hotel, (index) => `hotel_code = $${index}`);
    if (from) add(from, (index) => `source_date >= $${index}::date`);
    if (to) add(to, (index) => `source_date <= $${index}::date`);
    if (floor && floor !== 'ALL') add(floor, (index) => `floor_key = $${index}`);
    if (attendant && attendant !== 'ALL') add(attendant, (index) => `item = $${index}`);
    if (roomType && roomType !== 'ALL') add(roomType, (index) => `room_type_key = $${index}`);
    if (status && status !== 'ALL') add(status, (index) => `status = $${index}`);

    const base = `
      WITH source AS (
        SELECT
          hotel_code,
          COALESCE(NULLIF(BTRIM(attendant), ''), 'Unknown Attendant') AS item,
          COALESCE(NULLIF(BTRIM(floor), ''), 'Unknown Floor') AS floor_key,
          COALESCE(NULLIF(BTRIM(room_type), ''), 'Unknown Room Type') AS room_type_key,
          COALESCE(NULLIF(BTRIM(supervisor), ''), 'Inspector') AS inspector,
          COALESCE(created_date, completed_time, start_time) AS event_datetime,
          (COALESCE(created_date, completed_time, start_time) AT TIME ZONE 'UTC')::date AS source_date,
          COALESCE(is_completed, false) OR completed_time IS NOT NULL AS completed_flag,
          (COALESCE(is_completed, false) OR completed_time IS NOT NULL) AND (
            NOT COALESCE(is_on_time, false)
            OR COALESCE(duration_variance_minutes, 0) > 0
            OR COALESCE(ahead_behind_minutes, 0) > 0
            OR (actual_duration_minutes IS NOT NULL AND planned_duration_minutes IS NOT NULL
              AND actual_duration_minutes > planned_duration_minutes)
          ) AS exception_flag,
          COALESCE(actual_duration_minutes, duration_minutes, planned_duration_minutes,
            CASE WHEN ahead_behind_minutes IS NOT NULL THEN GREATEST(0, ahead_behind_minutes * -1) END
          )::numeric AS duration_minutes,
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
              OR (actual_duration_minutes IS NOT NULL AND planned_duration_minutes IS NOT NULL
                AND actual_duration_minutes > planned_duration_minutes)
            ) THEN 'Delayed'
            WHEN COALESCE(is_completed, false) OR completed_time IS NOT NULL THEN 'Completed'
            WHEN start_time IS NOT NULL AND completed_time IS NULL THEN 'In Progress'
            ELSE COALESCE(NULLIF(BTRIM(status_normalized), ''), NULLIF(BTRIM(pass_fail), ''),
              NULLIF(BTRIM(additional_task_status), ''), NULLIF(BTRIM(status), ''), 'Unknown')
          END AS status,
          COALESCE(NULLIF(BTRIM(cleaning_order_no), ''), 'Unknown Order') AS record_id,
          room_no,
          service_round,
          start_time,
          completed_time,
          cleaning_credit,
          row_number
        FROM co_records
        WHERE chain_code = $1
          AND COALESCE(created_date, completed_time, start_time) IS NOT NULL
      ), base AS (
        SELECT * FROM source WHERE ${scopedWhere.length > 0 ? scopedWhere.join(' AND ') : 'TRUE'}
      )`;
    const validDuration = `duration_minutes IS NOT NULL AND duration_minutes >= 0 AND duration_minutes < 10080`;
    const itemAgg = `
      item_agg AS (
        SELECT
          item AS name,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE exception_flag)::int AS exception_count,
          COUNT(DISTINCT source_date)::int AS active_days,
          COUNT(*) FILTER (WHERE ${validDuration})::int AS duration_count,
          COALESCE(SUM(duration_minutes) FILTER (WHERE ${validDuration}), 0)::float8 AS duration_sum_minutes,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_minutes) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration
        FROM base
        GROUP BY item
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY total DESC, name ASC)::int AS item_rank,
               COUNT(*) OVER ()::int AS total_items
        FROM item_agg
      ), ranged AS (
        SELECT *, CASE WHEN total_items > 500 THEN 50 WHEN total_items > 200 THEN 20 ELSE 10 END AS range_width
        FROM ranked
      ), bucketed AS (
        SELECT *,
          (((item_rank - 1) / range_width) * range_width + 1)::int AS range_start,
          LEAST((((item_rank - 1) / range_width) + 1) * range_width, total_items)::int AS range_end
        FROM ranged
      )`;

    let sql = '';
    if (level === 'hotels') {
      sql = `${base}
        SELECT hotel_code AS name, COUNT(*)::int AS total,
          COUNT(DISTINCT item)::int AS distinct_count, COUNT(DISTINCT source_date)::int AS active_days,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE exception_flag)::int AS exception_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_minutes) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration
        FROM base GROUP BY hotel_code ORDER BY total DESC, name ASC`;
    } else if (level === 'dists') {
      sql = `${base}, ${itemAgg}
        SELECT CASE WHEN range_end = MAX(total_items) AND range_end - range_start + 1 < MAX(range_width)
          THEN range_start::text || '+' ELSE range_start::text || '-' || range_end::text END AS name,
          range_start, range_end, COUNT(*)::int AS distinct_count, SUM(total)::int AS total,
          SUM(completed)::int AS completed, SUM(exception_count)::int AS exception_count,
          ROUND(100.0 * SUM(completed) / NULLIF(SUM(total), 0), 1)::float8 AS completion_rate,
          ROUND((SUM(duration_sum_minutes) / NULLIF(SUM(duration_count), 0))::numeric, 1)::float8 AS avg_duration
        FROM bucketed GROUP BY range_start, range_end ORDER BY range_start`;
    } else if (level === 'items') {
      params.push(distStart, distEnd);
      sql = `${base}, ${itemAgg}
        SELECT name, item_rank, total, completed, exception_count, active_days, completion_rate, avg_duration
        FROM bucketed WHERE item_rank BETWEEN $${params.length - 1} AND $${params.length}
        ORDER BY item_rank`;
    } else if (level === 'dates') {
      params.push(item);
      sql = `${base}
        SELECT source_date::text AS name, COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE exception_flag)::int AS exception_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_minutes) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration
        FROM base WHERE item = $${params.length}
        GROUP BY source_date ORDER BY source_date ASC`;
    } else {
      params.push(item, date);
      sql = `${base}
        SELECT record_id, start_time AS created_datetime, completed_time AS completed_datetime,
          room_no, floor_key AS floor, service_round, inspector, status,
          CASE WHEN ${validDuration} THEN ROUND(duration_minutes, 1)::float8 END AS duration,
          CASE WHEN standard_minutes IS NOT NULL THEN ROUND(standard_minutes, 1)::float8 END AS standard,
          CASE WHEN variance_minutes IS NOT NULL THEN ROUND(variance_minutes, 1)::float8 END AS variance,
          COALESCE(cleaning_credit, 0)::float8 AS credit
        FROM base WHERE item = $${params.length - 1} AND source_date = $${params.length}::date
        ORDER BY event_datetime ASC, record_id ASC, row_number ASC`;
    }

    const result = await getPool().query(sql, params);
    return NextResponse.json({ level, timezone, rows: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load CO daily trend table data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
