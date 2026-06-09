import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/supabaseCompat';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ResetHotelModule = 'ALL' | 'JO' | 'MO' | 'CO' | 'IM';
type ResetHotelAction = 'list' | 'preview' | 'execute';

export interface OrgModuleStat {
  module_code: string;
  job_count: number;
  total_rows: number;
}

export interface OrgEntry {
  id: string;
  organization_code: string;
  organization_name: string;
  modules: OrgModuleStat[];
}

export interface UploadJobEntry {
  id: string;
  module_code: string;
  status: string;
  total_rows: number;
  created_at: string;
  hotel_code: string | null;
  hotel_name: string | null;
  source_name: string | null;
  date_range_min: string | null;
  date_range_max: string | null;
}

export interface HotelTableStat {
  table_name: string;
  label: string;
  row_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODULES: ResetHotelModule[] = ['JO', 'MO', 'CO', 'IM'];

/** Tables affected per module — records & staging link via upload_job_id */
const MODULE_RECORD_TABLES: Record<string, string> = {
  JO: 'jo_records',
  MO: 'mo_records',
  CO: 'co_records',
  IM: 'im_records',
};
const MODULE_STAGING_TABLES: Record<string, string> = {
  JO: 'jo_staging_rows',
  MO: 'mo_staging_rows',
  CO: 'co_staging_rows',
  IM: 'im_staging_rows',
};
const MODULE_DASHBOARD_TABLES: Record<string, string> = {
  JO: 'jo_dashboard_json',
  MO: 'mo_dashboard_json',
  CO: 'co_dashboard_json',
  IM: 'im_dashboard_json',
};
const TABLE_LABELS: Record<string, string> = {
  jo_records: 'JO Records',          jo_staging_rows: 'JO Staging',       jo_dashboard_json: 'JO Dashboard Cache',
  mo_records: 'MO Records',          mo_staging_rows: 'MO Staging',       mo_dashboard_json: 'MO Dashboard Cache',
  co_records: 'CO Records',          co_staging_rows: 'CO Staging',       co_dashboard_json: 'CO Dashboard Cache',
  im_records: 'IM Records',          im_staging_rows: 'IM Staging',       im_dashboard_json: 'IM Dashboard Cache',
  uploaded_files: 'Uploaded Files',  upload_jobs: 'Upload Jobs',
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
    year: '2-digit', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const yy = parts.find((p) => p.type === 'year')?.value ?? '';
  const mm = parts.find((p) => p.type === 'month')?.value ?? '';
  const dd = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${yy}${mm}${dd}`;
}

/** Safely extract a scalar from a JSONB path */
function jsonbText(obj: Record<string, unknown> | null, ...keys: string[]): string | null {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur == null ? null : String(cur);
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: list organisations + per-module job counts
// ─────────────────────────────────────────────────────────────────────────────

async function actionList(pool: ReturnType<typeof getPool>): Promise<NextResponse> {
  const { rows: orgs } = await pool.query<{
    id: string; organization_code: string; organization_name: string;
  }>(`SELECT id, organization_code, organization_name FROM organizations ORDER BY organization_code`);

  const result: OrgEntry[] = [];

  for (const org of orgs) {
    const { rows: modRows } = await pool.query<{
      module_code: string; job_count: string; total_rows: string;
    }>(
      `SELECT module_code,
              count(*)::text AS job_count,
              coalesce(sum(total_rows), 0)::text AS total_rows
       FROM upload_jobs
       WHERE organization_id = $1
       GROUP BY module_code`,
      [org.id],
    );

    const modules: OrgModuleStat[] = MODULES.map((mc) => {
      const found = modRows.find((r) => r.module_code === mc);
      return {
        module_code: mc,
        job_count:   found ? parseInt(found.job_count, 10) : 0,
        total_rows:  found ? parseInt(found.total_rows, 10) : 0,
      };
    });

    result.push({
      id:                org.id,
      organization_code: org.organization_code,
      organization_name: org.organization_name,
      modules,
    });
  }

  return NextResponse.json({ ok: true, organizations: result });
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: preview — return upload jobs + row counts per table
// ─────────────────────────────────────────────────────────────────────────────

async function actionPreview(
  pool: ReturnType<typeof getPool>,
  organizationId: string,
  module: ResetHotelModule,
): Promise<NextResponse> {
  // Collect upload_job rows for this org + module(s)
  const moduleFilter = module === 'ALL'
    ? `module_code IN ('JO','MO','CO','IM')`
    : `module_code = '${module}'`;

  const { rows: jobRows } = await pool.query<{
    id: string; module_code: string; status: string; total_rows: string; created_at: string;
  }>(
    `SELECT id, module_code, status, total_rows::text, created_at
     FROM upload_jobs
     WHERE organization_id = $1 AND ${moduleFilter}
     ORDER BY created_at DESC`,
    [organizationId],
  );

  if (jobRows.length === 0) {
    return NextResponse.json({ ok: true, upload_jobs: [], tables: [], total_rows: 0 });
  }

  const jobIds = jobRows.map((r) => r.id);

  // Enrich each job with dashboard meta (hotel_code, hotel_name, date_range)
  const uploadJobs: UploadJobEntry[] = [];
  for (const job of jobRows) {
    const dashTable = MODULE_DASHBOARD_TABLES[job.module_code];
    let hotelCode: string | null = null;
    let hotelName: string | null = null;
    let sourceName: string | null = null;
    let dateRangeMin: string | null = null;
    let dateRangeMax: string | null = null;

    if (dashTable) {
      try {
        const { rows: dashRows } = await pool.query<{ meta: Record<string, unknown> }>(
          `SELECT generated_json->'meta' AS meta FROM ${quoteIdent(dashTable)} WHERE upload_job_id = $1 LIMIT 1`,
          [job.id],
        );
        if (dashRows[0]?.meta) {
          const meta = dashRows[0].meta;
          hotelCode    = jsonbText(meta, 'hotel_code');
          hotelName    = jsonbText(meta, 'hotel_name');
          sourceName   = jsonbText(meta, 'source_name');
          dateRangeMin = jsonbText(meta, 'date_range', 'min');
          dateRangeMax = jsonbText(meta, 'date_range', 'max');
        }
      } catch { /* dashboard row may not exist */ }
    }

    uploadJobs.push({
      id:             job.id,
      module_code:    job.module_code,
      status:         job.status,
      total_rows:     parseInt(job.total_rows, 10),
      created_at:     job.created_at,
      hotel_code:     hotelCode,
      hotel_name:     hotelName,
      source_name:    sourceName,
      date_range_min: dateRangeMin,
      date_range_max: dateRangeMax,
    });
  }

  // Count rows per affected table
  const tables: HotelTableStat[] = [];
  const modulesToScan = module === 'ALL' ? MODULES : [module as Exclude<ResetHotelModule, 'ALL'>];

  for (const mc of modulesToScan) {
    const jobIdsForMod = jobIds.filter((_, i) => jobRows[i]?.module_code === mc || module === 'ALL');
    const modJobIds    = jobRows.filter((r) => r.module_code === mc).map((r) => r.id);
    if (modJobIds.length === 0) continue;

    const placeholders = modJobIds.map((_, i) => `$${i + 1}`).join(', ');

    // records — linked via upload_job_id
    const recTable = MODULE_RECORD_TABLES[mc];
    const { rows: recRows } = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ${quoteIdent(recTable)} WHERE upload_job_id IN (${placeholders})`,
      modJobIds,
    );
    tables.push({ table_name: recTable, label: TABLE_LABELS[recTable] ?? recTable, row_count: parseInt(recRows[0]?.cnt ?? '0', 10) });

    // staging
    const stgTable = MODULE_STAGING_TABLES[mc];
    const { rows: stgRows } = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ${quoteIdent(stgTable)} WHERE upload_job_id IN (${placeholders})`,
      modJobIds,
    );
    tables.push({ table_name: stgTable, label: TABLE_LABELS[stgTable] ?? stgTable, row_count: parseInt(stgRows[0]?.cnt ?? '0', 10) });

    // dashboard
    const dashTable = MODULE_DASHBOARD_TABLES[mc];
    const { rows: dashRows } = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ${quoteIdent(dashTable)} WHERE upload_job_id IN (${placeholders})`,
      modJobIds,
    );
    tables.push({ table_name: dashTable, label: TABLE_LABELS[dashTable] ?? dashTable, row_count: parseInt(dashRows[0]?.cnt ?? '0', 10) });

    void jobIdsForMod; // suppress unused warning
  }

  // uploaded_files + upload_jobs counts
  const allPlaceholders = jobIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: ufRows } = await pool.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM uploaded_files WHERE upload_job_id IN (${allPlaceholders})`,
    jobIds,
  );
  tables.push({ table_name: 'uploaded_files', label: 'Uploaded Files', row_count: parseInt(ufRows[0]?.cnt ?? '0', 10) });

  tables.push({ table_name: 'upload_jobs', label: 'Upload Jobs', row_count: jobIds.length });

  const totalRows = tables.reduce((s, t) => s + t.row_count, 0);
  return NextResponse.json({ ok: true, upload_jobs: uploadJobs, tables, total_rows: totalRows });
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: execute — delete by upload_job_ids then VACUUM
// ─────────────────────────────────────────────────────────────────────────────

async function actionExecute(
  pool: ReturnType<typeof getPool>,
  organizationId: string,
  module: ResetHotelModule,
): Promise<NextResponse> {
  const moduleFilter = module === 'ALL'
    ? `module_code IN ('JO','MO','CO','IM')`
    : `module_code = '${module}'`;

  const { rows: jobRows } = await pool.query<{ id: string; module_code: string }>(
    `SELECT id, module_code FROM upload_jobs WHERE organization_id = $1 AND ${moduleFilter}`,
    [organizationId],
  );

  if (jobRows.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, message: 'No data found for that hotel/module.' });
  }

  const jobIds = jobRows.map((r) => r.id);
  const modulesToDel = module === 'ALL' ? MODULES : [module as Exclude<ResetHotelModule, 'ALL'>];

  let totalDeleted = 0;
  const affectedTables = new Set<string>();

  for (const mc of modulesToDel) {
    const modJobIds = jobRows.filter((r) => r.module_code === mc).map((r) => r.id);
    if (modJobIds.length === 0) continue;

    const placeholders = modJobIds.map((_, i) => `$${i + 1}`).join(', ');

    for (const tbl of [MODULE_RECORD_TABLES[mc], MODULE_STAGING_TABLES[mc], MODULE_DASHBOARD_TABLES[mc]]) {
      if (!tbl) continue;
      const { rowCount } = await pool.query(
        `DELETE FROM ${quoteIdent(tbl)} WHERE upload_job_id IN (${placeholders})`,
        modJobIds,
      );
      totalDeleted += rowCount ?? 0;
      affectedTables.add(tbl);
    }
  }

  // uploaded_files + upload_jobs
  const allPH = jobIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rowCount: ufDel } = await pool.query(`DELETE FROM uploaded_files WHERE upload_job_id IN (${allPH})`, jobIds);
  totalDeleted += ufDel ?? 0;
  affectedTables.add('uploaded_files');

  const { rowCount: ujDel } = await pool.query(`DELETE FROM upload_jobs WHERE id IN (${allPH})`, jobIds);
  totalDeleted += ujDel ?? 0;
  affectedTables.add('upload_jobs');

  // VACUUM ANALYZE each affected table
  let vacuumed = 0;
  for (const tbl of affectedTables) {
    try {
      await pool.query(`VACUUM ANALYZE ${quoteIdent(tbl)}`);
      vacuumed++;
    } catch { /* non-critical */ }
  }

  const label = module === 'ALL' ? 'all modules' : `${module} module`;
  return NextResponse.json({
    ok: true,
    deleted_rows:  totalDeleted,
    vacuumed_tables: vacuumed,
    message: `Hotel reset complete — ${label}, ${totalDeleted.toLocaleString()} rows deleted${vacuumed > 0 ? `, ${vacuumed} tables vacuumed` : ''}.`,
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
    const pool = getPool();
    return actionList(pool);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reset-by-hotel GET]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let password = '', organizationId = '', module: ResetHotelModule = 'ALL', action: ResetHotelAction = 'list';
    try {
      const body = await req.json() as {
        password?: string; organization_id?: string; module?: string; action?: string;
      };
      password       = String(body?.password ?? '');
      organizationId = String(body?.organization_id ?? '');
      module         = (['ALL', 'JO', 'MO', 'CO', 'IM'].includes(body?.module ?? '')
        ? (body!.module as ResetHotelModule) : 'ALL');
      action         = (['list', 'preview', 'execute'].includes(body?.action ?? '')
        ? (body!.action as ResetHotelAction) : 'list');
    } catch { /* empty body */ }

    if (password !== todayPasswordHKT()) {
      return NextResponse.json({ ok: false, error: 'Invalid reset password' }, { status: 403 });
    }

    const pool = getPool();

    if (action === 'list') return actionList(pool);

    if (!organizationId) {
      return NextResponse.json({ ok: false, error: 'organization_id is required' }, { status: 400 });
    }

    if (action === 'preview') return actionPreview(pool, organizationId, module);
    if (action === 'execute') return actionExecute(pool, organizationId, module);

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reset-by-hotel POST]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
