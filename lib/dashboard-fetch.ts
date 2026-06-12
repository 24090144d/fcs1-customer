// ---------------------------------------------------------------------------
// Shared dashboard data fetchers — used by /dashboard and /my-dashboard pages.
// Moved verbatim from app/dashboard/page.tsx (v1.0.45).
// ---------------------------------------------------------------------------

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import type { DashboardJson, ImDashboardJson, MoDashboardJson, CoDashboardJson, ChainEntry, DailyBucket, HotelSummary } from '@/types/dashboard';
import type { CoRow } from '@/types/csv';

type SbResult<T> = { data: T | null; error: { message: string } | null };

function resolveDashboardTable(moduleCode?: string): 'im_dashboard_json' | 'jo_dashboard_json' | 'mo_dashboard_json' | 'co_dashboard_json' {
  const mod = String(moduleCode ?? '').toLowerCase();
  if (mod === 'jo') return 'jo_dashboard_json';
  if (mod === 'mo') return 'mo_dashboard_json';
  if (mod === 'co') return 'co_dashboard_json';
  return 'im_dashboard_json';
}

export async function fetchDashboard(hotelCode?: string, moduleCode?: string): Promise<DashboardJson | null> {
  noStore();
  try {
    const supabase = createAdminClient();
    type DashRow = { generated_json: DashboardJson };
    const table = resolveDashboardTable(moduleCode);
    const isJo = String(moduleCode ?? '').toLowerCase() === 'jo';
    const normalizedModule = String(moduleCode ?? '').toLowerCase();
    const expectedSchema = normalizedModule === 'jo'
      ? 'jo-v1'
      : normalizedModule === 'mo'
        ? 'mo-v1'
        : normalizedModule === 'co'
          ? 'co-v1'
          : 'im-v1';
    const isCo = normalizedModule === 'co';
    const base = supabase
      .from(table)
      .select('generated_json')
      .filter('generated_json->meta->>schema', 'eq', expectedSchema)
      .order('created_at', { ascending: false });
    let result = await (
      hotelCode
        ? base.filter('generated_json->meta->>hotel_code', 'eq', hotelCode)
        : base
    ).limit(1).maybeSingle() as unknown as SbResult<DashRow>;
    if (result.error) {
      console.error('[dashboard/fetchDashboard] primary query failed', {
        hotelCode,
        moduleCode,
        table,
        expectedSchema,
        error: result.error,
      });
    }
    if (!result.data && isJo && hotelCode) {
      // Some historical JO rows may lack parsed hotel_code due to file-hash dedupe.
      // Fallback to latest JO dashboard row so user still sees JO data.
      result = await base.limit(1).maybeSingle() as unknown as SbResult<DashRow>;
      if (result.error) {
        console.error('[dashboard/fetchDashboard] jo fallback query failed', {
          hotelCode,
          moduleCode,
          table,
          expectedSchema,
          error: result.error,
        });
      }
    }
    const data = result.data?.generated_json ?? null;
    if (!data) return null;

    if (isJo && hotelCode) {
      const currentKpis = Array.isArray(data.kpis) ? [...data.kpis] : [];
      const totalQtyIdx = currentKpis.findIndex((k) => k.id === 'kpi_10');
      if (totalQtyIdx >= 0) {
        type QtyRow = { quantity: number | string | null };
        const qtyResult = await supabase
          .from('jo_records')
          .select('quantity')
          .eq('hotel_code', hotelCode.toUpperCase()) as unknown as SbResult<QtyRow[]>;
        const totalQuantity = (qtyResult.data ?? []).reduce((sum, row) => {
          const num = Number(row.quantity ?? 0);
          return sum + (Number.isFinite(num) ? num : 0);
        }, 0);
        currentKpis[totalQtyIdx] = {
          ...currentKpis[totalQtyIdx],
          value: Math.round(totalQuantity),
          unit: 'qty',
          fmt: 'integer',
        };
        return {
          ...data,
          kpis: currentKpis,
        } as DashboardJson;
      }
    }

    if (isCo && hotelCode) {
      return data as CoDashboardJson;
    }
    return data;
  } catch (error) {
    console.error('[dashboard/fetchDashboard] unexpected failure', { hotelCode, moduleCode, error });
    return null;
  }
}

export async function fetchCoRows(hotelCode?: string, chainCode?: string): Promise<CoRow[]> {
  noStore();
  try {
    const scopeHotel = String(hotelCode ?? '').trim().toUpperCase();
    const scopeChain = String(chainCode ?? '').trim().toUpperCase();
    if (!scopeHotel && !scopeChain) return [];
    const supabase = createAdminClient();
    const selectColumns = [
      'row_key',
      'row_number',
      'report_variant',
      'chain_code',
      'hotel_code',
      'created_date',
      'cleaning_order_no',
      'room_no',
      'room_type',
      'floor',
      'building',
      'status',
      'status_normalized',
      'priority',
      'priority_normalized',
      'stay_status',
      'attendant',
      'supervisor',
      'department',
      'task_type',
      'cleaning_type',
      'start_time',
      'end_time',
      'completed_time',
      'duration_minutes',
      'planned_duration_minutes',
      'actual_duration_minutes',
      'duration_variance_minutes',
      'ahead_behind_minutes',
      'inspection_status',
      'pass_fail',
      'reclean_flag',
      'remarks',
      'created_by',
      'updated_by',
      'updated_on',
      'cleaning_credit',
      'productivity_per_hour',
      'is_completed',
      'is_on_time',
      'additional_task_status',
    ].join(',');
    const normalizeRow = (row: Record<string, unknown>): CoRow => ({
      ...(row as Omit<CoRow, 'is_passed'>),
      report_variant: 'ACSR',
      chain_code: toStringOrNull(row.chain_code),
      hotel_code: toStringOrNull(row.hotel_code),
      is_passed: String(row.pass_fail ?? row.inspection_status ?? '').trim().toLowerCase() === 'pass',
      duration_minutes: toNumberOrNull(row.duration_minutes),
      planned_duration_minutes: toNumberOrNull(row.planned_duration_minutes),
      actual_duration_minutes: toNumberOrNull(row.actual_duration_minutes),
      duration_variance_minutes: toNumberOrNull(row.duration_variance_minutes),
      ahead_behind_minutes: toNumberOrNull(row.ahead_behind_minutes),
      cleaning_credit: toNumberOrNull(row.cleaning_credit),
      productivity_per_hour: toNumberOrNull(row.productivity_per_hour),
    });
    const runQuery = async (builder: ReturnType<typeof supabase.from>) => {
      const result = await builder.select(selectColumns).order('created_date', { ascending: true });
      return result as { data: Record<string, unknown>[] | null; error: { message: string } | null };
    };
    const scopedQuery = scopeHotel && scopeHotel !== 'CORP'
      ? supabase.from('co_records').eq('report_variant', 'ACSR').eq('hotel_code', scopeHotel)
      : scopeChain
        ? supabase.from('co_records').eq('report_variant', 'ACSR').eq('chain_code', scopeChain)
        : null;
    if (!scopedQuery) return [];
    const { data, error } = await runQuery(scopedQuery);
    if (error) {
      console.error('[dashboard/fetchCoRows] query failed', { hotelCode: scopeHotel, chainCode: scopeChain, error });
    }
    const primaryRows = (data ?? []).map(normalizeRow);
    if (primaryRows.length > 0) return primaryRows;
    const fallbackQuery = scopeHotel && scopeHotel !== 'CORP'
      ? supabase.from('co_records').eq('hotel_code', scopeHotel)
      : scopeChain
        ? supabase.from('co_records').eq('chain_code', scopeChain)
        : null;
    if (!fallbackQuery) return [];
    const { data: fallbackData, error: fallbackError } = await runQuery(fallbackQuery);
    if (fallbackError) {
      console.error('[dashboard/fetchCoRows] fallback query failed', { hotelCode: scopeHotel, chainCode: scopeChain, error: fallbackError });
      return [];
    }
    return (fallbackData ?? []).map(normalizeRow);
  } catch (error) {
    console.error('[dashboard/fetchCoRows] unexpected failure', { hotelCode, chainCode, error });
    return [];
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return text ? text : null;
}

export async function fetchChainEntries(chainCode: string, currentHotelCode: string, moduleCode?: string): Promise<ChainEntry[]> {
  noStore();
  try {
    const supabase = createAdminClient();
    type DashRow = { generated_json: DashboardJson; created_at: string };
    const table = resolveDashboardTable(moduleCode);
    const isCo = String(moduleCode ?? '').toLowerCase() === 'co';
    const { data: rows } = await supabase
      .from(table)
      .select('generated_json, created_at')
      .filter('generated_json->meta->>chain_code', 'eq', chainCode)
      .order('created_at', { ascending: false }) as unknown as SbResult<DashRow[]>;
    if (!rows || rows.length === 0) return [];
    const seen = new Map<string, ChainEntry>();
    for (const row of rows) {
      const json = row.generated_json;
      if (!json?.meta?.hotel_code) continue;
      if (seen.has(json.meta.hotel_code)) continue;
      if (!json.summary) continue;
      seen.set(json.meta.hotel_code, {
        hotel_code:   json.meta.hotel_code,
        hotel_name:   json.meta.hotel_name,
        country_code: json.meta.country_code ?? '',
        summary:      json.summary,
        raw_daily:    json.raw_daily ?? [],
        kpis_by_type: 'kpis_by_type' in json ? json.kpis_by_type : undefined,
        raw_daily_by_type: 'raw_daily_by_type' in json ? json.raw_daily_by_type : undefined,
        summary_by_type: 'summary_by_type' in json ? json.summary_by_type : undefined,
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.hotel_code.localeCompare(b.hotel_code));
  } catch (error) {
    console.error('[dashboard/fetchChainEntries] unexpected failure', { chainCode, currentHotelCode, moduleCode, error });
    return [];
  }
}

function mergeNumMap(target: Record<string, number>, source: Record<string, number> | undefined) {
  if (!source) return;
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}
function mergeNestedNumMap(
  target: Record<string, Record<string, number>>,
  source: Record<string, Record<string, number>> | undefined,
) {
  if (!source) return;
  for (const [k, inner] of Object.entries(source)) {
    if (!target[k]) target[k] = {};
    mergeNumMap(target[k], inner);
  }
}

function mergeRawDaily(allDaily: DailyBucket[][]): DailyBucket[] {
  const byDate = new Map<string, DailyBucket>();
  for (const daily of allDaily) {
    for (const d of daily) {
      if (!byDate.has(d.date)) {
        byDate.set(d.date, {
          date: d.date,
          total: 0,
          completed: 0,
          cancelled: 0,
          pending: 0,
          high_crit: 0,
          severity_sum: 0,
          vip: 0,
          by_severity: {},
          by_category: {},
          by_status: {},
        });
      }
      const t = byDate.get(d.date)!;
      t.total += d.total;
      t.completed += d.completed;
      t.cancelled += d.cancelled;
      t.pending += d.pending;
      t.high_crit += d.high_crit;
      t.severity_sum += d.severity_sum;
      t.vip += d.vip ?? 0;
      mergeNumMap(t.by_severity, d.by_severity);
      mergeNumMap(t.by_category, d.by_category);
      mergeNumMap(t.by_status, d.by_status);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function mergeSummary(summaries: HotelSummary[]): HotelSummary {
  const out: HotelSummary = {
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
  for (const s of summaries) {
    out.total += s.total;
    out.completed += s.completed;
    out.cancelled += s.cancelled;
    out.pending += s.pending;
    out.vip_total += s.vip_total;
    out.vip_completed += s.vip_completed;
    out.vip_cancelled += s.vip_cancelled;
    out.severity_sum += s.severity_sum;
    out.repeat_count += s.repeat_count;
    mergeNumMap(out.status_map, s.status_map);
    mergeNumMap(out.dept_map, s.dept_map);
    mergeNumMap(out.category_map, s.category_map);
    mergeNumMap(out.item_map, s.item_map);
    mergeNestedNumMap(out.dept_item_map, s.dept_item_map);
    mergeNestedNumMap(out.dept_category_map, s.dept_category_map);
    mergeNumMap(out.week_map, s.week_map);
    mergeNestedNumMap(out.week_source_map, s.week_source_map);
    mergeNestedNumMap(out.dept_source_map, s.dept_source_map);
    mergeNumMap(out.booking_map, s.booking_map);
    mergeNumMap(out.source_map, s.source_map);
    mergeNumMap(out.severity_map, s.severity_map);
  }
  return out;
}

function buildCorpKpis(template: ImDashboardJson, summary: HotelSummary): ImDashboardJson['kpis'] {
  const total = summary.total;
  const completed = summary.completed;
  const cancelled = summary.cancelled;
  const pending = summary.pending;
  const closureRate = total > 0 ? (completed / total) * 100 : 0;
  const backlogRate = total > 0 ? (pending / total) * 100 : 0;
  const timeoutRate = backlogRate;
  // For JO: kpi_05 (Escalation Rate) maps to cancelled/total; status_map['Escalated'] is never
  // populated in JO data so use cancelled directly — same formula as recomputeJoKpis.
  const escalationRate = total > 0 ? (cancelled / total) * 100 : 0;
  const reassignmentRate = total > 0 ? (summary.repeat_count / total) * 100 : 0;
  const avgSeverity = total > 0 ? (summary.severity_sum / total) : 0;
  const vipShare = total > 0 ? (summary.vip_total / total) * 100 : 0;

  return template.kpis.map((k) => {
    if (k.id === 'kpi_01') return { ...k, value: total };
    if (k.id === 'kpi_02') return { ...k, value: Number(closureRate.toFixed(1)) };
    if (k.id === 'kpi_03') return { ...k, value: Number(backlogRate.toFixed(1)) };
    if (k.id === 'kpi_04') return { ...k, value: Number(timeoutRate.toFixed(1)) };   // % not raw count
    if (k.id === 'kpi_05') return { ...k, value: Number(escalationRate.toFixed(1)) }; // % not raw count
    if (k.id === 'kpi_06') return { ...k, value: Number(vipShare.toFixed(1)) };
    if (k.id === 'kpi_07') return { ...k, value: k.value === null ? null : k.value };
    if (k.id === 'kpi_08') return { ...k, value: Number(reassignmentRate.toFixed(2)) };
    if (k.id === 'kpi_09') return { ...k, value: k.value === null ? null : k.value };
    if (k.id === 'kpi_10') return { ...k, value: Number(avgSeverity.toFixed(2)) };
    // JO-safe fallbacks
    if ((k.label ?? '').toLowerCase().includes('timeout')) return { ...k, value: Number(timeoutRate.toFixed(1)) };
    if ((k.label ?? '').toLowerCase().includes('escalation')) return { ...k, value: Number(escalationRate.toFixed(1)) };
    if ((k.label ?? '').toLowerCase().includes('reassignment')) return { ...k, value: Number(reassignmentRate.toFixed(1)) };
    return k;
  });
}

function sumChainKpiValue(entries: ChainEntry[], id: string): number {
  return entries.reduce((sum, entry) => {
    const raw = entry.kpis?.find((k) => k.id === id)?.value;
    const num = Number(raw ?? 0);
    return sum + (Number.isFinite(num) ? num : 0);
  }, 0);
}

/**
 * Corp JO KPIs — aggregate each hotel's already-correct JO KPI values with the
 * proper weighting. Rate KPIs of the form X/total are weighted by total; SLA
 * Compliance and resolution time (defined over completed jobs) are weighted by
 * completed. This avoids the IM-semantics bug in buildCorpKpis, which filled
 * JO's kpi_03 (SLA Compliance) slot with IM's Open Backlog Rate (pending/total).
 *
 * The template is itself a JO dashboard, so labels/units/benchmarks are already
 * JO-correct — only the numeric values are overridden.
 */
function buildCorpJoKpis(template: ImDashboardJson, entries: ChainEntry[]): ImDashboardJson['kpis'] {
  const totalSum = entries.reduce((s, e) => s + (e.summary.total ?? 0), 0);
  const kpiVal = (e: ChainEntry, id: string): number | null => {
    const v = e.kpis?.find((k) => k.id === id)?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  // Weighted average of per-hotel KPI values; weight selector returns the denominator.
  const wAvg = (id: string, weight: (e: ChainEntry) => number): number => {
    let num = 0;
    let den = 0;
    for (const e of entries) {
      const v = kpiVal(e, id);
      const w = weight(e);
      if (v !== null && w > 0) { num += v * w; den += w; }
    }
    return den > 0 ? num / den : 0;
  };
  const byTotal = (e: ChainEntry) => e.summary.total ?? 0;
  const byCompleted = (e: ChainEntry) => e.summary.completed ?? 0;

  return template.kpis.map((k) => {
    switch (k.id) {
      case 'kpi_01': return { ...k, value: totalSum };                                        // Total Job Orders
      case 'kpi_02': return { ...k, value: Number(wAvg('kpi_02', byTotal).toFixed(1)) };       // Completion Rate
      case 'kpi_03': return { ...k, value: Number(wAvg('kpi_03', byCompleted).toFixed(1)) };   // SLA Compliance
      case 'kpi_04': return { ...k, value: Number(wAvg('kpi_04', byTotal).toFixed(1)) };       // Timeout Rate
      case 'kpi_05': return { ...k, value: Number(wAvg('kpi_05', byTotal).toFixed(1)) };       // Escalation Rate
      case 'kpi_06': return { ...k, value: Number(wAvg('kpi_06', byTotal).toFixed(1)) };       // Reassignment Rate
      case 'kpi_07': return { ...k, value: Number(wAvg('kpi_07', byTotal).toFixed(2)) };       // Avg Response (min)
      case 'kpi_08': return { ...k, value: Number(wAvg('kpi_08', byTotal).toFixed(2)) };       // P90 Response (approx)
      case 'kpi_09': return { ...k, value: Number(wAvg('kpi_09', byCompleted).toFixed(2)) };   // Avg Resolution (min)
      case 'kpi_10': return { ...k, value: Math.round(sumChainKpiValue(entries, 'kpi_10')), unit: 'qty', fmt: 'integer' };
      default: return k;
    }
  });
}

export async function fetchCorpDashboard(chainCode?: string, moduleCode?: string): Promise<{ data: DashboardJson | null; chainEntries: ChainEntry[] }> {
  noStore();
  if (!chainCode) return { data: null, chainEntries: [] };
  try {
    const supabase = createAdminClient();
    const isMo = String(moduleCode ?? '').toLowerCase() === 'mo';
    const isCo = String(moduleCode ?? '').toLowerCase() === 'co';
    type DashRow = { generated_json: DashboardJson; created_at: string };
    const table = resolveDashboardTable(moduleCode);
    const rowsResult = await supabase
      .from(table)
      .select('generated_json, created_at')
      .filter('generated_json->meta->>chain_code', 'eq', chainCode.toUpperCase())
      .order('created_at', { ascending: false }) as unknown as SbResult<DashRow[]>;
    if (rowsResult.error) {
      console.error('[dashboard/fetchCorpDashboard] query failed', {
        chainCode,
        moduleCode,
        table,
        error: rowsResult.error,
      });
    }

    const rows = rowsResult.data ?? [];
    if (rows.length === 0) return { data: null, chainEntries: [] };

    const latestByHotel = new Map<string, DashboardJson>();
    for (const row of rows) {
      const json = row.generated_json;
      const hotelCode = (json?.meta?.hotel_code ?? '').trim().toUpperCase();
      if (!hotelCode || latestByHotel.has(hotelCode)) continue;
      if (!json.summary) continue;
      latestByHotel.set(hotelCode, json);
    }

    const dashboards = Array.from(latestByHotel.values());
    if (dashboards.length < 2) return { data: null, chainEntries: [] };

    const template = dashboards[0];
    const chainEntries: ChainEntry[] = dashboards.map((d) => {
      const maintenance = (d.meta.schema === 'mo-v1' || d.meta.schema === 'co-v1') ? d as MoDashboardJson | CoDashboardJson : null;
      return {
        hotel_code: d.meta.hotel_code,
        hotel_name: d.meta.hotel_name,
        country_code: d.meta.country_code ?? '',
        kpis: d.kpis ?? [],
        summary: d.summary,
        raw_daily: d.raw_daily ?? [],
        kpis_by_type: maintenance?.kpis_by_type,
        raw_daily_by_type: maintenance?.raw_daily_by_type,
        summary_by_type: maintenance?.summary_by_type,
      };
    }).sort((a, b) => a.hotel_code.localeCompare(b.hotel_code));

    // Build accurate department->source_of_complaint and department->item maps
    // from live IM records so corp charts remain correct even for legacy summaries.
    if (!isMo && !isCo && String(moduleCode ?? '').toLowerCase() !== 'jo') {
      type SrcRow = {
        hotel_code: string | null;
        department: string | null;
        source_of_complaint: string | null;
        incident_item_name: string | null;
        booking_source: string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const mapByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const itemByHotel: Record<string, Record<string, Record<string, number>>> = {};
        const bookingByHotel: Record<string, Record<string, number>> = {};
        const batch = await supabase
          .from('im_records')
          .select('hotel_code, department, source_of_complaint, incident_item_name, booking_source')
          .in('hotel_code', hotelCodes) as unknown as SbResult<SrcRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const deptRaw = r.department;
          const dept = deptRaw === null || deptRaw === undefined || String(deptRaw).trim() === '' ? 'Unknown Department' : String(deptRaw);
          const src = r.source_of_complaint === null ? 'Unknown' : String(r.source_of_complaint);
          const itemRaw = r.incident_item_name;
          const item = itemRaw === null || itemRaw === undefined || String(itemRaw).trim() === '' ? 'Unknown Item' : String(itemRaw);
          if (!mapByHotel[hotel]) mapByHotel[hotel] = {};
          if (!mapByHotel[hotel][dept]) mapByHotel[hotel][dept] = {};
          mapByHotel[hotel][dept][src] = (mapByHotel[hotel][dept][src] ?? 0) + 1;
          if (!itemByHotel[hotel]) itemByHotel[hotel] = {};
          if (!itemByHotel[hotel][dept]) itemByHotel[hotel][dept] = {};
          itemByHotel[hotel][dept][item] = (itemByHotel[hotel][dept][item] ?? 0) + 1;
          const bookingRaw = r.booking_source;
          const booking = bookingRaw === null || bookingRaw === undefined ? 'Unknown' : String(bookingRaw);
          if (!bookingByHotel[hotel]) bookingByHotel[hotel] = {};
          bookingByHotel[hotel][booking] = (bookingByHotel[hotel][booking] ?? 0) + 1;
        }

        for (const entry of chainEntries) {
          entry.summary.dept_source_map = mapByHotel[entry.hotel_code] ?? entry.summary.dept_source_map ?? {};
          entry.summary.dept_item_map = itemByHotel[entry.hotel_code] ?? entry.summary.dept_item_map ?? {};
          entry.summary.booking_map = bookingByHotel[entry.hotel_code] ?? entry.summary.booking_map ?? {};
        }
      }
    } else if (String(moduleCode ?? '').toLowerCase() === 'jo') {
      type QtyRow = {
        hotel_code: string | null;
        quantity: number | string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const qtyByHotel: Record<string, number> = {};
        const batch = await supabase
          .from('jo_records')
          .select('hotel_code, quantity')
          .in('hotel_code', hotelCodes) as unknown as SbResult<QtyRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const qty = Number(r.quantity ?? 0);
          qtyByHotel[hotel] = (qtyByHotel[hotel] ?? 0) + (Number.isFinite(qty) ? qty : 0);
        }
        for (const entry of chainEntries) {
          const totalQty = Math.round(qtyByHotel[entry.hotel_code] ?? 0);
          const kpis = Array.isArray(entry.kpis) ? [...entry.kpis] : [];
          const idx = kpis.findIndex((k) => k.id === 'kpi_10');
          if (idx >= 0) {
            kpis[idx] = { ...kpis[idx], value: totalQty, unit: 'qty', fmt: 'integer' };
          }
          entry.kpis = kpis;
        }
      }

      type JoLiveRow = {
        hotel_code: string | null;
        assigned_to_department: string | null;
        created_by_department: string | null;
        completed_by_department: string | null;
        location: string | null;
      };
      if (hotelCodes.length > 0) {
        const assignedByHotel: Record<string, Record<string, number>> = {};
        const createdByHotel: Record<string, Record<string, number>> = {};
        const completedByHotel: Record<string, Record<string, number>> = {};
        const locationByHotel: Record<string, Record<string, number>> = {};
        const batch = await supabase
          .from('jo_records')
          .select('hotel_code, assigned_to_department, created_by_department, completed_by_department, location')
          .in('hotel_code', hotelCodes) as unknown as SbResult<JoLiveRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const assigned = r.assigned_to_department === null || String(r.assigned_to_department).trim() === '' ? 'Unknown Assigned Dept' : String(r.assigned_to_department);
          const createdBy = r.created_by_department === null || String(r.created_by_department).trim() === '' ? 'Unknown Source Dept' : String(r.created_by_department);
          const completedBy = r.completed_by_department === null || String(r.completed_by_department).trim() === '' ? 'Unknown Completed Dept' : String(r.completed_by_department);
          const location = r.location === null || String(r.location).trim() === '' ? 'Unknown Location' : String(r.location);
          if (!assignedByHotel[hotel]) assignedByHotel[hotel] = {};
          if (!createdByHotel[hotel]) createdByHotel[hotel] = {};
          if (!completedByHotel[hotel]) completedByHotel[hotel] = {};
          if (!locationByHotel[hotel]) locationByHotel[hotel] = {};
          assignedByHotel[hotel][assigned] = (assignedByHotel[hotel][assigned] ?? 0) + 1;
          createdByHotel[hotel][createdBy] = (createdByHotel[hotel][createdBy] ?? 0) + 1;
          completedByHotel[hotel][completedBy] = (completedByHotel[hotel][completedBy] ?? 0) + 1;
          locationByHotel[hotel][location] = (locationByHotel[hotel][location] ?? 0) + 1;
        }

        for (const entry of chainEntries) {
          entry.summary.assigned_dept_map = assignedByHotel[entry.hotel_code] ?? entry.summary.assigned_dept_map ?? {};
          entry.summary.created_by_dept_map = createdByHotel[entry.hotel_code] ?? entry.summary.created_by_dept_map ?? {};
          entry.summary.completed_by_dept_map = completedByHotel[entry.hotel_code] ?? entry.summary.completed_by_dept_map ?? {};
          entry.summary.location_map = locationByHotel[entry.hotel_code] ?? entry.summary.location_map ?? {};
        }
      }
    } else if (String(moduleCode ?? '').toLowerCase() === 'im') {
      type JoLiveRow = {
        hotel_code: string | null;
        assigned_to_department: string | null;
        created_by_department: string | null;
        completed_by_department: string | null;
        location: string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const assignedByHotel: Record<string, Record<string, number>> = {};
        const createdByHotel: Record<string, Record<string, number>> = {};
        const completedByHotel: Record<string, Record<string, number>> = {};
        const locationByHotel: Record<string, Record<string, number>> = {};
        const batch = await supabase
          .from('jo_records')
          .select('hotel_code, assigned_to_department, created_by_department, completed_by_department, location')
          .in('hotel_code', hotelCodes) as unknown as SbResult<JoLiveRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const assigned = r.assigned_to_department === null || String(r.assigned_to_department).trim() === '' ? 'Unknown Assigned Dept' : String(r.assigned_to_department);
          const createdBy = r.created_by_department === null || String(r.created_by_department).trim() === '' ? 'Unknown Source Dept' : String(r.created_by_department);
          const completedBy = r.completed_by_department === null || String(r.completed_by_department).trim() === '' ? 'Unknown Completed Dept' : String(r.completed_by_department);
          const location = r.location === null || String(r.location).trim() === '' ? 'Unknown Location' : String(r.location);
          if (!assignedByHotel[hotel]) assignedByHotel[hotel] = {};
          if (!createdByHotel[hotel]) createdByHotel[hotel] = {};
          if (!completedByHotel[hotel]) completedByHotel[hotel] = {};
          if (!locationByHotel[hotel]) locationByHotel[hotel] = {};
          assignedByHotel[hotel][assigned] = (assignedByHotel[hotel][assigned] ?? 0) + 1;
          createdByHotel[hotel][createdBy] = (createdByHotel[hotel][createdBy] ?? 0) + 1;
          completedByHotel[hotel][completedBy] = (completedByHotel[hotel][completedBy] ?? 0) + 1;
          locationByHotel[hotel][location] = (locationByHotel[hotel][location] ?? 0) + 1;
        }

        for (const entry of chainEntries) {
          entry.summary.assigned_dept_map = assignedByHotel[entry.hotel_code] ?? entry.summary.assigned_dept_map ?? {};
          entry.summary.created_by_dept_map = createdByHotel[entry.hotel_code] ?? entry.summary.created_by_dept_map ?? {};
          entry.summary.completed_by_dept_map = completedByHotel[entry.hotel_code] ?? entry.summary.completed_by_dept_map ?? {};
          entry.summary.location_map = locationByHotel[entry.hotel_code] ?? entry.summary.location_map ?? {};
        }
      }
    }

    if (isMo || isCo) {
      type MoLiveRow = {
        hotel_code: string | null;
        type: string | null;
        location: string | null;
        building: string | null;
      };
      const hotelCodes = chainEntries.map((e) => e.hotel_code).filter(Boolean);
      if (hotelCodes.length > 0) {
        const locationByHotel: Record<string, Record<string, number>> = {};
        const maintenanceTable = isCo ? 'co_records' : 'mo_records';
        const batch = await supabase
          .from(maintenanceTable)
          .select('hotel_code, type, location, building')
          .in('hotel_code', hotelCodes)
          .in('type', isCo ? ['MO', 'CO'] : ['MO']) as unknown as SbResult<MoLiveRow[]>;
        const rows = batch.data ?? [];
        for (const r of rows) {
          const hotel = (r.hotel_code ?? '').toUpperCase();
          if (!hotel) continue;
          const location = r.location === null || String(r.location).trim() === ''
            ? (r.building === null || String(r.building).trim() === '' ? 'Unknown Location' : String(r.building))
            : String(r.location);
          if (!locationByHotel[hotel]) locationByHotel[hotel] = {};
          locationByHotel[hotel][location] = (locationByHotel[hotel][location] ?? 0) + 1;
        }
        for (const entry of chainEntries) {
          for (const maintenanceType of ['MO', 'PM'] as const) {
            if (!entry.summary_by_type?.[maintenanceType]) continue;
            entry.summary_by_type[maintenanceType].location_map =
              locationByHotel[entry.hotel_code] ?? entry.summary_by_type[maintenanceType].location_map ?? {};
          }
        }
      }

      const scopedEntriesByType = {
        MO: chainEntries.map((entry) => ({
          ...entry,
          summary: entry.summary_by_type?.MO ?? entry.summary,
          raw_daily: entry.raw_daily_by_type?.MO ?? entry.raw_daily ?? [],
        })),
        PM: chainEntries.map((entry) => ({
          ...entry,
          summary: entry.summary_by_type?.PM ?? entry.summary,
          raw_daily: entry.raw_daily_by_type?.PM ?? entry.raw_daily ?? [],
        })),
      };

      const scopedSummaryByType = {
        MO: mergeSummary(scopedEntriesByType.MO.map((e) => e.summary)),
        PM: mergeSummary(scopedEntriesByType.PM.map((e) => e.summary)),
      };
      const scopedRawDailyByType = {
        MO: mergeRawDaily(scopedEntriesByType.MO.map((e) => e.raw_daily ?? [])),
        PM: mergeRawDaily(scopedEntriesByType.PM.map((e) => e.raw_daily ?? [])),
      };
      const scopedDates = scopedRawDailyByType.MO.map((d) => d.date);
      const scopedDateMin = scopedDates.length > 0 ? scopedDates[0] : null;
      const scopedDateMax = scopedDates.length > 0 ? scopedDates[scopedDates.length - 1] : null;
      const scopedTotalRecords = scopedEntriesByType.MO.reduce((sum, entry) => sum + (entry.summary.total ?? 0), 0);

      if (isCo) {
        const coTemplate = template as CoDashboardJson;
        const corpCoData: CoDashboardJson = {
          ...coTemplate,
          meta: {
            ...coTemplate.meta,
            source_name: `${chainCode.toUpperCase()} Corp`,
            chain_code: chainCode.toUpperCase(),
            hotel_code: 'CORP',
            hotel_name: 'Corp',
            total_records: scopedTotalRecords,
            date_range: { min: scopedDateMin, max: scopedDateMax },
            generated_at: new Date().toISOString(),
            schema: 'co-v1',
          },
          kpis: coTemplate.kpis ?? [],
          eac: coTemplate.eac ?? [],
          charts: coTemplate.charts ?? [],
          raw_daily: scopedRawDailyByType.MO,
          summary: scopedSummaryByType.MO,
          kpis_by_type: {
            ...coTemplate.kpis_by_type,
            MO: coTemplate.kpis_by_type?.MO ?? [],
            PM: coTemplate.kpis_by_type?.PM ?? [],
          },
          charts_by_type: {
            ...coTemplate.charts_by_type,
            MO: coTemplate.charts_by_type?.MO ?? [],
            PM: coTemplate.charts_by_type?.PM ?? [],
          },
          raw_daily_by_type: {
            ...coTemplate.raw_daily_by_type,
            MO: scopedRawDailyByType.MO,
            PM: scopedRawDailyByType.PM,
          },
          summary_by_type: {
            ...coTemplate.summary_by_type,
            MO: scopedSummaryByType.MO,
            PM: scopedSummaryByType.PM,
          },
        };

        return { data: corpCoData, chainEntries };
      }

      const moTemplate = template as MoDashboardJson;
      const corpMoData: MoDashboardJson = {
        ...moTemplate,
        meta: {
          ...moTemplate.meta,
          source_name: `${chainCode.toUpperCase()} Corp`,
          chain_code: chainCode.toUpperCase(),
          hotel_code: 'CORP',
          hotel_name: 'Corp',
          total_records: scopedTotalRecords,
          date_range: { min: scopedDateMin, max: scopedDateMax },
          generated_at: new Date().toISOString(),
          schema: 'mo-v1',
        },
        kpis: moTemplate.kpis ?? [],
        eac: moTemplate.eac ?? [],
        charts: moTemplate.charts ?? [],
        raw_daily: scopedRawDailyByType.MO,
        summary: scopedSummaryByType.MO,
        kpis_by_type: {
          ...moTemplate.kpis_by_type,
          MO: moTemplate.kpis_by_type?.MO ?? [],
          PM: moTemplate.kpis_by_type?.PM ?? [],
        },
        charts_by_type: {
          ...moTemplate.charts_by_type,
          MO: moTemplate.charts_by_type?.MO ?? [],
          PM: moTemplate.charts_by_type?.PM ?? [],
        },
        raw_daily_by_type: {
          ...moTemplate.raw_daily_by_type,
          MO: scopedRawDailyByType.MO,
          PM: scopedRawDailyByType.PM,
        },
        summary_by_type: {
          ...moTemplate.summary_by_type,
          MO: scopedSummaryByType.MO,
          PM: scopedSummaryByType.PM,
        },
      };

      return { data: corpMoData, chainEntries };
    }

    const imTemplate = template as ImDashboardJson;
    const summary = mergeSummary(dashboards.map((d) => d.summary));
    // Re-merge summary from chainEntries in case live IM maps were enriched above.
    const enrichedSummary = mergeSummary(chainEntries.map((e) => e.summary));
    const rawDaily = mergeRawDaily(dashboards.map((d) => d.raw_daily ?? []));
    const dates = rawDaily.map((d) => d.date);
    const dateMin = dates.length > 0 ? dates[0] : null;
    const dateMax = dates.length > 0 ? dates[dates.length - 1] : null;
    const totalRecords = dashboards.reduce((s, d) => s + (d.meta.total_records ?? 0), 0);

    const data: ImDashboardJson = {
      ...imTemplate,
      meta: {
        ...imTemplate.meta,
        source_name: `${chainCode.toUpperCase()} Corp`,
        chain_code: chainCode.toUpperCase(),
        hotel_code: 'CORP',
        hotel_name: 'Corp',
        total_records: totalRecords,
        date_range: { min: dateMin, max: dateMax },
        generated_at: new Date().toISOString(),
      },
      kpis: moduleCode?.toLowerCase() === 'jo'
        ? buildCorpJoKpis(imTemplate, chainEntries)
        : buildCorpKpis(imTemplate, summary),
      raw_daily: rawDaily,
      summary: enrichedSummary,
    };

    return { data, chainEntries };
  } catch (error) {
    console.error('[dashboard/fetchCorpDashboard] unexpected failure', { chainCode, moduleCode, error });
    return { data: null, chainEntries: [] };
  }
}
