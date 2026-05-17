import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type Body = {
  chart_id?: string;
  action?: 'move_up' | 'move_down' | 'remove' | 'restore' | 'reorder' | 'rename';
  ordered_ids?: string[];
  new_title?: string;
  organization_id?: string;
  module_code?: 'im' | 'jo';
};

type Row = {
  id: string;
  organization_id: string;
  module_code: 'im' | 'jo';
  display_order: number | null;
  is_active: boolean;
};

async function normalizeDisplayOrder(
  sb: ReturnType<typeof createAiAdminClient>,
  organizationId: string,
  moduleCode: 'im' | 'jo',
) {
  const { data: items } = await sb
    .from('ai_chart_definitions')
    .select('id, display_order, created_at')
    .eq('organization_id', organizationId)
    .eq('module_code', moduleCode)
    .eq('is_active', true)
    .order('created_at', { ascending: true }) as {
      data: Array<{ id: string; display_order: number | null; created_at: string }> | null
    };
  const list = items ?? [];
  const sorted = [...list].sort((a, b) => {
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.created_at.localeCompare(b.created_at);
  });
  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    const want = i + 1;
    if ((row.display_order ?? -1) === want) continue;
    await sb.from('ai_chart_definitions').update({ display_order: want }).eq('id', row.id);
  }
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const chartId = (body.chart_id ?? '').trim();
  const action = body.action;
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  const sb = createAiAdminClient();
  if (action === 'reorder') {
    const orderedIds = (body.ordered_ids ?? []).map((x) => x.trim()).filter(Boolean);
    if (orderedIds.length === 0) {
      return NextResponse.json({ error: 'ordered_ids is required' }, { status: 400 });
    }
    for (let i = 0; i < orderedIds.length; i += 1) {
      const { error } = await sb.from('ai_chart_definitions').update({ display_order: i + 1 }).eq('id', orderedIds[i]);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!chartId) return NextResponse.json({ error: 'chart_id is required' }, { status: 400 });
  if (action === 'rename') {
    const newTitle = (body.new_title ?? '').trim();
    if (!newTitle) return NextResponse.json({ error: 'new_title is required' }, { status: 400 });
    const { data: existing } = await sb
      .from('ai_chart_definitions')
      .select('chart_config_json, query_spec_json')
      .eq('id', chartId)
      .maybeSingle() as { data: { chart_config_json?: Record<string, unknown>; query_spec_json?: Record<string, unknown> } | null };
    const chartConfig = { ...(existing?.chart_config_json ?? {}) } as Record<string, unknown>;
    const chartTitle = { ...((chartConfig.title as Record<string, unknown> | undefined) ?? {}), text: newTitle };
    chartConfig.title = chartTitle;
    const querySpec = { ...(existing?.query_spec_json ?? {}) } as Record<string, unknown>;
    querySpec._display_title = newTitle;
    const { error } = await sb
      .from('ai_chart_definitions')
      .update({
        title: newTitle,
        chart_config_json: chartConfig,
        query_spec_json: querySpec,
        updated_at: new Date().toISOString(),
      })
      .eq('id', chartId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, title: newTitle });
  }

  const { data: target } = await sb
    .from('ai_chart_definitions')
    .select('id, organization_id, module_code, display_order, is_active')
    .eq('id', chartId)
    .maybeSingle() as { data: Row | null };
  if (!target) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  if (action === 'remove') {
    const { error } = await sb.from('ai_chart_definitions').update({ is_active: false }).eq('id', chartId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (action === 'restore') {
    const { data: rows } = await sb
      .from('ai_chart_definitions')
      .select('display_order')
      .eq('organization_id', target.organization_id)
      .eq('module_code', target.module_code)
      .eq('is_active', true);
    const maxOrder = Math.max(0, ...((rows ?? []).map((r: { display_order?: number | null }) => Number(r.display_order ?? 0))));
    const { error } = await sb.from('ai_chart_definitions').update({ is_active: true, display_order: maxOrder + 1 }).eq('id', chartId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  await normalizeDisplayOrder(sb, target.organization_id, target.module_code);

  const { data: items } = await sb
    .from('ai_chart_definitions')
    .select('id, display_order, created_at')
    .eq('organization_id', target.organization_id)
    .eq('module_code', target.module_code)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true }) as { data: Array<{ id: string; display_order: number | null; created_at: string }> | null };
  const list = (items ?? []).map((x, i) => ({ id: x.id, order: Number(x.display_order ?? (i + 1)) }));
  const idx = list.findIndex((x) => x.id === chartId);
  if (idx < 0) return NextResponse.json({ error: 'Item not in active list' }, { status: 400 });

  const swapWith = action === 'move_up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return NextResponse.json({ ok: true });

  const a = list[idx];
  const b = list[swapWith];
  const { error: errA } = await sb.from('ai_chart_definitions').update({ display_order: b.order }).eq('id', a.id);
  if (errA) return NextResponse.json({ error: errA.message }, { status: 500 });
  const { error: errB } = await sb.from('ai_chart_definitions').update({ display_order: a.order }).eq('id', b.id);
  if (errB) return NextResponse.json({ error: errB.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
