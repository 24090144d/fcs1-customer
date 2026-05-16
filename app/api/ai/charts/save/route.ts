import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

type SaveReq = {
  organization_id?: string;
  title?: string;
  chart_type?: string;
  module_code?: 'im' | 'jo';
  prompt?: string;
  query_spec_json?: Record<string, unknown>;
  chart_config_json?: Record<string, unknown>;
  created_by?: string;
};

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

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('ai_chart_definitions')
    .insert({
      organization_id: body.organization_id,
      title: body.title,
      chart_type: body.chart_type,
      module_code: body.module_code,
      prompt: body.prompt ?? '',
      query_spec_json: body.query_spec_json ?? {},
      chart_config_json: body.chart_config_json,
      created_by: body.created_by ?? 'anonymous',
      is_active: true,
    })
    .select('id')
    .single();

  if (error || !data) return NextResponse.json({ error: 'Failed to save chart' }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
