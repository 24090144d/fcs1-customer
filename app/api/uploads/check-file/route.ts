import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import type { UploadedFileRow } from '@/types';

export interface CheckFileRequest {
  file_hash: string;
}

export type CheckFileResponse =
  | { duplicate: false }
  | {
      duplicate:          true;
      existing_file_name: string;
      first_uploaded_at:  string;
      upload_job_id:      string;
    };

type FileRow = Pick<UploadedFileRow, 'file_name' | 'uploaded_at' | 'upload_job_id'>;

export async function POST(req: NextRequest) {
  let body: CheckFileRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { file_hash } = body;
  if (!file_hash || typeof file_hash !== 'string') {
    return NextResponse.json({ error: 'file_hash is required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('uploaded_files')
    .select('file_name, uploaded_at, upload_job_id')
    .eq('file_hash', file_hash)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as { data: FileRow | null; error: { message: string } | null };

  if (error) {
    console.error('[check-file] Supabase error:', error.message);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ duplicate: false } satisfies CheckFileResponse);
  }

  return NextResponse.json({
    duplicate:          true,
    existing_file_name: data.file_name,
    first_uploaded_at:  data.uploaded_at,
    upload_job_id:      data.upload_job_id,
  } satisfies CheckFileResponse);
}
