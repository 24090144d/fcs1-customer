import { NextRequest, NextResponse } from 'next/server';
import { createAiAdminClient } from '@/lib/supabase/server';

type GenerateReq = { prompt?: string; module_code?: 'im' | 'jo' };
type SbResult<T> = { data: T | null; error: { message: string } | null };
type KpiDef = {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  fmt: 'integer' | 'pct1' | 'decimal2';
  available: boolean;
  note: string;
  formula: string;
};

function formulaFromSpec(spec: Record<string, unknown>): string {
  const table = String(spec.table ?? 'im_records');
  const groupBy = Array.isArray(spec.group_by) ? spec.group_by.map((x) => String(x)).filter(Boolean) : [];
  const metric = String(spec.metric ?? 'count');
  const topN = Number(spec.top_n ?? 0);
  let f = `COUNT(*) FROM ${table}`;
  if (groupBy.length > 0) f += ` GROUP BY ${groupBy.join(', ')}`;
  if (metric && metric !== 'count') f += ` METRIC ${metric}`;
  if (Number.isFinite(topN) && topN > 0) f += ` TOP ${topN}`;
  return f;
}

function monthFromIso(iso: string): string {
  return iso.slice(0, 7);
}

type ImDimension =
  | 'incident_case'
  | 'department'
  | 'incident_category'
  | 'incident_item_name'
  | 'incident_description'
  | 'incident_status'
  | 'severity'
  | 'subject'
  | 'source_of_complaint'
  | 'created_date'
  | 'incident_datetime'
  | 'guest_name'
  | 'room_no'
  | 'profile_type'
  | 'vip_code'
  | 'membership_number'
  | 'reservation_number'
  | 'date_of_birth'
  | 'company_name'
  | 'arrival_date'
  | 'departure_date'
  | 'nights'
  | 'rates'
  | 'rate_code'
  | 'booking_source'
  | 'visits'
  | 'created_by'
  | 'investigation_1'
  | 'investigation_remarks_1'
  | 'investigation_updated_by_1'
  | 'investigation_updated_on_1'
  | 'investigation_2'
  | 'investigation_remarks_2'
  | 'investigation_updated_by_2'
  | 'investigation_updated_on_2'
  | 'feedback_method_1'
  | 'feedback_updated_by_1'
  | 'feedback_updated_on_1'
  | 'feedback_remarks_1'
  | 'chain_code'
  | 'incident_location'
  | 'hotel_code'
  | 'module_code'
  | 'country_code';

type ImIntent = {
  dimension: ImDimension;
  wantsMonth: boolean;
  timeBucket: 'none' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
  wantsGauge: boolean;
  chartType: 'column' | 'bar' | 'line' | 'pie' | 'scatter' | 'bubble' | 'gauge' | 'heatmap' | 'treemap';
  topN: number;
  wantsDonut: boolean;
  wantsDualAxis: boolean;
  wantsStacked: boolean;
  wantsDrilldown: boolean;
  wantsDonutRace: boolean;
  wantsBarRace: boolean;
};

const SUPPORTED_IM_FIELDS: ImDimension[] = [
  'incident_case',
  'department',
  'incident_category',
  'incident_item_name',
  'incident_description',
  'incident_status',
  'severity',
  'subject',
  'source_of_complaint',
  'created_date',
  'incident_datetime',
  'guest_name',
  'room_no',
  'profile_type',
  'vip_code',
  'membership_number',
  'reservation_number',
  'date_of_birth',
  'company_name',
  'arrival_date',
  'departure_date',
  'nights',
  'rates',
  'rate_code',
  'booking_source',
  'visits',
  'created_by',
  'investigation_1',
  'investigation_remarks_1',
  'investigation_updated_by_1',
  'investigation_updated_on_1',
  'investigation_2',
  'investigation_remarks_2',
  'investigation_updated_by_2',
  'investigation_updated_on_2',
  'feedback_method_1',
  'feedback_updated_by_1',
  'feedback_updated_on_1',
  'feedback_remarks_1',
  'chain_code',
  'incident_location',
  'hotel_code',
  'module_code',
  'country_code',
];

const IM_DIMENSION_RULES: Array<{ dimension: ImDimension; keywords: string[] }> = [
  { dimension: 'incident_case', keywords: ['incident case', 'case id', 'case'] },
  { dimension: 'incident_item_name', keywords: ['incident item', 'items', 'item'] },
  { dimension: 'department', keywords: ['department', 'dept', 'team', 'function'] },
  { dimension: 'incident_category', keywords: ['category', 'categories', 'incident category'] },
  { dimension: 'incident_description', keywords: ['incident description', 'description', 'details'] },
  { dimension: 'incident_status', keywords: ['status', 'state'] },
  { dimension: 'severity', keywords: ['severity', 'priority', 'criticality'] },
  { dimension: 'subject', keywords: ['subject', 'title'] },
  { dimension: 'source_of_complaint', keywords: ['source', 'complaint source', 'channel'] },
  { dimension: 'created_date', keywords: ['created date', 'creation date', 'created datetime'] },
  { dimension: 'incident_datetime', keywords: ['incident datetime', 'incident date', 'incident time', 'incident timestamp'] },
  { dimension: 'guest_name', keywords: ['guest name', 'guest'] },
  { dimension: 'room_no', keywords: ['room no', 'room number', 'room'] },
  { dimension: 'profile_type', keywords: ['profile type', 'guest profile', 'profile'] },
  { dimension: 'vip_code', keywords: ['vip code', 'vip'] },
  { dimension: 'membership_number', keywords: ['membership number', 'member no', 'member'] },
  { dimension: 'reservation_number', keywords: ['reservation number', 'booking number', 'reservation'] },
  { dimension: 'date_of_birth', keywords: ['date of birth', 'dob', 'birth date'] },
  { dimension: 'company_name', keywords: ['company name', 'company', 'corporate'] },
  { dimension: 'arrival_date', keywords: ['arrival date', 'check in', 'check-in'] },
  { dimension: 'departure_date', keywords: ['departure date', 'check out', 'check-out'] },
  { dimension: 'nights', keywords: ['nights', 'night count', 'stay nights'] },
  { dimension: 'rates', keywords: ['rates', 'room rate', 'rate'] },
  { dimension: 'rate_code', keywords: ['rate code', 'tariff code'] },
  { dimension: 'booking_source', keywords: ['booking source', 'booking channel', 'booking'] },
  { dimension: 'visits', keywords: ['visits', 'visit count'] },
  { dimension: 'created_by', keywords: ['created by', 'creator', 'owner'] },
  { dimension: 'investigation_1', keywords: ['investigation 1', 'investigation first'] },
  { dimension: 'investigation_remarks_1', keywords: ['investigation remarks 1', 'investigation note 1'] },
  { dimension: 'investigation_updated_by_1', keywords: ['investigation updated by 1'] },
  { dimension: 'investigation_updated_on_1', keywords: ['investigation updated on 1'] },
  { dimension: 'investigation_2', keywords: ['investigation 2', 'investigation second'] },
  { dimension: 'investigation_remarks_2', keywords: ['investigation remarks 2', 'investigation note 2'] },
  { dimension: 'investigation_updated_by_2', keywords: ['investigation updated by 2'] },
  { dimension: 'investigation_updated_on_2', keywords: ['investigation updated on 2'] },
  { dimension: 'feedback_method_1', keywords: ['feedback method 1', 'feedback method'] },
  { dimension: 'feedback_updated_by_1', keywords: ['feedback updated by 1'] },
  { dimension: 'feedback_updated_on_1', keywords: ['feedback updated on 1'] },
  { dimension: 'feedback_remarks_1', keywords: ['feedback remarks 1', 'feedback remarks'] },
  { dimension: 'chain_code', keywords: ['chain code', 'brand code', 'chain'] },
  { dimension: 'incident_location', keywords: ['location', 'area', 'place'] },
  { dimension: 'hotel_code', keywords: ['hotel', 'property'] },
  { dimension: 'module_code', keywords: ['module code', 'module'] },
  { dimension: 'country_code', keywords: ['country', 'nation', 'region'] },
];

function detectRequestedImFields(prompt: string): ImDimension[] {
  const lower = prompt.toLowerCase();
  const requested: ImDimension[] = [];
  for (const rule of IM_DIMENSION_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      if (!requested.includes(rule.dimension)) requested.push(rule.dimension);
    }
  }
  return requested;
}

function parseImIntent(prompt: string): ImIntent {
  const lower = prompt.toLowerCase();
  const wantsHourly = lower.includes('hourly') || lower.includes('hour');
  const wantsDaily = lower.includes('daily') || lower.includes('day') || lower.includes('created date') || lower.includes('incident date');
  const wantsWeekly = lower.includes('weekly') || lower.includes('week');
  const wantsQuarterly = lower.includes('quarterly') || lower.includes('quarter') || /\bq[1-4]\b/.test(lower);
  const wantsMonthly = lower.includes('month') || lower.includes('monthly');
  const timeBucket: ImIntent['timeBucket'] = wantsHourly ? 'hourly' : wantsDaily ? 'daily' : wantsWeekly ? 'weekly' : wantsQuarterly ? 'quarterly' : wantsMonthly ? 'monthly' : 'none';
  const wantsMonth = timeBucket !== 'none';
  const wantsDonut = lower.includes('donut');
  const wantsPie = wantsDonut || lower.includes('pie');
  const wantsLine = lower.includes('line');
  const wantsBar = lower.includes('bar');
  const wantsTop = lower.includes('top');
  const wantsScatter = lower.includes('scatter');
  const wantsBubble = lower.includes('bubble');
  const wantsGauge = lower.includes('gauge') || lower.includes('meter') || lower.includes('kpi');
  const wantsHeatmap = lower.includes('heatmap');
  const wantsTreemap = lower.includes('treemap');
  const wantsDonutRace = lower.includes('donut race');
  const wantsBarRace = lower.includes('bar race');
  const wantsDualAxis = lower.includes('2-axis') || lower.includes('two-axis') || lower.includes('dual axis') || lower.includes('combo');
  const wantsStacked = lower.includes('stacked');
  const wantsDrilldown = lower.includes('drilldown') || lower.includes('drill down');
  const topNMatch = lower.match(/\btop\s+(\d{1,2})\b/);
  const topN = topNMatch ? Math.max(1, Math.min(20, Number.parseInt(topNMatch[1], 10))) : 10;

  let dimension: ImDimension = 'incident_category';
  for (const rule of IM_DIMENSION_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      dimension = rule.dimension;
      break;
    }
  }

  let chartType: 'column' | 'bar' | 'line' | 'pie' | 'scatter' | 'bubble' | 'gauge' | 'heatmap' | 'treemap' = 'column';
  if (wantsGauge) chartType = 'gauge';
  else if (wantsHeatmap) chartType = 'heatmap';
  else if (wantsTreemap) chartType = 'treemap';
  else if (wantsBubble) chartType = 'bubble';
  else if (wantsScatter) chartType = 'scatter';
  else if (wantsPie) chartType = 'pie';
  else if (wantsLine) chartType = 'line';
  else if (wantsBar || wantsTop) chartType = 'bar';

  return { dimension, wantsMonth, timeBucket, wantsGauge, chartType, topN, wantsDonut, wantsDualAxis, wantsStacked, wantsDrilldown, wantsDonutRace, wantsBarRace };
}

export async function POST(req: NextRequest) {
  let body: GenerateReq;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const prompt = (body.prompt ?? '').trim();
  const lowerPrompt = prompt.toLowerCase();
  const moduleCode = body.module_code ?? 'im';
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

  const sb = createAiAdminClient();
  const sourceTable = moduleCode === 'jo' ? 'jo_records' : 'im_records';
  const { data: sampleRows } = await sb
    .from(sourceTable)
    .select('organization_id')
    .limit(5000) as unknown as SbResult<Array<{ organization_id: string | null }>>;

  let preferredOrgId: string | null = null;
  if (sampleRows && sampleRows.length > 0) {
    const freq = new Map<string, number>();
    for (const r of sampleRows) {
      const id = (r.organization_id ?? '').trim();
      if (!id) continue;
      freq.set(id, (freq.get(id) ?? 0) + 1);
    }
    preferredOrgId = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  let org: { id: string; organization_code: string } | null = null;
  if (preferredOrgId) {
    const { data } = await sb
      .from('organizations')
      .select('id, organization_code')
      .eq('id', preferredOrgId)
      .maybeSingle() as unknown as SbResult<{ id: string; organization_code: string }>;
    org = data ?? null;
  }
  if (!org?.id) {
    const { data } = await sb
      .from('organizations')
      .select('id, organization_code')
      .order('created_at', { ascending: true })
      .limit(1)
      .single() as unknown as SbResult<{ id: string; organization_code: string }>;
    org = data ?? null;
  }
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
  const effectiveOrgId = preferredOrgId ?? org.id;

  if (preferredOrgId && org.id !== preferredOrgId) {
    const fallbackCode = (process.env.CUSTOMER_CODE ?? 'DEFAULT').toUpperCase();
    const fallbackName = process.env.CUSTOMER_NAME ?? 'Default Organization';
    await sb
      .from('organizations')
      .upsert({
        id: preferredOrgId,
        organization_code: fallbackCode,
        organization_name: fallbackName,
        timezone: 'UTC',
        metadata: {},
      }, { onConflict: 'id' });
  }

  let title = 'AI Chart Preview';
  let chartType: 'column' | 'bar' | 'line' | 'pie' | 'scatter' | 'bubble' | 'gauge' | 'heatmap' | 'treemap' = 'column';
  let querySpec: Record<string, unknown> = {};
  let interpretation = '';
  let categories: string[] = [];
  let series: Array<Record<string, unknown>> = [];
  let drilldownSeries: Array<Record<string, unknown>> = [];
  let plotOptions: Record<string, unknown> | undefined;
  let yAxis: Record<string, unknown> | Array<Record<string, unknown>> = { title: { text: 'Count' } };
  let requestedFields: ImDimension[] = [];
  let resolvedFields: ImDimension[] = [];
  const fallbackWarnings: string[] = [];

  if (moduleCode === 'im') {
    if (lowerPrompt.includes('kpi')) {
      const { data } = await sb
        .from('im_records')
        .select('created_date,incident_status,severity,vip_code,department,incident_category,source_of_complaint,hotel_code,incident_location')
        .eq('organization_id', effectiveOrgId)
        .limit(10000) as unknown as SbResult<Array<Record<string, string | null>>>;
      const rows = data ?? [];
      const total = rows.length;
      const status = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
      const isClosed = (s: string) => s.includes('complete') || s.includes('closed') || s.includes('resolved') || s.includes('done');
      const isPending = (s: string) => s.includes('pending') || s.includes('open') || s.includes('progress');
      const sev = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
      const dept = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
      const safePct = (n: number, d: number) => d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0;

      let closed = 0;
      let pending = 0;
      let vip = 0;
      let critical = 0;
      const deptMap = new Map<string, number>();
      const catMap = new Map<string, number>();
      const srcMap = new Map<string, number>();
      const monthMap = new Map<string, number>();
      let unknown = 0;
      let hkTotal = 0; let hkClosed = 0;
      let engTotal = 0; let engClosed = 0;
      for (const r of rows) {
        const st = status(r.incident_status);
        if (isClosed(st)) closed += 1;
        if (isPending(st)) pending += 1;
        if ((r.vip_code ?? '').trim()) vip += 1;
        const sv = sev(r.severity);
        if (sv.includes('critical')) critical += 1;
        const d = (r.department ?? 'Unknown').trim() || 'Unknown';
        deptMap.set(d, (deptMap.get(d) ?? 0) + 1);
        const c = (r.incident_category ?? 'Unknown').trim() || 'Unknown';
        catMap.set(c, (catMap.get(c) ?? 0) + 1);
        const src = (r.source_of_complaint ?? 'Unknown').trim() || 'Unknown';
        srcMap.set(src, (srcMap.get(src) ?? 0) + 1);
        if (!r.department || !r.incident_category || !r.incident_status) unknown += 1;
        if (r.created_date) {
          const mk = monthFromIso(new Date(r.created_date).toISOString());
          monthMap.set(mk, (monthMap.get(mk) ?? 0) + 1);
        }
        const dl = dept(r.department);
        if (dl.includes('housekeeping')) {
          hkTotal += 1;
          if (isClosed(st)) hkClosed += 1;
        }
        if (dl.includes('engineering')) {
          engTotal += 1;
          if (isClosed(st)) engClosed += 1;
        }
      }
      const topDept = Array.from(deptMap.values()).sort((a, b) => b - a)[0] ?? 0;
      const topCat = Array.from(catMap.values()).sort((a, b) => b - a)[0] ?? 0;
      const topSrc = Array.from(srcMap.values()).sort((a, b) => b - a)[0] ?? 0;
      const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const latest = sortedMonths.at(-1)?.[1] ?? 0;
      const prev = sortedMonths.at(-2)?.[1] ?? 0;
      const monthlyGrowth = prev > 0 ? Number((((latest - prev) / prev) * 100).toFixed(1)) : 0;

      const make = (id: string, label: string, value: number, fmt: KpiDef['fmt'], unit: string, note: string, formula: string): KpiDef => ({
        id, label, value, fmt, unit, note, formula, available: true,
      });
      let kpi = make('bkpi_01', 'Closure Rate', safePct(closed, total), 'pct1', '%', 'Completed/closed incidents share.', 'closed / total * 100');
      if (lowerPrompt.includes('total')) kpi = make('bkpi_02', 'Total Incidents', total, 'integer', 'cases', 'Total incident count.', 'COUNT(*)');
      else if (lowerPrompt.includes('pending')) kpi = make('bkpi_03', 'Pending Rate', safePct(pending, total), 'pct1', '%', 'Open/pending incidents share.', 'pending / total * 100');
      else if (lowerPrompt.includes('vip')) kpi = make('bkpi_04', 'VIP Incident Share', safePct(vip, total), 'pct1', '%', 'VIP incident share.', 'vip / total * 100');
      else if (lowerPrompt.includes('critical')) kpi = make('bkpi_05', 'Critical Severity Share', safePct(critical, total), 'pct1', '%', 'Critical severity share.', 'critical / total * 100');
      else if (lowerPrompt.includes('housekeeping') && lowerPrompt.includes('closure')) kpi = make('bkpi_06', 'Housekeeping Closure Rate', safePct(hkClosed, hkTotal), 'pct1', '%', 'Closure rate for housekeeping incidents.', 'housekeeping_closed / housekeeping_total * 100');
      else if (lowerPrompt.includes('engineering') && lowerPrompt.includes('closure')) kpi = make('bkpi_07', 'Engineering Closure Rate', safePct(engClosed, engTotal), 'pct1', '%', 'Closure rate for engineering incidents.', 'engineering_closed / engineering_total * 100');
      else if (lowerPrompt.includes('housekeeping')) kpi = make('bkpi_08', 'Housekeeping Incident Share', safePct(hkTotal, total), 'pct1', '%', 'Incident share for housekeeping.', 'housekeeping_total / total * 100');
      else if (lowerPrompt.includes('engineering')) kpi = make('bkpi_09', 'Engineering Incident Share', safePct(engTotal, total), 'pct1', '%', 'Incident share for engineering.', 'engineering_total / total * 100');
      else if (lowerPrompt.includes('source')) kpi = make('bkpi_10', 'Top Source Concentration', safePct(topSrc, total), 'pct1', '%', 'Top source concentration risk.', 'top_source_cases / total * 100');
      else if (lowerPrompt.includes('category')) kpi = make('bkpi_11', 'Top Category Concentration', safePct(topCat, total), 'pct1', '%', 'Top category concentration risk.', 'top_category_cases / total * 100');
      else if (lowerPrompt.includes('department')) kpi = make('bkpi_12', 'Top Department Concentration', safePct(topDept, total), 'pct1', '%', 'Top department concentration risk.', 'top_department_cases / total * 100');
      else if (lowerPrompt.includes('unknown') || lowerPrompt.includes('quality')) kpi = make('bkpi_13', 'Unknown Data Quality Rate', safePct(unknown, total), 'pct1', '%', 'Rows with key missing fields.', 'unknown_rows / total * 100');
      else if (lowerPrompt.includes('growth')) kpi = make('bkpi_14', 'Monthly Incident Growth', monthlyGrowth, 'pct1', '%', 'Latest month growth vs previous month.', '(latest - previous) / previous * 100');

      return NextResponse.json({
        organization_id: effectiveOrgId,
        module_code: moduleCode,
        title: kpi.label,
        chart_type: 'kpi',
        query_spec_json: { table: 'im_records', metric: kpi.id },
        chart_config_json: {},
        kpis: [kpi],
        assistant_text: `Interpreted as KPI card: ${kpi.label}.`,
        chart_note: kpi.note,
        chart_formula: kpi.formula,
      });
    }

    let intent = parseImIntent(prompt);
    requestedFields = detectRequestedImFields(prompt);
    if (requestedFields.includes('department') && requestedFields.includes('incident_item_name')) {
      intent = { ...intent, wantsDrilldown: true, dimension: 'department' };
    }
    const hasCalcAlias = /\b(rate|percent|percentage|pct|ratio|share|avg|average|mean)\b/i.test(prompt);
    if (hasCalcAlias && !lowerPrompt.includes('kpi') && !intent.wantsDualAxis && !intent.wantsGauge) {
      fallbackWarnings.push('Calculation keyword detected (rate/percent/ratio). Current rule-based chart defaults to count unless KPI/gauge/explicit formula pattern is used.');
    }
    if (intent.timeBucket !== 'none' && intent.timeBucket !== 'monthly') {
      fallbackWarnings.push(`Time granularity "${intent.timeBucket}" requested; using monthly bucket in current rule-based mode.`);
    }
    const dim = intent.dimension;
    const dimLabel = dim
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
    resolvedFields = [dim];

    interpretation = `Interpreted as ${intent.wantsMonth ? 'monthly ' : ''}incident count by ${dimLabel}${intent.chartType === 'pie' ? (intent.wantsDonut ? ' (donut)' : ' (pie)') : ''}${intent.chartType === 'scatter' ? ' (scatter)' : ''}${intent.chartType === 'bubble' ? ' (bubble)' : ''}${intent.chartType === 'gauge' ? ' (gauge KPI)' : ''}${intent.chartType === 'heatmap' ? ' (heatmap)' : ''}${intent.chartType === 'treemap' ? ' (treemap)' : ''}${intent.wantsDonutRace ? ' as donut race' : ''}${intent.wantsBarRace ? ' as bar race' : ''}${intent.wantsDualAxis ? ' with dual-axis combo' : ''}${intent.wantsStacked ? ' in stacked mode' : ''}${intent.wantsDrilldown ? ' with drilldown' : ''}.`;

    if (intent.wantsMonth) {
      title = `Monthly Incidents by ${dimLabel}`;
      chartType = intent.chartType;
      querySpec = { table: 'im_records', group_by: ['month', dim], metric: 'count' };
      const { data } = await sb
        .from('im_records')
        .select(`created_date,${dim}`)
        .eq('organization_id', effectiveOrgId)
        .limit(10000) as unknown as SbResult<Array<{ created_date: string | null } & Record<string, string | null>>>;
      const rows = data ?? [];
      const months = new Set<string>();
      const dimMap = new Map<string, Map<string, number>>();
      for (const r of rows) {
        if (!r.created_date) continue;
        const month = monthFromIso(new Date(r.created_date).toISOString());
        months.add(month);
        const raw = r[dim];
        const key = (typeof raw === 'string' ? raw : 'Unknown').trim() || 'Unknown';
        if (!dimMap.has(key)) dimMap.set(key, new Map());
        const cur = dimMap.get(key)!;
        cur.set(month, (cur.get(month) ?? 0) + 1);
      }
      categories = Array.from(months).sort();
      const ranked = Array.from(dimMap.entries())
        .sort((a, b) => {
          const sa = Array.from(a[1].values()).reduce((s, v) => s + v, 0);
          const sb2 = Array.from(b[1].values()).reduce((s, v) => s + v, 0);
          return sb2 - sa;
        })
        .slice(0, intent.topN);
      if (intent.wantsDonutRace) {
        chartType = 'pie';
        const latestMonth = categories[categories.length - 1] ?? '';
        const pieData = ranked
          .map(([name, m]) => ({ name, y: m.get(latestMonth) ?? 0 }))
          .filter((p) => p.y > 0);
        title = `Donut Race Snapshot by ${dimLabel} (${latestMonth || 'Latest Month'})`;
        interpretation = `Interpreted as donut race snapshot by ${dimLabel} for ${latestMonth || 'latest month'}.`;
        categories = [];
        plotOptions = { pie: { innerSize: '55%' } };
        series = [{ name: 'Count', type: 'pie', data: pieData }];
      } else if (intent.wantsBarRace) {
        chartType = 'bar';
        const latestMonth = categories[categories.length - 1] ?? '';
        const points = ranked.map(([name, m]) => ({ name, y: m.get(latestMonth) ?? 0 })).sort((a, b) => b.y - a.y);
        title = `Bar Race Snapshot by ${dimLabel} (${latestMonth || 'Latest Month'})`;
        interpretation = `Interpreted as bar race snapshot by ${dimLabel} for ${latestMonth || 'latest month'}.`;
        categories = points.map((p) => p.name);
        plotOptions = { series: { dataSorting: { enabled: true } } };
        series = [{ name: 'Count', type: 'bar', data: points.map((p) => p.y) }];
      } else if (chartType === 'pie') {
        const latestMonth = categories[categories.length - 1] ?? '';
        const pieData = ranked
          .map(([name, m]) => ({ name, y: m.get(latestMonth) ?? 0 }))
          .filter((p) => p.y > 0);
        title = `Incidents by ${dimLabel} (${latestMonth || 'Latest Month'})`;
        interpretation = `Interpreted as incident count by ${dimLabel} for ${latestMonth || 'latest month'} (donut).`;
        categories = [];
        series = [{ name: 'Count', data: pieData }];
      } else {
        const baseSeries = ranked.map(([name, m]) => ({
          name,
          data: categories.map((c) => m.get(c) ?? 0),
        }));
        if (intent.wantsDualAxis) {
          const totalByMonth = categories.map((month) => ranked.reduce((acc, [, m]) => acc + (m.get(month) ?? 0), 0));
          yAxis = [{ title: { text: 'By Dimension' } }, { title: { text: 'Total Incidents' }, opposite: true }];
          series = [
            { ...baseSeries[0], type: chartType === 'line' ? 'column' : chartType },
            { name: 'Total Incidents', type: 'line', yAxis: 1, data: totalByMonth },
          ];
          title = `Monthly Incidents by ${dimLabel} (2-Axis Combo)`;
        } else {
          series = baseSeries;
        }
        if (intent.wantsStacked && (chartType === 'column' || chartType === 'bar')) {
          plotOptions = { [chartType]: { stacking: 'normal' } };
        }
      }
    } else {
      title = `Top Incidents by ${dimLabel}`;
      chartType = intent.chartType;
      querySpec = { table: 'im_records', group_by: [dim], metric: 'count', top_n: intent.topN };
      if (chartType === 'gauge') {
        const { data } = await sb
          .from('im_records')
          .select('incident_status')
          .eq('organization_id', effectiveOrgId)
          .limit(10000) as unknown as SbResult<Array<{ incident_status: string | null }>>;
        const rows = data ?? [];
        const total = rows.length;
        const closed = rows.filter((r) => {
          const s = (r.incident_status ?? '').toLowerCase();
          return s.includes('complete') || s.includes('closed') || s.includes('done') || s.includes('resolved');
        }).length;
        const pct = total > 0 ? Number(((closed / total) * 100).toFixed(2)) : 0;
        title = 'Incident Closure Rate';
        interpretation = 'Interpreted as closure-rate KPI gauge from incident status.';
        yAxis = {
          min: 0,
          max: 100,
          tickInterval: 10,
          title: { text: 'Closure %' },
          plotBands: [
            { from: 0, to: 70, color: '#ef4444' },
            { from: 70, to: 90, color: '#f59e0b' },
            { from: 90, to: 100, color: '#22c55e' },
          ],
        };
        series = [{ name: 'Closure %', type: 'gauge', data: [pct] }];
      } else if (chartType === 'scatter' || chartType === 'bubble') {
        const { data } = await sb
          .from('im_records')
          .select(`${dim},incident_status,vip_code`)
          .eq('organization_id', effectiveOrgId)
          .limit(10000) as unknown as SbResult<Array<Record<string, string | null>>>;
        const agg = new Map<string, { total: number; closed: number; vip: number }>();
        for (const r of data ?? []) {
          const raw = r[dim];
          const k = (typeof raw === 'string' ? raw : 'Unknown').trim() || 'Unknown';
          const status = (r.incident_status ?? '').toLowerCase();
          const vipCode = (r.vip_code ?? '').trim();
          if (!agg.has(k)) agg.set(k, { total: 0, closed: 0, vip: 0 });
          const a = agg.get(k)!;
          a.total += 1;
          if (status.includes('complete') || status.includes('closed') || status.includes('done') || status.includes('resolved')) a.closed += 1;
          if (vipCode) a.vip += 1;
        }
        const top = Array.from(agg.entries())
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, intent.topN);
        title = chartType === 'scatter' ? `Incident Volume vs Closure Rate by ${dimLabel}` : `Incident Volume vs Closure Rate by ${dimLabel} (Bubble=VIP Share)`;
        interpretation = chartType === 'scatter'
          ? `Interpreted as scatter: X=incident volume, Y=closure rate by ${dimLabel}.`
          : `Interpreted as bubble: X=incident volume, Y=closure rate, Z=VIP share by ${dimLabel}.`;
        yAxis = { min: 0, max: 100, title: { text: 'Closure Rate %' } };
        series = [{
          name: dimLabel,
          type: chartType,
          data: top.map(([name, v]) => {
            const closePct = v.total > 0 ? Number(((v.closed / v.total) * 100).toFixed(2)) : 0;
            const vipPct = v.total > 0 ? Number(((v.vip / v.total) * 100).toFixed(2)) : 0;
            return chartType === 'bubble'
              ? { name, x: v.total, y: closePct, z: vipPct }
              : { name, x: v.total, y: closePct };
          }),
        }];
      } else if (chartType === 'heatmap') {
        const yDim: ImDimension = dim === 'department' ? 'severity' : 'department';
        const { data } = await sb
          .from('im_records')
          .select(`${dim},${yDim}`)
          .eq('organization_id', effectiveOrgId)
          .limit(10000) as unknown as SbResult<Array<Record<string, string | null>>>;
        const xCats = new Set<string>();
        const yCats = new Set<string>();
        const counts = new Map<string, number>();
        for (const r of data ?? []) {
          const x = (typeof r[dim] === 'string' ? r[dim] : 'Unknown')?.trim() || 'Unknown';
          const y = (typeof r[yDim] === 'string' ? r[yDim] : 'Unknown')?.trim() || 'Unknown';
          xCats.add(x);
          yCats.add(y);
          const k = `${x}|||${y}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        const xs = Array.from(xCats).slice(0, intent.topN);
        const ys = Array.from(yCats).slice(0, intent.topN);
        title = `Incident Heatmap: ${dimLabel} x ${yDim.replaceAll('_', ' ')}`;
        interpretation = `Interpreted as heatmap: ${dimLabel} by ${yDim.replaceAll('_', ' ')}.`;
        chartType = 'heatmap';
        categories = xs;
        yAxis = { categories: ys, title: { text: yDim.replaceAll('_', ' ') } };
        series = [{
          name: 'Incidents',
          type: 'heatmap',
          data: xs.flatMap((x, xi) => ys.map((y, yi) => [xi, yi, counts.get(`${x}|||${y}`) ?? 0])),
        }];
      } else if (chartType === 'treemap') {
        const treemapPalette = ['#C55A10', '#0E7470', '#7B3F28', '#1A6E6A', '#D4774A', '#3A9E9A', '#9B6A3A', '#5A8A6A'];
        const childDim: ImDimension = dim === 'incident_category' ? 'incident_item_name' : 'incident_category';
        const { data } = await sb
          .from('im_records')
          .select(`${dim},${childDim}`)
          .eq('organization_id', effectiveOrgId)
          .limit(10000) as unknown as SbResult<Array<Record<string, string | null>>>;
        const parentMap = new Map<string, number>();
        const childMap = new Map<string, number>();
        for (const r of data ?? []) {
          const p = (typeof r[dim] === 'string' ? r[dim] : 'Unknown')?.trim() || 'Unknown';
          const c = (typeof r[childDim] === 'string' ? r[childDim] : 'Unknown')?.trim() || 'Unknown';
          parentMap.set(p, (parentMap.get(p) ?? 0) + 1);
          childMap.set(`${p}|||${c}`, (childMap.get(`${p}|||${c}`) ?? 0) + 1);
        }
        const topParents = Array.from(parentMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, intent.topN);
        title = `Incident Treemap: ${dimLabel} hierarchy`;
        interpretation = `Interpreted as treemap hierarchy for ${dimLabel}.`;
        const dataTree: Array<Record<string, unknown>> = [];
        let colorIdx = 0;
        for (const [p, v] of topParents) {
          const parentColor = treemapPalette[colorIdx % treemapPalette.length];
          colorIdx += 1;
          dataTree.push({ id: `p-${p}`, name: p, value: v, color: parentColor, colorValue: v });
          const kids = Array.from(childMap.entries())
            .filter(([k]) => k.startsWith(`${p}|||`))
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.max(3, Math.floor(intent.topN / 2)));
          for (const [k, kv] of kids) {
            const childName = k.split('|||')[1] ?? 'Unknown';
            dataTree.push({ name: childName, parent: `p-${p}`, value: kv, color: parentColor });
          }
        }
        series = [{ type: 'treemap', layoutAlgorithm: 'squarified', colorByPoint: true, data: dataTree }];
      } else {
      let drillDimension: ImDimension = dim === 'incident_category' ? 'incident_item_name' : 'incident_category';
      if (intent.wantsDrilldown && dim === 'department' && requestedFields.includes('incident_item_name')) {
        drillDimension = 'incident_item_name';
      }
      if (intent.wantsDrilldown) resolvedFields.push(drillDimension);
      const selectCols = intent.wantsDrilldown ? `${dim},${drillDimension}` : dim;
      const { data } = await sb
        .from('im_records')
        .select(selectCols)
        .eq('organization_id', effectiveOrgId)
        .limit(10000) as unknown as SbResult<Array<Record<string, string | null>>>;
      const map = new Map<string, number>();
      const drillMap = new Map<string, Map<string, number>>();
      for (const r of data ?? []) {
        const raw = r[dim];
        const k = (typeof raw === 'string' ? raw : 'Unknown').trim() || 'Unknown';
        map.set(k, (map.get(k) ?? 0) + 1);
        if (intent.wantsDrilldown) {
          const childRaw = r[drillDimension];
          const child = (typeof childRaw === 'string' ? childRaw : 'Unknown').trim() || 'Unknown';
          if (!drillMap.has(k)) drillMap.set(k, new Map());
          const cur = drillMap.get(k)!;
          cur.set(child, (cur.get(child) ?? 0) + 1);
        }
      }
      const top = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, intent.topN);
      if (chartType === 'pie') {
        categories = [];
        series = [{
          name: 'Count',
          type: 'pie',
          data: top.map(([name, y]) => ({
            name,
            y,
            drilldown: intent.wantsDrilldown ? `dd-${name}` : undefined,
          })),
        }];
        if (intent.wantsDonut) {
          plotOptions = { pie: { innerSize: '55%' } };
        }
        if (intent.wantsDrilldown) {
          if (dim === 'department' && drillDimension === 'incident_item_name') {
            title = `Department by Top ${intent.topN} Incident Item${intent.wantsDonut ? ' (Donut Drilldown)' : ' (Drilldown)'}`;
          }
          drilldownSeries = top.map(([parent]) => {
            const kids = Array.from((drillMap.get(parent) ?? new Map()).entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, intent.topN);
            return {
              id: `dd-${parent}`,
              type: 'pie',
              name: `${parent} breakdown`,
              data: kids.map(([name, y]) => ({ name, y })),
            };
          });
        }
      } else {
        categories = top.map(([k]) => k);
        series = [{
          name: 'Count',
          type: chartType,
          data: top.map(([name, v]) => ({
            y: v,
            drilldown: intent.wantsDrilldown ? `dd-${name}` : undefined,
          })),
        }];
        if (intent.wantsStacked && (chartType === 'column' || chartType === 'bar')) {
          plotOptions = { [chartType]: { stacking: 'normal' } };
        }
        if (intent.wantsDualAxis) {
          yAxis = [{ title: { text: 'Count' } }, { title: { text: 'Running %' }, max: 100, min: 0, opposite: true }];
          const totals = top.reduce((s, [, v]) => s + v, 0);
          let running = 0;
          const runningPct = top.map(([, v]) => {
            running += v;
            return totals > 0 ? Number(((running / totals) * 100).toFixed(2)) : 0;
          });
          series.push({ name: 'Running %', type: 'line', yAxis: 1, data: runningPct });
          title = `${title} (2-Axis Combo)`;
        }
        if (intent.wantsDrilldown) {
          drilldownSeries = top.map(([parent]) => {
            const kids = Array.from((drillMap.get(parent) ?? new Map()).entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, intent.topN);
            return {
              id: `dd-${parent}`,
              type: chartType,
              name: `${parent} breakdown`,
              data: kids.map(([name, y]) => [name, y]),
            };
          });
          title = `${title} (Drilldown)`;
        }
      }
      }
    }
  } else {
    const lower = prompt.toLowerCase();
    const wantsMonth = lower.includes('month') || lower.includes('monthly');
    const wantsCategory = lower.includes('category');
    if (wantsMonth || wantsCategory) {
      title = 'Monthly JO Volume by Category';
      chartType = 'column';
      querySpec = { table: 'jo_records', group_by: ['month', 'service_item_category'], metric: 'count' };
      const { data } = await sb
        .from('jo_records')
        .select('created_datetime, service_item_category')
        .eq('organization_id', effectiveOrgId)
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
        .eq('organization_id', effectiveOrgId)
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
    xAxis: categories.length ? { categories } : (chartType === 'scatter' || chartType === 'bubble' ? { title: { text: 'Incident Volume' } } : undefined),
    yAxis,
    plotOptions: plotOptions ?? (chartType === 'pie' ? { pie: { innerSize: interpretation.includes('(donut)') ? '55%' : '0%' } } : undefined),
    series,
    drilldown: drilldownSeries.length ? { series: drilldownSeries } : undefined,
    exporting: { enabled: true },
    credits: { enabled: false },
    title: { text: title },
  };

  return NextResponse.json({
    organization_id: effectiveOrgId,
    module_code: moduleCode,
    title,
    chart_type: chartType,
    query_spec_json: querySpec,
    chart_config_json: chartOptions,
    assistant_text: interpretation || `Generated ${title} from tenant-scoped ${moduleCode.toUpperCase()} data.`,
    chart_note: interpretation || `Rule-based parser generated ${title}.`,
    chart_formula: formulaFromSpec(querySpec),
    diagnostics: moduleCode === 'im'
      ? (() => {
          const reqFields = requestedFields.length ? requestedFields : detectRequestedImFields(prompt);
          const unresolved = reqFields.filter((f) => !resolvedFields.includes(f));
          const reasons = [...fallbackWarnings];
          if (unresolved.length > 0) {
            reasons.push(`Requested field(s) not in resolved query: ${unresolved.join(', ')}`);
          }
          return {
            mode: 'rule_based',
            supported_fields: SUPPORTED_IM_FIELDS,
            requested_fields: reqFields,
            resolved_fields: resolvedFields,
            fallback: reasons.length > 0,
            fallback_reasons: reasons,
          };
        })()
      : {
          mode: 'rule_based',
          fallback: false,
          fallback_reasons: [],
        },
  });
}
