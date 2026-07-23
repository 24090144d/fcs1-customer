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

type ModalLevel = 'dists' | 'items' | 'dates' | 'details';

type HotelRow = {
  name: string;
  total_jobs: number;
  distinct_count: number;
  active_days: number;
  completed: number;
  delayed: number;
  completion_rate: number;
  avg_duration_minutes: number | null;
};

type DistRow = {
  name: string;
  range_start: number;
  range_end: number;
  distinct_count: number;
  total_jobs: number;
  completed: number;
  delayed: number;
  completion_rate: number;
  avg_duration_minutes: number | null;
};

type ItemRow = {
  name: string;
  item_rank: number;
  total_jobs: number;
  active_days: number;
  completed: number;
  delayed: number;
  completion_rate: number;
  avg_duration_minutes: number | null;
};

type DateRow = {
  name: string;
  total_jobs: number;
  quantity: number;
  completed: number;
  delayed: number;
  completion_rate: number;
  avg_duration_minutes: number | null;
};

type DetailRow = {
  job_order: string;
  created_datetime: string | null;
  completed_datetime: string | null;
  location: string;
  quantity: number;
  status: string;
  assigned_to: string;
  completed_by: string;
  duration_minutes: number | null;
  delay: string;
  guest_name: string;
};

type TableRow = HotelRow | DistRow | ItemRow | DateRow | DetailRow;
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
  chainCode: string;
  hotelFilter: string;
  hotelNames: Record<string, string>;
  rootLevel?: 'hotels' | 'dists';
  from?: string;
  to?: string;
  dark: boolean;
};

export function JoDailyTrendDrilldownTable({
  chainCode,
  hotelFilter,
  hotelNames,
  rootLevel = 'hotels',
  from = '',
  to = '',
  dark,
}: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const tableCode = rootLevel === 'hotels' ? 'cjot-02' : 'jot-02';
  const { dialogStyle, dragHandleProps, resetDialogPosition } = useDraggableDialog();
  const [rootRows, setRootRows] = useState<Array<HotelRow | DistRow>>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalLevel, setModalLevel] = useState<ModalLevel | null>(null);
  const [path, setPath] = useState<DrillPath | null>(null);
  const [modalRows, setModalRows] = useState<TableRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Hong_Kong');

  const queryUrl = useCallback((level: 'hotels' | ModalLevel, drillPath?: DrillPath) => {
    const query = new URLSearchParams({ level, chain: chainCode });
    const selectedHotel = drillPath?.hotel || (hotelFilter !== 'ALL' ? hotelFilter : '');
    if (selectedHotel) query.set('hotel', selectedHotel);
    if (drillPath?.distStart) query.set('dist_start', String(drillPath.distStart));
    if (drillPath?.distEnd) query.set('dist_end', String(drillPath.distEnd));
    if (drillPath?.item) query.set('item', drillPath.item);
    if (drillPath?.date) query.set('date', drillPath.date);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return `/api/dashboard/jo-daily-table?${query.toString()}`;
  }, [chainCode, hotelFilter, from, to]);

  useEffect(() => {
    const controller = new AbortController();
    setRootLoading(true);
    setError('');
    fetch(queryUrl(rootLevel), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse;
        if (!response.ok) throw new Error(payload.error || 'Unable to load JO daily trend data.');
        setRootRows((payload.rows ?? []) as Array<HotelRow | DistRow>);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load JO daily trend data.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setRootLoading(false);
      });
    return () => controller.abort();
  }, [queryUrl, rootLevel]);

  useEffect(() => {
    if (!modalLevel || !path) return;
    const controller = new AbortController();
    setModalLoading(true);
    setError('');
    fetch(queryUrl(modalLevel, path), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse;
        if (!response.ok) throw new Error(payload.error || 'Unable to load JO daily trend drilldown.');
        setModalRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load JO daily trend drilldown.');
        setModalRows([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setModalLoading(false);
      });
    return () => controller.abort();
  }, [modalLevel, path, queryUrl]);

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

  const openRootRow = (row: HotelRow | DistRow) => {
    beginTransition();
    if (rootLevel === 'hotels') {
      setPath({ hotel: row.name });
      setModalLevel('dists');
    } else {
      const dist = row as DistRow;
      setPath({ hotel: hotelFilter, distName: dist.name, distStart: dist.range_start, distEnd: dist.range_end });
      setModalLevel('items');
    }
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
    beginTransition();
    if (modalLevel === 'details') setModalLevel('dates');
    else if (modalLevel === 'dates') setModalLevel('items');
    else if (modalLevel === 'items') {
      if (rootLevel === 'dists') setModalLevel(null);
      else setModalLevel('dists');
    } else setModalLevel(null);
  };

  const modalTitle = useMemo(() => {
    if (modalLevel === 'dists') return t('dashboard_ui.jo_daily_dist_summary', 'Service Item Distribution');
    if (modalLevel === 'items') return t('dashboard_ui.jo_daily_item_summary', 'Service Item Summary');
    if (modalLevel === 'dates') return t('dashboard_ui.jo_daily_date_summary', 'Daily Trend');
    return t('dashboard_ui.jo_table_details', 'Job Order Details');
  }, [modalLevel, t]);

  const breadcrumb = useMemo(() => {
    if (!path) return [];
    const parts = rootLevel === 'hotels'
      ? [hotelLabel(path.hotel), path.distName, path.item, path.date]
      : [path.distName, path.item, path.date];
    return parts.filter(Boolean) as string[];
  }, [path, hotelLabel, rootLevel]);

  const formatDateTime = (value: string | null) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(parsed).replace(',', '');
  };
  const formatDate = (value: string) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', { year: '2-digit', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(parsed);
  };
  const formatDuration = (minutes: number | null) => minutes === null ? '—' : `${minutes.toFixed(1)} min`;
  const formatQuantity = (value: number) => Math.round(Number(value) || 0).toLocaleString();
  const thStyle = { color: tokens.dashboard.tableHeadText, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const tdStyle = { color: tokens.text, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const actionLabel = t('dashboard_ui.jo_table_drilldown', 'Drill down');

  const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={t('dashboard_ui.jo_table_export_csv', 'Export table to CSV')} aria-label={t('dashboard_ui.jo_table_export_csv', 'Export table to CSV')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><FileDown size={18} aria-hidden="true" /></button>
  );
  const DrillButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} title={`${actionLabel}: ${name}`} aria-label={`${actionLabel}: ${name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><CircleChevronRight size={17} aria-hidden="true" /></button>
  );

  const exportRows = (level: 'hotels' | ModalLevel, rows: TableRow[]) => {
    let headers: string[] = [];
    let values: CsvValue[][] = [];
    if (level === 'hotels') {
      headers = [t('dashboard_ui.jo_table_hotel', 'Hotel'), t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_table_service_items', 'Service Items'), t('dashboard_ui.jo_daily_active_days', 'Active Days'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration')];
      values = (rows as HotelRow[]).map((row) => [hotelLabel(row.name), row.total_jobs, row.distinct_count, row.active_days, row.completed, row.delayed, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration_minutes)]);
    } else if (level === 'dists') {
      headers = [t('dashboard_ui.jo_daily_item_dist', 'Service Item Dist'), t('dashboard_ui.jo_table_service_items', 'Service Items'), t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration')];
      values = (rows as DistRow[]).map((row) => [row.name, row.distinct_count, row.total_jobs, row.completed, row.delayed, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration_minutes)]);
    } else if (level === 'items') {
      headers = [t('dashboard_ui.jo_table_service_item', 'Service Item'), t('dashboard_ui.jo_daily_rank', 'Rank'), t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_daily_active_days', 'Active Days'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration')];
      values = (rows as ItemRow[]).map((row) => [row.name, row.item_rank, row.total_jobs, row.active_days, row.completed, row.delayed, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration_minutes)]);
    } else if (level === 'dates') {
      headers = [t('dashboard_ui.jo_daily_date', 'Date'), t('dashboard_ui.jo_table_jobs', 'Jobs'), t('dashboard_ui.jo_table_quantity', 'Quantity'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration')];
      values = (rows as DateRow[]).map((row) => [row.name, row.total_jobs, row.quantity, row.completed, row.delayed, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration_minutes)]);
    } else {
      headers = [t('dashboard_ui.jo_table_job_order', 'Job Order'), t('dashboard_ui.jo_table_created_time', 'Created Time'), t('dashboard_ui.jo_table_completed_time', 'Completed Time'), t('dashboard_ui.jo_table_location', 'Location'), t('dashboard_ui.jo_table_qty', 'Qty'), t('dashboard_ui.jo_table_status', 'Status'), t('dashboard_ui.jo_table_assigned_to', 'Assigned To'), t('dashboard_ui.jo_table_completed_by', 'Completed By'), t('dashboard_ui.jo_table_duration', 'Duration'), t('dashboard_ui.jo_table_delay', 'Delay'), t('dashboard_ui.jo_table_guest_name', 'Guest Name')];
      values = (rows as DetailRow[]).map((row) => [row.job_order, formatDateTime(row.created_datetime), formatDateTime(row.completed_datetime), row.location, row.quantity, row.status, row.assigned_to, row.completed_by, formatDuration(row.duration_minutes), row.delay, row.guest_name]);
    }
    const scope = [chainCode, path?.hotel, path?.distName, path?.item, path?.date, level].filter(Boolean).map((part) => csvSlug(String(part))).join('-');
    downloadCsvFile(`jo-daily-${scope}.csv`, headers, values);
  };

  const HotelTable = ({ rows, root = false }: { rows: HotelRow[]; root?: boolean }) => (
    <table className="min-w-[1100px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_table_hotel', 'Hotel'), t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_table_service_items', 'Service Items'), t('dashboard_ui.jo_daily_active_days', 'Active Days'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration'), t('dashboard_ui.jo_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{hotelLabel(row.name)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total_jobs.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.distinct_count.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.active_days.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.delayed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration_minutes)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => root && openRootRow(row)} /></td></tr>)}</tbody></table>
  );

  const DistTable = ({ rows, root = false }: { rows: DistRow[]; root?: boolean }) => (
    <table className="min-w-[980px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_daily_item_dist', 'Service Item Dist'), t('dashboard_ui.jo_table_service_items', 'Service Items'), t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration'), t('dashboard_ui.jo_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.range_start}-${row.range_end}`}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.distinct_count.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total_jobs.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.delayed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration_minutes)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => root ? openRootRow(row) : drillDist(row)} /></td></tr>)}</tbody></table>
  );

  const EmptyState = () => <div className="p-8 text-center font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}>{error || t('dashboard_ui.jo_daily_no_data', 'No JO daily trend data found for this selection.')}</div>;

  return (
    <>
      <div className="overflow-hidden" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderLeft: `4px solid ${tokens.accent}`, borderRadius: '12px' }}>
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
          <div><TableCodeTitle code={tableCode} title={t('dashboard_ui.jo_daily_title', 'Daily Trend by Service Item')} titleColor={tokens.text} codeColor={tokens.accent} background={tokens.chart.codeBg} /><p className="mt-1 font-mono text-[0.62rem]" style={{ color: tokens.dashboard.tableMuted }}>{rootLevel === 'hotels' ? t('dashboard_ui.jo_daily_corp_hierarchy', 'Hotel → Service Item Dist → Service Item → Date (Daily) → Detail') : t('dashboard_ui.jo_daily_hotel_hierarchy', 'Service Item Dist → Service Item → Date (Daily) → Detail')}</p></div>
          <ExportButton onClick={() => exportRows(rootLevel, rootRows)} disabled={rootLoading || rootRows.length === 0} />
        </div>
        <div className="overflow-x-auto">{rootLoading ? <div className="p-8 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.jo_table_loading', 'Loading table data…')}</div> : rootRows.length === 0 ? <EmptyState /> : rootLevel === 'hotels' ? <HotelTable rows={rootRows as HotelRow[]} root /> : <DistTable rows={rootRows as DistRow[]} root />}</div>
      </div>

      {modalLevel && path && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 md:p-6 print-hidden" onMouseDown={(event) => { if (event.currentTarget === event.target) setModalLevel(null); }}>
          <div role="dialog" aria-modal="true" aria-label={modalTitle} className="w-full max-w-7xl max-h-[88vh] overflow-hidden shadow-2xl" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderRadius: '12px', ...dialogStyle }}>
            <div {...dragHandleProps} className="flex cursor-move touch-none select-none items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
              <div className="min-w-0"><div className="flex items-center gap-2"><button type="button" onClick={back} className="inline-flex items-center gap-1 px-2 py-1 font-mono text-[0.65rem] hover:opacity-75" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55` }}><ArrowLeft size={13} /> {t('dashboard_ui.jo_table_back', 'Back')}</button><TableCodeTitle code={tableCode} title={modalTitle} titleColor={tokens.text} codeColor={tokens.accent} background={tokens.chart.codeBg} /></div><div className="mt-2 flex flex-wrap items-center gap-1 font-mono" style={{ color: tokens.dashboard.tableMuted, fontSize: 'calc(0.62rem + 5px)' }}>{breadcrumb.map((part, index) => { const active = index === breadcrumb.length - 1; return <span key={`${part}-${index}`} className={active ? 'font-bold' : undefined} style={active ? { color: tokens.text } : undefined}>{index > 0 && <span className="mx-1">→</span>}{part}</span>; })}</div></div>
              <div className="flex shrink-0 items-center gap-2"><ExportButton onClick={() => exportRows(modalLevel, modalRows)} disabled={modalLoading || modalRows.length === 0} /><button type="button" onClick={() => setModalLevel(null)} aria-label={t('dashboard_ui.jo_table_close', 'Close')} className="p-1.5 hover:opacity-70" style={{ color: tokens.textMuted }}><X size={18} /></button></div>
            </div>
            <div className={`max-h-[72vh] overflow-y-auto ${modalLevel === 'details' ? 'overflow-x-hidden' : 'overflow-x-auto'}`}>
              {modalLoading ? <div className="p-10 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.jo_table_loading', 'Loading table data…')}</div>
                : modalRows.length === 0 ? <EmptyState />
                : modalLevel === 'dists' ? <DistTable rows={modalRows as DistRow[]} />
                : modalLevel === 'items' ? <table className="min-w-[1040px] w-full"><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_table_service_item', 'Service Item'), t('dashboard_ui.jo_daily_rank', 'Rank'), t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_daily_active_days', 'Active Days'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration'), t('dashboard_ui.jo_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as ItemRow[]).map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.item_rank}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total_jobs.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.active_days.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.delayed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration_minutes)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drillItem(row)} /></td></tr>)}</tbody></table>
                : modalLevel === 'dates' ? <table className="min-w-[960px] w-full"><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_daily_date', 'Date'), t('dashboard_ui.jo_table_jobs', 'Jobs'), t('dashboard_ui.jo_table_quantity', 'Quantity'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration'), t('dashboard_ui.jo_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DateRow[]).map((row) => <tr key={row.name}><td className="px-3 py-2 font-mono text-xs font-semibold" style={tdStyle}>{formatDate(row.name)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total_jobs.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatQuantity(row.quantity)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.delayed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration_minutes)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drillDate(row)} /></td></tr>)}</tbody></table>
                : <table className="w-full table-fixed"><colgroup>{[9, 10, 10, 9, 4, 7, 10, 10, 7, 7, 17].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_table_job_order', 'Job Order'), t('dashboard_ui.jo_table_created_time', 'Created Time'), t('dashboard_ui.jo_table_completed_time', 'Completed Time'), t('dashboard_ui.jo_table_location', 'Location'), t('dashboard_ui.jo_table_qty', 'Qty'), t('dashboard_ui.jo_table_status', 'Status'), t('dashboard_ui.jo_table_assigned_to', 'Assigned To'), t('dashboard_ui.jo_table_completed_by', 'Completed By'), t('dashboard_ui.jo_table_duration', 'Duration'), t('dashboard_ui.jo_table_delay', 'Delay'), t('dashboard_ui.jo_table_guest_name', 'Guest Name')].map((label) => <th key={label} className="px-1.5 py-2 text-left font-mono uppercase leading-tight break-words" style={{ ...thStyle, fontSize: 'clamp(0.48rem, 0.65vw, 0.6rem)', letterSpacing: '0.025em' }}>{label}</th>)}</tr></thead><tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.job_order}-${index}`} style={{ fontSize: 'clamp(0.52rem, 0.72vw, 0.7rem)' }}><td className="px-1.5 py-2 font-mono font-semibold break-words" style={tdStyle}>{row.job_order}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.created_datetime)}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDateTime(row.completed_datetime)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.location}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatQuantity(row.quantity)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.status}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.assigned_to}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.completed_by}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDuration(row.duration_minutes)}</td><td className="px-1.5 py-2 font-mono leading-tight break-words" style={tdStyle}>{row.delay}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.guest_name}</td></tr>)}</tbody></table>}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
