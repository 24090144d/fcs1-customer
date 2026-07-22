import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/supabaseCompat';
import { resolveLiveTimezone } from '@/lib/dashboard-fetch';

type TableLevel = 'hotels' | 'departments' | 'categories' | 'items' | 'details';

const LEVELS = new Set<TableLevel>(['hotels', 'departments', 'categories', 'items', 'details']);
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
    const department = clean(url.searchParams.get('department'));
    const category = clean(url.searchParams.get('category'));
    const item = clean(url.searchParams.get('item'));
    const orderType = clean(url.searchParams.get('type'), 2).toUpperCase() || 'MO';
    const from = clean(url.searchParams.get('from'), 10);
    const to = clean(url.searchParams.get('to'), 10);

    if (!LEVELS.has(level) || !chain || !['MO', 'PM'].includes(orderType)) {
      return NextResponse.json({ error: 'Valid level and chain are required.' }, { status: 400 });
    }
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'Invalid date range.' }, { status: 400 });
    }
    if (level !== 'hotels' && !hotel) {
      return NextResponse.json({ error: 'hotel is required for this level.' }, { status: 400 });
    }
    if (['categories', 'items', 'details'].includes(level) && !department) {
      return NextResponse.json({ error: 'department is required for this level.' }, { status: 400 });
    }
    if (['items', 'details'].includes(level) && !category) {
      return NextResponse.json({ error: 'category is required for this level.' }, { status: 400 });
    }
    if (level === 'details' && !item) {
      return NextResponse.json({ error: 'item is required for details.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const timezone = await resolveLiveTimezone(supabase, 'mo_records', hotel ? [hotel] : [], chain);
    const params: unknown[] = [chain, orderType];
    const scopedWhere: string[] = [];
    const add = (value: unknown, sql: (index: number) => string) => {
      params.push(value);
      scopedWhere.push(sql(params.length));
    };

    if (hotel && hotel !== 'ALL') add(hotel, (i) => `hotel_code = $${i}`);
    if (department) add(department, (i) => `department = $${i}`);
    if (category) add(category, (i) => `category = $${i}`);
    if (item) add(item, (i) => `item = $${i}`);
    if (from) {
      params.push(timezone, from);
      scopedWhere.push(`(created_datetime AT TIME ZONE $${params.length - 1})::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(timezone, to);
      scopedWhere.push(`(created_datetime AT TIME ZONE $${params.length - 1})::date <= $${params.length}::date`);
    }

    const base = `
      WITH source AS (
        SELECT
          hotel_code,
          COALESCE(NULLIF(BTRIM(created_by_department), ''), 'Unknown Department') AS department,
          COALESCE(NULLIF(BTRIM(category), ''), 'Uncategorized') AS category,
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
          job_order,
          created_datetime,
          location,
          COALESCE(stock_out_qty_num, 0)::numeric AS quantity,
          assigned_to,
          completed_by,
          guest_name
        FROM mo_records
        WHERE chain_code = $1 AND type = $2
      ), base AS (
        SELECT * FROM source WHERE ${scopedWhere.length > 0 ? scopedWhere.join(' AND ') : 'TRUE'}
      )`;

    const validDuration = `duration_minutes IS NOT NULL AND duration_minutes >= 0 AND duration_minutes < 5256000`;
    let sql = '';

    if (level === 'hotels' || level === 'departments' || level === 'categories') {
      const key = level === 'hotels' ? 'hotel_code' : level === 'departments' ? 'department' : 'category';
      const distinctKey = level === 'hotels' ? 'department' : 'item';
      sql = `${base}
        SELECT
          ${key} AS name,
          COUNT(*)::int AS total_jobs,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE delayed_flag)::int AS delayed,
          COUNT(*) FILTER (WHERE cancelled_flag)::int AS cancelled,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          COUNT(DISTINCT ${distinctKey})::int AS distinct_count,
          ROUND(AVG(duration_minutes) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration_minutes
        FROM base
        GROUP BY ${key}
        ORDER BY total_jobs DESC, name ASC`;
    } else if (level === 'items') {
      sql = `${base}
        SELECT
          item AS name,
          COUNT(*)::int AS total_jobs,
          COALESCE(SUM(quantity), 0)::float8 AS quantity,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE delayed_flag)::int AS delayed,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_minutes) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration_minutes
        FROM base
        GROUP BY item
        ORDER BY total_jobs DESC, name ASC`;
    } else {
      sql = `${base}
        SELECT
          COALESCE(NULLIF(BTRIM(job_order), ''), 'Unknown Job') AS job_order,
          created_datetime,
          COALESCE(NULLIF(BTRIM(location), ''), '—') AS location,
          status,
          COALESCE(NULLIF(BTRIM(assigned_to), ''), '—') AS assigned_to,
          COALESCE(NULLIF(BTRIM(completed_by), ''), '—') AS completed_by,
          CASE WHEN ${validDuration} THEN ROUND(duration_minutes, 1)::float8 END AS duration_minutes,
          CASE WHEN delay_minutes IS NOT NULL THEN ROUND(delay_minutes, 1)::float8 END AS delay_minutes,
          COALESCE(NULLIF(BTRIM(guest_name), ''), '—') AS guest_name
        FROM base
        ORDER BY job_order ASC, created_datetime ASC`;
    }

    const result = await getPool().query(sql, params);
    return NextResponse.json({ level, timezone, type: orderType, rows: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load MO table data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

