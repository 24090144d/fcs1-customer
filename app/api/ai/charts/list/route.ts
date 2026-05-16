import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type SbResult<T> = { data: T | null; error: { message: string } | null };

export async function GET(req: NextRequest) {
  const userId = (req.nextUrl.searchParams.get('user_id') ?? 'anonymous').trim() || 'anonymous';
  const sb = createAiAdminClient();

  const { data: org } = await sb
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single() as unknown as SbResult<{ id: string }>;
  if (!org?.id) return NextResponse.json({ charts: [] });

  const { data: charts } = await sb
    .from('ai_chart_definitions')
    .select('id, title, chart_type, module_code, chart_config_json, created_at')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false }) as unknown as SbResult<Array<{
      id: string;
      title: string;
      chart_type: string;
      module_code: string;
      chart_config_json: Record<string, unknown>;
      created_at: string;
    }>>;

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
    charts: (charts ?? []).map((c) => ({
      ...c,
      is_hidden: visibility.get(c.id) ?? false,
    })),
  });
}
