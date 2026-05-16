import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type GenerateReq = { prompt?: string; module_code?: 'im' | 'jo' };
type SbResult<T> = { data: T | null; error: { message: string } | null };

function monthFromIso(iso: string): string {
  return iso.slice(0, 7);
}

export async function POST(req: NextRequest) {
  let body: GenerateReq;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const prompt = (body.prompt ?? '').trim();
  const moduleCode = body.module_code ?? 'im';
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

  const sb = createAiAdminClient();
  let { data: org } = await sb
    .from('organizations')
    .select('id, organization_code')
    .order('created_at', { ascending: true })
    .limit(1)
    .single() as unknown as SbResult<{ id: string; organization_code: string }>;
  if (!org?.id) {
    const fallbackCode = (process.env.CUSTOMER_CODE ?? 'DEFAULT').toUpperCase();
    const fallbackName = process.env.CUSTOMER_NAME ?? 'Default Organization';
    const { data: inserted } = await sb
      .from('organizations')
      .insert({
        organization_code: fallbackCode,
        organization_name: fallbackName,
        timezone: 'UTC',
        metadata: {},
      })
      .select('id, organization_code')
      .single() as unknown as SbResult<{ id: string; organization_code: string }>;
    org = inserted ?? null;
  }
  if (!org?.id) return NextResponse.json({ error: 'Organization not found' }, { status: 500 });

  const lower = prompt.toLowerCase();
  const wantsMonth = lower.includes('month') || lower.includes('monthly');
  const wantsSeverity = lower.includes('severity');
  const wantsStatus = lower.includes('status');
  const wantsCategory = lower.includes('category');

  let title = 'AI Chart Preview';
  let chartType: 'column' | 'bar' | 'line' | 'pie' = 'column';
  let querySpec: Record<string, unknown> = {};
  let categories: string[] = [];
  let series: Array<{ name: string; data: number[] | Array<{ name: string; y: number }> }> = [];

  if (moduleCode === 'im') {
    if (wantsMonth && wantsSeverity) {
      title = 'Monthly Incidents by Severity';
      chartType = 'column';
      querySpec = { table: 'im_records', group_by: ['month', 'severity'], metric: 'count' };
      const { data } = await sb
        .from('im_records')
        .select('created_date, severity')
        .eq('organization_id', org.id)
        .limit(5000) as unknown as SbResult<Array<{ created_date: string | null; severity: string | null }>>;
      const rows = data ?? [];
      const months = new Set<string>();
      const sevMap = new Map<string, Map<string, number>>();
      for (const r of rows) {
        if (!r.created_date) continue;
        const month = monthFromIso(new Date(r.created_date).toISOString());
        months.add(month);
        const sev = (r.severity ?? 'Unknown').trim() || 'Unknown';
        if (!sevMap.has(sev)) sevMap.set(sev, new Map());
        const cur = sevMap.get(sev)!;
        cur.set(month, (cur.get(month) ?? 0) + 1);
      }
      categories = Array.from(months).sort();
      series = Array.from(sevMap.entries()).map(([sev, m]) => ({
        name: sev,
        data: categories.map((c) => m.get(c) ?? 0),
      }));
    } else if (wantsStatus) {
      title = 'Incidents by Status';
      chartType = 'pie';
      querySpec = { table: 'im_records', group_by: ['incident_status'], metric: 'count' };
      const { data } = await sb
        .from('im_records')
        .select('incident_status')
        .eq('organization_id', org.id)
        .limit(5000) as unknown as SbResult<Array<{ incident_status: string | null }>>;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const k = (r.incident_status ?? 'Unknown').trim() || 'Unknown';
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      categories = [];
      series = [{ name: 'Count', data: Array.from(map.entries()).map(([name, y]) => ({ name, y })) }];
    } else {
      title = 'Top Incident Categories';
      chartType = 'bar';
      querySpec = { table: 'im_records', group_by: ['incident_category'], metric: 'count', top_n: 10 };
      const { data } = await sb
        .from('im_records')
        .select('incident_category')
        .eq('organization_id', org.id)
        .limit(5000) as unknown as SbResult<Array<{ incident_category: string | null }>>;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const k = (r.incident_category ?? 'Unknown').trim() || 'Unknown';
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      const top = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      categories = top.map(([k]) => k);
      series = [{ name: 'Count', data: top.map(([, v]) => v) }];
    }
  } else {
    if (wantsMonth || wantsCategory) {
      title = 'Monthly JO Volume by Category';
      chartType = 'column';
      querySpec = { table: 'jo_records', group_by: ['month', 'service_item_category'], metric: 'count' };
      const { data } = await sb
        .from('jo_records')
        .select('created_datetime, service_item_category')
        .eq('organization_id', org.id)
        .limit(5000) as unknown as SbResult<Array<{ created_datetime: string | null; service_item_category: string | null }>>;
      const rows = data ?? [];
      const months = new Set<string>();
      const catMap = new Map<string, Map<string, number>>();
      for (const r of rows) {
        if (!r.created_datetime) continue;
        const month = monthFromIso(new Date(r.created_datetime).toISOString());
        months.add(month);
        const cat = (r.service_item_category ?? 'Unknown').trim() || 'Unknown';
        if (!catMap.has(cat)) catMap.set(cat, new Map());
        const cur = catMap.get(cat)!;
        cur.set(month, (cur.get(month) ?? 0) + 1);
      }
      categories = Array.from(months).sort();
      series = Array.from(catMap.entries()).slice(0, 8).map(([cat, m]) => ({
        name: cat,
        data: categories.map((c) => m.get(c) ?? 0),
      }));
    } else {
      title = 'JO Status Breakdown';
      chartType = 'pie';
      querySpec = { table: 'jo_records', group_by: ['job_status'], metric: 'count' };
      const { data } = await sb
        .from('jo_records')
        .select('job_status')
        .eq('organization_id', org.id)
        .limit(5000) as unknown as SbResult<Array<{ job_status: string | null }>>;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const k = (r.job_status ?? 'Unknown').trim() || 'Unknown';
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      categories = [];
      series = [{ name: 'Count', data: Array.from(map.entries()).map(([name, y]) => ({ name, y })) }];
    }
  }

  const chartOptions = {
    chart: { type: chartType },
    xAxis: categories.length ? { categories } : undefined,
    yAxis: { title: { text: 'Count' } },
    series,
    title: { text: title },
  };

  return NextResponse.json({
    organization_id: org.id,
    module_code: moduleCode,
    title,
    chart_type: chartType,
    query_spec_json: querySpec,
    chart_config_json: chartOptions,
    assistant_text: `Generated ${title} from tenant-scoped ${moduleCode.toUpperCase()} data.`,
  });
}
