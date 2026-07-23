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

type ModalLevel = 'departments' | 'categories' | 'items' | 'details';

type SummaryRow = {
  name: string;
  total_jobs: number;
  completed: number;
  delayed: number;
  cancelled: number;
  completion_rate: number;
  distinct_count: number;
  avg_duration_minutes: number | null;
};

type ItemRow = {
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

type TableResponse<T> = { rows?: T[]; timezone?: string; error?: string };

type DrillPath = {
  hotel: string;
  department?: string;
  category?: string;
  item?: string;
};

type Props = {
  chainCode: string;
  hotelFilter: string;
  hotelNames: Record<string, string>;
  rootLevel?: 'hotels' | 'departments';
  from?: string;
  to?: string;
  dark: boolean;
};

export function CorpJoDrilldownTable({ chainCode, hotelFilter, hotelNames, rootLevel = 'hotels', from = '', to = '', dark }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const tableCode = rootLevel === 'hotels' ? 'cjot-01' : 'jot-01';
  const { dialogStyle, dragHandleProps, resetDialogPosition } = useDraggableDialog();
  const [rootRows, setRootRows] = useState<SummaryRow[]>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalLevel, setModalLevel] = useState<ModalLevel | null>(null);
  const [path, setPath] = useState<DrillPath | null>(null);
  const [modalRows, setModalRows] = useState<Array<SummaryRow | ItemRow | DetailRow>>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Hong_Kong');

  const queryUrl = useCallback((level: 'hotels' | ModalLevel, drillPath?: DrillPath) => {
    const query = new URLSearchParams({ level, chain: chainCode });
    const selectedHotel = drillPath?.hotel || (hotelFilter !== 'ALL' ? hotelFilter : '');
    if (selectedHotel) query.set('hotel', selectedHotel);
    if (drillPath?.department) query.set('department', drillPath.department);
    if (drillPath?.category) query.set('category', drillPath.category);
    if (drillPath?.item) query.set('item', drillPath.item);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return `/api/dashboard/jo-table?${query.toString()}`;
  }, [chainCode, hotelFilter, from, to]);

  useEffect(() => {
    const controller = new AbortController();
    setRootLoading(true);
    setError('');
    fetch(queryUrl(rootLevel), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse<SummaryRow>;
        if (!response.ok) throw new Error(payload.error || 'Unable to load JO table data.');
        setRootRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load JO table data.');
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
        const payload = await response.json() as TableResponse<SummaryRow | ItemRow | DetailRow>;
        if (!response.ok) throw new Error(payload.error || 'Unable to load JO drilldown data.');
        setModalRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load JO drilldown data.');
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

  const openRootRow = (name: string) => {
    beginTransition();
    if (rootLevel === 'hotels') {
      setPath({ hotel: name });
      setModalLevel('departments');
    } else {
      setPath({ hotel: hotelFilter, department: name });
      setModalLevel('categories');
    }
  };

  const drill = (name: string) => {
    if (!path || !modalLevel) return;
    beginTransition();
    if (modalLevel === 'departments') {
      setPath({ ...path, department: name });
      setModalLevel('categories');
    } else if (modalLevel === 'categories') {
      setPath({ ...path, category: name });
      setModalLevel('items');
    } else if (modalLevel === 'items') {
      setPath({ ...path, item: name });
      setModalLevel('details');
    }
  };

  const back = () => {
    if (!modalLevel) return;
    beginTransition();
    if (modalLevel === 'details') setModalLevel('items');
    else if (modalLevel === 'items') setModalLevel('categories');
    else if (modalLevel === 'categories') {
      if (rootLevel === 'departments') setModalLevel(null);
      else setModalLevel('departments');
    }
    else setModalLevel(null);
  };

  const modalTitle = useMemo(() => {
    if (modalLevel === 'departments') return t('dashboard_ui.jo_table_department_summary', 'Department Summary');
    if (modalLevel === 'categories') return t('dashboard_ui.jo_table_category_summary', 'Category Summary');
    if (modalLevel === 'items') return t('dashboard_ui.jo_table_item_summary', 'Service Item Summary');
    return t('dashboard_ui.jo_table_details', 'Job Order Details');
  }, [modalLevel, t]);

  const breadcrumb = useMemo(() => {
    if (!path) return [];
    const parts = rootLevel === 'hotels'
      ? [hotelLabel(path.hotel), path.department, path.category, path.item]
      : [path.department, path.category, path.item];
    return parts.filter(Boolean) as string[];
  }, [path, hotelLabel, rootLevel]);

  const formatDate = (value: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date).replace(',', '');
  };

  const formatDuration = (minutes: number | null) => minutes === null ? '—' : `${minutes.toFixed(1)} min`;
  const formatQuantity = (value: number) => Math.round(Number(value) || 0).toLocaleString();
  const actionLabel = t('dashboard_ui.jo_table_drilldown', 'Drill down');
  const thStyle = { color: tokens.dashboard.tableHeadText, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const tdStyle = { color: tokens.text, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };

  const exportRootCsv = () => {
    const firstHeader = rootLevel === 'hotels'
      ? t('dashboard_ui.jo_table_hotel', 'Hotel')
      : t('dashboard_ui.jo_table_department', 'Department');
    const distinctHeader = rootLevel === 'hotels'
      ? t('dashboard_ui.jo_table_departments', 'Departments')
      : t('dashboard_ui.jo_table_service_items', 'Service Items');
    const headers = [
      firstHeader,
      t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'),
      t('dashboard_ui.jo_table_completed', 'Completed'),
      t('dashboard_ui.jo_table_delayed', 'Delayed'),
      t('dashboard_ui.jo_table_cancelled', 'Cancelled'),
      t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'),
      distinctHeader,
      t('dashboard_ui.jo_table_average_duration', 'Average Duration'),
    ];
    const rows: CsvValue[][] = rootRows.map((row) => [
      rootLevel === 'hotels' ? hotelLabel(row.name) : row.name,
      row.total_jobs, row.completed, row.delayed, row.cancelled,
      `${row.completion_rate.toFixed(1)}%`, row.distinct_count, formatDuration(row.avg_duration_minutes),
    ]);
    const filename = rootLevel === 'hotels'
      ? `corp-jo-hotel-summary-${chainCode.toLowerCase()}.csv`
      : `hotel-jo-department-summary-${hotelFilter.toLowerCase()}.csv`;
    downloadCsvFile(filename, headers, rows);
  };

  const exportModalCsv = () => {
    if (!modalLevel || modalRows.length === 0) return;
    let headers: string[] = [];
    let rows: CsvValue[][] = [];
    if (modalLevel === 'departments' || modalLevel === 'categories') {
      headers = [
        modalLevel === 'departments' ? t('dashboard_ui.jo_table_department', 'Department') : t('dashboard_ui.jo_table_category', 'Category'),
        t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_table_completed', 'Completed'),
        t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_cancelled', 'Cancelled'),
        t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_service_items', 'Service Items'),
        t('dashboard_ui.jo_table_average_duration', 'Average Duration'),
      ];
      rows = (modalRows as SummaryRow[]).map((row) => [row.name, row.total_jobs, row.completed, row.delayed, row.cancelled, `${row.completion_rate.toFixed(1)}%`, row.distinct_count, formatDuration(row.avg_duration_minutes)]);
    } else if (modalLevel === 'items') {
      headers = [
        t('dashboard_ui.jo_table_service_item', 'Service Item'), t('dashboard_ui.jo_table_jobs', 'Jobs'),
        t('dashboard_ui.jo_table_quantity', 'Quantity'), t('dashboard_ui.jo_table_completed', 'Completed'),
        t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'),
        t('dashboard_ui.jo_table_average_duration', 'Average Duration'),
      ];
      rows = (modalRows as ItemRow[]).map((row) => [row.name, row.total_jobs, Math.round(Number(row.quantity) || 0), row.completed, row.delayed, `${row.completion_rate.toFixed(1)}%`, formatDuration(row.avg_duration_minutes)]);
    } else {
      headers = [
        t('dashboard_ui.jo_table_job_order', 'Job Order'), t('dashboard_ui.jo_table_created_time', 'Created Time'),
        t('dashboard_ui.jo_table_completed_time', 'Completed Time'),
        t('dashboard_ui.jo_table_location', 'Location'), t('dashboard_ui.jo_table_qty', 'Qty'),
        t('dashboard_ui.jo_table_status', 'Status'), t('dashboard_ui.jo_table_assigned_to', 'Assigned To'),
        t('dashboard_ui.jo_table_completed_by', 'Completed By'),
        t('dashboard_ui.jo_table_duration', 'Duration'), t('dashboard_ui.jo_table_delay', 'Delay'),
        t('dashboard_ui.jo_table_guest_name', 'Guest Name'),
      ];
      rows = (modalRows as DetailRow[]).map((row) => [row.job_order, formatDate(row.created_datetime), formatDate(row.completed_datetime), row.location, Math.round(Number(row.quantity) || 0), row.status, row.assigned_to, row.completed_by, formatDuration(row.duration_minutes), row.delay, row.guest_name]);
    }
    const scope = [chainCode, path?.hotel, path?.department, path?.category, path?.item, modalLevel].filter(Boolean).map((part) => csvSlug(String(part))).join('-');
    downloadCsvFile(`jo-${scope}.csv`, headers, rows);
  };

  const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={t('dashboard_ui.jo_table_export_csv', 'Export table to CSV')} aria-label={t('dashboard_ui.jo_table_export_csv', 'Export table to CSV')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><FileDown size={18} aria-hidden="true" /></button>
  );

  const DrillButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} title={`${actionLabel}: ${name}`} aria-label={`${actionLabel}: ${name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}>
      <CircleChevronRight size={17} aria-hidden="true" />
    </button>
  );

  const SummaryTable = ({ rows, firstLabel, distinctLabel, hotelNamesEnabled = false, rootTable = false }: { rows: SummaryRow[]; firstLabel: string; distinctLabel: string; hotelNamesEnabled?: boolean; rootTable?: boolean }) => (
    <table className="min-w-[1120px] w-full">
      <thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>
        {[firstLabel, t('dashboard_ui.jo_table_total_jobs', 'Total Jobs'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_cancelled', 'Cancelled'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), distinctLabel, t('dashboard_ui.jo_table_average_duration', 'Average Duration'), t('dashboard_ui.jo_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.name} onMouseEnter={(e) => { e.currentTarget.style.background = tokens.accentTint; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
        <td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{hotelNamesEnabled ? hotelLabel(row.name) : row.name}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total_jobs.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.delayed.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.cancelled.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td>
        <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.distinct_count.toLocaleString()}</td>
        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration_minutes)}</td>
        <td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => rootTable ? openRootRow(row.name) : drill(row.name)} /></td>
      </tr>)}</tbody>
    </table>
  );

  const EmptyState = () => <div className="p-8 text-center font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}>{error || t('dashboard_ui.jo_table_no_data', 'No job order data found for this selection.')}</div>;

  return (
    <>
      <div className="overflow-hidden" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderLeft: `4px solid ${tokens.accent}`, borderRadius: '12px' }}>
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
          <div>
            <TableCodeTitle code={tableCode} title={rootLevel === 'hotels' ? t('dashboard_ui.jo_table_hotel_summary', 'Hotel Job Order Summary') : t('dashboard_ui.jo_table_department_summary', 'Department Summary')} titleColor={tokens.text} codeColor={tokens.accent} background={tokens.chart.codeBg} />
            <p className="mt-1 font-mono text-[0.62rem]" style={{ color: tokens.dashboard.tableMuted }}>{rootLevel === 'hotels' ? t('dashboard_ui.jo_table_hierarchy', 'Hotel → Department → Category → Service Items → Detail') : t('dashboard_ui.jo_table_hotel_hierarchy', 'Department → Category → Service Items → Detail')}</p>
          </div>
          <ExportButton onClick={exportRootCsv} disabled={rootLoading || rootRows.length === 0} />
        </div>
        <div className="overflow-x-auto">
          {rootLoading ? <div className="p-8 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.jo_table_loading', 'Loading table data…')}</div>
            : rootRows.length > 0 ? <SummaryTable rows={rootRows} firstLabel={rootLevel === 'hotels' ? t('dashboard_ui.jo_table_hotel', 'Hotel') : t('dashboard_ui.jo_table_department', 'Department')} distinctLabel={rootLevel === 'hotels' ? t('dashboard_ui.jo_table_departments', 'Departments') : t('dashboard_ui.jo_table_service_items', 'Service Items')} hotelNamesEnabled={rootLevel === 'hotels'} rootTable /> : <EmptyState />}
        </div>
      </div>

      {modalLevel && path && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 md:p-6 print-hidden" onMouseDown={(e) => { if (e.currentTarget === e.target) setModalLevel(null); }}>
          <div role="dialog" aria-modal="true" aria-label={modalTitle} className="w-full max-w-7xl max-h-[88vh] overflow-hidden shadow-2xl" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderRadius: '12px', ...dialogStyle }}>
            <div {...dragHandleProps} className="flex cursor-move touch-none select-none items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><button type="button" onClick={back} className="inline-flex items-center gap-1 px-2 py-1 font-mono text-[0.65rem] hover:opacity-75" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55` }}><ArrowLeft size={13} /> {t('dashboard_ui.jo_table_back', 'Back')}</button><TableCodeTitle code={tableCode} title={modalTitle} titleColor={tokens.text} codeColor={tokens.accent} background={tokens.chart.codeBg} /></div>
                <div className="mt-2 flex flex-wrap items-center gap-1 font-mono" style={{ color: tokens.dashboard.tableMuted, fontSize: 'calc(0.62rem + 5px)' }}>
                  {breadcrumb.map((part, index) => { const active = index === breadcrumb.length - 1; return <span key={`${part}-${index}`} className={active ? 'font-bold' : undefined} style={active ? { color: tokens.text } : undefined}>{index > 0 && <span className="mx-1">→</span>}{part}</span>; })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ExportButton onClick={exportModalCsv} disabled={modalLoading || modalRows.length === 0} />
                <button type="button" onClick={() => setModalLevel(null)} aria-label={t('dashboard_ui.jo_table_close', 'Close')} className="p-1.5 hover:opacity-70" style={{ color: tokens.textMuted }}><X size={18} /></button>
              </div>
            </div>
            <div className={`max-h-[72vh] overflow-y-auto ${modalLevel === 'details' ? 'overflow-x-hidden' : 'overflow-x-auto'}`}>
              {modalLoading ? <div className="p-10 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.jo_table_loading', 'Loading table data…')}</div>
                : modalRows.length === 0 ? <EmptyState />
                : modalLevel === 'departments' || modalLevel === 'categories' ? <SummaryTable rows={modalRows as SummaryRow[]} firstLabel={modalLevel === 'departments' ? t('dashboard_ui.jo_table_department', 'Department') : t('dashboard_ui.jo_table_category', 'Category')} distinctLabel={t('dashboard_ui.jo_table_service_items', 'Service Items')} />
                : modalLevel === 'items' ? (
                  <table className="min-w-[1040px] w-full">
                    <thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_table_service_item', 'Service Item'), t('dashboard_ui.jo_table_jobs', 'Jobs'), t('dashboard_ui.jo_table_quantity', 'Quantity'), t('dashboard_ui.jo_table_completed', 'Completed'), t('dashboard_ui.jo_table_delayed', 'Delayed'), t('dashboard_ui.jo_table_completion_rate', 'Completion Rate'), t('dashboard_ui.jo_table_average_duration', 'Average Duration'), t('dashboard_ui.jo_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}</tr></thead>
                    <tbody>{(modalRows as ItemRow[]).map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.total_jobs.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatQuantity(row.quantity)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.delayed.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completion_rate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDuration(row.avg_duration_minutes)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drill(row.name)} /></td></tr>)}</tbody>
                  </table>
                ) : (
                  <table className="w-full table-fixed">
                    <colgroup>
                      {[9, 10, 10, 9, 4, 7, 10, 10, 7, 7, 17].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
                    </colgroup>
                    <thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{[t('dashboard_ui.jo_table_job_order', 'Job Order'), t('dashboard_ui.jo_table_created_time', 'Created Time'), t('dashboard_ui.jo_table_completed_time', 'Completed Time'), t('dashboard_ui.jo_table_location', 'Location'), t('dashboard_ui.jo_table_qty', 'Qty'), t('dashboard_ui.jo_table_status', 'Status'), t('dashboard_ui.jo_table_assigned_to', 'Assigned To'), t('dashboard_ui.jo_table_completed_by', 'Completed By'), t('dashboard_ui.jo_table_duration', 'Duration'), t('dashboard_ui.jo_table_delay', 'Delay'), t('dashboard_ui.jo_table_guest_name', 'Guest Name')].map((label) => <th key={label} className="px-1.5 py-2 text-left font-mono uppercase leading-tight break-words" style={{ ...thStyle, fontSize: 'clamp(0.48rem, 0.65vw, 0.6rem)', letterSpacing: '0.025em' }}>{label}</th>)}</tr></thead>
                    <tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.job_order}-${index}`} style={{ fontSize: 'clamp(0.52rem, 0.72vw, 0.7rem)' }}><td className="px-1.5 py-2 font-mono font-semibold break-words" style={tdStyle}>{row.job_order}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDate(row.created_datetime)}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDate(row.completed_datetime)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.location}</td><td className="px-1.5 py-2 font-mono" style={tdStyle}>{formatQuantity(row.quantity)}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.status}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.assigned_to}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.completed_by}</td><td className="px-1.5 py-2 font-mono leading-tight" style={tdStyle}>{formatDuration(row.duration_minutes)}</td><td className="px-1.5 py-2 font-mono leading-tight break-words" style={tdStyle}>{row.delay}</td><td className="px-1.5 py-2 break-words" style={tdStyle}>{row.guest_name}</td></tr>)}</tbody>
                  </table>
                )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
