import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/supabaseCompat';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ResetModule = 'ALL' | 'JO' | 'MO' | 'CO-ACSR' | 'CO-IR' | 'IM';
type ResetAction = 'preview' | 'execute' | 'compact';

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
  'CO-ACSR': ['co_records', 'co_staging_rows', 'co_dashboard_json'],
  'CO-IR': ['co_ir_records', 'co_staging_rows', 'co_dashboard_json'],
  ALL: [
    'im_records', 'im_staging_rows', 'im_dashboard_json',
    'jo_records', 'jo_staging_rows', 'jo_dashboard_json',
    'mo_records', 'mo_staging_rows', 'mo_dashboard_json',
    'co_records', 'co_staging_rows', 'co_dashboard_json',
    'co_ir_records',
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
  co_ir_records:       'CO IR Records',
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

function coSchema(module: 'CO-ACSR' | 'CO-IR'): string {
  return module === 'CO-IR' ? 'co-ir-v1' : 'co-v1';
}

async function getCoScopeStats(
  pool: ReturnType<typeof getPool>,
  module: 'CO-ACSR' | 'CO-IR',
): Promise<TableStat[]> {
  const recordTable = module === 'CO-IR' ? 'co_ir_records' : 'co_records';
  const recordStats = await getTableStats(pool, [recordTable]);
  const schema = coSchema(module);
  const shared: TableStat[] = [];
  for (const [table, label, condition] of [
    ['co_staging_rows', `${module} Staging`, `upload_job_id IN (SELECT upload_job_id FROM co_dashboard_json WHERE generated_json->'meta'->>'schema' = $1)`],
    ['co_dashboard_json', `${module} Dashboard Cache`, `generated_json->'meta'->>'schema' = $1`],
  ] as const) {
    try {
      const { rows } = await pool.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM ${quoteIdent(table)} WHERE ${condition}`,
        [schema],
      );
      shared.push({ table_name: table, label, row_count: parseInt(rows[0]?.cnt ?? '0', 10), size: 'shared table', size_bytes: 0 });
    } catch {
      shared.push({ table_name: table, label, row_count: 0, size: 'n/a', size_bytes: 0 });
    }
  }
  recordStats[0] = { ...recordStats[0], label: `${module} Records` };
  return [...recordStats, ...shared];
}

async function resetCoScope(
  pool: ReturnType<typeof getPool>,
  module: 'CO-ACSR' | 'CO-IR',
): Promise<{ deleted: number; vacuumed: number }> {
  const recordTable = module === 'CO-IR' ? 'co_ir_records' : 'co_records';
  const schema = coSchema(module);
  let deleted = 0;
  const { rowCount: recordRows } = await pool.query(`DELETE FROM ${quoteIdent(recordTable)}`);
  deleted += recordRows ?? 0;
  const { rowCount: stagingRows } = await pool.query(
    `DELETE FROM co_staging_rows WHERE upload_job_id IN (
       SELECT upload_job_id FROM co_dashboard_json WHERE generated_json->'meta'->>'schema' = $1
     )`,
    [schema],
  );
  deleted += stagingRows ?? 0;
  const { rowCount: dashboardRows } = await pool.query(
    `DELETE FROM co_dashboard_json WHERE generated_json->'meta'->>'schema' = $1`,
    [schema],
  );
  deleted += dashboardRows ?? 0;
  let vacuumed = 0;
  for (const table of [recordTable, 'co_staging_rows', 'co_dashboard_json']) {
    try { await pool.query(`VACUUM ANALYZE ${quoteIdent(table)}`); vacuumed++; } catch { /* non-critical */ }
  }
  return { deleted, vacuumed };
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
      const requestedModule = body?.module === 'CO' ? 'CO-ACSR' : body?.module;
      module   = (['ALL', 'JO', 'MO', 'CO-ACSR', 'CO-IR', 'IM'].includes(requestedModule ?? '')
        ? (requestedModule as ResetModule)
        : 'ALL');
      action   = body?.action === 'preview' ? 'preview' : body?.action === 'compact' ? 'compact' : 'execute';
    } catch { /* empty / malformed body */ }

    const expected = todayPasswordHKT();
    if (password !== expected) {
      return NextResponse.json({ ok: false, error: 'Invalid reset password' }, { status: 403 });
    }

    const pool   = getPool();
    const tables = MODULE_TABLES[module];

    // ── Preview: return row counts + sizes, no mutations ─────────────────────
    if (action === 'preview') {
      const stats = module === 'CO-ACSR' || module === 'CO-IR'
        ? await getCoScopeStats(pool, module)
        : await getTableStats(pool, tables);
      return NextResponse.json({ ok: true, module, tables: stats });
    }

    // ── Compact: VACUUM FULL only — reclaims disk space from already-deleted
    // rows without touching any remaining data. Plain VACUUM/VACUUM ANALYZE
    // (run automatically after a reset's TRUNCATE below) only marks space
    // reusable within the table; it does not shrink the file on disk. This is
    // for the case where rows were removed some other way (e.g. a scoped
    // delete outside this endpoint) and the table itself needs shrinking.
    // Takes an ACCESS EXCLUSIVE lock per table for its duration.
    if (action === 'compact') {
      const before = await getTableStats(pool, tables);
      const compacted: string[] = [];
      const failed: string[] = [];
      for (const t of tables) {
        try {
          await pool.query(`VACUUM (FULL, ANALYZE) ${quoteIdent(t)}`);
          compacted.push(t);
        } catch (e) {
          console.error(`[reset-database] VACUUM FULL failed for ${t}:`, e instanceof Error ? e.message : e);
          failed.push(t);
        }
      }
      const after = await getTableStats(pool, tables);
      const beforeBytes = before.reduce((s, t) => s + t.size_bytes, 0);
      const afterBytes = after.reduce((s, t) => s + t.size_bytes, 0);
      const label = module === 'ALL' ? 'All modules' : `${module} module`;
      return NextResponse.json({
        ok: true,
        module,
        compacted_tables: compacted.length,
        failed_tables: failed,
        before,
        after,
        bytes_reclaimed: Math.max(0, beforeBytes - afterBytes),
        message: `${label} compacted — ${compacted.length}/${tables.length} tables, `
          + `${(before.reduce((s, t) => s + t.size_bytes, 0) - after.reduce((s, t) => s + t.size_bytes, 0)) > 0
              ? `reclaimed ${Math.round((beforeBytes - afterBytes) / 1024 / 1024)} MB`
              : 'no size change'}${failed.length > 0 ? ` (${failed.length} failed — check logs)` : ''}.`,
      });
    }

    if (module === 'CO-ACSR' || module === 'CO-IR') {
      const result = await resetCoScope(pool, module);
      return NextResponse.json({
        ok: true,
        module,
        deleted_rows: result.deleted,
        vacuumed_tables: result.vacuumed,
        message: `${module} reset completed — ${result.deleted.toLocaleString()} rows deleted${result.vacuumed > 0 ? `, ${result.vacuumed} tables vacuumed` : ''}.`,
      });
    }

    // A full (module=ALL) reset truncates `organizations` too. Capture the
    // existing row(s) — organization_code/name AND the configured timezone —
    // before truncating, so the reset doesn't silently discard whatever the
    // user set in Configuration → System (previously this reseeded with a
    // hardcoded 'UTC' timezone and env-var defaults, losing both).
    type OrgSnapshot = { organization_code: string; organization_name: string; timezone: string };
    let orgSnapshot: OrgSnapshot[] = [];
    if (tables.includes('organizations')) {
      try {
        const { rows } = await pool.query<OrgSnapshot>(
          `SELECT organization_code, organization_name, timezone FROM organizations`,
        );
        orgSnapshot = rows;
      } catch { /* table may not exist yet — proceed with no snapshot */ }
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

    // Restore the captured org row(s) — every CSV upload depends on at least
    // one row existing (see create-job's resolveOrganizationId fallback), and
    // restoring the ORIGINAL name/timezone (not env-var/UTC defaults) means a
    // reset never resets Configuration → System settings as a side effect.
    // Only fall back to CUSTOMER_CODE/CUSTOMER_NAME/UTC if no row existed at
    // all (e.g. the very first reset on a brand-new database).
    let orgReseeded = false;
    if (tables.includes('organizations')) {
      const toRestore: OrgSnapshot[] = orgSnapshot.length > 0
        ? orgSnapshot
        : [{
            organization_code: (process.env.CUSTOMER_CODE ?? 'DEFAULT').toUpperCase(),
            organization_name: process.env.CUSTOMER_NAME ?? 'Default Organization',
            timezone: 'UTC',
          }];
      try {
        for (const org of toRestore) {
          await pool.query(
            `INSERT INTO organizations (organization_code, organization_name, timezone)
             VALUES ($1, $2, $3)
             ON CONFLICT (organization_code) DO UPDATE
               SET organization_name = EXCLUDED.organization_name, timezone = EXCLUDED.timezone`,
            [org.organization_code, org.organization_name, org.timezone],
          );
        }
        orgReseeded = true;
      } catch (e) {
        console.error('[reset-database] Failed to restore organization row(s):', e instanceof Error ? e.message : e);
      }
    }

    const label = module === 'ALL' ? 'All modules' : `${module} module`;
    return NextResponse.json({
      ok: true,
      module,
      truncated_tables: tables.length,
      vacuumed_tables:  vacuumed,
      identity_reset:   identityReset,
      org_reseeded:     orgReseeded,
      message: `${label} reset completed — ${tables.length} tables truncated${vacuumed > 0 ? `, ${vacuumed} vacuumed` : ''}${orgReseeded ? ', default organization reseeded' : ''}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reset failure';
    console.error('[reset-database]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
