import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/supabaseCompat';
import { resolveLiveTimezone } from '@/lib/dashboard-fetch';

type TableLevel = 'hotels' | 'groups' | 'dists' | 'items' | 'dates' | 'details';

const LEVELS = new Set<TableLevel>(['hotels', 'groups', 'dists', 'items', 'dates', 'details']);
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
    const group = clean(url.searchParams.get('group'));
    const item = clean(url.searchParams.get('item'));
    const date = clean(url.searchParams.get('date'), 10);
    const from = clean(url.searchParams.get('from'), 10);
    const to = clean(url.searchParams.get('to'), 10);
    const orderType = clean(url.searchParams.get('type'), 2).toUpperCase() || 'MO';
    const distStart = positiveInt(url.searchParams.get('dist_start'));
    const distEnd = positiveInt(url.searchParams.get('dist_end'));

    if (!LEVELS.has(level) || !chain || !['MO', 'PM'].includes(orderType)) {
      return NextResponse.json({ error: 'Valid level, chain, and maintenance type are required.' }, { status: 400 });
    }
    if ([from, to, date].some((value) => value && !DATE_RE.test(value)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'Invalid date selection.' }, { status: 400 });
    }
    if (level !== 'hotels' && !hotel) {
      return NextResponse.json({ error: 'hotel is required for this level.' }, { status: 400 });
    }
    if (level === 'items' && (!distStart || !distEnd || distStart > distEnd)) {
      return NextResponse.json({ error: 'A valid defect distribution range is required.' }, { status: 400 });
    }
    if (['dates', 'details'].includes(level) && !item) {
      return NextResponse.json({ error: 'item is required for this level.' }, { status: 400 });
    }
    if (level === 'details' && !date) {
      return NextResponse.json({ error: 'date is required for details.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const timezone = await resolveLiveTimezone(supabase, 'mo_records', hotel ? [hotel] : [], chain);
    const params: unknown[] = [chain, orderType];
    const scopedWhere: string[] = [];
    const add = (value: unknown, sql: (index: number) => string) => {
      params.push(value);
      scopedWhere.push(sql(params.length));
    };

    if (hotel && hotel !== 'ALL') add(hotel, (index) => `hotel_code = $${index}`);
    if (group) add(group, (index) => `group_key = $${index}`);
    if (from) add(from, (index) => `source_date >= $${index}::date`);
    if (to) add(to, (index) => `source_date <= $${index}::date`);

    const base = `
      WITH source AS (
        SELECT
          hotel_code,
          COALESCE(NULLIF(BTRIM(created_by_department), ''), 'Unknown Department') AS group_key,
          COALESCE(NULLIF(BTRIM(defect), ''), NULLIF(BTRIM(asset), ''), 'Unknown Defect') AS item,
          COALESCE(NULLIF(BTRIM(job_status), ''), 'Unknown') AS status,
          COALESCE(is_completed, false) OR COALESCE(job_status, '') ~* '(complete|closed|done|finish)' AS completed_flag,
          COALESCE(is_cancelled, false) OR COALESCE(job_status, '') ~* 'cancel' AS cancelled_flag,
          COALESCE(is_overdue, false) OR COALESCE(deadline_variance_minutes, 0) > 0 AS delayed_flag,
          COALESCE(resolution_minutes,
            CASE WHEN completed_datetime IS NOT NULL AND created_datetime IS NOT NULL AND completed_datetime >= created_datetime
              THEN EXTRACT(EPOCH FROM (completed_datetime - created_datetime)) / 60.0 END
          )::numeric AS duration_minutes,
          CASE
            WHEN COALESCE(deadline_variance_minutes, 0) > 0 THEN deadline_variance_minutes
            WHEN deadline_datetime IS NOT NULL
              AND COALESCE(completed_datetime, CURRENT_TIMESTAMP) > deadline_datetime
              THEN EXTRACT(EPOCH FROM (COALESCE(completed_datetime, CURRENT_TIMESTAMP) - deadline_datetime)) / 60.0
          END::numeric AS delay_minutes,
          (created_datetime AT TIME ZONE 'UTC')::date AS source_date,
          job_order,
          created_datetime,
          completed_datetime,
          location,
          COALESCE(stock_out_qty_num, 0)::numeric AS quantity,
          assigned_to,
          completed_by,
          guest_name
        FROM mo_records
        WHERE chain_code = $1
          AND type = $2
          AND created_datetime IS NOT NULL
      ), base AS (
        SELECT * FROM source WHERE ${scopedWhere.length > 0 ? scopedWhere.join(' AND ') : 'TRUE'}
      )`;
    const validDuration = `duration_minutes IS NOT NULL AND duration_minutes >= 0 AND duration_minutes < 5256000`;
    const itemAgg = `
      item_agg AS (
        SELECT
          item AS name,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE delayed_flag)::int AS exception_count,
          COUNT(*) FILTER (WHERE cancelled_flag)::int AS cancelled,
          COUNT(DISTINCT source_date)::int AS active_days,
          COUNT(*) FILTER (WHERE ${validDuration})::int AS duration_count,
          COALESCE(SUM(duration_minutes) FILTER (WHERE ${validDuration}), 0)::float8 AS duration_sum_minutes,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND((AVG(duration_minutes) FILTER (WHERE ${validDuration}) / 60.0)::numeric, 1)::float8 AS avg_duration
        FROM base
        GROUP BY item
      ), ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (ORDER BY total DESC, name ASC)::int AS item_rank,
          COUNT(*) OVER ()::int AS total_items
        FROM item_agg
      ), ranged AS (
        SELECT
          *,
          CASE WHEN total_items > 500 THEN 50 WHEN total_items > 200 THEN 20 ELSE 10 END AS range_width
        FROM ranked
      ), bucketed AS (
        SELECT
          *,
          (((item_rank - 1) / range_width) * range_width + 1)::int AS range_start,
          LEAST((((item_rank - 1) / range_width) + 1) * range_width, total_items)::int AS range_end
        FROM ranged
      )`;

    let sql = '';
    if (level === 'hotels') {
      sql = `${base}
        SELECT
          hotel_code AS name,
          COUNT(*)::int AS total,
          COUNT(DISTINCT item)::int AS distinct_count,
          COUNT(DISTINCT source_date)::int AS active_days,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE delayed_flag)::int AS exception_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND((AVG(duration_minutes) FILTER (WHERE ${validDuration}) / 60.0)::numeric, 1)::float8 AS avg_duration
        FROM base
        GROUP BY hotel_code
        ORDER BY total DESC, name ASC`;
    } else if (level === 'groups') {
      sql = `${base}
        SELECT group_key AS name, COUNT(*)::int AS total,
          COUNT(DISTINCT item)::int AS distinct_count, COUNT(DISTINCT source_date)::int AS active_days,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE delayed_flag)::int AS exception_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND((AVG(duration_minutes) FILTER (WHERE ${validDuration}) / 60.0)::numeric, 1)::float8 AS avg_duration
        FROM base GROUP BY group_key ORDER BY total DESC, name ASC`;
    } else if (level === 'dists') {
      sql = `${base}, ${itemAgg}
        SELECT
          CASE
            WHEN range_end = MAX(total_items) AND range_end - range_start + 1 < MAX(range_width)
              THEN range_start::text || '+'
            ELSE range_start::text || '-' || range_end::text
          END AS name,
          range_start,
          range_end,
          COUNT(*)::int AS distinct_count,
          SUM(total)::int AS total,
          SUM(completed)::int AS completed,
          SUM(exception_count)::int AS exception_count,
          SUM(cancelled)::int AS cancelled,
          ROUND(100.0 * SUM(completed) / NULLIF(SUM(total), 0), 1)::float8 AS completion_rate,
          ROUND((SUM(duration_sum_minutes) / NULLIF(SUM(duration_count), 0) / 60.0)::numeric, 1)::float8 AS avg_duration
        FROM bucketed
        GROUP BY range_start, range_end
        ORDER BY range_start`;
    } else if (level === 'items') {
      params.push(distStart, distEnd);
      sql = `${base}, ${itemAgg}
        SELECT name, item_rank, total, completed, exception_count, cancelled, active_days,
               completion_rate, avg_duration
        FROM bucketed
        WHERE item_rank BETWEEN $${params.length - 1} AND $${params.length}
        ORDER BY item_rank`;
    } else if (level === 'dates') {
      params.push(item);
      sql = `${base}
        SELECT
          source_date::text AS name,
          COUNT(*)::int AS total,
          COALESCE(SUM(quantity), 0)::float8 AS quantity,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE delayed_flag)::int AS exception_count,
          COUNT(*) FILTER (WHERE cancelled_flag)::int AS cancelled,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND((AVG(duration_minutes) FILTER (WHERE ${validDuration}) / 60.0)::numeric, 1)::float8 AS avg_duration
        FROM base
        WHERE item = $${params.length}
        GROUP BY source_date
        ORDER BY source_date ASC`;
    } else {
      params.push(item, date);
      sql = `${base}
        SELECT
          COALESCE(NULLIF(BTRIM(job_order), ''), 'Unknown Order') AS record_id,
          created_datetime,
          completed_datetime,
          COALESCE(NULLIF(BTRIM(location), ''), '—') AS location,
          COALESCE(quantity, 0)::float8 AS quantity,
          status,
          COALESCE(NULLIF(BTRIM(assigned_to), ''), '—') AS assigned_to,
          COALESCE(NULLIF(BTRIM(completed_by), ''), '—') AS completed_by,
          CASE WHEN ${validDuration} THEN ROUND((duration_minutes / 60.0)::numeric, 1)::float8 END AS duration,
          CASE WHEN delay_minutes IS NOT NULL THEN ROUND((delay_minutes / 60.0)::numeric, 1)::float8 END AS delay,
          COALESCE(NULLIF(BTRIM(guest_name), ''), '—') AS guest_name
        FROM base
        WHERE item = $${params.length - 1}
          AND source_date = $${params.length}::date
        ORDER BY job_order ASC, created_datetime ASC`;
    }

    const result = await getPool().query(sql, params);
    return NextResponse.json({ level, timezone, type: orderType, rows: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load MO daily trend table data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
