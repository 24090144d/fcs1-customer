'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CircleChevronRight, FileDown, LoaderCircle, X } from 'lucide-react';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { csvSlug, downloadCsvFile, type CsvValue } from '@/lib/download-csv';
import { useDraggableDialog } from '@/components/dashboard/useDraggableDialog';
import { TableCodeTitle } from '@/components/dashboard/TableCodeTitle';

type DailyModule = 'mo' | 'im' | 'co' | 'co-ir';
type ModalLevel = 'dists' | 'items' | 'dates' | 'details';

type SummaryRow = {
  name: string;
  total: number;
  distinct_count: number;
  active_days: number;
  completed: number;
  exception_count: number;
  completion_rate: number;
  avg_duration: number | null;
};

type DistRow = SummaryRow & {
  range_start: number;
  range_end: number;
};

type ItemRow = SummaryRow & {
  item_rank: number;
};

type DateRow = {
  name: string;
  total: number;
  quantity?: number;
  completed: number;
  exception_count: number;
  high_critical?: number;
  completion_rate: number;
  avg_duration: number | null;
};

type DetailRow = {
  record_id: string;
  created_datetime: string | null;
  completed_datetime: string | null;
  location?: string;
  quantity?: number;
  status: string;
  assigned_to?: string;
  completed_by?: string;
  duration: number | string | null;
  delay?: number | null;
  guest_name?: string;
  room_no?: string;
  severity?: string;
  complaint_source?: string;
  floor?: string;
  service_round?: string;
  inspector?: string;
  standard?: number | string | null;
  variance?: number | string | null;
  credit?: number | string;
  room_status?: string;
  cleaned_by?: string;
  inspection_score?: number | string | null;
};

type TableRow = SummaryRow | DistRow | ItemRow | DateRow | DetailRow;
type TableResponse = { rows?: TableRow[]; timezone?: string; error?: string };

type DrillPath = {
  hotel: string;
  distName?: string;
  distStart?: number;
  distEnd?: number;
  item?: string;
  date?: string;
};

type Props = {
  module: DailyModule;
  chainCode: string;
  hotelFilter: string;
  hotelNames: Record<string, string>;
  rootLevel?: 'hotels' | 'dists';
  maintenanceType?: 'MO' | 'PM';
  from?: string;
  to?: string;
  coFilters?: {
    floor: string;
    attendant: string;
    roomType: string;
    status: string;
  };
  dark: boolean;
};

export function ModuleDailyTrendDrilldownTable({
  module,
  chainCode,
  hotelFilter,
  hotelNames,
  rootLevel = 'hotels',
  maintenanceType = 'MO',
  from = '',
  to = '',
  coFilters,
  dark,
}: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const isMo = module === 'mo';
  const isIm = module === 'im';
  const isCo = module === 'co';
  const isCoIr = module === 'co-ir';
  const tableCode = rootLevel === 'hotels'
    ? (isMo ? 'cmot-02' : isIm ? 'cimt-02' : isCo ? 'ccot-04' : 'ccoirt-02')
    : (isMo ? 'mot-02' : isIm ? 'imt-02' : isCo ? 'cot-04' : 'coirt-02');
  const { dialogStyle, dragHandleProps, resetDialogPosition } = useDraggableDialog();
  const [rootRows, setRootRows] = useState<Array<SummaryRow | DistRow>>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalLevel, setModalLevel] = useState<ModalLevel | null>(null);
  const [path, setPath] = useState<DrillPath | null>(null);
  const [modalRows, setModalRows] = useState<TableRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  const labels = useMemo(() => ({
    title: isMo
      ? t('dashboard_ui.mo_daily_title', 'Daily Trend by Defects')
      : isIm
        ? t('dashboard_ui.im_daily_title', 'Daily Trend by Incident')
        : isCo
          ? t('dashboard_ui.co_daily_title', 'Daily Trend by Attendant')
          : t('dashboard_ui.co_ir_daily_title', 'Daily Trend by Inspector'),
    hierarchy: rootLevel === 'hotels'
      ? (isMo
        ? t('dashboard_ui.mo_daily_corp_hierarchy', 'Hotel → Defects Dist → Defects → Date (Daily) → Detail')
        : isIm
          ? t('dashboard_ui.im_daily_corp_hierarchy', 'Hotel → Incident Dist → Incident → Date (Daily) → Detail')
          : isCo
            ? t('dashboard_ui.co_daily_corp_hierarchy', 'Hotel → Attendant Dist → Attendant → Date (Daily) → Detail')
            : t('dashboard_ui.co_ir_daily_corp_hierarchy', 'Hotel → Inspector Dist → Inspector → Date (Daily) → Detail'))
      : (isMo
        ? t('dashboard_ui.mo_daily_hotel_hierarchy', 'Defects Dist → Defects → Date (Daily) → Detail')
        : isIm
          ? t('dashboard_ui.im_daily_hotel_hierarchy', 'Incident Dist → Incident → Date (Daily) → Detail')
          : isCo
            ? t('dashboard_ui.co_daily_hotel_hierarchy', 'Attendant Dist → Attendant → Date (Daily) → Detail')
            : t('dashboard_ui.co_ir_daily_hotel_hierarchy', 'Inspector Dist → Inspector → Date (Daily) → Detail')),
    item: isMo
      ? t('dashboard_ui.mo_table_defect', 'Defect')
      : isIm
        ? t('dashboard_ui.im_table_incident', 'Incident')
        : isCo
          ? t('dashboard_ui.co_table_attendant', 'Attendant')
          : t('dashboard_ui.co_table_inspector', 'Inspector'),
    items: isMo
      ? t('dashboard_ui.mo_table_defects', 'Defects')
      : isIm
        ? t('dashboard_ui.im_daily_incidents', 'Incidents')
        : isCo
          ? t('dashboard_ui.co_table_attendants', 'Attendants')
          : t('dashboard_ui.co_table_inspectors', 'Inspectors'),
    dist: isMo
      ? t('dashboard_ui.mo_daily_defect_dist', 'Defects Dist')
      : isIm
        ? t('dashboard_ui.im_daily_incident_dist', 'Incident Dist')
        : isCo
          ? t('dashboard_ui.co_daily_attendant_dist', 'Attendant Dist')
          : t('dashboard_ui.co_ir_daily_inspector_dist', 'Inspector Dist'),
    total: isMo
      ? t('dashboard_ui.mo_table_jobs', 'Jobs')
      : isIm
        ? t('dashboard_ui.im_table_cases', 'Cases')
        : isCo
          ? t('dashboard_ui.co_table_cleaning_records', 'Cleaning Records')
          : t('co_ir.kpi_01', 'Inspections'),
    exception: isMo
      ? t('dashboard_ui.mo_table_delayed', 'Delayed')
      : isIm
        ? t('dashboard_ui.im_table_open', 'Open')
        : isCo
          ? t('dashboard_ui.co_table_behind_target', 'Behind Target')
          : t('co_ir.kpi_04', 'Failed Inspections'),
    rate: isMo
      ? t('dashboard_ui.mo_table_completion_rate', 'Completion Rate')
      : isIm
        ? t('dashboard_ui.im_table_closure_rate', 'Closure Rate')
        : isCo
          ? t('dashboard_ui.co_completion_rate', 'Completion Rate')
          : t('co_ir.kpi_03', 'Pass Rate'),
    average: isMo
      ? t('dashboard_ui.mo_table_average_duration', 'Average Duration (Hour)')
      : isIm
        ? t('dashboard_ui.im_table_average_duration', 'Average Duration')
        : t('dashboard_ui.co_table_average_time', 'Average Time'),
  }), [isCo, isIm, isMo, rootLevel, t]);

  const queryUrl = useCallback((level: 'hotels' | ModalLevel, drillPath?: DrillPath) => {
    const query = new URLSearchParams({ level, chain: chainCode });
    const selectedHotel = drillPath?.hotel || (hotelFilter !== 'ALL' ? hotelFilter : '');
    if (selectedHotel) query.set('hotel', selectedHotel);
    if (drillPath?.distStart) query.set('dist_start', String(drillPath.distStart));
    if (drillPath?.distEnd) query.set('dist_end', String(drillPath.distEnd));
    if (drillPath?.item) query.set('item', drillPath.item);
    if (drillPath?.date) query.set('date', drillPath.date);
    if (isMo) query.set('type', maintenanceType);
    if (isCo && coFilters) {
      query.set('floor', coFilters.floor);
      query.set('filter_attendant', coFilters.attendant);
      query.set('room_type', coFilters.roomType);
      query.set('status_filter', coFilters.status);
    }
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return `/api/dashboard/${module}-daily-table?${query.toString()}`;
  }, [chainCode, coFilters, from, hotelFilter, isCo, isMo, maintenanceType, module, to]);

  useEffect(() => {
    const controller = new AbortController();
    setRootLoading(true);
    setError('');
    fetch(queryUrl(rootLevel), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse;
        if (!response.ok) throw new Error(payload.error || `Unable to load ${module.toUpperCase()} daily trend data.`);
        setRootRows((payload.rows ?? []) as Array<SummaryRow | DistRow>);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : `Unable to load ${module.toUpperCase()} daily trend data.`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRootLoading(false);
      });
    return () => controller.abort();
  }, [module, queryUrl, rootLevel]);

  useEffect(() => {
    if (!modalLevel || !path) return;
    const controller = new AbortController();
    setModalLoading(true);
    setError('');
    fetch(queryUrl(modalLevel, path), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse;
        if (!response.ok) throw new Error(payload.error || `Unable to load ${module.toUpperCase()} daily trend drilldown.`);
        setModalRows(payload.rows ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : `Unable to load ${module.toUpperCase()} daily trend drilldown.`);
        setModalRows([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setModalLoading(false);
      });
    return () => controller.abort();
  }, [modalLevel, module, path, queryUrl]);

  useEffect(() => {
    if (!modalLevel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalLevel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalLevel]);

  useEffect(() => {
    if (!modalLevel) resetDialogPosition();
  }, [modalLevel, resetDialogPosition]);

  const hotelLabel = useCallback((code: string) => {
    const name = hotelNames[code];
    return name && name !== code ? `${code} · ${name}` : code;
  }, [hotelNames]);

  const beginTransition = () => {
    setModalRows([]);
    setModalLoading(true);
  };

  const openRootRow = (row: SummaryRow | DistRow) => {
    beginTransition();
    if (rootLevel === 'hotels') {
      setPath({ hotel: row.name });
      setModalLevel('dists');
      return;
    }
    const dist = row as DistRow;
    setPath({ hotel: hotelFilter, distName: dist.name, distStart: dist.range_start, distEnd: dist.range_end });
    setModalLevel('items');
  };

  const drillDist = (row: DistRow) => {
    if (!path) return;
    beginTransition();
    setPath({ ...path, distName: row.name, distStart: row.range_start, distEnd: row.range_end });
    setModalLevel('items');
  };

  const drillItem = (row: ItemRow) => {
    if (!path) return;
    beginTransition();
    setPath({ ...path, item: row.name });
    setModalLevel('dates');
  };

  const drillDate = (row: DateRow) => {
    if (!path) return;
    beginTransition();
    setPath({ ...path, date: row.name });
    setModalLevel('details');
  };

  const back = () => {
    if (!modalLevel) return;
    setModalRows([]);
    setModalLoading(true);
    if (modalLevel === 'details') setModalLevel('dates');
    else if (modalLevel === 'dates') setModalLevel('items');
    else if (modalLevel === 'items') {
      if (rootLevel === 'dists') setModalLevel(null);
      else setModalLevel('dists');
    } else {
      setModalLevel(null);
    }
  };

  const modalTitle = useMemo(() => {
    if (modalLevel === 'dists') return labels.dist;
    if (modalLevel === 'items') return labels.item;
    if (modalLevel === 'dates') return t('dashboard_ui.daily_table_date_summary', 'Daily Summary');
    return t('dashboard_ui.daily_table_details', 'Detail');
  }, [labels, modalLevel, t]);

  const breadcrumb = useMemo(() => {
    if (!path) return [];
    const parts = rootLevel === 'hotels'
      ? [hotelLabel(path.hotel), path.distName, path.item, path.date]
      : [path.distName, path.item, path.date];
    return parts.filter(Boolean) as string[];
  }, [hotelLabel, path, rootLevel]);

  const formatDateTime = (value: string | null) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
    }).format(parsed);
  };
  const formatDate = (value: string) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
      year: '2-digit', month: '2-digit', day: '2-digit', timeZone: 'UTC',
    }).format(parsed);
  };
  const formatDecimal = (value: unknown, suffix = '') => {
    const numericValue = Number(value);
    return value === null || value === undefined || !Number.isFinite(numericValue)
      ? '—'
      : `${numericValue.toFixed(1)}${suffix}`;
  };
  const formatDuration = (value: number | string | null | undefined) =>
    formatDecimal(value, ` ${isCo || isCoIr ? 'min' : 'h'}`);
  const formatQuantity = (value?: number) => Math.round(Number(value) || 0).toLocaleString();
  const thStyle = { color: tokens.dashboard.tableHeadText, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const tdStyle = { color: tokens.text, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const actionLabel = t('dashboard_ui.daily_table_drilldown', 'Drill down');

  const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={t('dashboard_ui.daily_table_export_csv', 'Export table to CSV')} aria-label={t('dashboard_ui.daily_table_export_csv', 'Export table to CSV')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><FileDown size={18} aria-hidden="true" /></button>
  );
  const DrillButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} title={`${actionLabel}: ${name}`} aria-label={`${actionLabel}: ${name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><CircleChevronRight size={17} aria-hidden="true" /></button>
  );

  const exportRows = (level: 'hotels' | ModalLevel, rows: TableRow[]) => {
    let headers: string[] = [];
    let values: CsvValue[][] = [];
    if (level === 'hotels') {
      headers = [t('dashboard_ui.daily_table_hotel', 'Hotel'), labels.total, labels.items, t('dashboard_ui.daily_table_active_days', 'Active Days'), t('dashboard_ui.daily_table_completed', 'Completed'), labels.exception, labels.rate, labels.average];
      values = (rows as SummaryRow[]).map((row) => [hotelLabel(row.name), row.total, row.distinct_count, row.active_days, row.completed, row.exception_count, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration)]);
    } else if (level === 'dists') {
      headers = [labels.dist, labels.items, labels.total, t('dashboard_ui.daily_table_completed', 'Completed'), labels.exception, labels.rate, labels.average];
      values = (rows as DistRow[]).map((row) => [row.name, row.distinct_count, row.total, row.completed, row.exception_count, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration)]);
    } else if (level === 'items') {
      headers = [labels.item, t('dashboard_ui.daily_table_rank', 'Rank'), labels.total, t('dashboard_ui.daily_table_active_days', 'Active Days'), t('dashboard_ui.daily_table_completed', 'Completed'), labels.exception, labels.rate, labels.average];
      values = (rows as ItemRow[]).map((row) => [row.name, row.item_rank, row.total, row.active_days, row.completed, row.exception_count, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration)]);
    } else if (level === 'dates') {
      headers = [t('dashboard_ui.daily_table_date', 'Date'), labels.total, t('dashboard_ui.daily_table_completed', 'Completed'), labels.exception, labels.rate, labels.average];
      values = (rows as DateRow[]).map((row) => [row.name, row.total, row.completed, row.exception_count, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration)]);
    } else if (isCo) {
      headers = [
        t('dashboard_ui.co_table_room', 'Room'),
        t('dashboard_ui.co_table_floor', 'Floor'),
        t('dashboard_ui.co_table_service_round', 'Service Round'),
        t('dashboard_ui.co_table_inspector', 'Inspector'),
        t('dashboard_ui.co_table_start', 'Start'),
        t('dashboard_ui.co_table_complete', 'Complete'),
        t('dashboard_ui.co_table_status', 'Status'),
        t('dashboard_ui.co_table_time_spent', 'Time Spent'),
        t('dashboard_ui.co_table_standard', 'Standard'),
        t('dashboard_ui.co_table_ahead_behind', 'Ahead / Behind'),
        t('dashboard_ui.co_table_credit', 'Credit'),
      ];
      values = (rows as DetailRow[]).map((row) => [
        row.room_no ?? '—', row.floor ?? '—', row.service_round ?? '—', row.inspector ?? 'Inspector',
        formatDateTime(row.created_datetime), formatDateTime(row.completed_datetime), row.status,
        formatDuration(row.duration), formatDecimal(row.standard, ' min'),
        formatDecimal(row.variance, ' min'),
        row.credit ?? 0,
      ]);
    } else if (isCoIr) {
      headers = [
        t('dashboard_ui.co_table_date', 'Date'),
        t('dashboard_ui.co_table_room', 'Room'),
        t('dashboard_ui.co_ir_room_status', 'Room Status'),
        t('dashboard_ui.co_ir_cleaned_by', 'Cleaned By'),
        t('dashboard_ui.co_table_start', 'Start'),
        t('dashboard_ui.co_table_complete', 'Complete'),
        t('dashboard_ui.co_ir_result', 'Result'),
        t('dashboard_ui.co_table_time_spent', 'Time Spent'),
        t('dashboard_ui.co_ir_score', 'Score'),
        t('dashboard_ui.co_table_credit', 'Credit'),
      ];
      values = (rows as DetailRow[]).map((row) => [
        path?.date ?? '', row.location ?? '—', row.room_status ?? '—', row.cleaned_by ?? '—',
        formatDateTime(row.created_datetime), formatDateTime(row.completed_datetime), row.status,
        formatDuration(row.duration), row.inspection_score ?? '—', row.credit ?? 0,
      ]);
    } else if (isMo) {
      headers = [t('dashboard_ui.mo_table_maintenance_order', 'Maintenance Order'), t('dashboard_ui.mo_table_created_time', 'Created Time'), t('dashboard_ui.daily_table_completed_time', 'Completed Time'), t('dashboard_ui.mo_table_location', 'Location'), t('dashboard_ui.mo_table_quantity', 'Quantity'), t('dashboard_ui.mo_table_status', 'Status'), t('dashboard_ui.mo_table_assigned_to', 'Assigned To'), t('dashboard_ui.mo_table_completed_by', 'Completed By'), t('dashboard_ui.mo_table_duration', 'Duration'), t('dashboard_ui.mo_table_delay', 'Delay'), t('dashboard_ui.mo_table_guest_name', 'Guest Name')];
      values = (rows as DetailRow[]).map((row) => [row.record_id, formatDateTime(row.created_datetime), formatDateTime(row.completed_datetime), row.location ?? '—', row.quantity ?? 0, row.status, row.assigned_to ?? '—', row.completed_by ?? '—', formatDuration(row.duration), row.delay === null || row.delay === undefined ? '—' : `${row.delay.toFixed(1)} h`, row.guest_name ?? '—']);
    } else {
      headers = [t('dashboard_ui.im_table_case_number', 'Case Number'), t('dashboard_ui.im_table_date_time', 'Date / Time'), t('dashboard_ui.daily_table_completed_time', 'Completed Time'), t('dashboard_ui.im_table_room', 'Room'), t('dashboard_ui.im_table_guest', 'Guest'), t('dashboard_ui.im_table_status', 'Status'), t('dashboard_ui.im_table_severity', 'Severity'), labels.average, t('dashboard_ui.im_table_complaint_source', 'Complaint Source')];
      values = (rows as DetailRow[]).map((row) => [row.record_id, formatDateTime(row.created_datetime), formatDateTime(row.completed_datetime), row.room_no ?? '—', row.guest_name ?? '—', row.status, row.severity ?? '—', formatDuration(row.duration), row.complaint_source ?? '—']);
    }
    const scope = [module, chainCode, path?.hotel, path?.distName, path?.item, path?.date, level].filter(Boolean).map((part) => csvSlug(String(part))).join('-');
    downloadCsvFile(`${scope}.csv`, headers, values);
  };

  const SummaryTable = ({ rows, root = false, distribution = false }: { rows: Array<SummaryRow | DistRow>; root?: boolean; distribution?: boolean }) => (
    <table className="min-w-[980px] w-full">
      <thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>
        {[
          (distribution ? labels.dist : t('dashboard_ui.daily_table_hotel', 'Hotel')),
          labels.items,
          labels.total,
          ...(!distribution ? [t('dashboard_ui.daily_table_active_days', 'Active Days')] : []),
          t('dashboard_ui.daily_table_completed', 'Completed'),
          labels.exception,
          labels.rate,
          labels.average,
          t('dashboard_ui.daily_table_action', 'Action'),
        ].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={distribution ? `${(row as DistRow).range_start}-${(row as DistRow).range_end}` : row.name}>
        <td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{distribution ? row.name : hotelLabel(row.name)}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.distinct_count.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total.toLocaleString()}</td>
        {!distribution && <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.active_days.toLocaleString()}</td>}
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.exception_count.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td>
        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration)}</td>
        <td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => root ? openRootRow(row) : drillDist(row as DistRow)} /></td>
      </tr>)}</tbody>
    </table>
  );

  const EmptyState = () => <div className="p-8 text-center font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}>{error || t('dashboard_ui.daily_table_no_data', 'No daily trend data found for this selection.')}</div>;

  return (
    <>
      <div data-table-code={tableCode} className="overflow-hidden" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderLeft: `4px solid ${tokens.accent}`, borderRadius: '12px' }}>
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
          <div><TableCodeTitle code={tableCode} title={labels.title} titleColor={tokens.text} codeColor={tokens.accent} background={tokens.chart.codeBg} /><p className="mt-1 font-mono text-[0.62rem]" style={{ color: tokens.dashboard.tableMuted }}>{labels.hierarchy}</p></div>
          <ExportButton onClick={() => exportRows(rootLevel, rootRows)} disabled={rootLoading || rootRows.length === 0} />
        </div>
        <div className="overflow-x-auto">{rootLoading
          ? <div className="p-8 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.daily_table_loading', 'Loading table data…')}</div>
          : rootRows.length === 0
            ? <EmptyState />
            : <SummaryTable rows={rootRows} root distribution={rootLevel === 'dists'} />}
        </div>
      </div>

      {modalLevel && path && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 md:p-6 print-hidden" onMouseDown={(event) => { if (event.currentTarget === event.target) setModalLevel(null); }}>
          <div role="dialog" aria-modal="true" aria-label={modalTitle} data-table-code={tableCode} className="w-full max-w-7xl max-h-[88vh] overflow-hidden shadow-2xl" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderRadius: '12px', ...dialogStyle }}>
            <div {...dragHandleProps} className="flex cursor-move touch-none select-none items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><button type="button" onClick={back} className="inline-flex items-center gap-1 px-2 py-1 font-mono text-[0.65rem] hover:opacity-75" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55` }}><ArrowLeft size={13} /> {t('dashboard_ui.daily_table_back', 'Back')}</button><TableCodeTitle code={tableCode} title={modalTitle} titleColor={tokens.text} codeColor={tokens.accent} background={tokens.chart.codeBg} /></div>
                <div className="mt-2 flex flex-wrap items-center gap-1 font-mono" style={{ color: tokens.dashboard.tableMuted, fontSize: 'calc(0.62rem + 5px)' }}>{breadcrumb.map((part, index) => <span key={`${part}-${index}`} className={index === breadcrumb.length - 1 ? 'font-bold' : undefined} style={index === breadcrumb.length - 1 ? { color: tokens.text } : undefined}>{index > 0 && <span className="mx-1">→</span>}{part}</span>)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2"><ExportButton onClick={() => exportRows(modalLevel, modalRows)} disabled={modalLoading || modalRows.length === 0} /><button type="button" onClick={() => setModalLevel(null)} aria-label={t('dashboard_ui.daily_table_close', 'Close')} className="p-1.5 hover:opacity-70" style={{ color: tokens.textMuted }}><X size={18} /></button></div>
            </div>
            <div className={`max-h-[72vh] overflow-y-auto ${modalLevel === 'details' ? 'overflow-x-hidden' : 'overflow-x-auto'}`}>
              {modalLoading
                ? <div className="p-10 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.daily_table_loading', 'Loading table data…')}</div>
                : modalRows.length === 0 ? <EmptyState />
                  : modalLevel === 'dists' ? <SummaryTable rows={modalRows as DistRow[]} distribution />
                    : modalLevel === 'items' ? (
                      <table className="min-w-[1040px] w-full"><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[labels.item, t('dashboard_ui.daily_table_rank', 'Rank'), labels.total, t('dashboard_ui.daily_table_active_days', 'Active Days'), t('dashboard_ui.daily_table_completed', 'Completed'), labels.exception, labels.rate, labels.average, t('dashboard_ui.daily_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as ItemRow[]).map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.item_rank}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.active_days.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.exception_count.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drillItem(row)} /></td></tr>)}</tbody></table>
                    ) : modalLevel === 'dates' ? (
                      <table className="min-w-[900px] w-full"><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.daily_table_date', 'Date'), labels.total, t('dashboard_ui.daily_table_completed', 'Completed'), labels.exception, labels.rate, labels.average, t('dashboard_ui.daily_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DateRow[]).map((row) => <tr key={row.name}><td className="px-3 py-2 font-mono text-xs font-semibold" style={tdStyle}>{formatDate(row.name)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.exception_count.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drillDate(row)} /></td></tr>)}</tbody></table>
                    ) : isCo ? (
                      <table className="w-full table-fixed"><colgroup>{[8, 7, 8, 9, 11, 11, 9, 9, 8, 8, 6].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[
                        t('dashboard_ui.co_table_room', 'Room'),
                        t('dashboard_ui.co_table_floor', 'Floor'),
                        t('dashboard_ui.co_table_service_round', 'Service Round'),
                        t('dashboard_ui.co_table_inspector', 'Inspector'),
                        t('dashboard_ui.co_table_start', 'Start'),
                        t('dashboard_ui.co_table_complete', 'Complete'),
                        t('dashboard_ui.co_table_status', 'Status'),
                        t('dashboard_ui.co_table_time_spent', 'Time Spent'),
                        t('dashboard_ui.co_table_standard', 'Standard'),
                        t('dashboard_ui.co_table_ahead_behind', 'Ahead / Behind'),
                        t('dashboard_ui.co_table_credit', 'Credit'),
                      ].map((label) => <th key={label} className="px-1.5 py-2 text-left font-mono uppercase leading-tight break-words" style={{ ...thStyle, fontSize: 'clamp(0.46rem, 0.62vw, 0.58rem)', letterSpacing: '0.02em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.record_id}-${index}`} style={{ fontSize: 'clamp(0.5rem, 0.7vw, 0.68rem)' }}><td className="px-1.5 py-2 font-mono font-semibold break-words" style={tdStyle}>{row.room_no ?? '—'}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.floor ?? '—'}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.service_round ?? '—'}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.inspector ?? 'Inspector'}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.created_datetime)}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.completed_datetime)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.status}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDuration(row.duration)}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDecimal(row.standard, ' min')}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDecimal(row.variance, ' min')}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDecimal(row.credit ?? 0)}</td></tr>)}</tbody></table>
                    ) : isCoIr ? (
                      <table className="w-full table-fixed"><colgroup>{[10, 10, 10, 11, 12, 12, 10, 9, 8, 8].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[
                        t('dashboard_ui.co_table_date', 'Date'),
                        t('dashboard_ui.co_table_room', 'Room'),
                        t('dashboard_ui.co_ir_room_status', 'Room Status'),
                        t('dashboard_ui.co_ir_cleaned_by', 'Cleaned By'),
                        t('dashboard_ui.co_table_start', 'Start'),
                        t('dashboard_ui.co_table_complete', 'Complete'),
                        t('dashboard_ui.co_ir_result', 'Result'),
                        t('dashboard_ui.co_table_time_spent', 'Time Spent'),
                        t('dashboard_ui.co_ir_score', 'Score'),
                        t('dashboard_ui.co_table_credit', 'Credit'),
                      ].map((label) => <th key={label} className="px-1.5 py-2 text-left font-mono uppercase leading-tight break-words" style={{ ...thStyle, fontSize: 'clamp(0.46rem, 0.62vw, 0.58rem)', letterSpacing: '0.02em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.record_id}-${index}`} style={{ fontSize: 'clamp(0.5rem, 0.7vw, 0.68rem)' }}><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDate(path?.date ?? '')}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.location ?? '—'}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.room_status ?? '—'}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.cleaned_by ?? '—'}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.created_datetime)}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.completed_datetime)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.status}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDuration(row.duration)}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDecimal(row.inspection_score)}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDecimal(row.credit ?? 0)}</td></tr>)}</tbody></table>
                    ) : isMo ? (
                      <table className="w-full table-fixed"><colgroup>{[9, 10, 10, 9, 5, 7, 10, 10, 8, 7, 15].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.mo_table_maintenance_order', 'Maintenance Order'), t('dashboard_ui.mo_table_created_time', 'Created Time'), t('dashboard_ui.daily_table_completed_time', 'Completed Time'), t('dashboard_ui.mo_table_location', 'Location'), t('dashboard_ui.mo_table_quantity', 'Quantity'), t('dashboard_ui.mo_table_status', 'Status'), t('dashboard_ui.mo_table_assigned_to', 'Assigned To'), t('dashboard_ui.mo_table_completed_by', 'Completed By'), t('dashboard_ui.mo_table_duration', 'Duration'), t('dashboard_ui.mo_table_delay', 'Delay'), t('dashboard_ui.mo_table_guest_name', 'Guest Name')].map((label) => <th key={label} className="px-1.5 py-2 text-left font-mono uppercase leading-tight break-words" style={{ ...thStyle, fontSize: 'clamp(0.48rem, 0.65vw, 0.6rem)', letterSpacing: '0.025em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.record_id}-${index}`} style={{ fontSize: 'clamp(0.52rem, 0.72vw, 0.7rem)' }}><td className="px-1.5 py-2 font-mono font-semibold break-words" style={tdStyle}>{row.record_id}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.created_datetime)}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.completed_datetime)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.location}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatQuantity(row.quantity)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.status}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.assigned_to}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.completed_by}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDuration(row.duration)}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{row.delay === null || row.delay === undefined ? '—' : `${row.delay.toFixed(1)} h`}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.guest_name}</td></tr>)}</tbody></table>
                    ) : (
                      <table className="w-full table-fixed"><colgroup>{[12, 12, 12, 8, 12, 10, 9, 10, 15].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.im_table_case_number', 'Case Number'), t('dashboard_ui.im_table_date_time', 'Date / Time'), t('dashboard_ui.daily_table_completed_time', 'Completed Time'), t('dashboard_ui.im_table_room', 'Room'), t('dashboard_ui.im_table_guest', 'Guest'), t('dashboard_ui.im_table_status', 'Status'), t('dashboard_ui.im_table_severity', 'Severity'), labels.average, t('dashboard_ui.im_table_complaint_source', 'Complaint Source')].map((label) => <th key={label} className="px-1.5 py-2 text-left font-mono uppercase leading-tight break-words" style={{ ...thStyle, fontSize: 'clamp(0.48rem, 0.65vw, 0.6rem)', letterSpacing: '0.025em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.record_id}-${index}`} style={{ fontSize: 'clamp(0.52rem, 0.72vw, 0.7rem)' }}><td className="px-1.5 py-2 font-mono font-semibold break-words" style={tdStyle}>{row.record_id}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.created_datetime)}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.completed_datetime)}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{row.room_no}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.guest_name}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.status}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.severity}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatDuration(row.duration)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.complaint_source}</td></tr>)}</tbody></table>
                    )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
