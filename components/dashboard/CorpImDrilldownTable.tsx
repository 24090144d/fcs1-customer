'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CircleChevronRight, FileDown, LoaderCircle, X } from 'lucide-react';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { csvSlug, downloadCsvFile, type CsvValue } from '@/lib/download-csv';

type ModalLevel = 'departments' | 'categories' | 'incidents' | 'details';

type SummaryRow = {
  name: string;
  cases: number;
  completed: number;
  not_completed: number;
  high_critical: number;
  closure_rate: number;
  avg_duration_hours: number | null;
};

type IncidentRow = {
  name: string;
  cases: number;
  open: number;
  high_critical: number;
  case_share: number;
  avg_duration_hours: number | null;
};

type DetailRow = {
  incident_case: string;
  occurred_at: string | null;
  room_no: string;
  guest_name: string;
  status: string;
  severity: string;
  complaint_source: string;
};

type TableResponse<T> = { rows?: T[]; timezone?: string; error?: string };

type DrillPath = {
  hotel: string;
  department?: string;
  category?: string;
  incident?: string;
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

export function CorpImDrilldownTable({ chainCode, hotelFilter, hotelNames, rootLevel = 'hotels', from = '', to = '', dark }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const [rootRows, setRootRows] = useState<SummaryRow[]>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalLevel, setModalLevel] = useState<ModalLevel | null>(null);
  const [path, setPath] = useState<DrillPath | null>(null);
  const [modalRows, setModalRows] = useState<Array<SummaryRow | IncidentRow | DetailRow>>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Hong_Kong');

  const queryUrl = useCallback((level: 'hotels' | ModalLevel, drillPath?: DrillPath) => {
    const query = new URLSearchParams({ level, chain: chainCode });
    const selectedHotel = drillPath?.hotel || (hotelFilter !== 'ALL' ? hotelFilter : '');
    if (selectedHotel) query.set('hotel', selectedHotel);
    if (drillPath?.department) query.set('department', drillPath.department);
    if (drillPath?.category) query.set('category', drillPath.category);
    if (drillPath?.incident) query.set('incident', drillPath.incident);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return `/api/dashboard/im-table?${query.toString()}`;
  }, [chainCode, hotelFilter, from, to]);

  useEffect(() => {
    const controller = new AbortController();
    setRootLoading(true);
    setError('');
    fetch(queryUrl(rootLevel), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse<SummaryRow>;
        if (!response.ok) throw new Error(payload.error || 'Unable to load table data.');
        setRootRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load table data.');
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
        const payload = await response.json() as TableResponse<SummaryRow | IncidentRow | DetailRow>;
        if (!response.ok) throw new Error(payload.error || 'Unable to load drilldown data.');
        setModalRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load drilldown data.');
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

  const hotelLabel = useCallback((code: string) => {
    const name = hotelNames[code];
    return name && name !== code ? `${code} · ${name}` : code;
  }, [hotelNames]);

  const openRootRow = (name: string) => {
    setModalRows([]);
    setModalLoading(true);
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
    setModalRows([]);
    setModalLoading(true);
    if (modalLevel === 'departments') {
      setPath({ ...path, department: name });
      setModalLevel('categories');
    } else if (modalLevel === 'categories') {
      setPath({ ...path, category: name });
      setModalLevel('incidents');
    } else if (modalLevel === 'incidents') {
      setPath({ ...path, incident: name });
      setModalLevel('details');
    }
  };

  const back = () => {
    if (!modalLevel || !path) return;
    setModalRows([]);
    setModalLoading(true);
    if (modalLevel === 'details') setModalLevel('incidents');
    else if (modalLevel === 'incidents') setModalLevel('categories');
    else if (modalLevel === 'categories') {
      if (rootLevel === 'departments') setModalLevel(null);
      else setModalLevel('departments');
    }
    else setModalLevel(null);
  };

  const modalTitle = useMemo(() => {
    if (modalLevel === 'departments') return t('dashboard_ui.im_table_department_summary', 'Department Summary');
    if (modalLevel === 'categories') return t('dashboard_ui.im_table_category_summary', 'Category Summary');
    if (modalLevel === 'incidents') return t('dashboard_ui.im_table_incident_summary', 'Incident Summary');
    return t('dashboard_ui.im_table_incident_details', 'Incident Details');
  }, [modalLevel, t]);

  const breadcrumb = useMemo(() => {
    if (!path) return [];
    const parts = rootLevel === 'hotels'
      ? [hotelLabel(path.hotel), path.department, path.category, path.incident]
      : [path.department, path.category, path.incident];
    return parts.filter(Boolean) as string[];
  }, [path, hotelLabel, rootLevel]);

  const formatDate = (value: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date);
  };

  const thStyle = { color: tokens.dashboard.tableHeadText, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const tdStyle = { color: tokens.text, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const actionLabel = t('dashboard_ui.im_table_drilldown', 'Drill down');
  const durationLabel = t('dashboard_ui.im_table_average_duration', 'Average Duration');
  const durationValue = (hours: number | null) => hours === null ? '—' : `${hours.toFixed(1)} h`;

  const exportRootCsv = () => {
    const firstHeader = rootLevel === 'hotels'
      ? t('dashboard_ui.im_table_hotel', 'Hotel')
      : t('dashboard_ui.im_table_department', 'Department');
    const headers = [
      firstHeader, t('dashboard_ui.im_table_cases', 'Cases'), t('dashboard_ui.im_table_completed', 'Completed'),
      t('dashboard_ui.im_table_not_completed', 'Not Completed'), t('dashboard_ui.im_table_high_critical', 'High/Critical'),
      t('dashboard_ui.im_table_closure_rate', 'Closure Rate'), durationLabel,
    ];
    const rows: CsvValue[][] = rootRows.map((row) => [
      rootLevel === 'hotels' ? hotelLabel(row.name) : row.name,
      row.cases, row.completed, row.not_completed, row.high_critical, `${row.closure_rate.toFixed(1)}%`, durationValue(row.avg_duration_hours),
    ]);
    const filename = rootLevel === 'hotels'
      ? `corp-im-hotel-summary-${chainCode.toLowerCase()}.csv`
      : `hotel-im-department-summary-${hotelFilter.toLowerCase()}.csv`;
    downloadCsvFile(filename, headers, rows);
  };

  const exportModalCsv = () => {
    if (!modalLevel || modalRows.length === 0) return;
    let headers: string[] = [];
    let rows: CsvValue[][] = [];
    if (modalLevel === 'departments' || modalLevel === 'categories') {
      headers = [
        modalLevel === 'departments' ? t('dashboard_ui.im_table_department', 'Department') : t('dashboard_ui.im_table_category', 'Category'),
        t('dashboard_ui.im_table_cases', 'Cases'), t('dashboard_ui.im_table_completed', 'Completed'),
        t('dashboard_ui.im_table_not_completed', 'Not Completed'), t('dashboard_ui.im_table_high_critical', 'High/Critical'),
        t('dashboard_ui.im_table_closure_rate', 'Closure Rate'), durationLabel,
      ];
      rows = (modalRows as SummaryRow[]).map((row) => [row.name, row.cases, row.completed, row.not_completed, row.high_critical, `${row.closure_rate.toFixed(1)}%`, durationValue(row.avg_duration_hours)]);
    } else if (modalLevel === 'incidents') {
      headers = [
        t('dashboard_ui.im_table_incident', 'Incident'), t('dashboard_ui.im_table_cases', 'Cases'),
        t('dashboard_ui.im_table_open', 'Open'), t('dashboard_ui.im_table_high_critical', 'High/Critical'),
        t('dashboard_ui.im_table_case_share', 'Case Share'), durationLabel,
      ];
      rows = (modalRows as IncidentRow[]).map((row) => [row.name, row.cases, row.open, row.high_critical, `${row.case_share.toFixed(1)}%`, durationValue(row.avg_duration_hours)]);
    } else {
      headers = [
        t('dashboard_ui.im_table_case_number', 'Case Number'), t('dashboard_ui.im_table_date_time', 'Date / Time'),
        t('dashboard_ui.im_table_room', 'Room'), t('dashboard_ui.im_table_guest', 'Guest'),
        t('dashboard_ui.im_table_status', 'Status'), t('dashboard_ui.im_table_severity', 'Severity'),
        t('dashboard_ui.im_table_complaint_source', 'Complaint Source'),
      ];
      rows = (modalRows as DetailRow[]).map((row) => [row.incident_case, formatDate(row.occurred_at), row.room_no, row.guest_name, row.status, row.severity, row.complaint_source]);
    }
    const scope = [chainCode, path?.hotel, path?.department, path?.category, path?.incident, modalLevel].filter(Boolean).map((part) => csvSlug(String(part))).join('-');
    downloadCsvFile(`im-${scope}.csv`, headers, rows);
  };

  const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={t('dashboard_ui.im_table_export_csv', 'Export table to CSV')} aria-label={t('dashboard_ui.im_table_export_csv', 'Export table to CSV')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><FileDown size={18} aria-hidden="true" /></button>
  );

  const SummaryTable = ({ rows, firstLabel, onDrill }: { rows: SummaryRow[]; firstLabel: string; onDrill: (name: string) => void }) => (
    <table className="min-w-[920px] w-full">
      <thead style={{ background: tokens.dashboard.tableHeadBg }}>
        <tr>
          {[firstLabel, t('dashboard_ui.im_table_cases', 'Cases'), t('dashboard_ui.im_table_completed', 'Completed'), t('dashboard_ui.im_table_not_completed', 'Not Completed'), t('dashboard_ui.im_table_high_critical', 'High/Critical'), t('dashboard_ui.im_table_closure_rate', 'Closure Rate'), durationLabel, t('dashboard_ui.im_table_action', 'Action')].map((label) => (
            <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="transition-colors" onMouseEnter={(e) => { e.currentTarget.style.background = tokens.accentTint; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
            <td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{firstLabel === t('dashboard_ui.im_table_hotel', 'Hotel') ? hotelLabel(row.name) : row.name}</td>
            <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.cases.toLocaleString()}</td>
            <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.completed.toLocaleString()}</td>
            <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.not_completed.toLocaleString()}</td>
            <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.high_critical.toLocaleString()}</td>
            <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.closure_rate.toFixed(1)}%</td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{durationValue(row.avg_duration_hours)}</td>
            <td className="px-3 py-2" style={tdStyle}>
              <button type="button" onClick={() => onDrill(row.name)} title={`${actionLabel}: ${row.name}`} aria-label={`${actionLabel}: ${row.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}>
                <CircleChevronRight size={17} aria-hidden="true" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const EmptyState = () => (
    <div className="p-8 text-center font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}>
      {error || t('dashboard_ui.im_table_no_data', 'No incident data found for this selection.')}
    </div>
  );

  return (
    <>
      <div className="overflow-hidden" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderLeft: `4px solid ${tokens.accent}`, borderRadius: '12px' }}>
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
          <div>
            <h4 className="font-serif font-semibold" style={{ color: tokens.text }}>{rootLevel === 'hotels' ? t('dashboard_ui.im_table_hotel_summary', 'Hotel Incident Summary') : t('dashboard_ui.im_table_department_summary', 'Department Summary')}</h4>
            <p className="mt-1 font-mono text-[0.62rem]" style={{ color: tokens.dashboard.tableMuted }}>
              {rootLevel === 'hotels' ? t('dashboard_ui.im_table_hierarchy', 'Hotel → Department → Category → Incident → Detail') : t('dashboard_ui.im_table_hotel_hierarchy', 'Department → Category → Incident → Detail')}
            </p>
          </div>
          <ExportButton onClick={exportRootCsv} disabled={rootLoading || rootRows.length === 0} />
        </div>
        <div className="overflow-x-auto">
          {rootLoading ? (
            <div className="p-8 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.im_table_loading', 'Loading table data…')}</div>
          ) : rootRows.length > 0 ? (
            <SummaryTable rows={rootRows} firstLabel={rootLevel === 'hotels' ? t('dashboard_ui.im_table_hotel', 'Hotel') : t('dashboard_ui.im_table_department', 'Department')} onDrill={openRootRow} />
          ) : <EmptyState />}
        </div>
      </div>

      {modalLevel && path && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 md:p-6 print-hidden" onMouseDown={(e) => { if (e.currentTarget === e.target) setModalLevel(null); }}>
          <div role="dialog" aria-modal="true" aria-label={modalTitle} className="w-full max-w-6xl max-h-[88vh] overflow-hidden shadow-2xl" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderRadius: '12px' }}>
            <div className="flex items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={back} className="inline-flex items-center gap-1 px-2 py-1 font-mono text-[0.65rem] hover:opacity-75" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55` }}><ArrowLeft size={13} /> {t('dashboard_ui.im_table_back', 'Back')}</button>
                  <h4 className="font-serif font-semibold" style={{ color: tokens.text }}>{modalTitle}</h4>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 font-mono" style={{ color: tokens.dashboard.tableMuted, fontSize: 'calc(0.62rem + 5px)' }}>
                  {breadcrumb.map((part, index) => {
                    const isActiveLevel = index === breadcrumb.length - 1;
                    return (
                      <span key={`${part}-${index}`} className={isActiveLevel ? 'font-bold' : undefined} style={isActiveLevel ? { color: tokens.text } : undefined}>
                        {index > 0 && <span className="mx-1">→</span>}{part}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ExportButton onClick={exportModalCsv} disabled={modalLoading || modalRows.length === 0} />
                <button type="button" onClick={() => setModalLevel(null)} aria-label={t('dashboard_ui.im_table_close', 'Close')} className="p-1.5 hover:opacity-70" style={{ color: tokens.textMuted }}><X size={18} /></button>
              </div>
            </div>

            <div className="max-h-[72vh] overflow-auto">
              {modalLoading ? (
                <div className="p-10 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.im_table_loading', 'Loading table data…')}</div>
              ) : modalRows.length === 0 ? <EmptyState /> : modalLevel === 'departments' || modalLevel === 'categories' ? (
                <SummaryTable rows={modalRows as SummaryRow[]} firstLabel={modalLevel === 'departments' ? t('dashboard_ui.im_table_department', 'Department') : t('dashboard_ui.im_table_category', 'Category')} onDrill={drill} />
              ) : modalLevel === 'incidents' ? (
                <table className="min-w-[860px] w-full">
                  <thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>
                    {[t('dashboard_ui.im_table_incident', 'Incident'), t('dashboard_ui.im_table_cases', 'Cases'), t('dashboard_ui.im_table_open', 'Open'), t('dashboard_ui.im_table_high_critical', 'High/Critical'), t('dashboard_ui.im_table_case_share', 'Case Share'), durationLabel, t('dashboard_ui.im_table_action', 'Action')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}
                  </tr></thead>
                  <tbody>{(modalRows as IncidentRow[]).map((row) => <tr key={row.name}>
                    <td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.cases.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.open.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.high_critical.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.case_share.toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{durationValue(row.avg_duration_hours)}</td>
                    <td className="px-3 py-2" style={tdStyle}><button type="button" onClick={() => drill(row.name)} title={`${actionLabel}: ${row.name}`} aria-label={`${actionLabel}: ${row.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><CircleChevronRight size={17} aria-hidden="true" /></button></td>
                  </tr>)}</tbody>
                </table>
              ) : (
                <table className="min-w-[980px] w-full">
                  <thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>
                    {[t('dashboard_ui.im_table_case_number', 'Case Number'), t('dashboard_ui.im_table_date_time', 'Date / Time'), t('dashboard_ui.im_table_room', 'Room'), t('dashboard_ui.im_table_guest', 'Guest'), t('dashboard_ui.im_table_status', 'Status'), t('dashboard_ui.im_table_severity', 'Severity'), t('dashboard_ui.im_table_complaint_source', 'Complaint Source')].map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>)}
                  </tr></thead>
                  <tbody>{(modalRows as DetailRow[]).map((row, index) => <tr key={`${row.incident_case}-${index}`}>
                    <td className="px-3 py-2 font-mono text-xs font-semibold" style={tdStyle}>{row.incident_case}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDate(row.occurred_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.room_no}</td>
                    <td className="px-3 py-2 text-xs" style={tdStyle}>{row.guest_name}</td>
                    <td className="px-3 py-2 text-xs" style={tdStyle}>{row.status}</td>
                    <td className="px-3 py-2 text-xs" style={tdStyle}>{row.severity}</td>
                    <td className="px-3 py-2 text-xs" style={tdStyle}>{row.complaint_source}</td>
                  </tr>)}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
