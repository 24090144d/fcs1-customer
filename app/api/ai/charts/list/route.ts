import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type SbResult<T> = { data: T | null; error: { message: string } | null };

export async function GET(req: NextRequest) {
  const userId = (req.nextUrl.searchParams.get('user_id') ?? 'anonymous').trim() || 'anonymous';
  const orgIdParam = (req.nextUrl.searchParams.get('organization_id') ?? '').trim();
  const sb = createAiAdminClient();

  let org: { id: string } | null = null;
  if (orgIdParam) {
    org = { id: orgIdParam };
  } else {
    const { data: sampleRows } = await sb
      .from('im_records')
      .select('organization_id')
      .limit(5000) as unknown as SbResult<Array<{ organization_id: string | null }>>;
    const freq = new Map<string, number>();
    for (const r of sampleRows ?? []) {
      const id = (r.organization_id ?? '').trim();
      if (!id) continue;
      freq.set(id, (freq.get(id) ?? 0) + 1);
    }
    const preferred = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (preferred) org = { id: preferred };
  }
  if (!org?.id) {
    const { data } = await sb
      .from('organizations')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single() as unknown as SbResult<{ id: string }>;
    org = data ?? null;
  }
  if (!org?.id) return NextResponse.json({ charts: [] });

  const { data: charts } = await sb
    .from('ai_chart_definitions')
    .select('id, title, chart_type, module_code, chart_config_json, created_at, is_published, display_order')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false }) as unknown as SbResult<Array<{
      id: string;
      title: string;
      chart_type: string;
      module_code: string;
      chart_config_json: Record<string, unknown>;
      created_at: string;
      is_published: boolean;
      display_order: number | null;
    }>>;
  const normalizedCharts = [...(charts ?? [])].sort((a, b) => {
    const ao = Number(a.display_order ?? Number.MAX_SAFE_INTEGER);
    const bo = Number(b.display_order ?? Number.MAX_SAFE_INTEGER);
    if (ao !== bo) return ao - bo;
    // created_at may be a Date (pg driver) or an ISO string
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const ids = (charts ?? []).map((c) => c.id);
  const visibility = new Map<string, boolean>();
  if (ids.length > 0) {
    const { data: visRows } = await sb
      .from('user_chart_visibility')
      .select('chart_id, is_hidden')
      .eq('user_id', userId)
      .in('chart_id', ids) as unknown as SbResult<Array<{ chart_id: string; is_hidden: boolean }>>;
    for (const row of visRows ?? []) visibility.set(row.chart_id, row.is_hidden);
  }

  return NextResponse.json({
    organization_id: org.id,
    charts: normalizedCharts.map((c) => ({
      ...c,
      is_hidden: visibility.get(c.id) ?? false,
    })),
  });
}
