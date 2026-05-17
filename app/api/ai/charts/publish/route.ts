import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type PublishReq = {
  organization_id?: string;
  chart_id?: string;
  module_code?: 'im' | 'jo';
  publish?: boolean;
  publish_all?: boolean;
};

type SbResult<T> = { data: T | null; error: { message: string } | null };

export async function POST(req: NextRequest) {
  let body: PublishReq;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sb = createAiAdminClient();
  const publish = body.publish ?? true;
  const now = new Date().toISOString();

  if (body.publish_all) {
    if (!body.organization_id || !body.module_code) {
      return NextResponse.json({ error: 'organization_id and module_code are required for publish_all' }, { status: 400 });
    }
    const { error } = await sb
      .from('ai_chart_definitions')
      .update({
        is_published: publish,
        published_at: publish ? now : null,
      })
      .eq('organization_id', body.organization_id)
      .eq('module_code', body.module_code)
      .eq('is_active', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const chartId = (body.chart_id ?? '').trim();
  if (!chartId) return NextResponse.json({ error: 'chart_id is required' }, { status: 400 });

  const { error } = await sb
    .from('ai_chart_definitions')
    .update({
      is_published: publish,
      published_at: publish ? now : null,
    })
    .eq('id', chartId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: row } = await sb
    .from('ai_chart_definitions')
    .select('is_published')
    .eq('id', chartId)
    .maybeSingle() as unknown as SbResult<{ is_published: boolean }>;

  return NextResponse.json({ ok: true, is_published: row?.is_published ?? publish });
}

