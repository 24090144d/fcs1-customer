import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/supabaseCompat';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ResetChainModule = 'ALL' | 'JO' | 'MO' | 'CO-ACSR' | 'CO-IR' | 'IM';
type ResetChainAction = 'list' | 'preview' | 'execute';

export interface ChainModuleStat {
  module_code: string;
  job_count: number;
  total_rows: number;
}

export interface ChainEntry {
  chain_code: string;
  modules: ChainModuleStat[];
}

export interface UploadJobEntry {
  id: string;
  module_code: string;
  status: string;
  total_rows: number;
  created_at: string;
  chain_code: string | null;
  hotel_code: string | null;
  hotel_name: string | null;
  source_name: string | null;
  date_range_min: string | null;
  date_range_max: string | null;
}

export interface ChainTableStat {
  table_name: string;
  label: string;
  row_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODULES: Exclude<ResetChainModule, 'ALL'>[] = ['JO', 'MO', 'CO-ACSR', 'CO-IR', 'IM'];

const MODULE_RECORD_TABLES: Record<string, string> = { JO: 'jo_records', MO: 'mo_records', 'CO-ACSR': 'co_records', 'CO-IR': 'co_ir_records', IM: 'im_records' };
const MODULE_STAGING_TABLES: Record<string, string> = { JO: 'jo_staging_rows', MO: 'mo_staging_rows', 'CO-ACSR': 'co_staging_rows', 'CO-IR': 'co_staging_rows', IM: 'im_staging_rows' };
const MODULE_DASHBOARD_TABLES: Record<string, string> = { JO: 'jo_dashboard_json', MO: 'mo_dashboard_json', 'CO-ACSR': 'co_dashboard_json', 'CO-IR': 'co_dashboard_json', IM: 'im_dashboard_json' };

const TABLE_LABELS: Record<string, string> = {
  jo_records: 'JO Records',     jo_staging_rows: 'JO Staging',    jo_dashboard_json: 'JO Dashboard Cache',
  mo_records: 'MO Records',     mo_staging_rows: 'MO Staging',    mo_dashboard_json: 'MO Dashboard Cache',
  co_records: 'CO Records',     co_staging_rows: 'CO Staging',    co_dashboard_json: 'CO Dashboard Cache',
  co_ir_records: 'CO IR Records',
  im_records: 'IM Records',     im_staging_rows: 'IM Staging',    im_dashboard_json: 'IM Dashboard Cache',
  uploaded_files: 'Uploaded Files',
  upload_jobs:    'Upload Jobs',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function schemaFilter(module: Exclude<ResetChainModule, 'ALL'>): string {
  return module === 'CO-ACSR' ? ` AND generated_json->'meta'->>'schema' = 'co-v1'`
    : module === 'CO-IR' ? ` AND generated_json->'meta'->>'schema' = 'co-ir-v1'` : '';
}

function tableLabel(module: string, table: string): string {
  if (module === 'CO-ACSR') return table === 'co_records' ? 'CO ACSR Records' : table === 'co_staging_rows' ? 'CO ACSR Staging' : 'CO ACSR Dashboard Cache';
  if (module === 'CO-IR') return table === 'co_ir_records' ? 'CO IR Records' : table === 'co_staging_rows' ? 'CO IR Staging' : 'CO IR Dashboard Cache';
  return TABLE_LABELS[table] ?? table;
}

function todayPasswordHKT(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: '2-digit', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const yy = parts.find((p) => p.type === 'year')?.value  ?? '';
  const mm = parts.find((p) => p.type === 'month')?.value ?? '';
  const dd = parts.find((p) => p.type === 'day')?.value   ?? '';
  return `${yy}${mm}${dd}`;
}

/** Resolve upload_job_ids for a given chain_code + module(s) via dashboard meta. */
async function resolveJobIds(
  pool: ReturnType<typeof getPool>,
  chainCode: string,
  module: ResetChainModule,
): Promise<{ jobIds: string[]; byModule: Record<string, string[]> }> {
  const mods = module === 'ALL' ? MODULES : [module as Exclude<ResetChainModule, 'ALL'>];
  const byModule: Record<string, string[]> = {};
  const allIds: string[] = [];

  for (const mc of mods) {
    const dashTable = MODULE_DASHBOARD_TABLES[mc];
    const { rows } = await pool.query<{ upload_job_id: string }>(
      `SELECT upload_job_id FROM ${quoteIdent(dashTable)}
       WHERE generated_json->'meta'->>'chain_code' = $1${schemaFilter(mc)}`,
      [chainCode],
    );
    const ids = rows.map((r) => r.upload_job_id);
    byModule[mc] = ids;
    allIds.push(...ids);
  }

  return { jobIds: allIds, byModule };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: list — distinct chains from dashboard meta across all modules
// ─────────────────────────────────────────────────────────────────────────────

async function actionList(pool: ReturnType<typeof getPool>): Promise<NextResponse> {
  const chainMap = new Map<string, ChainEntry>();

  for (const mc of MODULES) {
    const dashTable = MODULE_DASHBOARD_TABLES[mc];
    try {
      const { rows } = await pool.query<{
        chain_code: string; job_count: string; total_rows: string;
      }>(
        `SELECT
           d.generated_json->'meta'->>'chain_code' AS chain_code,
           count(*)::text                          AS job_count,
           coalesce(sum(uj.total_rows), 0)::text   AS total_rows
         FROM ${quoteIdent(dashTable)} d
         LEFT JOIN upload_jobs uj ON uj.id = d.upload_job_id
         WHERE d.generated_json->'meta'->>'chain_code' IS NOT NULL
           AND d.generated_json->'meta'->>'chain_code' <> ''
           ${schemaFilter(mc).replaceAll('generated_json', 'd.generated_json')}
         GROUP BY 1`,
      );

      for (const r of rows) {
        if (!chainMap.has(r.chain_code)) {
          chainMap.set(r.chain_code, { chain_code: r.chain_code, modules: [] });
        }
        chainMap.get(r.chain_code)!.modules.push({
          module_code: mc,
          job_count:   parseInt(r.job_count,  10),
          total_rows:  parseInt(r.total_rows, 10),
        });
      }
    } catch { /* table may not exist */ }
  }

  const chains = [...chainMap.values()].sort((a, b) =>
    a.chain_code.localeCompare(b.chain_code),
  );

  return NextResponse.json({ ok: true, chains });
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: preview
// ─────────────────────────────────────────────────────────────────────────────

async function actionPreview(
  pool: ReturnType<typeof getPool>,
  chainCode: string,
  module: ResetChainModule,
): Promise<NextResponse> {
  const { jobIds, byModule } = await resolveJobIds(pool, chainCode, module);

  if (jobIds.length === 0) {
    return NextResponse.json({ ok: true, upload_jobs: [], tables: [], total_rows: 0 });
  }

  // Enrich upload_jobs with dashboard meta
  const uploadJobs: UploadJobEntry[] = [];
  for (const mc of (module === 'ALL' ? MODULES : [module as Exclude<ResetChainModule, 'ALL'>])) {
    const ids = byModule[mc] ?? [];
    if (ids.length === 0) continue;
    const dashTable = MODULE_DASHBOARD_TABLES[mc];

    for (const jobId of ids) {
      const { rows: ujRows } = await pool.query<{
        status: string; total_rows: string; created_at: string;
      }>(
        `SELECT status, total_rows::text, created_at FROM upload_jobs WHERE id = $1`,
        [jobId],
      );
      const uj = ujRows[0];

      const { rows: dashRows } = await pool.query<{ meta: Record<string, unknown> }>(
        `SELECT generated_json->'meta' AS meta FROM ${quoteIdent(dashTable)} WHERE upload_job_id = $1 LIMIT 1`,
        [jobId],
      );
      const meta = dashRows[0]?.meta ?? {};
      const g = (k: string) => (meta[k] != null ? String(meta[k]) : null);
      const dr = meta['date_range'] as Record<string, string> | undefined;

      uploadJobs.push({
        id:             jobId,
        module_code:    mc,
        status:         uj?.status ?? 'unknown',
        total_rows:     parseInt(uj?.total_rows ?? '0', 10),
        created_at:     String(uj?.created_at ?? ''),
        chain_code:     g('chain_code'),
        hotel_code:     g('hotel_code'),
        hotel_name:     g('hotel_name'),
        source_name:    g('source_name'),
        date_range_min: dr?.min ?? null,
        date_range_max: dr?.max ?? null,
      });
    }
  }

  // Count rows per affected table
  const tables: ChainTableStat[] = [];
  const modsToScan = module === 'ALL' ? MODULES : [module as Exclude<ResetChainModule, 'ALL'>];

  for (const mc of modsToScan) {
    const ids = byModule[mc] ?? [];
    if (ids.length === 0) continue;
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');

    for (const [tblKey, tbl] of [
      ['rec',  MODULE_RECORD_TABLES[mc]],
      ['stg',  MODULE_STAGING_TABLES[mc]],
      ['dash', MODULE_DASHBOARD_TABLES[mc]],
    ] as [string, string][]) {
      void tblKey;
      const { rows } = await pool.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM ${quoteIdent(tbl)} WHERE upload_job_id IN (${ph})`,
        ids,
      );
      tables.push({ table_name: tbl, label: tableLabel(mc, tbl), row_count: parseInt(rows[0]?.cnt ?? '0', 10) });
    }
  }

  // uploaded_files + upload_jobs
  const allPH = jobIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: ufRows } = await pool.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM uploaded_files WHERE upload_job_id IN (${allPH})`, jobIds,
  );
  tables.push({ table_name: 'uploaded_files', label: 'Uploaded Files', row_count: parseInt(ufRows[0]?.cnt ?? '0', 10) });
  tables.push({ table_name: 'upload_jobs',    label: 'Upload Jobs',    row_count: jobIds.length });

  return NextResponse.json({
    ok: true, upload_jobs: uploadJobs, tables,
    total_rows: tables.reduce((s, t) => s + t.row_count, 0),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: execute
// ─────────────────────────────────────────────────────────────────────────────

async function actionExecute(
  pool: ReturnType<typeof getPool>,
  chainCode: string,
  module: ResetChainModule,
): Promise<NextResponse> {
  const { jobIds, byModule } = await resolveJobIds(pool, chainCode, module);

  if (jobIds.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, message: 'No data found for that chain/module.' });
  }

  const modsToDelete = module === 'ALL' ? MODULES : [module as Exclude<ResetChainModule, 'ALL'>];
  let totalDeleted = 0;
  const affectedTables = new Set<string>();

  for (const mc of modsToDelete) {
    const ids = byModule[mc] ?? [];
    if (ids.length === 0) continue;
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');

    for (const tbl of [MODULE_RECORD_TABLES[mc], MODULE_STAGING_TABLES[mc], MODULE_DASHBOARD_TABLES[mc]]) {
      if (!tbl) continue;
      const { rowCount } = await pool.query(`DELETE FROM ${quoteIdent(tbl)} WHERE upload_job_id IN (${ph})`, ids);
      totalDeleted += rowCount ?? 0;
      affectedTables.add(tbl);
    }
  }

  const allPH = jobIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rowCount: ufDel } = await pool.query(`DELETE FROM uploaded_files WHERE upload_job_id IN (${allPH})`, jobIds);
  totalDeleted += ufDel ?? 0;
  affectedTables.add('uploaded_files');

  const { rowCount: ujDel } = await pool.query(`DELETE FROM upload_jobs WHERE id IN (${allPH})`, jobIds);
  totalDeleted += ujDel ?? 0;
  affectedTables.add('upload_jobs');

  // VACUUM ANALYZE
  let vacuumed = 0;
  for (const tbl of affectedTables) {
    try { await pool.query(`VACUUM ANALYZE ${quoteIdent(tbl)}`); vacuumed++; } catch { /* non-critical */ }
  }

  const label = module === 'ALL' ? 'all modules' : `${module} module`;
  return NextResponse.json({
    ok: true,
    deleted_rows:    totalDeleted,
    vacuumed_tables: vacuumed,
    message: `${chainCode} reset complete — ${label}, ${totalDeleted.toLocaleString()} rows deleted${vacuumed > 0 ? `, ${vacuumed} tables vacuumed` : ''}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const url      = new URL(req.url);
    const password = url.searchParams.get('password') ?? '';
    if (password !== todayPasswordHKT()) {
      return NextResponse.json({ ok: false, error: 'Invalid reset password' }, { status: 403 });
    }
    return actionList(getPool());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reset-by-chain GET]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let password = '', chainCode = '', module: ResetChainModule = 'ALL', action: ResetChainAction = 'list';
    try {
      const body = await req.json() as {
        password?: string; chain_code?: string; module?: string; action?: string;
      };
      password  = String(body?.password   ?? '');
      chainCode = String(body?.chain_code ?? '').toUpperCase();
      const requestedModule = body?.module === 'CO' ? 'CO-ACSR' : body?.module;
      module    = (['ALL', 'JO', 'MO', 'CO-ACSR', 'CO-IR', 'IM'].includes(requestedModule ?? '')
        ? (requestedModule as ResetChainModule) : 'ALL');
      action    = (['list', 'preview', 'execute'].includes(body?.action ?? '')
        ? (body!.action as ResetChainAction) : 'list');
    } catch { /* empty body */ }

    if (password !== todayPasswordHKT()) {
      return NextResponse.json({ ok: false, error: 'Invalid reset password' }, { status: 403 });
    }

    const pool = getPool();

    if (action === 'list') return actionList(pool);

    if (!chainCode) {
      return NextResponse.json({ ok: false, error: 'chain_code is required' }, { status: 400 });
    }

    if (action === 'preview') return actionPreview(pool, chainCode, module);
    if (action === 'execute') return actionExecute(pool, chainCode, module);

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reset-by-chain POST]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
