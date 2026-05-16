import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type VisReq = { user_id?: string; chart_id?: string; is_hidden?: boolean };

export async function POST(req: NextRequest) {
  let body: VisReq;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const userId = (body.user_id ?? 'anonymous').trim() || 'anonymous';
  const chartId = (body.chart_id ?? '').trim();
  const isHidden = body.is_hidden === true;
  if (!chartId) return NextResponse.json({ error: 'chart_id is required' }, { status: 400 });

  const sb = createAiAdminClient();
  const { error } = await sb
    .from('user_chart_visibility')
    .upsert({
      user_id: userId,
      chart_id: chartId,
      is_hidden: isHidden,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,chart_id' });

  if (error) return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
