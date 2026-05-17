import { unstable_noStore as noStore } from 'next/cache';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardClient } from '@/app/dashboard/DashboardClient';
import { createAdminClient } from '@/lib/supabase/server';
import type { ImDashboardJson, KpiDef, ChartDef, DailyBucket, HotelSummary, ChainEntry } from '@/types/dashboard';

export const dynamic = 'force-dynamic';

type SbResult<T> = { data: T | null; error: { message: string } | null };

type BuilderRow = {
  id: string;
  title: string;
  chart_type: string;
  chart_config_json: Record<string, unknown>;
  query_spec_json: Record<string, unknown>;
  created_at: string;
  display_order: number | null;
};

type ScopeRow = {
  created_date: string | null;
  incident_datetime: string | null;
  incident_status: string | null;
  severity: string | null;
  vip_code: string | null;
  incident_category: string | null;
  incident_item_name: string | null;
  source_of_complaint: string | null;
  booking_source: string | null;
  department: string | null;
};

const EMPTY_SUMMARY: HotelSummary = {
  total: 0,
  completed: 0,
  cancelled: 0,
  pending: 0,
  vip_total: 0,
  vip_completed: 0,
  vip_cancelled: 0,
  severity_sum: 0,
  repeat_count: 0,
  status_map: {},
  dept_map: {},
  category_map: {},
  item_map: {},
  dept_item_map: {},
  dept_category_map: {},
  week_map: {},
  week_source_map: {},
  dept_source_map: {},
  booking_map: {},
  source_map: {},
  severity_map: {},
};

async function fetchBuilderDashboard(): Promise<{ data: ImDashboardJson | null; chainEntries: ChainEntry[] }> {
  noStore();
  try {
    const sb = createAdminClient();
    const { data: sampleRows } = await sb
      .from('im_records')
      .select('organization_id, created_date')
      .limit(10000) as unknown as SbResult<Array<{ organization_id: string | null; created_date: string | null }>>;

    const freq = new Map<string, number>();
    let minDate: string | null = null;
    let maxDate: string | null = null;
    for (const r of sampleRows ?? []) {
      const id = (r.organization_id ?? '').trim();
      if (id) freq.set(id, (freq.get(id) ?? 0) + 1);
      if (r.created_date) {
        const d = new Date(r.created_date).toISOString().slice(0, 10);
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }
    const orgId = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!orgId) return { data: null, chainEntries: [] };

    const { data: imRows } = await sb
      .from('im_records')
      .select('created_date, incident_datetime, incident_status, severity, vip_code, incident_category, incident_item_name, source_of_complaint, booking_source, department')
      .eq('organization_id', orgId) as unknown as SbResult<ScopeRow[]>;

    const { data: rows } = await sb
      .from('ai_chart_definitions')
      .select('id, title, chart_type, chart_config_json, query_spec_json, created_at, display_order')
      .eq('organization_id', orgId)
      .eq('module_code', 'im')
      .eq('is_active', true)
      .eq('is_published', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false }) as unknown as SbResult<BuilderRow[]>;

    const published = [...(rows ?? [])].sort((a, b) => {
      const ao = Number(a.display_order ?? Number.MAX_SAFE_INTEGER);
      const bo = Number(b.display_order ?? Number.MAX_SAFE_INTEGER);
      if (ao !== bo) return ao - bo;
      return a.created_at.localeCompare(b.created_at);
    });
    if (published.length === 0) return { data: null, chainEntries: [] };

    const kpiRows = published.filter((r) => r.chart_type === 'kpi');
    const kpis: KpiDef[] = kpiRows.flatMap((r, i) => {
      const orderTag = String(i + 1).padStart(2, '0');
      return (((r.chart_config_json as { kpis?: KpiDef[] }).kpis) ?? []).map((k) => ({
        ...k,
        label: `[${orderTag}] ${k.label}`,
      }));
    });

    const charts: ChartDef[] = published
      .filter((r) => r.chart_type !== 'kpi')
      .map((r, i) => ({
        id: `builder_chart_${String(i + 1).padStart(2, '0')}`,
        title: String(
          (r.query_spec_json as { _display_title?: string } | undefined)?._display_title
          ?? r.title,
        ),
        options: r.chart_config_json,
        note: String((r.query_spec_json as { _chart_note?: string } | undefined)?._chart_note ?? 'Builder chart'),
        formula: String((r.query_spec_json as { _chart_formula?: string } | undefined)?._chart_formula ?? 'Builder-defined visualization'),
        filterable: false,
      }));

    const status_map: Record<string, number> = {};
    const severity_map: Record<string, number> = {};
    const category_map: Record<string, number> = {};
    const item_map: Record<string, number> = {};
    const source_map: Record<string, number> = {};
    const booking_map: Record<string, number> = {};
    const dept_map: Record<string, number> = {};
    const byDate = new Map<string, DailyBucket>();
    let total = 0;
    let completed = 0;
    let cancelled = 0;
    let pending = 0;
    let vip_total = 0;
    let vip_completed = 0;
    let vip_cancelled = 0;
    let severity_sum = 0;
    const repeatKeyCount: Record<string, number> = {};
    const sevWeight: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

    for (const r of imRows ?? []) {
      const day = r.created_date ? new Date(r.created_date).toISOString().slice(0, 10) : (r.incident_datetime ? new Date(r.incident_datetime).toISOString().slice(0, 10) : null);
      if (!day) continue;
      const status = (r.incident_status ?? 'Unknown').trim() || 'Unknown';
      const sev = (r.severity ?? 'Unknown').trim() || 'Unknown';
      const cat = (r.incident_category ?? 'Uncategorized').trim() || 'Uncategorized';
      const item = (r.incident_item_name ?? 'Unknown Item').trim() || 'Unknown Item';
      const source = r.source_of_complaint === null ? 'Unknown' : String(r.source_of_complaint);
      const booking = r.booking_source === null ? 'Unknown' : String(r.booking_source);
      const dept = (r.department ?? 'Unknown Department').trim() || 'Unknown Department';
      const isVip = r.vip_code !== null && r.vip_code !== undefined && String(r.vip_code).trim() !== '' && String(r.vip_code).trim() !== '-';

      total += 1;
      status_map[status] = (status_map[status] ?? 0) + 1;
      severity_map[sev] = (severity_map[sev] ?? 0) + 1;
      category_map[cat] = (category_map[cat] ?? 0) + 1;
      item_map[item] = (item_map[item] ?? 0) + 1;
      source_map[source] = (source_map[source] ?? 0) + 1;
      booking_map[booking] = (booking_map[booking] ?? 0) + 1;
      dept_map[dept] = (dept_map[dept] ?? 0) + 1;

      if (/completed|closed/i.test(status)) completed += 1;
      else if (/cancel/i.test(status)) cancelled += 1;
      else pending += 1;
      if (isVip) {
        vip_total += 1;
        if (/completed|closed/i.test(status)) vip_completed += 1;
        else if (/cancel/i.test(status)) vip_cancelled += 1;
      }
      severity_sum += sevWeight[sev] ?? 0;
      if (!byDate.has(day)) {
        byDate.set(day, { date: day, total: 0, completed: 0, cancelled: 0, pending: 0, high_crit: 0, severity_sum: 0, vip: 0, by_severity: {}, by_category: {}, by_status: {} });
      }
      const b = byDate.get(day)!;
      b.total += 1;
      if (/completed|closed/i.test(status)) b.completed += 1;
      else if (/cancel/i.test(status)) b.cancelled += 1;
      else b.pending += 1;
      if (/critical|high/i.test(sev)) b.high_crit += 1;
      b.severity_sum += sevWeight[sev] ?? 0;
      if (isVip) b.vip += 1;
      b.by_status[status] = (b.by_status[status] ?? 0) + 1;
      b.by_severity[sev] = (b.by_severity[sev] ?? 0) + 1;
      b.by_category[cat] = (b.by_category[cat] ?? 0) + 1;
      const rk = `${dept}|${cat}|${item}`;
      repeatKeyCount[rk] = (repeatKeyCount[rk] ?? 0) + 1;
    }
    const repeat_count = Object.values(repeatKeyCount).filter((v) => v > 1).reduce((s, v) => s + v, 0);
    const rawDaily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    const summary: HotelSummary = {
      ...EMPTY_SUMMARY,
      total,
      completed,
      cancelled,
      pending,
      vip_total,
      vip_completed,
      vip_cancelled,
      severity_sum,
      repeat_count,
      status_map,
      dept_map,
      category_map,
      item_map,
      booking_map,
      source_map,
      severity_map,
    };
    minDate = rawDaily[0]?.date ?? minDate;
    maxDate = rawDaily[rawDaily.length - 1]?.date ?? maxDate;

    const chainCode = (process.env.CUSTOMER_CODE ?? 'PEN').toUpperCase();
    const now = new Date().toISOString();
    const data: ImDashboardJson = {
      meta: {
        upload_job_id: 'builder-dashboard-im',
        source_name: 'Dashboard Builder',
        chain_code: chainCode,
        hotel_code: 'BLD',
        hotel_name: 'Dashboard IM',
        country_code: 'CN',
        total_records: total,
        date_range: { min: minDate, max: maxDate },
        generated_at: now,
        schema: 'im-v1',
        organization_id: orgId,
      } as ImDashboardJson['meta'],
      kpis,
      eac: [],
      charts,
      raw_daily: rawDaily,
      summary,
    };

    return { data, chainEntries: [] };
  } catch {
    return { data: null, chainEntries: [] };
  }
}

export default async function DashboardImPage() {
  const { data, chainEntries } = await fetchBuilderDashboard();
  if (!data) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Dashboard' }, { label: 'Dashboard · IM' }]}>
        <div className="p-6 text-sm text-slate-600">No published Builder items yet.</div>
      </AppLayout>
    );
  }
  return (
    <AppLayout breadcrumbs={[{ label: 'Dashboard' }, { label: 'Dashboard · IM' }]}>
      <DashboardClient data={data} chainEntries={chainEntries} />
    </AppLayout>
  );
}
