import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getPool } from '@/lib/db/supabaseCompat';

export const dynamic = 'force-dynamic';

// Parse filename: [ChainCode]-[HotelCode]-[HotelName]-[Module]-[CountryCode]-[DataRange].csv
function parseFilename(filename: string) {
  const name = filename.replace(/\.csv$/i, '').trim();
  const parts = name.split('-');
  if (parts.length < 4) return null;
  return {
    chain_code:   (parts[0] ?? '').toUpperCase(),
    hotel_code:   (parts[1] ?? '').toUpperCase(),
    hotel_name:   parts[2] ?? '',
    module:       (parts[3] ?? '').toLowerCase(),
    country_code: (parts[4] ?? '').toUpperCase(),
    data_range:   parts.slice(5).join('-'),
  };
}

export type DataSourceEntry = {
  upload_job_id: string;
  file_name: string;
  module_code: string;
  organization_id: string;
  chain_code: string;
  hotel_code: string;
  hotel_name: string;
  country_code: string;
  data_range: string;
  created_at: string;
};

type DbRow = {
  upload_job_id: string;
  created_at: string;
  file_name: string;
  module_code: string;
  organization_id: string;
  organization_code: string | null;
};

export async function GET() {
  noStore();
  try {
    const pool = getPool();

    const { rows } = await pool.query<DbRow>(`
      SELECT
        uj.id            AS upload_job_id,
        uj.created_at,
        uf.file_name,
        uf.module_code,
        uf.organization_id,
        o.organization_code
      FROM upload_jobs uj
      JOIN uploaded_files uf ON uf.upload_job_id = uj.id
      LEFT JOIN organizations o ON o.id = uf.organization_id
      WHERE uj.status = 'completed'
        AND uf.file_name IS NOT NULL
        AND uf.file_name <> ''
      ORDER BY uj.created_at DESC
      LIMIT 200
    `);

    // Deduplicate by file_name — same CSV re-uploaded multiple times should appear once.
    // Query is ordered by created_at DESC so the first hit per name is the most recent job.
    const seenNames = new Set<string>();
    const sources: DataSourceEntry[] = [];

    for (const row of rows) {
      const key = row.file_name.trim().toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      const parsed   = parseFilename(row.file_name);
      const orgChain = (row.organization_code ?? '').toUpperCase();

      sources.push({
        upload_job_id:   row.upload_job_id,
        file_name:       row.file_name,
        module_code:     row.module_code,
        organization_id: row.organization_id,
        chain_code:      parsed?.chain_code  || orgChain || 'UNKNOWN',
        hotel_code:      parsed?.hotel_code  || '',
        hotel_name:      parsed?.hotel_name  || '',
        country_code:    parsed?.country_code || '',
        data_range:      parsed?.data_range   || '',
        created_at:      row.created_at,
      });
    }

    return NextResponse.json({ sources });
  } catch (e) {
    console.error('[datasources] error:', e);
    return NextResponse.json({ sources: [] });
  }
}
