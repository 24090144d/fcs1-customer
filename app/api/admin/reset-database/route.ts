import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/supabaseCompat';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ResetModule = 'ALL' | 'JO' | 'MO' | 'CO' | 'IM';
type ResetAction = 'preview' | 'execute';

export interface TableStat {
  table_name: string;
  label: string;
  row_count: number;
  size: string;
  size_bytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module → table mapping
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_TABLES: Record<ResetModule, string[]> = {
  IM: ['im_records', 'im_staging_rows', 'im_dashboard_json'],
  JO: ['jo_records', 'jo_staging_rows', 'jo_dashboard_json'],
  MO: ['mo_records', 'mo_staging_rows', 'mo_dashboard_json'],
  CO: ['co_records', 'co_staging_rows', 'co_dashboard_json'],
  ALL: [
    'im_records', 'im_staging_rows', 'im_dashboard_json',
    'jo_records', 'jo_staging_rows', 'jo_dashboard_json',
    'mo_records', 'mo_staging_rows', 'mo_dashboard_json',
    'co_records', 'co_staging_rows', 'co_dashboard_json',
    'organizations', 'upload_jobs', 'uploaded_files',
    'user_chart_visibility', 'ai_chart_definitions',
  ],
};

const TABLE_LABELS: Record<string, string> = {
  im_records:          'IM Records',
  im_staging_rows:     'IM Staging',
  im_dashboard_json:   'IM Dashboard Cache',
  jo_records:          'JO Records',
  jo_staging_rows:     'JO Staging',
  jo_dashboard_json:   'JO Dashboard Cache',
  mo_records:          'MO Records',
  mo_staging_rows:     'MO Staging',
  mo_dashboard_json:   'MO Dashboard Cache',
  co_records:          'CO Records',
  co_staging_rows:     'CO Staging',
  co_dashboard_json:   'CO Dashboard Cache',
  organizations:       'Organizations',
  upload_jobs:         'Upload Jobs',
  uploaded_files:      'Uploaded Files',
  user_chart_visibility: 'Chart Visibility Settings',
  ai_chart_definitions:  'AI Chart Definitions',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function todayPasswordHKT(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const yy = parts.find((p) => p.type === 'year')?.value ?? '';
  const mm = parts.find((p) => p.type === 'month')?.value ?? '';
  const dd = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${yy}${mm}${dd}`;
}

async function getTableStats(
  pool: ReturnType<typeof getPool>,
  tables: string[],
): Promise<TableStat[]> {
  const stats: TableStat[] = [];
  for (const t of tables) {
    try {
      const { rows } = await pool.query<{ cnt: string; sz: string; sz_bytes: string }>(
        `SELECT count(*) AS cnt,
                pg_size_pretty(pg_total_relation_size($1)) AS sz,
                pg_total_relation_size($1)::text AS sz_bytes
         FROM ${quoteIdent(t)}`,
        [t],
      );
      stats.push({
        table_name: t,
        label:      TABLE_LABELS[t] ?? t,
        row_count:  parseInt(rows[0]?.cnt ?? '0', 10),
        size:       rows[0]?.sz ?? '0 bytes',
        size_bytes: parseInt(rows[0]?.sz_bytes ?? '0', 10),
      });
    } catch {
      // table may not exist in this deployment — skip silently
      stats.push({ table_name: t, label: TABLE_LABELS[t] ?? t, row_count: 0, size: 'n/a', size_bytes: 0 });
    }
  }
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    let password = '', module: ResetModule = 'ALL', action: ResetAction = 'execute';
    try {
      const body = await req.json() as { password?: string; module?: string; action?: string };
      password = String(body?.password ?? '');
      module   = (['ALL', 'JO', 'MO', 'CO', 'IM'].includes(body?.module ?? '')
        ? (body!.module as ResetModule)
        : 'ALL');
      action   = body?.action === 'preview' ? 'preview' : 'execute';
    } catch { /* empty / malformed body */ }

    const expected = todayPasswordHKT();
    if (password !== expected) {
      return NextResponse.json({ ok: false, error: 'Invalid reset password' }, { status: 403 });
    }

    const pool   = getPool();
    const tables = MODULE_TABLES[module];

    // ── Preview: return row counts + sizes, no mutations ─────────────────────
    if (action === 'preview') {
      const stats = await getTableStats(pool, tables);
      return NextResponse.json({ ok: true, module, tables: stats });
    }

    // ── Execute: TRUNCATE then VACUUM ANALYZE ─────────────────────────────────
    const tableList = tables.map(quoteIdent).join(', ');
    let identityReset = true;
    try {
      await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (msg.includes('must be owner of sequence')) {
        identityReset = false;
        await pool.query(`TRUNCATE TABLE ${tableList} CASCADE`);
      } else {
        throw e;
      }
    }

    // VACUUM ANALYZE — reclaims disk space; silently skip on failure (e.g. pooled connections)
    let vacuumed = 0;
    for (const t of tables) {
      try {
        await pool.query(`VACUUM ANALYZE ${quoteIdent(t)}`);
        vacuumed++;
      } catch { /* non-critical */ }
    }

    const label = module === 'ALL' ? 'All modules' : `${module} module`;
    return NextResponse.json({
      ok: true,
      module,
      truncated_tables: tables.length,
      vacuumed_tables:  vacuumed,
      identity_reset:   identityReset,
      message: `${label} reset completed — ${tables.length} tables truncated${vacuumed > 0 ? `, ${vacuumed} vacuumed` : ''}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reset failure';
    console.error('[reset-database]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
