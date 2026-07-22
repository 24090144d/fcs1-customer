'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CircleCheck, CircleChevronRight, CircleX, FileDown, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { csvSlug, downloadCsvFile, type CsvValue } from '@/lib/download-csv';

type ModalLevel = 'cleaning_types' | 'stay_statuses' | 'inspectors' | 'attendants' | 'details';
type Hierarchy = 'stay-status' | 'inspector';

type HotelRow = {
  name: string;
  rooms_cleaned: number;
  cleaning_types: number;
  attendants: number;
  inspectors: number;
  credits: number;
  avg_time_minutes: number | null;
};

type CleaningTypeRow = {
  name: string;
  cleaning_records: number;
  share: number;
  attendants: number;
  inspectors: number;
  avg_time_minutes: number | null;
  credits: number;
};

type StayStatusRow = {
  name: string;
  rooms: number;
  share: number;
  attendants: number;
  inspectors: number;
  avg_time_minutes: number | null;
  credits: number;
  behind_target: number;
};

type InspectorRow = {
  name: string;
  rooms: number;
  share: number;
  attendants: number;
  avg_time_minutes: number | null;
  credits: number;
  behind_target: number;
};

type AttendantRow = {
  name: string;
  inspector: string;
  rooms: number;
  floors: number;
  inspectors: number;
  avg_time_minutes: number | null;
  cleaning_credits: number;
  credits_per_room: number | null;
  behind_target: number;
};

type DetailRow = {
  cleaning_order_no: string;
  room: string;
  floor: string;
  service_round: string;
  inspector: string;
  start_time: string | null;
  completed_time: string | null;
  time_spent_minutes: number | null;
  standard_minutes: number | null;
  variance_minutes: number | null;
  credit: number;
  flag: 'good' | 'watch' | 'bad';
};

type TableRow = HotelRow | CleaningTypeRow | StayStatusRow | InspectorRow | AttendantRow | DetailRow;
type TableResponse = { rows?: TableRow[]; timezone?: string; error?: string };

type DrillPath = {
  hotel: string;
  cleaningType?: string;
  stayStatus?: string;
  inspector?: string;
  attendant?: string;
};

type Props = {
  chainCode: string;
  hotelFilter: string;
  hotelNames: Record<string, string>;
  rootLevel?: 'hotels' | 'cleaning_types';
  hierarchy?: Hierarchy;
  filters: {
    dateFrom: string;
    dateTo: string;
    floor: string;
    attendant: string;
    roomType: string;
    status: string;
  };
  dark: boolean;
};

export function CorpCoDrilldownTable({ chainCode, hotelFilter, hotelNames, rootLevel = 'hotels', hierarchy = 'stay-status', filters, dark }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const [rootRows, setRootRows] = useState<TableRow[]>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalLevel, setModalLevel] = useState<ModalLevel | null>(null);
  const [path, setPath] = useState<DrillPath | null>(null);
  const [modalRows, setModalRows] = useState<TableRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [timezone, setTimezone] = useState('UTC');

  const queryUrl = useCallback((level: 'hotels' | ModalLevel, drillPath?: DrillPath) => {
    const query = new URLSearchParams({ level, chain: chainCode });
    const selectedHotel = drillPath?.hotel || (hotelFilter !== 'ALL' ? hotelFilter : '');
    if (selectedHotel) query.set('hotel', selectedHotel);
    if (drillPath?.cleaningType) query.set('cleaning_type', drillPath.cleaningType);
    if (drillPath?.stayStatus) query.set('stay_status', drillPath.stayStatus);
    if (drillPath?.inspector) query.set('inspector', drillPath.inspector);
    if (drillPath?.attendant) query.set('attendant', drillPath.attendant);
    if (filters.dateFrom) query.set('from', filters.dateFrom);
    if (filters.dateTo) query.set('to', filters.dateTo);
    if (filters.floor !== 'ALL') query.set('floor', filters.floor);
    if (filters.attendant !== 'ALL') query.set('filter_attendant', filters.attendant);
    if (filters.roomType !== 'ALL') query.set('room_type', filters.roomType);
    if (filters.status !== 'ALL') query.set('status_filter', filters.status);
    return `/api/dashboard/co-table?${query.toString()}`;
  }, [chainCode, hotelFilter, filters]);

  useEffect(() => {
    const controller = new AbortController();
    setRootLoading(true);
    setError('');
    fetch(queryUrl(rootLevel), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TableResponse;
        if (!response.ok) throw new Error(payload.error || 'Unable to load CO table data.');
        setRootRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load CO table data.');
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
        if (!response.ok) throw new Error(payload.error || 'Unable to load CO drilldown data.');
        setModalRows(payload.rows ?? []);
        if (payload.timezone) setTimezone(payload.timezone);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load CO drilldown data.');
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

  const beginTransition = () => {
    setModalRows([]);
    setModalLoading(true);
  };

  const openRootRow = (name: string) => {
    beginTransition();
    if (rootLevel === 'hotels') {
      setPath({ hotel: name });
      setModalLevel('cleaning_types');
    } else {
      setPath({ hotel: hotelFilter, cleaningType: name });
      setModalLevel(hierarchy === 'inspector' ? 'inspectors' : 'stay_statuses');
    }
  };

  const drill = (name: string) => {
    if (!path || !modalLevel) return;
    beginTransition();
    if (modalLevel === 'cleaning_types') {
      setPath({ ...path, cleaningType: name });
      setModalLevel(hierarchy === 'inspector' ? 'inspectors' : 'stay_statuses');
    } else if (modalLevel === 'stay_statuses') {
      setPath({ ...path, stayStatus: name });
      setModalLevel('attendants');
    } else if (modalLevel === 'inspectors') {
      setPath({ ...path, inspector: name });
      setModalLevel('attendants');
    } else if (modalLevel === 'attendants') {
      setPath({ ...path, attendant: name });
      setModalLevel('details');
    }
  };

  const back = () => {
    if (!modalLevel) return;
    beginTransition();
    if (modalLevel === 'details') setModalLevel('attendants');
    else if (modalLevel === 'attendants') setModalLevel(hierarchy === 'inspector' ? 'inspectors' : 'stay_statuses');
    else if (modalLevel === 'stay_statuses' || modalLevel === 'inspectors') {
      if (rootLevel === 'cleaning_types') setModalLevel(null);
      else setModalLevel('cleaning_types');
    } else setModalLevel(null);
  };

  const modalTitle = useMemo(() => {
    if (modalLevel === 'cleaning_types') return t('dashboard_ui.co_table_cleaning_type_summary', 'Cleaning Type Summary');
    if (modalLevel === 'stay_statuses') return t('dashboard_ui.co_table_stay_status_summary', 'Stay Status Summary');
    if (modalLevel === 'inspectors') return t('dashboard_ui.co_inspector_table_inspector_summary', 'Inspector Summary');
    if (modalLevel === 'attendants') return t('dashboard_ui.co_table_attendant_summary', 'Attendant Summary');
    return t('dashboard_ui.co_table_details', 'Cleaning Record Details');
  }, [modalLevel, t]);

  const breadcrumb = useMemo(() => {
    if (!path) return [];
    const middle = hierarchy === 'inspector' ? path.inspector : path.stayStatus;
    const parts = rootLevel === 'hotels'
      ? [hotelLabel(path.hotel), path.cleaningType, middle, path.attendant]
      : [path.cleaningType, middle, path.attendant];
    return parts.filter(Boolean) as string[];
  }, [path, hotelLabel, rootLevel, hierarchy]);

  const formatDateTime = (value: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date).replace(',', '');
  };
  const formatMinutes = (value: number | null) => value === null ? '—' : `${value.toFixed(1)} min`;
  const formatCount = (value: number) => Math.round(Number(value) || 0).toLocaleString();
  const formatCredit = (value: number | null, decimals = 1) => value === null ? '—' : Number(value || 0).toFixed(decimals);
  const formatVariance = (value: number | null) => {
    if (value === null) return '—';
    if (value < 0) return `${Math.abs(value).toFixed(1)} min ${t('dashboard_ui.co_table_ahead', 'ahead')}`;
    if (value > 0) return `${value.toFixed(1)} min ${t('dashboard_ui.co_table_behind', 'behind')}`;
    return t('dashboard_ui.co_table_on_time', 'On time');
  };
  const flagLabel = (flag: DetailRow['flag']) => flag === 'good'
    ? t('dashboard_ui.co_table_flag_good', 'Good')
    : flag === 'watch'
      ? t('dashboard_ui.co_table_flag_watch', 'Needs Improvement')
      : t('dashboard_ui.co_table_flag_bad', 'Bad');

  const actionLabel = t('dashboard_ui.co_table_drilldown', 'Drill down');
  const thStyle = { color: tokens.dashboard.tableHeadText, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const tdStyle = { color: tokens.text, borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };

  const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={t('dashboard_ui.co_table_export_csv', 'Export table to CSV')} aria-label={t('dashboard_ui.co_table_export_csv', 'Export table to CSV')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><FileDown size={18} aria-hidden="true" /></button>
  );

  const DrillButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} title={`${actionLabel}: ${name}`} aria-label={`${actionLabel}: ${name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55`, background: tokens.accentTint }}><CircleChevronRight size={17} aria-hidden="true" /></button>
  );

  const FlagIcon = ({ flag }: { flag: DetailRow['flag'] }) => {
    const label = flagLabel(flag);
    if (flag === 'good') return <span title={label} aria-label={label} className="inline-flex"><CircleCheck size={18} color="#15803d" aria-hidden="true" /></span>;
    if (flag === 'watch') return <span title={label} aria-label={label} className="inline-flex"><TriangleAlert size={18} color="#b45309" aria-hidden="true" /></span>;
    return <span title={label} aria-label={label} className="inline-flex"><CircleX size={18} color="#b91c1c" aria-hidden="true" /></span>;
  };

  const headerCells = (labels: string[]) => labels.map((label) => <th key={label} className="px-3 py-2 text-left font-mono uppercase" style={{ ...thStyle, fontSize: '0.62rem', letterSpacing: '0.06em' }}>{label}</th>);

  const HotelTable = ({ rows, root = false }: { rows: HotelRow[]; root?: boolean }) => (
    <table className="min-w-[1040px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{headerCells([
      t('dashboard_ui.co_table_hotel', 'Hotel'), t('dashboard_ui.co_table_rooms_cleaned', 'Rooms Cleaned'), t('dashboard_ui.co_table_cleaning_types', 'Cleaning Types'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_average_time', 'Average Time'), t('dashboard_ui.co_table_action', 'Action'),
    ])}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{hotelLabel(row.name)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.rooms_cleaned)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.cleaning_types)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.attendants)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.inspectors)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.credits)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.avg_time_minutes)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => root ? openRootRow(row.name) : drill(row.name)} /></td></tr>)}</tbody></table>
  );

  const CleaningTypeTable = ({ rows, root = false }: { rows: CleaningTypeRow[]; root?: boolean }) => (
    <table className="min-w-[1080px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{headerCells([
      t('dashboard_ui.co_table_cleaning_type', 'Cleaning Type'), t('dashboard_ui.co_table_cleaning_records', 'Cleaning Records'), t('dashboard_ui.co_table_share_pct', 'Share %'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_action', 'Action'),
    ])}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.cleaning_records)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.share.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.attendants)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.inspectors)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.avg_time_minutes)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.credits)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => root ? openRootRow(row.name) : drill(row.name)} /></td></tr>)}</tbody></table>
  );

  const StayStatusTable = ({ rows }: { rows: StayStatusRow[] }) => (
    <table className="min-w-[1180px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{headerCells([
      t('dashboard_ui.co_table_stay_status', 'Stay Status'), t('dashboard_ui.co_table_rooms', 'Rooms'), t('dashboard_ui.co_table_share', 'Share'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_behind_target', 'Behind Target'), t('dashboard_ui.co_table_action', 'Action'),
    ])}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.rooms)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.share.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.attendants)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.inspectors)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.avg_time_minutes)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.credits)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.behind_target)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drill(row.name)} /></td></tr>)}</tbody></table>
  );

  const InspectorTable = ({ rows }: { rows: InspectorRow[] }) => (
    <table className="min-w-[1120px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{headerCells([
      t('dashboard_ui.co_table_inspector', 'Inspector'), t('dashboard_ui.co_table_rooms', 'Rooms'), t('dashboard_ui.co_table_share', 'Share'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_behind_target', 'Behind Target'), t('dashboard_ui.co_table_action', 'Action'),
    ])}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.rooms)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{row.share.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.attendants)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.avg_time_minutes)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.credits)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.behind_target)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drill(row.name)} /></td></tr>)}</tbody></table>
  );

  const AttendantTable = ({ rows }: { rows: AttendantRow[] }) => (
    <table className="min-w-[1240px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{headerCells([
      t('dashboard_ui.co_table_attendant', 'Attendant'), hierarchy === 'inspector' ? t('dashboard_ui.co_table_inspector', 'Inspector') : t('dashboard_ui.co_table_rooms', 'Rooms'), hierarchy === 'inspector' ? t('dashboard_ui.co_table_rooms', 'Rooms') : t('dashboard_ui.co_table_floors', 'Floors'), hierarchy === 'inspector' ? t('dashboard_ui.co_table_floors', 'Floors') : t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_cleaning_credits', 'Cleaning Credits'), t('dashboard_ui.co_table_credits_per_room', 'Credits per Room'), t('dashboard_ui.co_table_behind_target', 'Behind Target'), t('dashboard_ui.co_table_action', 'Action'),
    ])}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="px-3 py-2 text-sm font-semibold" style={tdStyle}>{row.name}</td>{hierarchy === 'inspector' ? <><td className="px-3 py-2 text-xs" style={tdStyle}>{row.inspector}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.rooms)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.floors)}</td></> : <><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.rooms)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.floors)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.inspectors)}</td></>}<td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.avg_time_minutes)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.cleaning_credits)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.credits_per_room, 2)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCount(row.behind_target)}</td><td className="px-3 py-2" style={tdStyle}><DrillButton name={row.name} onClick={() => drill(row.name)} /></td></tr>)}</tbody></table>
  );

  const DetailTable = ({ rows }: { rows: DetailRow[] }) => (
    <table className={`${hierarchy === 'inspector' ? 'min-w-[1160px]' : 'min-w-[1240px]'} w-full`}><thead className="sticky top-0" style={{ background: tokens.dashboard.tableHeadBg }}><tr>{headerCells([
      t('dashboard_ui.co_table_room', 'Room'), t('dashboard_ui.co_table_floor', 'Floor'), ...(hierarchy === 'inspector' ? [] : [t('dashboard_ui.co_table_service_round', 'Service Round')]), t('dashboard_ui.co_table_inspector', 'Inspector'), t('dashboard_ui.co_table_start', 'Start'), t('dashboard_ui.co_table_complete', 'Complete'), t('dashboard_ui.co_table_time_spent', 'Time Spent'), t('dashboard_ui.co_table_standard', 'Standard'), t('dashboard_ui.co_table_ahead_behind', 'Ahead/Behind'), t('dashboard_ui.co_table_credit', 'Credit'), t('dashboard_ui.co_table_flags', 'Flags'),
    ])}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.cleaning_order_no}-${index}`}><td className="px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap" style={tdStyle}>{row.room}</td><td className="px-3 py-2 text-xs" style={tdStyle}>{row.floor}</td>{hierarchy === 'inspector' ? null : <td className="px-3 py-2 text-xs" style={tdStyle}>{row.service_round}</td>}<td className="px-3 py-2 text-xs" style={tdStyle}>{row.inspector}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDateTime(row.start_time)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatDateTime(row.completed_time)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.time_spent_minutes)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatMinutes(row.standard_minutes)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={tdStyle}>{formatVariance(row.variance_minutes)}</td><td className="px-3 py-2 font-mono text-xs" style={tdStyle}>{formatCredit(row.credit, 2)}</td><td className="px-3 py-2" style={tdStyle}><FlagIcon flag={row.flag} /></td></tr>)}</tbody></table>
  );

  const exportRootCsv = () => {
    if (rootLevel === 'hotels') {
      const headers = [t('dashboard_ui.co_table_hotel', 'Hotel'), t('dashboard_ui.co_table_rooms_cleaned', 'Rooms Cleaned'), t('dashboard_ui.co_table_cleaning_types', 'Cleaning Types'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_average_time', 'Average Time')];
      const rows = (rootRows as HotelRow[]).map((row): CsvValue[] => [hotelLabel(row.name), row.rooms_cleaned, row.cleaning_types, row.attendants, row.inspectors, row.credits, formatMinutes(row.avg_time_minutes)]);
      downloadCsvFile(`corp-co-${hierarchy === 'inspector' ? 'inspector-' : ''}hotel-summary-${chainCode.toLowerCase()}.csv`, headers, rows);
    } else {
      const headers = [t('dashboard_ui.co_table_cleaning_type', 'Cleaning Type'), t('dashboard_ui.co_table_cleaning_records', 'Cleaning Records'), t('dashboard_ui.co_table_share_pct', 'Share %'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits')];
      const rows = (rootRows as CleaningTypeRow[]).map((row): CsvValue[] => [row.name, row.cleaning_records, `${row.share.toFixed(1)}%`, row.attendants, row.inspectors, formatMinutes(row.avg_time_minutes), row.credits]);
      downloadCsvFile(`hotel-co-${hierarchy === 'inspector' ? 'inspector-' : ''}cleaning-type-summary-${hotelFilter.toLowerCase()}.csv`, headers, rows);
    }
  };

  const exportModalCsv = () => {
    if (!modalLevel || modalRows.length === 0) return;
    let headers: string[] = [];
    let rows: CsvValue[][] = [];
    if (modalLevel === 'cleaning_types') {
      headers = [t('dashboard_ui.co_table_cleaning_type', 'Cleaning Type'), t('dashboard_ui.co_table_cleaning_records', 'Cleaning Records'), t('dashboard_ui.co_table_share_pct', 'Share %'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits')];
      rows = (modalRows as CleaningTypeRow[]).map((row) => [row.name, row.cleaning_records, `${row.share.toFixed(1)}%`, row.attendants, row.inspectors, formatMinutes(row.avg_time_minutes), row.credits]);
    } else if (modalLevel === 'stay_statuses') {
      headers = [t('dashboard_ui.co_table_stay_status', 'Stay Status'), t('dashboard_ui.co_table_rooms', 'Rooms'), t('dashboard_ui.co_table_share', 'Share'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_behind_target', 'Behind Target')];
      rows = (modalRows as StayStatusRow[]).map((row) => [row.name, row.rooms, `${row.share.toFixed(1)}%`, row.attendants, row.inspectors, formatMinutes(row.avg_time_minutes), row.credits, row.behind_target]);
    } else if (modalLevel === 'inspectors') {
      headers = [t('dashboard_ui.co_table_inspector', 'Inspector'), t('dashboard_ui.co_table_rooms', 'Rooms'), t('dashboard_ui.co_table_share', 'Share'), t('dashboard_ui.co_table_attendants', 'Attendants'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_credits', 'Credits'), t('dashboard_ui.co_table_behind_target', 'Behind Target')];
      rows = (modalRows as InspectorRow[]).map((row) => [row.name, row.rooms, `${row.share.toFixed(1)}%`, row.attendants, formatMinutes(row.avg_time_minutes), row.credits, row.behind_target]);
    } else if (modalLevel === 'attendants') {
      headers = hierarchy === 'inspector'
        ? [t('dashboard_ui.co_table_attendant', 'Attendant'), t('dashboard_ui.co_table_inspector', 'Inspector'), t('dashboard_ui.co_table_rooms', 'Rooms'), t('dashboard_ui.co_table_floors', 'Floors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_cleaning_credits', 'Cleaning Credits'), t('dashboard_ui.co_table_credits_per_room', 'Credits per Room'), t('dashboard_ui.co_table_behind_target', 'Behind Target')]
        : [t('dashboard_ui.co_table_attendant', 'Attendant'), t('dashboard_ui.co_table_rooms', 'Rooms'), t('dashboard_ui.co_table_floors', 'Floors'), t('dashboard_ui.co_table_inspectors', 'Inspectors'), t('dashboard_ui.co_table_avg_time', 'Avg. Time'), t('dashboard_ui.co_table_cleaning_credits', 'Cleaning Credits'), t('dashboard_ui.co_table_credits_per_room', 'Credits per Room'), t('dashboard_ui.co_table_behind_target', 'Behind Target')];
      rows = (modalRows as AttendantRow[]).map((row) => hierarchy === 'inspector'
        ? [row.name, row.inspector, row.rooms, row.floors, formatMinutes(row.avg_time_minutes), row.cleaning_credits, row.credits_per_room, row.behind_target]
        : [row.name, row.rooms, row.floors, row.inspectors, formatMinutes(row.avg_time_minutes), row.cleaning_credits, row.credits_per_room, row.behind_target]);
    } else {
      headers = hierarchy === 'inspector'
        ? [t('dashboard_ui.co_table_room', 'Room'), t('dashboard_ui.co_table_floor', 'Floor'), t('dashboard_ui.co_table_inspector', 'Inspector'), t('dashboard_ui.co_table_start', 'Start'), t('dashboard_ui.co_table_complete', 'Complete'), t('dashboard_ui.co_table_time_spent', 'Time Spent'), t('dashboard_ui.co_table_standard', 'Standard'), t('dashboard_ui.co_table_ahead_behind', 'Ahead/Behind'), t('dashboard_ui.co_table_credit', 'Credit'), t('dashboard_ui.co_table_flags', 'Flags')]
        : [t('dashboard_ui.co_table_room', 'Room'), t('dashboard_ui.co_table_floor', 'Floor'), t('dashboard_ui.co_table_service_round', 'Service Round'), t('dashboard_ui.co_table_inspector', 'Inspector'), t('dashboard_ui.co_table_start', 'Start'), t('dashboard_ui.co_table_complete', 'Complete'), t('dashboard_ui.co_table_time_spent', 'Time Spent'), t('dashboard_ui.co_table_standard', 'Standard'), t('dashboard_ui.co_table_ahead_behind', 'Ahead/Behind'), t('dashboard_ui.co_table_credit', 'Credit'), t('dashboard_ui.co_table_flags', 'Flags')];
      rows = (modalRows as DetailRow[]).map((row) => hierarchy === 'inspector'
        ? [row.room, row.floor, row.inspector, formatDateTime(row.start_time), formatDateTime(row.completed_time), formatMinutes(row.time_spent_minutes), formatMinutes(row.standard_minutes), formatVariance(row.variance_minutes), row.credit, flagLabel(row.flag)]
        : [row.room, row.floor, row.service_round, row.inspector, formatDateTime(row.start_time), formatDateTime(row.completed_time), formatMinutes(row.time_spent_minutes), formatMinutes(row.standard_minutes), formatVariance(row.variance_minutes), row.credit, flagLabel(row.flag)]);
    }
    const scope = [chainCode, path?.hotel, path?.cleaningType, path?.stayStatus, path?.inspector, path?.attendant, modalLevel].filter(Boolean).map((part) => csvSlug(String(part))).join('-');
    downloadCsvFile(`co-${hierarchy === 'inspector' ? 'inspector-table-' : ''}${scope}.csv`, headers, rows);
  };

  const EmptyState = () => <div className="p-8 text-center font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}>{error || t('dashboard_ui.co_table_no_data', 'No cleaning data found for this selection.')}</div>;
  const renderRoot = () => rootLevel === 'hotels'
    ? <HotelTable rows={rootRows as HotelRow[]} root />
    : <CleaningTypeTable rows={rootRows as CleaningTypeRow[]} root />;

  return (
    <>
      <div className="overflow-hidden" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderLeft: `4px solid ${tokens.accent}`, borderRadius: '12px' }}>
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
          <div><h4 className="font-serif font-semibold" style={{ color: tokens.text }}>{hierarchy === 'inspector' ? (rootLevel === 'hotels' ? t('dashboard_ui.co_inspector_table_hotel_summary', 'Inspector Table · Hotel Summary') : t('dashboard_ui.co_inspector_table_cleaning_type_summary', 'Inspector Table · Cleaning Type Summary')) : (rootLevel === 'hotels' ? t('dashboard_ui.co_table_hotel_summary', 'Hotel Cleaning Summary') : t('dashboard_ui.co_table_cleaning_type_summary', 'Cleaning Type Summary'))}</h4><p className="mt-1 font-mono text-[0.62rem]" style={{ color: tokens.dashboard.tableMuted }}>{hierarchy === 'inspector' ? (rootLevel === 'hotels' ? t('dashboard_ui.co_inspector_table_hierarchy', 'Hotel → Cleaning Type → Inspector → Attendant → Detail') : t('dashboard_ui.co_inspector_table_hotel_hierarchy', 'Cleaning Type → Inspector → Attendant → Detail')) : (rootLevel === 'hotels' ? t('dashboard_ui.co_table_hierarchy', 'Hotel → Cleaning Type → Stay Status → Attendant → Detail') : t('dashboard_ui.co_table_hotel_hierarchy', 'Cleaning Type → Stay Status → Attendant → Detail'))}</p></div>
          <ExportButton onClick={exportRootCsv} disabled={rootLoading || rootRows.length === 0} />
        </div>
        <div className="overflow-x-auto">{rootLoading ? <div className="p-8 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.co_table_loading', 'Loading table data…')}</div> : rootRows.length > 0 ? renderRoot() : <EmptyState />}</div>
      </div>

      {modalLevel && path && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 md:p-6 print-hidden" onMouseDown={(event) => { if (event.currentTarget === event.target) setModalLevel(null); }}>
          <div role="dialog" aria-modal="true" aria-label={modalTitle} className="w-full max-w-7xl max-h-[88vh] overflow-hidden shadow-2xl" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderRadius: '12px' }}>
            <div className="flex items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>
              <div className="min-w-0"><div className="flex items-center gap-2"><button type="button" onClick={back} className="inline-flex items-center gap-1 px-2 py-1 font-mono text-[0.65rem] hover:opacity-75" style={{ color: tokens.accent, border: `1px solid ${tokens.accent}55` }}><ArrowLeft size={13} /> {t('dashboard_ui.co_table_back', 'Back')}</button><h4 className="font-serif font-semibold" style={{ color: tokens.text }}>{modalTitle}</h4></div><div className="mt-2 flex flex-wrap items-center gap-1 font-mono" style={{ color: tokens.dashboard.tableMuted, fontSize: 'calc(0.62rem + 5px)' }}>{breadcrumb.map((part, index) => { const active = index === breadcrumb.length - 1; return <span key={`${part}-${index}`} className={active ? 'font-bold' : undefined} style={active ? { color: tokens.text } : undefined}>{index > 0 && <span className="mx-1">→</span>}{part}</span>; })}</div></div>
              <div className="flex shrink-0 items-center gap-2"><ExportButton onClick={exportModalCsv} disabled={modalLoading || modalRows.length === 0} /><button type="button" onClick={() => setModalLevel(null)} aria-label={t('dashboard_ui.co_table_close', 'Close')} className="p-1.5 hover:opacity-70" style={{ color: tokens.textMuted }}><X size={18} /></button></div>
            </div>
            <div className="max-h-[72vh] overflow-auto">{modalLoading ? <div className="p-10 flex items-center justify-center gap-2 font-mono text-xs" style={{ color: tokens.dashboard.tableMuted }}><LoaderCircle size={16} className="animate-spin" /> {t('dashboard_ui.co_table_loading', 'Loading table data…')}</div> : modalRows.length === 0 ? <EmptyState /> : modalLevel === 'cleaning_types' ? <CleaningTypeTable rows={modalRows as CleaningTypeRow[]} /> : modalLevel === 'stay_statuses' ? <StayStatusTable rows={modalRows as StayStatusRow[]} /> : modalLevel === 'inspectors' ? <InspectorTable rows={modalRows as InspectorRow[]} /> : modalLevel === 'attendants' ? <AttendantTable rows={modalRows as AttendantRow[]} /> : <DetailTable rows={modalRows as DetailRow[]} />}</div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
