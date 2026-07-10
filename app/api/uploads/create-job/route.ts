import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import type { UploadJobInsert, UploadedFileInsert, UploadMode, ModuleCodeDb } from '@/types';

export interface CreateJobRequest {
  file_hash:    string;
  file_name:    string;
  file_size:    number;
  module_code:  ModuleCodeDb;
  upload_mode:  UploadMode;
  chain_code:   string | null;
  hotel_code:   string | null;
  hotel_name:   string | null;
  country_code: string | null;
  data_range:   string | null;
}

export interface CreateJobResponse {
  upload_job_id:    string;
  uploaded_file_id: string;
}

type SbResult<T> = { data: T | null; error: { message: string } | null };

/**
 * Resolve the organization for a new upload job.
 * Stage 1: chain-code match on organizations.organization_code (lets a multi-chain
 * deployment route uploads to a chain-specific org, if one exists).
 * Stage 2: the single org configured in Configuration → System Settings — the
 * oldest organizations row, same lookup getOrg() uses in the system-settings API.
 * This is what makes "Organization Name" in Configuration apply to all CSV
 * uploads on the portal: every deployment has exactly one org row in practice,
 * so this is the org every upload ultimately lands on.
 */
async function resolveOrganizationId(
  supabase: ReturnType<typeof createAdminClient>,
  chain_code: string | null,
): Promise<string | null> {
  if (chain_code) {
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .ilike('organization_code', chain_code)
      .maybeSingle() as unknown as SbResult<{ id: string }>;
    if (org?.id) return org.id;
  }

  const { data: configuredOrg } = await supabase
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle() as unknown as SbResult<{ id: string }>;
  return configuredOrg?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    let body: CreateJobRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      file_hash, file_name, file_size,
      module_code, chain_code, hotel_code, hotel_name, country_code, data_range,
    } = body;

    if (!file_hash || !file_name || !file_size || !module_code) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Resolve organization — match by chain_code, then use a real fallback org
    const organization_id = await resolveOrganizationId(supabase, chain_code);
    if (!organization_id) {
      return NextResponse.json({ error: 'No organization available for upload job' }, { status: 500 });
    }

    // 2. Create the upload_jobs row
    const sourceParts = [hotel_name, module_code.toUpperCase(), data_range].filter(Boolean);
    const jobInsert: UploadJobInsert = {
      organization_id,
      module_code,
      status:        'pending',
      source_name:   sourceParts.length > 0 ? sourceParts.join(' · ') : file_name.replace(/\.csv$/i, ''),
      requested_by:  null,
      started_at:    null,
      completed_at:  null,
      failed_reason: null,
      total_files:   1,
      total_rows:    0,
      processed_rows: 0,
      // Resolved once here — finalize reads these directly instead of
      // re-deriving hotel identity from a (possibly stale/reused) file lookup.
      chain_code:    chain_code   ?? null,
      hotel_code:    hotel_code   ?? null,
      hotel_name:    hotel_name   ?? null,
      country_code:  country_code ?? null,
      data_range:    data_range   ?? null,
    };

    const { data: job, error: jobError } = await supabase
      .from('upload_jobs')
      .insert(jobInsert)
      .select('id')
      .single() as unknown as SbResult<{ id: string }>;

    if (jobError || !job) {
      console.error('[create-job] Failed to create upload_jobs row:', jobError?.message);
      return NextResponse.json({ error: 'Failed to create upload job' }, { status: 500 });
    }

    // 3. Resolve uploaded_files row — reuse existing if same hash already exists
    //    (prevents unique constraint violation when user continues a duplicate upload)
    const { data: existingFile } = await supabase
      .from('uploaded_files')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('module_code', module_code)
      .eq('file_hash', file_hash)
      .maybeSingle() as unknown as SbResult<{ id: string }>;

    let uploaded_file_id: string;

    if (existingFile?.id) {
      uploaded_file_id = existingFile.id;
    } else {
      const fileInsert: UploadedFileInsert = {
        organization_id,
        upload_job_id:   job.id,
        file_name,
        mime_type:       'text/csv',
        file_size_bytes: file_size,
        file_hash,
        storage_bucket:  null,
        storage_path:    null,
        uploaded_by:     null,
        module_code,
      };

      const { data: newFile, error: fileError } = await supabase
        .from('uploaded_files')
        .insert(fileInsert)
        .select('id')
        .single() as unknown as SbResult<{ id: string }>;

      if (fileError || !newFile) {
        console.error('[create-job] Failed to insert uploaded_files row:', fileError?.message);
        return NextResponse.json({ error: 'Failed to create uploaded_files record' }, { status: 500 });
      }
      uploaded_file_id = newFile.id;
    }

    return NextResponse.json({
      upload_job_id:    job.id,
      uploaded_file_id,
    } satisfies CreateJobResponse);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[create-job] Unhandled error:', msg);
    if (msg.includes('DATABASE_URL is not set')) {
      return NextResponse.json(
        { error: 'Server misconfigured: DATABASE_URL missing in .env.local' },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: 'Internal server error while creating upload job' }, { status: 500 });
  }
}
