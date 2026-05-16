import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import type { KpiDef, ChartDef, DailyBucket, ImDashboardJson, HotelSummary } from '@/types/dashboard';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE    = 1_000;
const INSERT_BATCH = 500;

const SEV_WEIGHTS: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
const SEV_ORDER   = ['Critical', 'High', 'Medium', 'Low'] as const;
const SEV_COLORS  = { Critical: '#dc3545', High: '#fd7e14', Medium: '#ffc107', Low: '#28a745' };
const STAT_COLORS: Record<string, string> = { Completed: '#22c55e', Cancelled: '#94a3b8' };
const WD_NAMES    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Public types ──────────────────────────────────────────────────────────────

export interface FinalizeRequest  { upload_job_id: string }
export interface FinalizeResponse { records_inserted: number; dashboard_generated: boolean }

type SbResult<T> = { data: T | null; error: { message: string } | null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFilename(fileName: string): { chainCode: string; hotelCode: string; hotelName: string; countryCode: string } {
  const base = fileName.replace(/\.csv$/i, '');
  const parts = base.split('-');
  let moduleIdx = -1;
  for (let i = parts.length - 3; i >= 2; i--) {
    if (/^(im|jo)$/i.test(parts[i])) { moduleIdx = i; break; }
  }
  return {
    chainCode:   parts[0]?.toUpperCase() ?? '',
    hotelCode:   parts[1]?.toUpperCase() ?? '',
    hotelName:   moduleIdx > 2 ? parts.slice(2, moduleIdx).join('-') : (parts[2] ?? ''),
    countryCode: moduleIdx >= 0 ? (parts[moduleIdx + 1]?.toUpperCase() ?? '') : '',
  };
}

function toIso(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val); return isNaN(n) ? null : n;
}
function toStr(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  return String(val);
}
function inc(map: Record<string, number>, key: string | null) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}
function topN(map: Record<string, number>, n: number): [string, number][] {
  return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, n);
}
function r1(n: number) { return Math.round(n * 10) / 10; }
function r2(n: number) { return Math.round(n * 100) / 100; }

function isVip(rr: Record<string, unknown>): boolean {
  // IM rule: VIP is decided by vip_code only.
  // Non-VIP when vip_code is null/undefined, blank/whitespace, or '-'.
  const raw = rr.vip_code;
  if (raw === null || raw === undefined) return false;
  const code = String(raw).trim();
  if (!code) return false;
  if (code === '-') return false;
  return true;
}

function findField(rr: Record<string, unknown>, ...fields: string[]): string | null {
  for (const f of fields) {
    const v = rr[f];
    if (v !== null && v !== undefined && v !== '') return String(v);
  }
  return null;
}

function toWeekKey(d: Date): string {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() + 3 - ((dt.getDay() + 6) % 7));
  const w1 = new Date(dt.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((dt.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${dt.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function parseDurationMinutes(val: unknown): number | null {
  const raw = toStr(val)?.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3] ?? 0);
    if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss)) {
      return hh * 60 + mm + Math.floor(ss / 60);
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function mapJoStatusToIncidentStatus(status: string | null): string {
  const s = (status ?? '').trim().toLowerCase();
  if (!s) return 'Pending';
  if (s.includes('cancel')) return 'Cancelled';
  if (s.includes('complete') || s.includes('close') || s.includes('done') || s.includes('finish')) return 'Completed';
  return 'Pending';
}

function mapJoSeverity(rr: Record<string, unknown>): string {
  const delayMin = parseDurationMinutes(rr.delay_duration);
  if (delayMin !== null) {
    if (delayMin >= 60) return 'Critical';
    if (delayMin >= 15) return 'High';
    if (delayMin > 0) return 'Medium';
    return 'Low';
  }
  const totalMin = parseDurationMinutes(
    findField(rr, 'total_hour_between_created_to_completed', 'execution_duration', 'total_act_between_acknowledged_to_completed'),
  );
  if (totalMin !== null) {
    if (totalMin >= 240) return 'Critical';
    if (totalMin >= 120) return 'High';
    if (totalMin >= 30) return 'Medium';
  }
  return 'Low';
}

function normaliseJoForIm(rr: Record<string, unknown>): Record<string, unknown> {
  const created = toStr(rr.created_datetime);
  return {
    incident_status: mapJoStatusToIncidentStatus(toStr(rr.job_status)),
    incident_category: toStr(rr.service_item_category) ?? toStr(rr.department_name) ?? 'Uncategorized',
    incident_item_name: toStr(rr.service_item) ?? toStr(rr.job_order) ?? null,
    incident_location: toStr(rr.location) ?? null,
    severity: mapJoSeverity(rr),
    source_of_complaint: findField(rr, 'created_by_department', 'created_by_user', 'escalation_group'),
    room_no: toStr(rr.location) ?? null,
    nights: null,
    department: toStr(rr.department_name) ?? null,
    created_date: created,
    incident_datetime: created,
    investigation_updated_on_1: toStr(rr.acknowledged_datetime),
  };
}

// ── IM accumulator ────────────────────────────────────────────────────────────

interface DayBucket {
  date: string; total: number; completed: number; cancelled: number; pending: number;
  high_crit: number; severity_sum: number; vip: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status:   Record<string, number>;
}

interface ImAcc {
  total: number; completed: number; cancelled: number; severitySum: number;
  vipTotal: number; vipCompleted: number; vipCancelled: number;
  firstResponseSum: number; firstResponseCount: number;
  statusMap:     Record<string, number>;
  severityMap:   Record<string, number>;
  categoryMap:   Record<string, number>;
  itemMap:       Record<string, number>;
  roomMap:       Record<string, number>;
  deptMap:       Record<string, number>;
  sourceMap:     Record<string, number>;
  bookingMap:    Record<string, number>;
  hourMap:       Record<number, number>;
  weekMap:       Record<string, number>;
  dailyMap:      Record<string, DayBucket>;
  monthMap:      Record<string, number>;
  weekdayMap:    Record<number, number>;
  catStatusMap:  Record<string, Record<string, number>>;
  catSevMap:     Record<string, Record<string, number>>;
  catDailyMap:   Record<string, Record<string, number>>;
  sevDailyMap:   Record<string, Record<string, number>>;
  monthSevMap:   Record<string, Record<string, number>>;
  wdMonthMap:    Record<string, Record<number, number>>;
  weekSourceMap: Record<string, Record<string, number>>; // week -> source -> count
  statusDeptMap: Record<string, Record<string, number>>; // status → dept → count
  sourceDeptMap: Record<string, Record<string, number>>; // source → dept → count
  deptSourceMap: Record<string, Record<string, number>>; // dept -> source -> count
  deptCatMap:    Record<string, Record<string, number>>; // dept → category → count
  deptItemMap:   Record<string, Record<string, number>>; // dept → incident item → count
  vipDeptMap:    Record<string, number>;
  repeatMap:     Map<string, number>;
  nightsBkts:    Record<string, number>;
  repeatCount:   number;
}

function newImAcc(): ImAcc {
  return {
    total: 0, completed: 0, cancelled: 0, severitySum: 0,
    vipTotal: 0, vipCompleted: 0, vipCancelled: 0,
    firstResponseSum: 0, firstResponseCount: 0,
    statusMap: {}, severityMap: {}, categoryMap: {}, itemMap: {}, roomMap: {},
    deptMap: {}, sourceMap: {}, hourMap: {}, weekMap: {},
    bookingMap: {},
    dailyMap: {}, monthMap: {}, weekdayMap: {},
    catStatusMap: {}, catSevMap: {}, catDailyMap: {}, sevDailyMap: {}, monthSevMap: {}, wdMonthMap: {},
    weekSourceMap: {},
    statusDeptMap: {}, sourceDeptMap: {}, deptSourceMap: {}, deptCatMap: {}, deptItemMap: {}, vipDeptMap: {},
    repeatMap: new Map(),
    nightsBkts: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 },
    repeatCount: 0,
  };
}

function accumulate(acc: ImAcc, rr: Record<string, unknown>) {
  acc.total++;
  const status   = toStr(rr.incident_status)   ?? '';
  const severity = toStr(rr.severity)           ?? '';
  const category = toStr(rr.incident_category)  ?? '';
  const item     = toStr(rr.incident_item_name) ?? '';
  const room     = toStr(rr.room_no)            ?? '';
  const nights   = toNum(rr.nights);
  const dept     = findField(rr, 'department', 'incident_location', 'location', 'department_name') ?? '';
  const sourceRaw = rr.source_of_complaint;
  const source = sourceRaw === null || sourceRaw === undefined ? 'Unknown' : String(sourceRaw);
  const bookingRaw = rr.booking_source;
  const booking = bookingRaw === null || bookingRaw === undefined ? 'Unknown' : String(bookingRaw);
  const vip      = isVip(rr);

  if (status === 'Completed') acc.completed++;
  else if (status === 'Cancelled') acc.cancelled++;

  acc.severitySum += SEV_WEIGHTS[severity] ?? 0;

  inc(acc.statusMap,   status   || null);
  inc(acc.severityMap, severity || null);
  inc(acc.categoryMap, category || null);
  inc(acc.itemMap,     item     || null);
  inc(acc.roomMap,     room     || null);
  inc(acc.deptMap,     dept     || null);
  inc(acc.sourceMap, source);
  inc(acc.bookingMap, booking);

  if (vip) {
    acc.vipTotal++;
    if (status === 'Completed') acc.vipCompleted++;
    else if (status === 'Cancelled') acc.vipCancelled++;
    inc(acc.vipDeptMap, dept || null);
  }

  if (!acc.catStatusMap[category]) acc.catStatusMap[category] = {};
  inc(acc.catStatusMap[category], status   || null);
  if (!acc.catSevMap[category])   acc.catSevMap[category]   = {};
  inc(acc.catSevMap[category],    severity || null);

  if (!acc.statusDeptMap[status]) acc.statusDeptMap[status] = {};
  inc(acc.statusDeptMap[status], dept || null);

  if (!acc.sourceDeptMap[source]) acc.sourceDeptMap[source] = {};
  inc(acc.sourceDeptMap[source], dept || null);
  if (!acc.deptSourceMap[dept]) acc.deptSourceMap[dept] = {};
  inc(acc.deptSourceMap[dept], source);

  if (!acc.deptCatMap[dept]) acc.deptCatMap[dept] = {};
  inc(acc.deptCatMap[dept], category || null);
  if (!acc.deptItemMap[dept]) acc.deptItemMap[dept] = {};
  inc(acc.deptItemMap[dept], item || null);

  const rk = `${room}::${category}::${item}`;
  const prevCnt = acc.repeatMap.get(rk) ?? 0;
  acc.repeatMap.set(rk, prevCnt + 1);
  if (prevCnt + 1 === 2) acc.repeatCount += 2;
  else if (prevCnt + 1 > 2) acc.repeatCount++;

  if (nights !== null) {
    const b = nights <= 0 ? '0' : nights === 1 ? '1' : nights === 2 ? '2' : nights === 3 ? '3' : nights === 4 ? '4' : '5+';
    acc.nightsBkts[b] = (acc.nightsBkts[b] ?? 0) + 1;
  }

  // First-response time: created_date → investigation_updated_on_1
  const createdRaw = toStr(rr.created_date);
  const invOn1Raw  = toStr(rr.investigation_updated_on_1);
  if (createdRaw && invOn1Raw) {
    const t1 = new Date(createdRaw).getTime();
    const t2 = new Date(invOn1Raw).getTime();
    if (!isNaN(t1) && !isNaN(t2) && t2 >= t1) {
      acc.firstResponseSum   += (t2 - t1) / 60_000;
      acc.firstResponseCount++;
    }
  }

  // Date-based accumulation
  const rawDate = toStr(rr.incident_datetime) ?? toStr(rr.created_date);
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      const dayKey   = d.toISOString().slice(0, 10);
      const monthKey = d.toISOString().slice(0, 7);
      const wd       = d.getDay();
      const hr       = d.getUTCHours();
      const wkKey    = toWeekKey(d);

      if (!acc.dailyMap[dayKey]) acc.dailyMap[dayKey] = {
        date: dayKey, total: 0, completed: 0, cancelled: 0, pending: 0,
        high_crit: 0, severity_sum: 0, vip: 0,
        by_severity: {}, by_category: {}, by_status: {},
      };
      const bkt = acc.dailyMap[dayKey];
      bkt.total++;
      if (status === 'Completed') bkt.completed++;
      else if (status === 'Cancelled') bkt.cancelled++;
      else bkt.pending++;
      if (severity === 'High' || severity === 'Critical') bkt.high_crit++;
      bkt.severity_sum += SEV_WEIGHTS[severity] ?? 0;
      if (vip) bkt.vip++;
      inc(bkt.by_severity, severity || null);
      inc(bkt.by_category, category || null);
      inc(bkt.by_status,   status   || null);

      inc(acc.monthMap, monthKey);
      acc.weekdayMap[wd] = (acc.weekdayMap[wd] ?? 0) + 1;
      acc.hourMap[hr]    = (acc.hourMap[hr]    ?? 0) + 1;
      acc.weekMap[wkKey] = (acc.weekMap[wkKey] ?? 0) + 1;
      if (!acc.weekSourceMap[wkKey]) acc.weekSourceMap[wkKey] = {};
      inc(acc.weekSourceMap[wkKey], source || null);

      if (!acc.wdMonthMap[monthKey]) acc.wdMonthMap[monthKey] = {};
      acc.wdMonthMap[monthKey][wd] = (acc.wdMonthMap[monthKey][wd] ?? 0) + 1;

      if (!acc.catDailyMap[category]) acc.catDailyMap[category] = {};
      acc.catDailyMap[category][dayKey] = (acc.catDailyMap[category][dayKey] ?? 0) + 1;

      if (!acc.sevDailyMap[severity]) acc.sevDailyMap[severity] = {};
      acc.sevDailyMap[severity][dayKey] = (acc.sevDailyMap[severity][dayKey] ?? 0) + 1;

      if (!acc.monthSevMap[monthKey]) acc.monthSevMap[monthKey] = {};
      acc.monthSevMap[monthKey][severity] = (acc.monthSevMap[monthKey][severity] ?? 0) + 1;
    }
  }
}

// ── Dashboard JSON builder ────────────────────────────────────────────────────

interface HotelInfo { chainCode: string; hotelCode: string; hotelName: string; countryCode: string }

function buildImJson(acc: ImAcc, upload_job_id: string, source_name: string, hotel: HotelInfo): ImDashboardJson {
  const { total, completed, cancelled, severitySum, vipTotal, vipCompleted, vipCancelled,
          firstResponseSum, firstResponseCount } = acc;
  const pending     = total - completed - cancelled;
  const closureRate = total > 0 ? (completed / total) * 100 : 0;
  const backlogRate = total > 0 ? (pending   / total) * 100 : 0;
  const avgSev      = total > 0 ? severitySum / total : 0;
  const repeatRate  = total > 0 ? (acc.repeatCount / total) * 100 : 0;
  const hasVip          = vipTotal > 0;
  const vipShare        = hasVip && total > 0 ? (vipTotal / total) * 100 : null;
  const vipClosure      = hasVip && vipTotal > 0 ? (vipCompleted / vipTotal) * 100 : null;
  const hasFirstResp    = firstResponseCount > 0;
  const avgFirstResp    = hasFirstResp ? firstResponseSum / firstResponseCount : null;

  const sortedDays   = Object.keys(acc.dailyMap).sort();
  const sortedMonths = Object.keys(acc.monthMap).sort();
  const sortedWeeks  = Object.keys(acc.weekMap).sort();
  const allCats      = topN(acc.categoryMap, 999).map(([k]) => k);
  const top5Cats     = allCats.slice(0, 5);
  const top8Cats     = allCats.slice(0, 8);
  const top10Cats    = allCats.slice(0, 10);
  const allDepts     = topN(acc.deptMap, 999).map(([k]) => k);
  const top8Depts    = allDepts.slice(0, 8);

  // ── KPIs ────────────────────────────────────────────────────────────────────

  const kpis: KpiDef[] = [
    {
      id: 'kpi_01', label: 'Incident Volume', value: total, unit: 'cases', fmt: 'integer', available: true,
      note: 'Total number of incidents logged in the selected period.',
      formula: 'COUNT(all incidents)',
    },
    {
      id: 'kpi_02', label: 'Closure Rate', value: r1(closureRate), unit: '%', fmt: 'pct1', available: true,
      note: 'Percentage of incidents resolved (Completed status) out of all incidents.',
      formula: 'Completed ÷ Total × 100',
    },
    {
      id: 'kpi_03', label: 'Open Backlog Rate', value: r1(backlogRate), unit: '%', fmt: 'pct1', available: true,
      note: 'Percentage of incidents still open or pending — not yet completed or cancelled.',
      formula: '(Total − Completed − Cancelled) ÷ Total × 100',
    },
    {
      id: 'kpi_04', label: 'Pending Cases', value: pending, unit: 'cases', fmt: 'integer', available: true,
      note: 'Count of incidents currently open or in a pending status.',
      formula: 'COUNT(status ∉ {Completed, Cancelled})',
    },
    {
      id: 'kpi_05', label: 'Cancelled Cases', value: cancelled, unit: 'cases', fmt: 'integer', available: true,
      note: 'Count of incidents that were withdrawn or cancelled.',
      formula: 'COUNT(status = "Cancelled")',
    },
    {
      id: 'kpi_06', label: 'VIP Incident Share', value: hasVip ? r1(vipShare!) : null, unit: '%', fmt: 'pct1',
      available: hasVip,
      note: hasVip
        ? 'Percentage of incidents flagged as VIP (non-placeholder VIP Code).'
        : 'VIP Code field not present in this upload. Upload a CSV with a VIP Code column to enable.',
      formula: 'VIP Incidents ÷ Total × 100',
    },
    {
      id: 'kpi_07', label: 'VIP Closure Rate', value: hasVip ? r1(vipClosure!) : null, unit: '%', fmt: 'pct1',
      available: hasVip,
      note: hasVip
        ? 'Percentage of VIP incidents that were resolved (Completed).'
        : 'VIP Code field not present in this upload.',
      formula: 'Completed VIP Incidents ÷ Total VIP Incidents × 100',
    },
    {
      id: 'kpi_08', label: 'Repeat Incident Rate', value: r1(repeatRate), unit: '%', fmt: 'pct1', available: true,
      note: 'Share of incidents belonging to a repeated room + category + item combination.',
      formula: 'Incidents in groups(room + category + item) with count > 1 ÷ Total × 100',
    },
    {
      id: 'kpi_09', label: 'Avg First Response', value: hasFirstResp ? r2(avgFirstResp!) : null,
      unit: 'min', fmt: 'decimal2', available: hasFirstResp,
      note: hasFirstResp
        ? `Average minutes from incident creation to first investigation update. Based on ${firstResponseCount} incidents with response data.`
        : 'First-response timestamp (Investigation Updated On 1) not present in this upload.',
      formula: 'AVG(Investigation Updated On 1 − Created Date) in minutes',
    },
    {
      id: 'kpi_10', label: 'Avg Severity Score', value: r2(avgSev), unit: 'pts', fmt: 'decimal2', available: true,
      note: 'Weighted average severity. Low=1, Medium=2, High=3, Critical=4.',
      formula: '(Low×1 + Medium×2 + High×3 + Critical×4) ÷ Total incidents',
    },
  ];

  // ── Chart helpers ────────────────────────────────────────────────────────────

  function pieSeries(map: Record<string, number>, colors?: Record<string, string>) {
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([name, y]) => ({ name, y, ...(colors?.[name] ? { color: colors[name] } : {}) }));
  }

  function dailyTotals(field: keyof DayBucket) {
    return sortedDays.map(d => (acc.dailyMap[d][field] as number) ?? 0);
  }

  function catClosureRates(cats: string[]) {
    return cats.map(cat => {
      const sm = acc.catStatusMap[cat] ?? {};
      const tot = Object.values(sm).reduce((s, v) => s + v, 0);
      return tot > 0 ? r1(((sm['Completed'] ?? 0) / tot) * 100) : 0;
    });
  }

  // Semi-donut gauge helper (no extra module needed — standard pie with angle limits)
  function gaugeOptions(value: number, maxValue: number, color: string, unit: string) {
    const pct = Math.min(Math.max(value / maxValue, 0), 1);
    return {
      chart: { type: 'pie', margin: [0, 0, 0, 0] },
      plotOptions: {
        pie: {
          startAngle: -90, endAngle: 90, center: ['50%', '75%'],
          size: '110%', innerSize: '70%',
          dataLabels: { enabled: true, format: `<b>{point.y:.1f}${unit}</b>`, style: { fontSize: '18px' }, distance: -40 },
        },
      },
      series: [{
        name: 'Value',
        type: 'pie',
        data: [
          { name: 'Value', y: r1(value), color },
          { name: '',      y: r1(maxValue - value), color: 'transparent', dataLabels: { enabled: false } },
        ],
      }],
      tooltip: { enabled: false },
    };
  }

  // ── 6 EAC Charts ────────────────────────────────────────────────────────────

  // eac_01: Status → Department drilldown donut
  const statusKeys = Object.keys(acc.statusMap).sort((a, b) => acc.statusMap[b] - acc.statusMap[a]);
  const eac01DrillSeries = statusKeys.map(status => ({
    id: status,
    name: `${status} — By Department`,
    type: 'pie',
    innerSize: '45%',
    data: Object.entries(acc.statusDeptMap[status] ?? {})
      .sort(([, a], [, b]) => b - a)
      .map(([dept, y]) => ({ name: dept || 'Unknown', y })),
  }));

  // eac_05: Source → Department drilldown donut
  const sourceKeys = Object.keys(acc.sourceMap).sort((a, b) => acc.sourceMap[b] - acc.sourceMap[a]);
  const eac05DrillSeries = sourceKeys.map(source => ({
    id: source,
    name: `${source} — By Department`,
    type: 'pie',
    innerSize: '45%',
    data: Object.entries(acc.sourceDeptMap[source] ?? {})
      .sort(([, a], [, b]) => b - a)
      .map(([dept, y]) => ({ name: dept || 'Unknown', y })),
  }));

  const eac: ChartDef[] = [
    {
      id: 'eac_01', title: 'Incident by Status → Department', filterable: true, height: 320,
      options: {
        chart: { type: 'pie' },
        series: [{
          name: 'Status', type: 'pie', innerSize: '45%',
          data: statusKeys.map(s => ({
            name: s, y: acc.statusMap[s],
            drilldown: s,
            ...(STAT_COLORS[s] ? { color: STAT_COLORS[s] } : {}),
          })),
        }],
        drilldown: { series: eac01DrillSeries },
        plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' } } },
        tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} incidents ({point.percentage:.1f}%)' },
      },
      note: 'Click a status slice to drill down into its department breakdown.',
      formula: 'COUNT by incident_status → COUNT by department per status',
    },
    {
      id: 'eac_02', title: 'Severity Breakdown', filterable: true,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: SEV_ORDER.filter(s => acc.severityMap[s]) },
        yAxis: { title: { text: 'Incidents' } },
        series: [{
          name: 'Count',
          data: SEV_ORDER.filter(s => acc.severityMap[s]).map(s => ({ y: acc.severityMap[s] ?? 0, color: SEV_COLORS[s as keyof typeof SEV_COLORS] })),
        }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
        tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
      },
      note: 'Count of incidents at each severity level. Critical and High require immediate management attention.',
      formula: 'COUNT by severity',
    },
    {
      id: 'eac_03', title: 'Daily Incident Volume', filterable: true,
      options: {
        chart: { type: 'areaspline' },
        xAxis: { categories: sortedDays, tickInterval: Math.max(1, Math.floor(sortedDays.length / 10)) },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        series: [{ name: 'Incidents', data: dailyTotals('total'), fillOpacity: 0.15 }],
        tooltip: { shared: true },
      },
      note: 'Daily incident count over the period. Spikes indicate high-activity days.',
      formula: 'COUNT by DATE(created_date)',
    },
    {
      id: 'eac_04', title: 'Top Incident Categories', filterable: true,
      options: {
        chart: { type: 'bar' },
        xAxis: { categories: top10Cats },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: top10Cats.map(c => acc.categoryMap[c] ?? 0) }],
        plotOptions: { bar: { dataLabels: { enabled: true } } },
        tooltip: { pointFormat: '<b>{point.y}</b> incidents' },
      },
      note: 'Most frequent incident categories. Focus improvement efforts on the leaders.',
      formula: 'COUNT by incident_category ORDER BY count DESC LIMIT 10',
    },
    {
      id: 'eac_05', title: 'Incident Source → Department', filterable: false,
      options: sourceKeys.length > 0
        ? {
            chart: { type: 'pie' },
            series: [{
              name: 'Source', type: 'pie', innerSize: '45%',
              data: sourceKeys.map(s => ({ name: s, y: acc.sourceMap[s], drilldown: s })),
            }],
            drilldown: { series: eac05DrillSeries },
            plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' } } },
            tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} incidents ({point.percentage:.1f}%)' },
          }
        : {
            chart: { type: 'pie' },
            series: [{ name: 'Incidents', type: 'pie', data: [{ name: 'No source data', y: 1, color: '#e2e8f0' }] }],
            plotOptions: { pie: { dataLabels: { enabled: true } } },
          },
      note: sourceKeys.length > 0
        ? 'Click a source slice to drill into its department breakdown.'
        : 'No complaint source / channel column found in this upload.',
      formula: 'COUNT by complaint_source → COUNT by department per source',
    },
    {
      id: 'eac_06', title: 'VIP Incident Share', filterable: false, height: 220,
      options: hasVip
        ? gaugeOptions(vipShare!, 100, '#f59e0b', '%')
        : {
            chart: { type: 'pie' },
            series: [{ name: '', type: 'pie', data: [{ name: 'No VIP data', y: 1, color: '#e2e8f0' }] }],
            plotOptions: { pie: { dataLabels: { enabled: true } } },
          },
      note: hasVip
        ? `${vipTotal} VIP incidents out of ${total} total (${r1(vipShare!)}%). VIP = non-placeholder VIP Code field.`
        : 'VIP Code column not found or all values are placeholders in this upload.',
      formula: 'VIP Incidents ÷ Total × 100',
    },
  ];

  // ── 24 GM Core Charts ─────────────────────────────────────────────────────────

  function catStackedSeries(cats: string[], map: Record<string, Record<string, number>>, keys: string[]) {
    return keys.map(key => ({
      name: key,
      data: cats.map(c => map[c]?.[key] ?? 0),
      ...(STAT_COLORS[key] ? { color: STAT_COLORS[key] } : {}),
    }));
  }

  const top5SevSeries = SEV_ORDER.map(sev => ({
    name: sev,
    data: top5Cats.map(c => acc.catSevMap[c]?.[sev] ?? 0),
    color: SEV_COLORS[sev as keyof typeof SEV_COLORS],
  }));

  const monthSevSeries = SEV_ORDER.map(sev => ({
    name: sev,
    data: sortedMonths.map(m => acc.monthSevMap[m]?.[sev] ?? 0),
    color: SEV_COLORS[sev as keyof typeof SEV_COLORS],
  }));

  const cat5TrendSeries = top5Cats.map(cat => ({
    name: cat,
    data: sortedDays.map(d => acc.catDailyMap[cat]?.[d] ?? 0),
  }));

  const sevTrendSeries = SEV_ORDER.filter(s => acc.sevDailyMap[s]).map(s => ({
    name: s,
    data: sortedDays.map(d => acc.sevDailyMap[s]?.[d] ?? 0),
    color: SEV_COLORS[s as keyof typeof SEV_COLORS],
  }));

  const heatMonths = sortedMonths;
  const heatData: [number, number, number][] = [];
  for (let mi = 0; mi < heatMonths.length; mi++) {
    const m = heatMonths[mi];
    for (let wd = 0; wd < 7; wd++) {
      const v = acc.wdMonthMap[m]?.[wd] ?? 0;
      if (v > 0) heatData.push([mi, wd, v]);
    }
  }

  // Repeat rate by category
  const catRepeatNum: Record<string, number> = {};
  const catRepeatDen: Record<string, number> = {};
  for (const [key, cnt] of acc.repeatMap) {
    const cat = key.split('::')[1] ?? '';
    catRepeatDen[cat] = (catRepeatDen[cat] ?? 0) + cnt;
    if (cnt > 1) catRepeatNum[cat] = (catRepeatNum[cat] ?? 0) + cnt;
  }
  const repeatCats  = allCats.filter(c => catRepeatDen[c]);
  const repeatRates = repeatCats.map(c =>
    catRepeatDen[c] > 0 ? r1(((catRepeatNum[c] ?? 0) / catRepeatDen[c]) * 100) : 0,
  );

  const highCritByCat = top10Cats.map(c => (acc.catSevMap[c]?.['High'] ?? 0) + (acc.catSevMap[c]?.['Critical'] ?? 0));

  // Dept × category heatmap for chart_18 single-hotel fallback
  const deptCatData: [number, number, number][] = [];
  for (let di = 0; di < top8Depts.length; di++) {
    for (let ci = 0; ci < top8Cats.length; ci++) {
      const v = acc.deptCatMap[top8Depts[di]]?.[top8Cats[ci]] ?? 0;
      if (v > 0) deptCatData.push([di, ci, v]);
    }
  }

  const charts: ChartDef[] = [
    // chart_01 — All categories column
    {
      id: 'chart_01', title: 'Incidents by Category', filterable: true,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: allCats },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: allCats.map(c => acc.categoryMap[c] ?? 0) }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
      },
      note: 'All incident categories ranked by volume.',
      formula: 'COUNT by incident_category ORDER BY count DESC',
    },
    // chart_02 — Severity donut
    {
      id: 'chart_02', title: 'Severity Distribution', filterable: true,
      options: {
        chart: { type: 'pie' },
        series: [{ name: 'Incidents', type: 'pie', innerSize: '50%', data: SEV_ORDER.filter(s => acc.severityMap[s]).map(s => ({ name: s, y: acc.severityMap[s], color: SEV_COLORS[s as keyof typeof SEV_COLORS] })) }],
        plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%' } } },
      },
      note: 'Proportional share of each severity level.',
      formula: 'COUNT by severity ÷ Total × 100',
    },
    // chart_03 — Status donut (filterable)
    {
      id: 'chart_03', title: 'Status Distribution', filterable: true,
      options: {
        chart: { type: 'pie' },
        series: [{ name: 'Incidents', type: 'pie', innerSize: '50%', data: pieSeries(acc.statusMap, STAT_COLORS) }],
        plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%' } } },
      },
      note: 'Proportion of incidents in each status.',
      formula: 'COUNT by incident_status ÷ Total × 100',
    },
    // chart_04 — Daily trend spline (filterable)
    {
      id: 'chart_04', title: 'Daily Incident Trend', filterable: true,
      options: {
        chart: { type: 'spline' },
        xAxis: { categories: sortedDays, tickInterval: Math.max(1, Math.floor(sortedDays.length / 10)) },
        yAxis: { title: { text: 'Incidents' }, min: 0 },
        series: [{ name: 'Incidents', data: dailyTotals('total') }],
        tooltip: { shared: true },
      },
      note: 'Daily incident volume. Use to identify spikes and weekly rhythms.',
      formula: 'COUNT by DATE(created_date)',
    },
    // chart_05 — Monthly volume (filterable)
    {
      id: 'chart_05', title: 'Monthly Incident Volume', filterable: true,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: sortedMonths },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: sortedMonths.map(m => acc.monthMap[m] ?? 0) }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
      },
      note: 'Monthly aggregate incident count.',
      formula: 'COUNT by MONTH(created_date)',
    },
    // chart_06 — Day of week
    {
      id: 'chart_06', title: 'Incidents by Day of Week', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: WD_NAMES },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: WD_NAMES.map((_, i) => acc.weekdayMap[i] ?? 0) }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
      },
      note: 'Incident distribution by day of the week.',
      formula: 'COUNT by DAYOFWEEK(created_date)',
    },
    // chart_07 — Top 15 items
    {
      id: 'chart_07', title: 'Top 15 Incident Items', filterable: false,
      options: {
        chart: { type: 'bar' },
        xAxis: { categories: topN(acc.itemMap, 15).map(([k]) => k) },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: topN(acc.itemMap, 15).map(([, v]) => v) }],
        plotOptions: { bar: { dataLabels: { enabled: true } } },
      },
      note: 'The 15 most-reported incident item types.',
      formula: 'COUNT by incident_item_name ORDER BY count DESC LIMIT 15',
    },
    // chart_08 — Top 10 rooms
    {
      id: 'chart_08', title: 'Top 10 Rooms by Incidents', filterable: false,
      options: {
        chart: { type: 'bar' },
        xAxis: { categories: topN(acc.roomMap, 10).map(([k]) => `Room ${k}`) },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: topN(acc.roomMap, 10).map(([, v]) => v) }],
        plotOptions: { bar: { dataLabels: { enabled: true } } },
      },
      note: 'Rooms with the most incidents.',
      formula: 'COUNT by room_no ORDER BY count DESC LIMIT 10',
    },
    // chart_09 — Category × Status stacked
    {
      id: 'chart_09', title: 'Category × Status (Stacked)', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: top8Cats },
        yAxis: { title: { text: 'Incidents' } },
        series: catStackedSeries(top8Cats, acc.catStatusMap, Object.keys(acc.statusMap)),
        plotOptions: { column: { stacking: 'normal' } },
      },
      note: 'Status breakdown within the top 8 categories.',
      formula: 'COUNT by (incident_category, incident_status) for top 8 categories',
    },
    // chart_10 — Category × Severity top 5
    {
      id: 'chart_10', title: 'Category × Severity (Top 5)', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: top5Cats },
        yAxis: { title: { text: 'Incidents' } },
        series: top5SevSeries,
        plotOptions: { column: { grouping: true } },
      },
      note: 'Severity distribution for the top 5 incident categories.',
      formula: 'COUNT by (incident_category, severity) for top 5 categories',
    },
    // chart_11 — Closure rate by category (filterable)
    {
      id: 'chart_11', title: 'Closure Rate by Category (%)', filterable: true,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: top10Cats },
        yAxis: { title: { text: 'Closure Rate (%)' }, min: 0, max: 100 },
        series: [{ name: 'Closure Rate %', data: catClosureRates(top10Cats) }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
        tooltip: { pointFormat: 'Closure Rate: <b>{point.y:.1f}%</b>' },
      },
      note: 'Percentage of incidents resolved within each category.',
      formula: 'COUNT(Completed) ÷ COUNT(all) × 100 per category',
    },
    // chart_12 — Chain: Total Incidents (fallback: single hotel status pie)
    {
      id: 'chart_12', title: 'Chain — Total Incidents by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: [total] }],
        plotOptions: { column: { dataLabels: { enabled: true } } },
      },
      note: 'Chain comparison not available — only one hotel uploaded. Upload additional hotels to enable cross-hotel comparison.',
      formula: 'COUNT per hotel',
    },
    // chart_13 — Chain: Closure Rate (fallback: single hotel)
    {
      id: 'chart_13', title: 'Chain — Closure Rate by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'Closure Rate (%)' }, min: 0, max: 100 },
        series: [{ name: 'Closure Rate %', data: [r1(closureRate)], color: '#22c55e' }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      },
      note: 'Chain comparison not available — only one hotel uploaded.',
      formula: 'Completed ÷ Total × 100 per hotel',
    },
    // chart_14 — Chain: VIP Share (fallback: single hotel)
    {
      id: 'chart_14', title: 'Chain — VIP Incident Share by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'VIP Share (%)' }, min: 0, max: 100 },
        series: [{ name: 'VIP Share %', data: [hasVip ? r1(vipShare!) : 0], color: '#f59e0b' }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      },
      note: 'Chain comparison not available — only one hotel uploaded.',
      formula: 'VIP Incidents ÷ Total × 100 per hotel',
    },
    // chart_15 — Chain: Avg Severity Score (fallback: single hotel)
    {
      id: 'chart_15', title: 'Chain — Avg Severity Score by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'Avg Severity (1-4)' }, min: 0, max: 4 },
        series: [{ name: 'Avg Severity', data: [r2(avgSev)], color: '#ef4444' }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.2f}' } } },
      },
      note: 'Chain comparison not available — only one hotel uploaded.',
      formula: 'Weighted avg severity score per hotel',
    },
    // chart_16 — Chain: Category Mix stacked % (fallback: single hotel top-5 category share)
    {
      id: 'chart_16', title: 'Chain — Category Mix by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'Share (%)' }, min: 0, max: 100 },
        series: top5Cats.map(cat => ({
          name: cat,
          data: [total > 0 ? r1(((acc.categoryMap[cat] ?? 0) / total) * 100) : 0],
        })),
        plotOptions: { column: { stacking: 'normal' } },
      },
      note: 'Chain comparison not available — only one hotel uploaded.',
      formula: 'COUNT by category per hotel as % of total',
    },
    // chart_17 — Chain: Pending Rate (fallback: single hotel)
    {
      id: 'chart_17', title: 'Chain — Pending Rate by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'Pending Rate (%)' }, min: 0, max: 100 },
        series: [{ name: 'Pending Rate %', data: [r1(backlogRate)], color: '#f97316' }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      },
      note: 'Chain comparison not available — only one hotel uploaded.',
      formula: 'Pending ÷ Total × 100 per hotel',
    },
    // chart_18 — Dept × Category heatmap (single-hotel) / Chain dept comparison
    {
      id: 'chart_18', title: 'Department × Category Heatmap', filterable: false,
      options: top8Depts.length > 0
        ? {
            chart: { type: 'heatmap' },
            xAxis: { categories: top8Depts, title: { text: 'Department' } },
            yAxis: { categories: top8Cats, reversed: true, title: { text: 'Category' } },
            colorAxis: { min: 0, minColor: '#e0f2fe', maxColor: '#1e3a5f' },
            series: [{ name: 'Incidents', type: 'heatmap', data: deptCatData, dataLabels: { enabled: true, style: { fontSize: '10px' } } }],
            tooltip: { pointFormat: 'Incidents: <b>{point.value}</b>' },
          }
        : {
            chart: { type: 'column' },
            series: [{ name: 'No Data', data: [] }],
          },
      note: 'Incident density across departments and categories. Identifies which departments handle which categories most.',
      formula: 'COUNT by (department, incident_category) for top 8 each',
    },
    // chart_19 — Weekly volume (filterable)
    {
      id: 'chart_19', title: 'Weekly Incident Volume', filterable: true,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: sortedWeeks, tickInterval: Math.max(1, Math.floor(sortedWeeks.length / 8)) },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: sortedWeeks.map(w => acc.weekMap[w] ?? 0) }],
        plotOptions: { column: { dataLabels: { enabled: sortedWeeks.length <= 16 } } },
      },
      note: 'Weekly incident count. Useful for identifying multi-week trends and seasonal patterns.',
      formula: 'COUNT by ISO week (YYYY-Www)',
    },
    // chart_20 — Chain: Repeat Rate (fallback: single hotel repeat rate)
    {
      id: 'chart_20', title: 'Chain — Repeat Incident Rate by Hotel', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: [hotel.hotelCode] },
        yAxis: { title: { text: 'Repeat Rate (%)' }, min: 0, max: 100 },
        series: [{ name: 'Repeat Rate %', data: [r1(repeatRate)], color: '#f59e0b' }],
        plotOptions: { column: { dataLabels: { enabled: true, format: '{point.y:.1f}%' } } },
      },
      note: 'Chain comparison not available — only one hotel uploaded.',
      formula: 'Incidents in repeated room+category+item groups ÷ Total × 100 per hotel',
    },
    // chart_21 — Hour of day column
    {
      id: 'chart_21', title: 'Incidents by Hour of Day', filterable: false,
      options: {
        chart: { type: 'column' },
        xAxis: { categories: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`) },
        yAxis: { title: { text: 'Incidents' } },
        series: [{ name: 'Incidents', data: Array.from({ length: 24 }, (_, i) => acc.hourMap[i] ?? 0) }],
        plotOptions: { column: { dataLabels: { enabled: false } } },
        tooltip: { pointFormat: '<b>{point.y}</b> incidents at {point.name}' },
      },
      note: 'Incident distribution across 24 hours. Identifies peak operational hours for staffing decisions.',
      formula: 'COUNT by HOUR(incident_datetime)',
    },
    // chart_22 — Gauge: Closure Rate
    {
      id: 'chart_22', title: 'Gauge — Closure Rate', filterable: false, height: 220,
      options: gaugeOptions(closureRate, 100, '#22c55e', '%'),
      note: `Overall closure rate: ${r1(closureRate)}% of ${total} incidents resolved.`,
      formula: 'Completed ÷ Total × 100',
    },
    // chart_23 — Gauge: VIP Closure Rate
    {
      id: 'chart_23', title: 'Gauge — VIP Closure Rate', filterable: false, height: 220,
      options: hasVip
        ? gaugeOptions(vipClosure!, 100, '#f59e0b', '%')
        : gaugeOptions(0, 100, '#e2e8f0', '%'),
      note: hasVip
        ? `VIP closure rate: ${r1(vipClosure!)}% of ${vipTotal} VIP incidents resolved.`
        : 'No VIP incidents detected in this upload.',
      formula: 'Completed VIP ÷ Total VIP × 100',
    },
    // chart_24 — Gauge: Avg Severity Score (max 4)
    {
      id: 'chart_24', title: 'Gauge — Avg Severity Score', filterable: false, height: 220,
      options: gaugeOptions(avgSev, 4, '#ef4444', 'pts'),
      note: `Average severity: ${r2(avgSev)} / 4.0. Low=1, Medium=2, High=3, Critical=4.`,
      formula: '(Low×1 + Medium×2 + High×3 + Critical×4) ÷ Total',
    },
  ];

  // ── raw_daily ────────────────────────────────────────────────────────────────

  const raw_daily: DailyBucket[] = sortedDays.map(d => {
    const b = acc.dailyMap[d];
    return {
      date: b.date, total: b.total, completed: b.completed, cancelled: b.cancelled,
      pending: b.pending, high_crit: b.high_crit, severity_sum: b.severity_sum, vip: b.vip,
      by_severity: b.by_severity, by_category: b.by_category, by_status: b.by_status,
    };
  });

  // ── summary (for cross-hotel comparison) ─────────────────────────────────────

  const summary: HotelSummary = {
    total, completed, cancelled, pending, vip_total: vipTotal, vip_completed: vipCompleted,
    vip_cancelled: vipCancelled, severity_sum: severitySum, repeat_count: acc.repeatCount,
    status_map:   acc.statusMap,
    dept_map:     acc.deptMap,
    category_map: acc.categoryMap,
    item_map:     acc.itemMap,
    dept_item_map: acc.deptItemMap,
    dept_category_map: acc.deptCatMap,
    week_map:     acc.weekMap,
    week_source_map: acc.weekSourceMap,
    dept_source_map: acc.deptSourceMap,
    booking_map:  acc.bookingMap,
    source_map:   acc.sourceMap,
    severity_map: acc.severityMap,
  };

  return {
    meta: {
      upload_job_id, source_name,
      chain_code:   hotel.chainCode,
      hotel_code:   hotel.hotelCode,
      hotel_name:   hotel.hotelName,
      country_code: hotel.countryCode,
      total_records: total,
      date_range: { min: sortedDays[0] ?? null, max: sortedDays[sortedDays.length - 1] ?? null },
      generated_at: new Date().toISOString(),
      schema: 'im-v1',
    },
    kpis, eac, charts, raw_daily, summary,
  };
}

interface JoKpiAcc {
  total: number;
  completed: number;
  timeout: number;
  escalated: number;
  reassigned: number;
  slaBreachCompleted: number;
  quantityTotal: number;
  responseMins: number[];
  resolutionMins: number[];
  weekStats: Record<string, { jobs: number; completed: number; slaBreaches: number; timeouts: number }>;
  statusCatMap: Record<string, Record<string, number>>;
  catItemCount: Record<string, Record<string, number>>;
  deptStatusMap: Record<string, Record<string, number>>;
  catTotal: Record<string, number>;
  catCompleted: Record<string, number>;
  itemCount: Record<string, number>;
  assignedDeptCount: Record<string, number>;
  createdByDeptCount: Record<string, number>;
  completedDeptCount: Record<string, number>;
  locationCount: Record<string, number>;
  catItemResponse: Record<string, Record<string, number[]>>;
  catItemResolution: Record<string, Record<string, number[]>>;
  catItemBreachMins: Record<string, Record<string, number>>;
  catItemEscalations: Record<string, Record<string, number>>;
  deptReassigned: Record<string, number>;
}

function newJoKpiAcc(): JoKpiAcc {
  return {
    total: 0,
    completed: 0,
    timeout: 0,
    escalated: 0,
    reassigned: 0,
    slaBreachCompleted: 0,
    quantityTotal: 0,
    responseMins: [],
    resolutionMins: [],
    weekStats: {},
    statusCatMap: {},
    catItemCount: {},
    deptStatusMap: {},
    catTotal: {},
    catCompleted: {},
    itemCount: {},
    assignedDeptCount: {},
    createdByDeptCount: {},
    completedDeptCount: {},
    locationCount: {},
    catItemResponse: {},
    catItemResolution: {},
    catItemBreachMins: {},
    catItemEscalations: {},
    deptReassigned: {},
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function inc2(map: Record<string, Record<string, number>>, k1: string, k2: string, by = 1) {
  if (!map[k1]) map[k1] = {};
  map[k1][k2] = (map[k1][k2] ?? 0) + by;
}

function push2(map: Record<string, Record<string, number[]>>, k1: string, k2: string, v: number) {
  if (!map[k1]) map[k1] = {};
  if (!map[k1][k2]) map[k1][k2] = [];
  map[k1][k2].push(v);
}

function accumulateJoKpis(acc: JoKpiAcc, rr: Record<string, unknown>) {
  acc.total++;
  const statusRaw = (toStr(rr.job_status) ?? '').trim().toLowerCase();
  const status = toStr(rr.job_status) ?? 'Unknown';
  const category = toStr(rr.service_item_category) ?? 'Unknown';
  const item = toStr(rr.service_item) ?? 'Unknown';
  const dept = toStr(rr.department_name) ?? 'Unknown';
  const assignedDept = toStr(rr.assigned_to_department) ?? 'Unknown';
  const createdByDept = toStr(rr.created_by_department) ?? 'Unknown';
  const completedDept = toStr(rr.completed_by_department) ?? 'Unknown';
  const location = toStr(rr.location) ?? 'Unknown';
  const completedFlag = statusRaw.includes('complete') || statusRaw.includes('close') || statusRaw.includes('done') || statusRaw.includes('finish');
  const timeoutFlag = statusRaw.includes('timeout');
  const escalatedFlag = !!toStr(rr.escalation_group);
  const reassignedFlag = (toStr(rr.reassigned_job) ?? '').trim().toLowerCase() === 'yes';

  if (completedFlag) acc.completed++;
  if (timeoutFlag) acc.timeout++;
  if (escalatedFlag) acc.escalated++;
  if (reassignedFlag) acc.reassigned++;

  const qty = toNum(rr.quantity);
  if (qty !== null) acc.quantityTotal += qty;

  const delayMin = parseDurationMinutes(rr.delay_duration);
  if (completedFlag && delayMin !== null && delayMin > 0) acc.slaBreachCompleted++;

  inc2(acc.statusCatMap, status, category);
  inc2(acc.catItemCount, category, item);
  inc2(acc.deptStatusMap, dept, status);
  inc(acc.catTotal, category);
  if (completedFlag) inc(acc.catCompleted, category);
  inc(acc.itemCount, item);
  inc(acc.assignedDeptCount, assignedDept);
  inc(acc.createdByDeptCount, createdByDept);
  inc(acc.completedDeptCount, completedDept);
  inc(acc.locationCount, location);
  if (escalatedFlag) inc2(acc.catItemEscalations, category, item);
  if (reassignedFlag) inc(acc.deptReassigned, dept);
  if (delayMin !== null && delayMin > 0) inc2(acc.catItemBreachMins, category, item, delayMin);

  const createdAt = toStr(rr.created_datetime);
  const ackAt = toStr(rr.acknowledged_datetime);
  const completedAt = toStr(rr.completed_datetime);
  if (createdAt) {
    const d = new Date(createdAt);
    if (!isNaN(d.getTime())) {
      const wk = toWeekKey(d);
      if (!acc.weekStats[wk]) acc.weekStats[wk] = { jobs: 0, completed: 0, slaBreaches: 0, timeouts: 0 };
      acc.weekStats[wk].jobs++;
      if (completedFlag) acc.weekStats[wk].completed++;
      if (timeoutFlag) acc.weekStats[wk].timeouts++;
      if (completedFlag && delayMin !== null && delayMin > 0) acc.weekStats[wk].slaBreaches++;
    }
  }
  if (createdAt && ackAt) {
    const t1 = new Date(createdAt).getTime();
    const t2 = new Date(ackAt).getTime();
    if (!isNaN(t1) && !isNaN(t2) && t2 >= t1) {
      const m = (t2 - t1) / 60_000;
      acc.responseMins.push(m);
      push2(acc.catItemResponse, category, item, m);
    }
  }
  if (createdAt && completedAt) {
    const t1 = new Date(createdAt).getTime();
    const t2 = new Date(completedAt).getTime();
    if (!isNaN(t1) && !isNaN(t2) && t2 >= t1) {
      const m = (t2 - t1) / 60_000;
      acc.resolutionMins.push(m);
      push2(acc.catItemResolution, category, item, m);
    }
  }
}

function buildJoKpis(acc: JoKpiAcc): KpiDef[] {
  const total = acc.total;
  const completionRate = total > 0 ? (acc.completed / total) * 100 : 0;
  const slaCompliance = acc.completed > 0 ? (1 - acc.slaBreachCompleted / acc.completed) * 100 : 0;
  const timeoutRate = total > 0 ? (acc.timeout / total) * 100 : 0;
  const escalationRate = total > 0 ? (acc.escalated / total) * 100 : 0;
  const reassignmentRate = total > 0 ? (acc.reassigned / total) * 100 : 0;
  const avgResponse = acc.responseMins.length > 0 ? acc.responseMins.reduce((a, b) => a + b, 0) / acc.responseMins.length : null;
  const p90Response = percentile(acc.responseMins, 90);
  const avgResolution = acc.resolutionMins.length > 0 ? acc.resolutionMins.reduce((a, b) => a + b, 0) / acc.resolutionMins.length : null;

  return [
    { id: 'kpi_01', label: 'Total Job Orders', value: total, unit: 'jobs', fmt: 'integer', available: true, note: 'Total volume of job orders in scope.', formula: 'COUNT(JobOrder)' },
    { id: 'kpi_02', label: 'Completion Rate', value: r1(completionRate), unit: '%', fmt: 'pct1', available: true, note: 'Percentage of jobs completed successfully.', formula: 'SUM(completed_flag)/COUNT(*)*100' },
    { id: 'kpi_03', label: 'SLA Compliance', value: r1(slaCompliance), unit: '%', fmt: 'pct1', available: acc.completed > 0, note: 'Completed jobs delivered within SLA.', formula: '(1-SUM(sla_breach_flag)/SUM(completed_flag))*100' },
    { id: 'kpi_04', label: 'Timeout Rate', value: r1(timeoutRate), unit: '%', fmt: 'pct1', available: true, note: 'Percentage of jobs ending in timeout.', formula: 'SUM(timeout_flag)/COUNT(*)*100' },
    { id: 'kpi_05', label: 'Escalation Rate', value: r1(escalationRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of jobs escalated for intervention.', formula: 'SUM(escalated_flag)/COUNT(*)*100' },
    { id: 'kpi_06', label: 'Reassignment Rate', value: r1(reassignmentRate), unit: '%', fmt: 'pct1', available: true, note: 'Share of jobs reassigned across teams.', formula: 'SUM(reassigned_flag)/COUNT(*)*100' },
    { id: 'kpi_07', label: 'Avg Response (min)', value: avgResponse === null ? null : r2(avgResponse), unit: 'min', fmt: 'decimal2', available: avgResponse !== null, note: 'Average minutes from create to acknowledge.', formula: 'AVG(response_min)' },
    { id: 'kpi_08', label: 'P90 Response (min)', value: p90Response === null ? null : r2(p90Response), unit: 'min', fmt: 'decimal2', available: p90Response !== null, note: '90th percentile of response time.', formula: 'P90(response_min)' },
    { id: 'kpi_09', label: 'Avg Resolution (min)', value: avgResolution === null ? null : r2(avgResolution), unit: 'min', fmt: 'decimal2', available: avgResolution !== null, note: 'Average minutes from create to completion.', formula: 'AVG(resolution_min)' },
    { id: 'kpi_10', label: 'Total Quantity', value: r2(acc.quantityTotal), unit: 'qty', fmt: 'decimal2', available: true, note: 'Total requested quantity across all jobs.', formula: 'SUM(quantity)' },
  ];
}

function buildDrilldownDonut(
  id: string,
  title: string,
  note: string,
  formula: string,
  outer: Record<string, number>,
  inner: Record<string, Record<string, number>>,
): ChartDef {
  const outerKeys = Object.keys(outer).sort((a, b) => (outer[b] ?? 0) - (outer[a] ?? 0));
  const drillSeries = outerKeys.map((k) => ({
    id: k,
    name: `${k} items`,
    type: 'pie',
    innerSize: '45%',
    data: Object.entries(inner[k] ?? {}).sort(([, a], [, b]) => b - a).map(([name, y]) => ({ name, y })),
  }));
  return {
    id, title, note, formula, filterable: false,
    options: {
      chart: { type: 'pie' },
      series: [{ name: 'Jobs', type: 'pie', innerSize: '45%', data: outerKeys.map((k) => ({ name: k, y: outer[k], drilldown: k })) }],
      drilldown: { series: drillSeries },
      plotOptions: { pie: { dataLabels: { enabled: true, format: '<b>{point.name}</b><br>{point.y} ({point.percentage:.1f}%)' } } },
    },
  };
}

function buildJoEac(_acc: ImAcc, jo: JoKpiAcc): ChartDef[] {
  const weeks = Object.keys(jo.weekStats).sort();
  const weekJobs = weeks.map((w) => jo.weekStats[w].jobs);
  const weekSla = weeks.map((w) => jo.weekStats[w].completed > 0 ? r1((1 - jo.weekStats[w].slaBreaches / jo.weekStats[w].completed) * 100) : 0);
  const weekClose = weeks.map((w) => jo.weekStats[w].jobs > 0 ? r1((jo.weekStats[w].completed / jo.weekStats[w].jobs) * 100) : 0);
  const cumulative: Record<string, number> = {};
  for (const w of weeks) {
    const cats = jo.statusCatMap['Completed'] ?? {};
    for (const [c, v] of Object.entries(cats)) cumulative[c] = (cumulative[c] ?? 0) + v;
    if (Object.keys(cumulative).length === 0) {
      for (const [c, v] of Object.entries(jo.catTotal)) cumulative[c] = (cumulative[c] ?? 0) + v;
    }
  }
  const top = topN(cumulative, 10);
  const others = Object.values(cumulative).reduce((s, v) => s + v, 0) - top.reduce((s, [, v]) => s + v, 0);
  return [
    {
      id: 'jo_eac_01', title: 'Cumulative Weekly Service Category Share (Donut Race)', filterable: false,
      note: 'Animated cumulative weekly donut race showing long-run share shifts by service category. Impact: sustained cumulative dominance reveals structural demand pressure points. Resolution: rebalance capacity plans, inventory, and preventive actions toward categories with persistent cumulative growth.',
      formula: 'RUNNING_SUM(COUNT(*)) BY service_category OVER created_week (ASC), Top 10 + Others',
      options: { chart: { type: 'pie' }, series: [{ name: 'Cumulative Jobs', type: 'pie', innerSize: '45%', data: [...top.map(([name, y]) => ({ name, y })), ...(others > 0 ? [{ name: 'Others', y: others }] : [])] }] },
    },
    {
      id: 'jo_eac_02', title: 'SLA vs Jobs by week', filterable: false,
      note: 'Week-ascending workload bars with SLA compliance line.',
      formula: 'COUNT(*) and SLA% BY created_week (ASC)',
      options: { chart: { type: 'column' }, xAxis: { categories: weeks }, yAxis: [{ title: { text: 'Jobs' } }, { title: { text: 'SLA %' }, opposite: true, max: 100, min: 0 }], series: [{ name: 'Jobs', type: 'column', data: weekJobs }, { name: 'SLA %', type: 'spline', yAxis: 1, data: weekSla }] },
    },
    {
      id: 'jo_eac_03', title: 'Closing Rate vs Jobs by week', filterable: false,
      note: 'Week-ascending workload bars with closing rate line.',
      formula: 'COUNT(*) and completed% BY created_week (ASC)',
      options: { chart: { type: 'column' }, xAxis: { categories: weeks }, yAxis: [{ title: { text: 'Jobs' } }, { title: { text: 'Close %' }, opposite: true, max: 100, min: 0 }], series: [{ name: 'Jobs', type: 'column', data: weekJobs }, { name: 'Close %', type: 'spline', yAxis: 1, data: weekClose }] },
    },
    {
      id: 'jo_eac_04', title: 'Status -> Service Category (Drilldown)', filterable: false,
      note: 'Click a status slice to drill down into service category mix.',
      formula: 'COUNT(*) BY status, then COUNT(*) BY service_category within status',
      options: {
        chart: { type: 'pie' },
        series: [{ name: 'Status', type: 'pie', innerSize: '45%', data: Object.entries(jo.statusCatMap).map(([st, m]) => ({ name: st, y: Object.values(m).reduce((s, v) => s + v, 0), drilldown: st })) }],
        drilldown: { series: Object.entries(jo.statusCatMap).map(([st, m]) => ({ id: st, name: `${st} categories`, type: 'pie', innerSize: '45%', data: Object.entries(m).map(([name, y]) => ({ name, y })) })) },
      },
    },
  ];
}

function buildJoCharts(_acc: ImAcc, jo: JoKpiAcc): ChartDef[] {
  const weeks = Object.keys(jo.weekStats).sort();
  const weekJobs = weeks.map((w) => jo.weekStats[w].jobs);
  const weekClose = weeks.map((w) => jo.weekStats[w].jobs > 0 ? r1((jo.weekStats[w].completed / jo.weekStats[w].jobs) * 100) : 0);
  const weekSla = weeks.map((w) => jo.weekStats[w].completed > 0 ? r1((1 - jo.weekStats[w].slaBreaches / jo.weekStats[w].completed) * 100) : 0);
  const weekTimeout = weeks.map((w) => jo.weekStats[w].timeouts);
  const top10Dept = topN(Object.fromEntries(Object.entries(jo.deptStatusMap).map(([d, m]) => [d, Object.values(m).reduce((s, v) => s + v, 0)])), 10).map(([d]) => d);
  const statuses = Array.from(new Set(Object.values(jo.deptStatusMap).flatMap((m) => Object.keys(m))));
  const topCats = topN(jo.catTotal, 10).map(([k]) => k);
  const topItems = topN(jo.itemCount, 10);
  const topAssigned = topN(jo.assignedDeptCount, 10);
  const topCreatedBy = topN(jo.createdByDeptCount, 10);
  const topCompletedBy = topN(jo.completedDeptCount, 10);
  const topLocations = topN(jo.locationCount, 10);
  const catCloseRate = topCats.map((c) => (jo.catTotal[c] ?? 0) > 0 ? r1(((jo.catCompleted[c] ?? 0) / (jo.catTotal[c] ?? 1)) * 100) : 0);
  const catEsc = Object.fromEntries(Object.entries(jo.catItemEscalations).map(([c, m]) => [c, Object.values(m).reduce((s, v) => s + v, 0)]));
  const catRespAvg = Object.fromEntries(Object.entries(jo.catItemResponse).map(([c, m]) => [c, r2(Object.values(m).flat().reduce((s, v) => s + v, 0) / Math.max(1, Object.values(m).flat().length))]));
  const catResAvg = Object.fromEntries(Object.entries(jo.catItemResolution).map(([c, m]) => [c, r2(Object.values(m).flat().reduce((s, v) => s + v, 0) / Math.max(1, Object.values(m).flat().length))]));
  const catRespP90 = Object.fromEntries(Object.entries(jo.catItemResponse).map(([c, m]) => [c, percentile(Object.values(m).flat(), 90) ?? 0]));
  const catResP90 = Object.fromEntries(Object.entries(jo.catItemResolution).map(([c, m]) => [c, percentile(Object.values(m).flat(), 90) ?? 0]));

  const drillCount = buildDrilldownDonut('jo_chart_01', 'Service Category -> Service Items (Drilldown)', 'Shows where demand is concentrated. Click a category slice to drill into its top service items. Impact: concentrated demand can overload teams and slow fulfillment. Resolution: rebalance staffing, pre-stage inventory, and standardize high-volume request handling for the largest item clusters.', 'COUNT(*) by category then item', jo.catTotal, jo.catItemCount);
  const drillRespAvg = buildDrilldownDonut('jo_chart_12', 'Avg Response by Service Category -> Service Items (Drilldown)', 'Average first-response time by category; click to drill into item-level contributors. Impact: slow first response directly impacts guest perception. Resolution: define fast-response SOPs for worst items and introduce response-time alerts.', 'AVG(response_min) by category then item', catRespAvg, Object.fromEntries(Object.entries(jo.catItemResponse).map(([c, m]) => [c, Object.fromEntries(Object.entries(m).map(([i, arr]) => [i, r2(arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1))]))])));
  const drillResAvg = buildDrilldownDonut('jo_chart_13', 'Avg Resolution by Service Category -> Service Items (Drilldown)', 'Average end-to-end resolution time by category with item drilldown. Impact: long resolution cycles reduce operational throughput. Resolution: remove approval/parts delays and set item-level turnaround standards.', 'AVG(resolution_min) by category then item', catResAvg, Object.fromEntries(Object.entries(jo.catItemResolution).map(([c, m]) => [c, Object.fromEntries(Object.entries(m).map(([i, arr]) => [i, r2(arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1))]))])));
  const drillBreach = buildDrilldownDonut('jo_chart_14', 'SLA Breach Minutes by Service Category -> Service Items (Drilldown)', 'Total breach minutes concentration by category with item drilldown. Impact: concentrated breach minutes identify where SLA risk is financially and reputationally highest. Resolution: prioritize chronic breach items for process redesign and escalation governance.', 'SUM(sla_breach_min) by category then item', Object.fromEntries(Object.entries(jo.catItemBreachMins).map(([c, m]) => [c, Object.values(m).reduce((s, v) => s + v, 0)])), jo.catItemBreachMins);
  const drillEsc = buildDrilldownDonut('jo_chart_15', 'Escalation by Service Category -> Service Items (Drilldown)', 'Escalation concentration by category; click for item-level problem areas. Impact: high escalation indicates service instability or unclear ownership. Resolution: strengthen first-line decision rights, update runbooks, and clarify escalation triggers.', 'SUM(escalated_flag) by category then item', catEsc, jo.catItemEscalations);
  const drillRespP90 = buildDrilldownDonut('jo_chart_17', 'Response P90 by Service Category -> Service Items (Drilldown)', 'P90 response time exposes tail-risk delays by category and item. Impact: long-tail response outliers hurt VIP/peak-time experience. Resolution: enforce priority routing and exception handling for high-P90 items.', 'P90(response_min) by category then item', catRespP90, Object.fromEntries(Object.entries(jo.catItemResponse).map(([c, m]) => [c, Object.fromEntries(Object.entries(m).map(([i, arr]) => [i, percentile(arr, 90) ?? 0]))])));
  const drillResP90 = buildDrilldownDonut('jo_chart_18', 'Resolution P90 by Service Category -> Service Items (Drilldown)', 'P90 resolution time shows worst-case completion behavior by category and item. Impact: tail resolution delays drive complaints and SLA penalties. Resolution: target root-cause items with dedicated recovery plans and stricter completion SLAs.', 'P90(resolution_min) by category then item', catResP90, Object.fromEntries(Object.entries(jo.catItemResolution).map(([c, m]) => [c, Object.fromEntries(Object.entries(m).map(([i, arr]) => [i, percentile(arr, 90) ?? 0]))])));

  return [
    drillCount,
    { id: 'jo_chart_02', title: 'JO Closing Rate vs Jobs Trend by week', filterable: false, note: 'Weekly workload (bars) versus closure efficiency (line) in ascending week order. Impact: rising jobs with falling close rate indicates backlog risk. Resolution: add short-term capacity, prioritize aging jobs, and enforce daily closure targets until rate stabilizes.', formula: 'COUNT(*) and completed% by created_week', options: { chart: { type: 'column' }, xAxis: { categories: weeks }, yAxis: [{ title: { text: 'Jobs' } }, { title: { text: 'Close %' }, opposite: true, max: 100, min: 0 }], series: [{ name: 'Jobs', type: 'column', data: weekJobs }, { name: 'Close %', type: 'spline', yAxis: 1, data: weekClose }] } },
    { id: 'jo_chart_03', title: 'SLA Compliance vs Jobs Trend by week', filterable: false, note: 'Compares weekly incoming volume with SLA performance in ascending week order. Impact: SLA dips during high-volume weeks reveal process bottlenecks. Resolution: deploy surge playbook, tighten handoff SLAs, and monitor breach-prone queues hourly.', formula: 'COUNT(*) and SLA% by created_week', options: { chart: { type: 'column' }, xAxis: { categories: weeks }, yAxis: [{ title: { text: 'Jobs' } }, { title: { text: 'SLA %' }, opposite: true, max: 100, min: 0 }], series: [{ name: 'Jobs', type: 'column', data: weekJobs }, { name: 'SLA %', type: 'spline', yAxis: 1, data: weekSla }] } },
    { id: 'jo_chart_04', title: 'Timeout Trend', filterable: false, note: 'Weekly timeout volume trend to detect service interruptions early. Impact: timeout spikes reduce guest satisfaction and increase repeat contacts. Resolution: identify root-cause weeks, fix routing/escalation delays, and set alert thresholds for timeout spikes.', formula: 'SUM(timeout_flag) by created_week', options: { chart: { type: 'column' }, xAxis: { categories: weeks }, series: [{ name: 'Timeouts', data: weekTimeout }] } },
    { id: 'jo_chart_05', title: 'Status vs Top 10 Departments', filterable: false, note: 'Vertical stacked view of status mix across the top 10 departments by volume. Impact: high open/pending share in specific departments signals queue congestion. Resolution: redistribute tickets, clear blockers, and set department-level WIP limits with daily review.', formula: 'COUNT(*) by department and status', options: { chart: { type: 'column' }, xAxis: { categories: top10Dept }, plotOptions: { column: { stacking: 'normal' } }, series: statuses.map((s) => ({ name: s, type: 'column', data: top10Dept.map((d) => jo.deptStatusMap[d]?.[s] ?? 0) })) } },
    { id: 'jo_chart_06', title: 'Top 10 Service Category Volume', filterable: false, note: 'Shows demand (bars) and close rate (line) by top categories. Impact: high-volume/low-close categories are critical performance gaps. Resolution: assign category owners, create playbooks, and track close-rate recovery by category weekly.', formula: 'COUNT(*) and completed% by category', options: { chart: { type: 'column' }, xAxis: { categories: topCats }, yAxis: [{ title: { text: 'Jobs' } }, { title: { text: 'Close %' }, opposite: true, min: 0, max: 100 }], series: [{ name: 'Jobs', type: 'column', data: topCats.map((c) => jo.catTotal[c] ?? 0) }, { name: 'Close %', type: 'spline', yAxis: 1, data: catCloseRate }] } },
    { id: 'jo_chart_07', title: 'Top 10 Service Item Volume', filterable: false, note: 'Ranks the most requested service items. Impact: item concentration can create recurring operational strain. Resolution: bundle common tasks, automate repetitive steps, and pre-allocate resources for top items.', formula: 'COUNT(*) by service_item', options: { chart: { type: 'bar' }, xAxis: { categories: topItems.map(([k]) => k) }, series: [{ name: 'Jobs', data: topItems.map(([, v]) => v) }] } },
    { id: 'jo_chart_08', title: 'Top 10 Assigned Department Volume', filterable: false, note: 'Shows departments receiving the highest assignment load. Impact: uneven load can cause response delays and burnout. Resolution: rebalance dispatch rules and cross-train teams to absorb peaks.', formula: 'COUNT(*) by assigned_department', options: { chart: { type: 'bar' }, xAxis: { categories: topAssigned.map(([k]) => k) }, series: [{ name: 'Jobs', data: topAssigned.map(([, v]) => v) }] } },
    { id: 'jo_chart_09', title: 'Top 10 Created By Department Volume', filterable: false, note: 'Shows request-origin departments generating the most JOs. Impact: large demand sources may indicate upstream process gaps. Resolution: run preventive actions with source departments to reduce avoidable requests.', formula: 'COUNT(*) by created_by_department', options: { chart: { type: 'bar' }, xAxis: { categories: topCreatedBy.map(([k]) => k) }, series: [{ name: 'Jobs', data: topCreatedBy.map(([, v]) => v) }] } },
    { id: 'jo_chart_10', title: 'Top 10 Completed Department Volume', filterable: false, note: 'Shows departments completing the highest JO volume. Impact: low completion share versus assignment share may indicate execution bottlenecks. Resolution: compare assigned vs completed mix and remove completion blockers.', formula: 'COUNT(*) by completed_department', options: { chart: { type: 'bar' }, xAxis: { categories: topCompletedBy.map(([k]) => k) }, series: [{ name: 'Jobs', data: topCompletedBy.map(([, v]) => v) }] } },
    { id: 'jo_chart_11', title: 'Top Location Volume', filterable: false, note: 'Highlights locations with the largest JO demand. Impact: hotspots can degrade on-site service quality if unmanaged. Resolution: deploy location-specific staffing, stock, and preventive maintenance actions.', formula: 'COUNT(*) by location', options: { chart: { type: 'bar' }, xAxis: { categories: topLocations.map(([k]) => k) }, series: [{ name: 'Jobs', data: topLocations.map(([, v]) => v) }] } },
    drillRespAvg,
    drillResAvg,
    drillBreach,
    drillEsc,
    { id: 'jo_chart_16', title: 'Top Reassignment by Department', filterable: false, note: 'Departments with the highest reassignment volume. Impact: frequent reassignment adds cycle time and accountability gaps. Resolution: improve assignment accuracy rules, skill mapping, and triage quality at intake.', formula: 'SUM(reassigned_flag) by department', options: { chart: { type: 'bar' }, xAxis: { categories: topN(jo.deptReassigned, 10).map(([k]) => k) }, series: [{ name: 'Reassigned Jobs', data: topN(jo.deptReassigned, 10).map(([, v]) => v) }] } },
    drillRespP90,
    drillResP90,
  ];
}

// ── Route ─────────────────────────────────────────────────────────────────────

type StagingRow = { id: number; uploaded_file_id: string; row_number: number; raw_row: Record<string, unknown> };

export async function POST(req: NextRequest) {
  let body: FinalizeRequest;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { upload_job_id } = body;
  if (!upload_job_id) return NextResponse.json({ error: 'Missing upload_job_id' }, { status: 400 });

  const supabase = createAdminClient();

  type JobRow = { organization_id: string; module_code: 'im' | 'jo'; source_name: string | null };
  const { data: job, error: jobError } = await supabase
    .from('upload_jobs').select('organization_id, module_code, source_name')
    .eq('id', upload_job_id).single() as unknown as SbResult<JobRow>;

  if (jobError || !job) return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });

  const { organization_id, module_code, source_name } = job;
  const stagingTable   = module_code === 'im' ? 'im_staging_rows'   : 'jo_staging_rows';
  const recordTable    = module_code === 'im' ? 'im_records'        : 'jo_records';
  const dashboardTable = module_code === 'im' ? 'im_dashboard_json' : 'jo_dashboard_json';

  type FileRow = { id: string; file_name: string };
  let { data: fileRow } = await supabase
    .from('uploaded_files').select('id, file_name').eq('upload_job_id', upload_job_id)
    .order('uploaded_at', { ascending: false }).limit(1).maybeSingle() as unknown as SbResult<FileRow>;
  if (!fileRow) {
    // If uploaded_files is de-duplicated by hash across jobs, resolve via staging rows.
    type StagingFileRow = { uploaded_file_id: string };
    const { data: srow } = await supabase
      .from(stagingTable)
      .select('uploaded_file_id')
      .eq('upload_job_id', upload_job_id)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle() as unknown as SbResult<StagingFileRow>;
    if (srow?.uploaded_file_id) {
      const { data: fr2 } = await supabase
        .from('uploaded_files')
        .select('id, file_name')
        .eq('id', srow.uploaded_file_id)
        .maybeSingle() as unknown as SbResult<FileRow>;
      if (fr2) fileRow = fr2;
    }
  }
  const uploaded_file_id = fileRow?.id ?? null;
  const hotel = parseFilename(fileRow?.file_name ?? '');

  await supabase.from(recordTable).delete().eq('upload_job_id', upload_job_id);

  // ── Single pass: accumulate + insert records ──────────────────────────────

  const acc = newImAcc();
  const joKpiAcc = newJoKpiAcc();
  let totalInserted = 0;
  let lastId = 0;

  for (;;) {
    const _pageResult = await supabase
      .from(stagingTable).select('id, uploaded_file_id, row_number, raw_row')
      .eq('upload_job_id', upload_job_id).eq('is_valid', true)
      .gt('id', lastId).order('id', { ascending: true }).limit(PAGE_SIZE);
    const rows = (_pageResult.data ?? null) as StagingRow[] | null;

    if (!rows || rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    let payload: Record<string, unknown>[];

    if (module_code === 'im') {
      payload = rows.map(r => {
        accumulate(acc, r.raw_row);
        const rr = r.raw_row;
        return {
          organization_id, upload_job_id,
          uploaded_file_id: uploaded_file_id ?? r.uploaded_file_id,
          source_row_id:      r.id,
          chain_code:         hotel.chainCode || null,
          hotel_code:         hotel.hotelCode || null,
          module_code:        module_code,
          country_code:       hotel.countryCode || null,
          incident_case:      toStr(rr.incident_case),
          incident_status:    toStr(rr.incident_status),
          incident_category:  toStr(rr.incident_category),
          incident_item_name: toStr(rr.incident_item_name),
          incident_description: toStr(rr.incident_description),
          incident_location:  toStr(rr.incident_location),
          severity:           toStr(rr.severity),
          subject:            toStr(rr.subject),
          source_of_complaint: toStr(rr.source_of_complaint),
          // Guest profile
          guest_name:         toStr(rr.guest_name),
          room_no:            toStr(rr.room_no),
          profile_type:       toStr(rr.profile_type),
          vip_code:           toStr(rr.vip_code),
          membership_number:  toStr(rr.membership_number),
          reservation_number: toStr(rr.reservation_number),
          date_of_birth:      toStr(rr.date_of_birth),
          company_name:       toStr(rr.company_name),
          // Stay details
          arrival_date:       toIso(rr.arrival_date),
          departure_date:     toIso(rr.departure_date),
          nights:             toNum(rr.nights),
          rates:              toStr(rr.rates),
          rate_code:          toStr(rr.rate_code),
          booking_source:     toStr(rr.booking_source),
          visits:             toStr(rr.visits),
          // Dates
          created_date:       toIso(rr.created_date),
          incident_datetime:  toIso(rr.incident_datetime),
          // Staff
          created_by:         toStr(rr.created_by),
          department:         toStr(rr.department),
          // Investigation cycle 1
          investigation_1:            toStr(rr.investigation_1),
          investigation_remarks_1:    toStr(rr.investigation_remarks_1),
          investigation_updated_by_1: toStr(rr.investigation_updated_by_1),
          investigation_updated_on_1: toIso(rr.investigation_updated_on_1),
          // Investigation cycle 2
          investigation_2:            toStr(rr.investigation_2),
          investigation_remarks_2:    toStr(rr.investigation_remarks_2),
          investigation_updated_by_2: toStr(rr.investigation_updated_by_2),
          investigation_updated_on_2: toIso(rr.investigation_updated_on_2),
          // Feedback cycle 1
          feedback_method_1:     toStr(rr.feedback_method_1),
          feedback_updated_by_1: toStr(rr.feedback_updated_by_1),
          feedback_updated_on_1: toIso(rr.feedback_updated_on_1),
          feedback_remarks_1:    toStr(rr.feedback_remarks_1),
          normalized_row:     rr,
        };
      });
    } else {
      payload = rows.map(r => {
        const rr = r.raw_row;
        accumulate(acc, normaliseJoForIm(rr));
        accumulateJoKpis(joKpiAcc, rr);
        return {
          organization_id, upload_job_id,
          uploaded_file_id:      uploaded_file_id ?? r.uploaded_file_id,
          source_row_id:         r.id,
          chain_code:            hotel.chainCode || null,
          hotel_code:            hotel.hotelCode || null,
          module_code:           module_code,
          country_code:          hotel.countryCode || null,
          department_name:       toStr(rr.department_name),
          created_datetime:      toIso(rr.created_datetime),
          job_status:            toStr(rr.job_status),
          job_order:             toStr(rr.job_order),
          guest_name:            toStr(rr.guest_name),
          location:              toStr(rr.location),
          service_item_category: toStr(rr.service_item_category),
          service_item:          toStr(rr.service_item),
          quantity:              toNum(rr.quantity),
          remarks:               toStr(rr.remarks),
          execution_duration:    toStr(rr.execution_duration),
          initial_deadline:      toIso(rr.initial_deadline),
          extended_deadline:     toIso(rr.extended_deadline),
          acknowledged_datetime: toIso(rr.acknowledged_datetime),
          completed_datetime:    toIso(rr.completed_datetime),
          delay_duration:        toStr(rr.delay_duration),
          // Keep full JO source row in normalized_row for compatibility
          // with DBs that haven't applied 002_jo_schema_alignment.sql yet.
          normalized_row:        rr,
        };
      });
    }

    for (let i = 0; i < payload.length; i += INSERT_BATCH) {
      const { error: ie } = await supabase
        .from(recordTable).insert(payload.slice(i, i + INSERT_BATCH)) as unknown as SbResult<null>;
      if (ie) {
        console.error(`[finalize] insert error (${recordTable}):`, ie.message);
        const msg = String(ie.message ?? '');
        const isSizeLimit = /project size limit|exceeded/i.test(msg);
        return NextResponse.json(
          {
            error: isSizeLimit
              ? `Database storage limit reached. Please free space in Neon, then retry finalize/upload. Detail: ${msg}`
              : `Failed to insert records: ${msg}`,
          },
          { status: 500 },
        );
      }
      totalInserted += Math.min(INSERT_BATCH, payload.length - i);
    }

    if (rows.length < PAGE_SIZE) break;
  }

  // ── Build + upsert dashboard JSON ────────────────────────────────────────

  const generatedJson = buildImJson(acc, upload_job_id, source_name ?? upload_job_id, hotel);
  if (module_code === 'jo') {
    generatedJson.meta.schema = 'jo-v1';
    generatedJson.kpis = buildJoKpis(joKpiAcc);
    generatedJson.eac = buildJoEac(acc, joKpiAcc);
    generatedJson.charts = buildJoCharts(acc, joKpiAcc);
  }

  const now = new Date().toISOString();
  const { error: dashError } = await supabase
    .from(dashboardTable)
    .upsert(
      { organization_id, upload_job_id, schema_version: 'v1', generated_json: generatedJson, generated_at: now, updated_at: now },
      { onConflict: 'upload_job_id' },
    ) as unknown as SbResult<null>;

  if (dashError) {
    console.error('[finalize] dashboard upsert error:', dashError.message);
    return NextResponse.json({ error: 'Failed to upsert dashboard JSON' }, { status: 500 });
  }

  // Reclaim disk: staging rows are temporary and no longer needed after finalize succeeds.
  await supabase.from(stagingTable).delete().eq('upload_job_id', upload_job_id);

  await supabase.from('upload_jobs').update({ status: 'completed', completed_at: now, updated_at: now }).eq('id', upload_job_id);

  return NextResponse.json({ records_inserted: totalInserted, dashboard_generated: true } satisfies FinalizeResponse);
}
