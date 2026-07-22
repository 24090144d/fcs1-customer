import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/supabaseCompat';
import { resolveLiveTimezone } from '@/lib/dashboard-fetch';

type TableLevel = 'hotels' | 'departments' | 'categories' | 'incidents' | 'details';

const LEVELS = new Set<TableLevel>(['hotels', 'departments', 'categories', 'incidents', 'details']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: string | null, max = 160): string {
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
    const incident = clean(url.searchParams.get('incident'));
    const from = clean(url.searchParams.get('from'), 10);
    const to = clean(url.searchParams.get('to'), 10);

    if (!LEVELS.has(level) || !chain) {
      return NextResponse.json({ error: 'Valid level and chain are required.' }, { status: 400 });
    }
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'Invalid date range.' }, { status: 400 });
    }
    if (level !== 'hotels' && !hotel) {
      return NextResponse.json({ error: 'hotel is required for this level.' }, { status: 400 });
    }
    if (['categories', 'incidents', 'details'].includes(level) && !department) {
      return NextResponse.json({ error: 'department is required for this level.' }, { status: 400 });
    }
    if (['incidents', 'details'].includes(level) && !category) {
      return NextResponse.json({ error: 'category is required for this level.' }, { status: 400 });
    }
    if (level === 'details' && !incident) {
      return NextResponse.json({ error: 'incident is required for details.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const timezone = await resolveLiveTimezone(supabase, 'im_records', hotel ? [hotel] : [], chain);
    const params: unknown[] = [chain];
    const where = ['chain_code = $1'];
    const add = (value: unknown, sql: (index: number) => string) => {
      params.push(value);
      where.push(sql(params.length));
    };

    if (hotel && hotel !== 'ALL') add(hotel, (i) => `hotel_code = $${i}`);
    if (department) add(department, (i) => `COALESCE(NULLIF(BTRIM(department), ''), 'Unknown Department') = $${i}`);
    if (category) add(category, (i) => `COALESCE(NULLIF(BTRIM(incident_category), ''), 'Uncategorized') = $${i}`);
    if (incident) add(incident, (i) => `COALESCE(NULLIF(BTRIM(incident_item_name), ''), 'Unknown Incident') = $${i}`);
    if (from) {
      params.push(timezone, from);
      where.push(`(COALESCE(created_date, incident_datetime) AT TIME ZONE $${params.length - 1})::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(timezone, to);
      where.push(`(COALESCE(created_date, incident_datetime) AT TIME ZONE $${params.length - 1})::date <= $${params.length}::date`);
    }

    const base = `
      WITH base AS (
        SELECT
          hotel_code,
          COALESCE(NULLIF(BTRIM(department), ''), 'Unknown Department') AS department,
          COALESCE(NULLIF(BTRIM(incident_category), ''), 'Uncategorized') AS category,
          COALESCE(NULLIF(BTRIM(incident_item_name), ''), 'Unknown Incident') AS incident,
          incident_case,
          COALESCE(NULLIF(BTRIM(incident_status), ''), 'Unknown') AS status,
          COALESCE(NULLIF(BTRIM(severity), ''), 'Unknown') AS severity,
          COALESCE(created_date, incident_datetime) AS occurred_at,
          COALESCE(investigation_updated_on_2, investigation_updated_on_1) AS completed_at,
          room_no,
          guest_name,
          source_of_complaint
        FROM im_records
        WHERE ${where.join(' AND ')}
      )`;

    let sql = '';
    if (level === 'hotels' || level === 'departments' || level === 'categories') {
      const key = level === 'hotels' ? 'hotel_code' : level === 'departments' ? 'department' : 'category';
      sql = `${base}
        SELECT
          ${key} AS name,
          COUNT(*)::int AS cases,
          COUNT(*) FILTER (WHERE status ~* '(completed|closed)')::int AS completed,
          COUNT(*) FILTER (WHERE status !~* '(completed|closed)')::int AS not_completed,
          COUNT(*) FILTER (WHERE severity ~* '^(high|critical)$')::int AS high_critical,
          ROUND(100.0 * COUNT(*) FILTER (WHERE status ~* '(completed|closed)') / NULLIF(COUNT(*), 0), 1)::float8 AS closure_rate,
          ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - occurred_at)) / 3600.0)
            FILTER (WHERE completed_at IS NOT NULL AND occurred_at IS NOT NULL
              AND completed_at >= occurred_at AND completed_at < occurred_at + INTERVAL '3650 days'), 1)::float8 AS avg_duration_hours
        FROM base
        GROUP BY ${key}
        ORDER BY cases DESC, name ASC`;
    } else if (level === 'incidents') {
      sql = `${base}, totals AS (SELECT COUNT(*)::numeric AS total FROM base)
        SELECT
          incident AS name,
          COUNT(*)::int AS cases,
          COUNT(*) FILTER (WHERE status !~* '(completed|closed)')::int AS open,
          COUNT(*) FILTER (WHERE severity ~* '^(high|critical)$')::int AS high_critical,
          ROUND((100.0 * COUNT(*) / NULLIF((SELECT total FROM totals), 0))::numeric, 1)::float8 AS case_share,
          ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - occurred_at)) / 3600.0)
            FILTER (WHERE completed_at IS NOT NULL AND occurred_at IS NOT NULL
              AND completed_at >= occurred_at AND completed_at < occurred_at + INTERVAL '3650 days'), 1)::float8 AS avg_duration_hours
        FROM base
        GROUP BY incident
        ORDER BY cases DESC, name ASC`;
    } else {
      sql = `${base}
        SELECT
          COALESCE(NULLIF(BTRIM(incident_case), ''), 'Unknown Case') AS incident_case,
          occurred_at,
          COALESCE(NULLIF(BTRIM(room_no), ''), '—') AS room_no,
          COALESCE(NULLIF(BTRIM(guest_name), ''), '—') AS guest_name,
          status,
          severity,
          COALESCE(NULLIF(BTRIM(source_of_complaint), ''), '—') AS complaint_source
        FROM base
        ORDER BY incident_case ASC, occurred_at ASC`;
    }

    const result = await getPool().query(sql, params);
    return NextResponse.json({ level, timezone, rows: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load IM table data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
