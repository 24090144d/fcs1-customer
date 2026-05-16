import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CHUNK_ROWS = 2000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChunkRowInput {
  row_number:  number;
  raw_row:     Record<string, unknown>;
  is_valid:    boolean;
  parse_error: string | null;
}

export interface ChunkRequest {
  upload_job_id:    string;
  uploaded_file_id: string;
  chunk_index:      number;
  is_last_chunk:    boolean;
  total_valid_rows: number | null;
  rows:             ChunkRowInput[];
}

export interface ChunkResponse {
  inserted:    number;
  skipped:     number;
  chunk_index: number;
}

type SbResult<T> = { data: T | null; error: { message: string } | null };

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: ChunkRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { upload_job_id, uploaded_file_id, chunk_index, is_last_chunk, total_valid_rows, rows } = body;

  if (!upload_job_id || !uploaded_file_id || typeof chunk_index !== 'number' || !Array.isArray(rows)) {
    return NextResponse.json(
      { error: 'Missing required fields: upload_job_id, uploaded_file_id, chunk_index, rows' },
      { status: 400 },
    );
  }
  if (rows.length > MAX_CHUNK_ROWS) {
    return NextResponse.json({ error: `Chunk exceeds max ${MAX_CHUNK_ROWS} rows` }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ── Resolve upload job ─────────────────────────────────────────────────────

  type JobRow = { organization_id: string; module_code: 'im' | 'jo' };
  const { data: job, error: jobError } = await supabase
    .from('upload_jobs')
    .select('organization_id, module_code')
    .eq('id', upload_job_id)
    .single() as unknown as SbResult<JobRow>;

  if (jobError || !job) {
    return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
  }

  const table = job.module_code === 'im' ? 'im_staging_rows' : 'jo_staging_rows';

  // ── Empty-row fast path (still finalizes job if last chunk) ───────────────

  if (rows.length === 0) {
    if (is_last_chunk) {
      await supabase
        .from('upload_jobs')
        .update({
          status:       'completed',
          completed_at: new Date().toISOString(),
          total_rows:   total_valid_rows ?? 0,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', upload_job_id);
    }
    return NextResponse.json({ inserted: 0, skipped: 0, chunk_index } satisfies ChunkResponse);
  }

  // ── First chunk: mark job as processing, clear stale staging rows ─────────

  if (chunk_index === 0) {
    await Promise.all([
      supabase
        .from('upload_jobs')
        .update({
          status:         'processing',
          started_at:     new Date().toISOString(),
          processed_rows: 0,
          updated_at:     new Date().toISOString(),
        })
        .eq('id', upload_job_id),
      // Idempotent restart: wipe any staging rows from a prior attempt
      supabase
        .from(table)
        .delete()
        .eq('upload_job_id', upload_job_id),
    ]);
  }

  // ── Duplicate prevention for retried chunks ───────────────────────────────

  const rowNumbers = rows.map((r) => r.row_number);
  let existingNums = new Set<number>();

  if (chunk_index > 0) {
    const { data: existing } = await supabase
      .from(table)
      .select('row_number')
      .eq('upload_job_id', upload_job_id)
      .in('row_number', rowNumbers) as unknown as { data: { row_number: number }[] | null; error: unknown };

    existingNums = new Set((existing ?? []).map((r) => r.row_number));
  }

  const toInsert = rows.filter((r) => !existingNums.has(r.row_number));
  const skipped  = rows.length - toInsert.length;

  // ── Insert staging rows ───────────────────────────────────────────────────

  let inserted = 0;

  if (toInsert.length > 0) {
    const payload = toInsert.map((row) => ({
      organization_id:  job.organization_id,
      upload_job_id,
      uploaded_file_id,
      row_number:       row.row_number,
      raw_row:          row.raw_row,
      parse_error:      row.parse_error ?? null,
      is_valid:         row.is_valid,
    }));

    const { error: insertError } = await supabase
      .from(table)
      .insert(payload) as unknown as SbResult<null>;

    if (insertError) {
      console.error(`[chunk] Insert error job=${upload_job_id} chunk=${chunk_index}:`, insertError.message);
      return NextResponse.json({ error: 'Row insert failed' }, { status: 500 });
    }

    inserted = toInsert.length;
  }

  // ── Update job progress ───────────────────────────────────────────────────

  // Fetch current counter for safe increment (chunks are sequential — no race)
  const { data: current } = await supabase
    .from('upload_jobs')
    .select('processed_rows')
    .eq('id', upload_job_id)
    .single() as unknown as SbResult<{ processed_rows: number }>;

  const progressPatch: Record<string, unknown> = {
    processed_rows: (current?.processed_rows ?? 0) + inserted,
    updated_at:     new Date().toISOString(),
  };

  if (is_last_chunk) {
    progressPatch.status       = 'completed';
    progressPatch.completed_at = new Date().toISOString();
    if (total_valid_rows !== null && total_valid_rows !== undefined) {
      progressPatch.total_rows = total_valid_rows;
    }
  }

  await supabase
    .from('upload_jobs')
    .update(progressPatch)
    .eq('id', upload_job_id);

  return NextResponse.json({ inserted, skipped, chunk_index } satisfies ChunkResponse);
}
