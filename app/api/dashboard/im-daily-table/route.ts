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
      return NextResponse.json({ error: 'A valid incident distribution range is required.' }, { status: 400 });
    }
    if (['dates', 'details'].includes(level) && !item) {
      return NextResponse.json({ error: 'item is required for this level.' }, { status: 400 });
    }
    if (level === 'details' && !date) {
      return NextResponse.json({ error: 'date is required for details.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const timezone = await resolveLiveTimezone(supabase, 'im_records', hotel ? [hotel] : [], chain);
    const params: unknown[] = [chain];
    const scopedWhere: string[] = [];
    const add = (value: unknown, sql: (index: number) => string) => {
      params.push(value);
      scopedWhere.push(sql(params.length));
    };

    if (hotel && hotel !== 'ALL') add(hotel, (index) => `hotel_code = $${index}`);
    if (from) add(from, (index) => `source_date >= $${index}::date`);
    if (to) add(to, (index) => `source_date <= $${index}::date`);

    const base = `
      WITH source AS (
        SELECT
          hotel_code,
          COALESCE(NULLIF(BTRIM(incident_item_name), ''), 'Unknown Incident') AS item,
          COALESCE(NULLIF(BTRIM(incident_status), ''), 'Unknown') AS status,
          COALESCE(NULLIF(BTRIM(severity), ''), 'Unknown') AS severity,
          COALESCE(created_date, incident_datetime) AS occurred_at,
          COALESCE(investigation_updated_on_2, investigation_updated_on_1) AS completed_at,
          (COALESCE(created_date, incident_datetime) AT TIME ZONE 'UTC')::date AS source_date,
          incident_case,
          room_no,
          guest_name,
          source_of_complaint
        FROM im_records
        WHERE chain_code = $1
          AND COALESCE(created_date, incident_datetime) IS NOT NULL
      ), base AS (
        SELECT
          *,
          status ~* '(completed|closed)' AS completed_flag,
          status !~* '(completed|closed)' AS exception_flag,
          CASE WHEN completed_at IS NOT NULL AND occurred_at IS NOT NULL
              AND completed_at >= occurred_at AND completed_at < occurred_at + INTERVAL '3650 days'
            THEN EXTRACT(EPOCH FROM (completed_at - occurred_at)) / 3600.0 END::numeric AS duration_hours
        FROM source
        WHERE ${scopedWhere.length > 0 ? scopedWhere.join(' AND ') : 'TRUE'}
      )`;
    const validDuration = `duration_hours IS NOT NULL AND duration_hours >= 0 AND duration_hours < 87600`;
    const itemAgg = `
      item_agg AS (
        SELECT
          item AS name,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE exception_flag)::int AS exception_count,
          COUNT(DISTINCT source_date)::int AS active_days,
          COUNT(*) FILTER (WHERE ${validDuration})::int AS duration_count,
          COALESCE(SUM(duration_hours) FILTER (WHERE ${validDuration}), 0)::float8 AS duration_sum_hours,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_hours) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration
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
          COUNT(*) FILTER (WHERE exception_flag)::int AS exception_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_hours) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration
        FROM base
        GROUP BY hotel_code
        ORDER BY total DESC, name ASC`;
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
          ROUND(100.0 * SUM(completed) / NULLIF(SUM(total), 0), 1)::float8 AS completion_rate,
          ROUND((SUM(duration_sum_hours) / NULLIF(SUM(duration_count), 0))::numeric, 1)::float8 AS avg_duration
        FROM bucketed
        GROUP BY range_start, range_end
        ORDER BY range_start`;
    } else if (level === 'items') {
      params.push(distStart, distEnd);
      sql = `${base}, ${itemAgg}
        SELECT name, item_rank, total, completed, exception_count, active_days,
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
          COUNT(*) FILTER (WHERE completed_flag)::int AS completed,
          COUNT(*) FILTER (WHERE exception_flag)::int AS exception_count,
          COUNT(*) FILTER (WHERE severity ~* '^(high|critical)$')::int AS high_critical,
          ROUND(100.0 * COUNT(*) FILTER (WHERE completed_flag) / NULLIF(COUNT(*), 0), 1)::float8 AS completion_rate,
          ROUND(AVG(duration_hours) FILTER (WHERE ${validDuration}), 1)::float8 AS avg_duration
        FROM base
        WHERE item = $${params.length}
        GROUP BY source_date
        ORDER BY source_date ASC`;
    } else {
      params.push(item, date);
      sql = `${base}
        SELECT
          COALESCE(NULLIF(BTRIM(incident_case), ''), 'Unknown Case') AS record_id,
          occurred_at AS created_datetime,
          completed_at AS completed_datetime,
          COALESCE(NULLIF(BTRIM(room_no), ''), '—') AS room_no,
          COALESCE(NULLIF(BTRIM(guest_name), ''), '—') AS guest_name,
          status,
          severity,
          COALESCE(NULLIF(BTRIM(source_of_complaint), ''), '—') AS complaint_source,
          CASE WHEN ${validDuration} THEN ROUND(duration_hours, 1)::float8 END AS duration
        FROM base
        WHERE item = $${params.length - 1}
          AND source_date = $${params.length}::date
        ORDER BY incident_case ASC, occurred_at ASC`;
    }

    const result = await getPool().query(sql, params);
    return NextResponse.json({ level, timezone, rows: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load IM daily trend table data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
