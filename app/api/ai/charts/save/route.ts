import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type SaveReq = {
  organization_id?: string;
  title?: string;
  chart_type?: string;
  module_code?: 'im' | 'jo' | 'co';
  prompt?: string;
  query_spec_json?: Record<string, unknown>;
  chart_config_json?: Record<string, unknown>;
  chart_note?: string;
  chart_formula?: string;
  created_by?: string;
};

function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function POST(req: NextRequest) {
  let body: SaveReq;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.organization_id || !body.title || !body.chart_type || !body.module_code || !body.chart_config_json) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const sb = createAiAdminClient();
  const cleanChartConfig = toJsonSafe(body.chart_config_json);
  const cleanQuerySpec = toJsonSafe(body.query_spec_json ?? {});
  const enrichedQuerySpec = {
    ...cleanQuerySpec,
    _display_title: body.title ?? '',
    _chart_note: body.chart_note ?? '',
    _chart_formula: body.chart_formula ?? '',
  };

  const { data: orgRow } = await sb
    .from('organizations')
    .select('id')
    .eq('id', body.organization_id)
    .maybeSingle();

  if (!orgRow?.id) {
    const fallbackCode = (process.env.CUSTOMER_CODE ?? 'DEFAULT').toUpperCase();
    const fallbackName = process.env.CUSTOMER_NAME ?? 'Default Organization';
    const suffix = body.organization_id.slice(0, 8).toUpperCase();
    await sb
      .from('organizations')
      .upsert({
        id: body.organization_id,
        organization_code: `${fallbackCode}_${suffix}`,
        organization_name: `${fallbackName} ${suffix}`,
        timezone: 'UTC',
        metadata: { auto_seeded_by: 'ai_chart_save' },
      }, { onConflict: 'id' });
  }

  const { data: orderRows } = await sb
    .from('ai_chart_definitions')
    .select('display_order')
    .eq('organization_id', body.organization_id)
    .eq('module_code', body.module_code)
    .eq('is_active', true);
  const maxOrder = Math.max(0, ...((orderRows ?? []).map((r: { display_order?: number | null }) => Number(r.display_order ?? 0))));

  const { data, error } = await sb
    .from('ai_chart_definitions')
    .insert({
      organization_id: body.organization_id,
      title: body.title,
      chart_type: body.chart_type,
      module_code: body.module_code,
      prompt: body.prompt ?? '',
      query_spec_json: enrichedQuerySpec,
      chart_config_json: cleanChartConfig,
      created_by: body.created_by ?? 'anonymous',
      is_active: true,
      is_published: false,
      display_order: maxOrder + 1,
    })
    .select('id')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save chart' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
