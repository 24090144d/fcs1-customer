'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CircleChevronRight, FileDown, X } from 'lucide-react';
import type { CoIrRow } from '@/types/csv';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { csvSlug, downloadCsvFile, type CsvValue } from '@/lib/download-csv';
import { TableCodeTitle } from '@/components/dashboard/TableCodeTitle';

type Selection = { hotel?: string; date?: string; status?: string; inspector?: string };
type Level = 'hotel' | 'date' | 'status' | 'inspector' | 'detail';
type Props = { rows: CoIrRow[]; isCorp: boolean; hotelNames: Record<string, string>; dark: boolean; timezone: string };

const countDistinct = (values: Array<string | null | undefined>) => new Set(values.filter(Boolean)).size;
const avg = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
const pct = (part: number, total: number) => total ? (part / total) * 100 : 0;
const shortDateTime = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value)).replace(',', '') : '—';

export function CoIrDrilldownTable({ rows, isCorp, hotelNames, dark, timezone }: Props) {
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const rootLevel: Level = 'date';
  const [level, setLevel] = useState<Level>(rootLevel);
  const [selection, setSelection] = useState<Selection>({});

  const scoped = useMemo(() => rows.filter((row) =>
    (!selection.hotel || row.hotel_code === selection.hotel)
    && (!selection.date || row.inspection_date === selection.date)
    && (!selection.status || row.room_status === selection.status)
    && (!selection.inspector || row.inspector === selection.inspector)
  ), [rows, selection]);

  const groups = useMemo(() => {
    if (level === 'detail') return [];
    const keyOf = (row: CoIrRow) => level === 'hotel' ? row.hotel_code ?? 'Unknown Hotel'
      : level === 'date' ? row.inspection_date ?? 'Unknown Date'
        : level === 'status' ? row.room_status
          : row.inspector;
    const map = new Map<string, CoIrRow[]>();
    for (const row of scoped) map.set(keyOf(row), [...(map.get(keyOf(row)) ?? []), row]);
    return Array.from(map.entries()).map(([name, values]) => {
      const passed = values.filter((row) => row.inspection_result === 'Pass').length;
      return {
        name, rows: values.length, rooms: countDistinct(values.map((row) => row.location)),
        inspectors: countDistinct(values.map((row) => row.inspector)), passRate: pct(passed, values.length),
        avgDuration: avg(values.map((row) => row.inspection_duration_minutes)),
        scoreCoverage: pct(values.filter((row) => row.inspection_score !== null).length, values.length),
        credits: values.reduce((sum, row) => sum + (row.inspection_credit ?? 0), 0),
      };
    }).sort((a, b) => level === 'date' ? a.name.localeCompare(b.name) : b.rows - a.rows || a.name.localeCompare(b.name));
  }, [level, scoped]);

  const details = useMemo(() => [...scoped].sort((a, b) =>
    String(a.inspection_date ?? '').localeCompare(String(b.inspection_date ?? ''))
    || String(a.start_time ?? '').localeCompare(String(b.start_time ?? ''))
    || a.location.localeCompare(b.location)
  ), [scoped]);

  const next = (name: string) => {
    if (level === 'date') { setSelection({ date: name }); setLevel(isCorp ? 'hotel' : 'status'); }
    else if (level === 'hotel') { setSelection((s) => ({ ...s, hotel: name })); setLevel('status'); }
    else if (level === 'status') { setSelection((s) => ({ ...s, status: name })); setLevel('inspector'); }
    else if (level === 'inspector') { setSelection((s) => ({ ...s, inspector: name })); setLevel('detail'); }
  };
  const back = () => {
    if (level === 'detail') { setSelection((s) => ({ ...s, inspector: undefined })); setLevel('inspector'); }
    else if (level === 'inspector') { setSelection((s) => ({ ...s, status: undefined })); setLevel('status'); }
    else if (level === 'status') {
      setSelection((s) => isCorp ? { date: s.date } : {});
      setLevel(isCorp ? 'hotel' : 'date');
    }
    else if (level === 'hotel') { setSelection({}); setLevel('date'); }
  };
  const close = () => { setSelection({}); setLevel(rootLevel); };
  const tableCode = isCorp ? 'ccoirt-01' : 'coirt-01';
  const rootTitle = `Inspector Table for ${isCorp ? 'Corp' : 'Hotel'}`;
  const modalTitle = level === 'hotel' ? 'Hotel Summary'
    : level === 'status' ? 'Room Status Summary'
      : level === 'inspector' ? 'Inspector Summary' : 'Inspection Detail';
  const path = [selection.date, selection.hotel && `${selection.hotel} · ${hotelNames[selection.hotel] ?? selection.hotel}`, selection.status, selection.inspector].filter(Boolean);

  const exportCsv = () => {
    if (level === 'detail') {
      downloadCsvFile(`co-ir-${csvSlug(path.join('-') || 'detail')}.csv`,
        ['Date', 'Room', 'Room Status', 'Inspector', 'Cleaned By', 'Start', 'Complete', 'Duration (min)', 'Duration Source', 'Result', 'Score', 'Credit'],
        details.map((row) => [row.inspection_date, row.location, row.room_status, row.inspector, row.cleaned_by, row.start_time, row.complete_time, row.inspection_duration_minutes, row.duration_source, row.inspection_result, row.inspection_score, row.inspection_credit] as CsvValue[]));
      return;
    }
    downloadCsvFile(`co-ir-${csvSlug(level === rootLevel ? rootTitle : modalTitle)}.csv`, ['Name', 'Inspections', 'Rooms', 'Inspectors', 'Pass Rate %', 'Average Duration', 'Score Coverage %', 'Credits'],
      groups.map((row) => [row.name, row.rows, row.rooms, row.inspectors, row.passRate, row.avgDuration, row.scoreCoverage, row.credits]));
  };

  const th = (label: string) => <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase tracking-wider whitespace-nowrap" style={{ color: tokens.dashboard.tableHeadText }}>{label}</th>;
  const td = { borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` };
  const content = (
    <div className="overflow-x-auto">
      <table className="min-w-[980px] w-full">
        <thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>
          {level === 'detail' ? <>{th('Date')}{th('Room')}{th('Room Status')}{th('Inspector')}{th('Cleaned By')}{th('Start')}{th('Complete')}{th('Duration')}{th('Source')}{th('Result')}{th('Score')}{th('Credit')}</>
            : <>{th(level === 'hotel' ? 'Hotel' : level === 'date' ? 'Date' : level === 'status' ? 'Room Status' : 'Inspector')}{th('Inspections')}{th('Rooms')}{th('Inspectors')}{th('Pass Rate')}{th('Avg. Duration')}{th('Score Coverage')}{th('Credits')}{th('Action')}</>}
        </tr></thead>
        <tbody>{level === 'detail' ? details.map((row, index) => <tr key={`${row.row_key}-${index}`}>
          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={td}>{row.inspection_date ?? '—'}</td><td className="px-3 py-2 text-xs" style={td}>{row.location}</td><td className="px-3 py-2 text-xs" style={td}>{row.room_status}</td><td className="px-3 py-2 text-xs" style={td}>{row.inspector}</td><td className="px-3 py-2 text-xs" style={td}>{row.cleaned_by ?? '—'}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={td}>{shortDateTime(row.start_time)}</td><td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={td}>{shortDateTime(row.complete_time)}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.inspection_duration_minutes?.toFixed(1) ?? '—'} min</td><td className="px-3 py-2 font-mono text-[0.65rem]" style={td}>{row.duration_source ?? '—'}</td><td className="px-3 py-2 text-xs" style={td}>{row.inspection_result}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.inspection_score?.toFixed(1) ?? '—'}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.inspection_credit?.toFixed(1) ?? '—'}</td>
        </tr>) : groups.map((row) => <tr key={row.name}>
          <td className="px-3 py-2 text-xs font-semibold" style={td}>{level === 'hotel' ? `${row.name} · ${hotelNames[row.name] ?? row.name}` : row.name}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.rows.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.rooms.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.inspectors.toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.passRate.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.avgDuration?.toFixed(1) ?? '—'} min</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.scoreCoverage.toFixed(1)}%</td><td className="px-3 py-2 font-mono text-xs" style={td}>{row.credits.toFixed(1)}</td><td className="px-3 py-2" style={td}><button type="button" onClick={() => next(row.name)} aria-label={`Drill down: ${row.name}`}><CircleChevronRight size={18} style={{ color: tokens.accent }} /></button></td>
        </tr>)}</tbody>
      </table>
    </div>
  );

  return <>
    <section className="rounded-xl overflow-hidden" style={{ border: `1px solid ${tokens.card.border}`, background: tokens.card.bg }}>
      <div className="flex items-center justify-between px-4 py-3"><div><TableCodeTitle code={tableCode} title={rootTitle} titleColor={tokens.dashboard.metaTitle} codeColor={tokens.accent} background={tokens.chart.codeBg} /><p className="font-mono text-[0.62rem]" style={{ color: tokens.dashboard.metaSub }}>{isCorp ? 'Date → Hotel → Room Status → Inspector → Detail' : 'Date → Room Status → Inspector → Detail'}</p></div><button type="button" onClick={exportCsv} aria-label="Export table to CSV"><FileDown size={17} style={{ color: tokens.accent }} /></button></div>
      {content}
    </section>
    {level !== rootLevel && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><div className="w-[min(96vw,1400px)] max-h-[88vh] overflow-hidden rounded-xl shadow-2xl" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}` }}><div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tokens.card.border}` }}><button type="button" onClick={back} aria-label="Back"><ArrowLeft size={18} /></button><div className="min-w-0 flex-1"><TableCodeTitle code={tableCode} title={modalTitle} titleColor={tokens.dashboard.metaTitle} codeColor={tokens.accent} background={tokens.chart.codeBg} /><p className="font-mono text-xs truncate" style={{ color: tokens.dashboard.metaSub }}>{path.map((part, index) => <span key={part} className={index === path.length - 1 ? 'font-bold' : ''}>{index ? ' → ' : ''}{part}</span>)}</p></div><button type="button" onClick={exportCsv} aria-label="Export table to CSV"><FileDown size={17} style={{ color: tokens.accent }} /></button><button type="button" onClick={close} aria-label="Close"><X size={19} /></button></div><div className="max-h-[calc(88vh-72px)] overflow-auto">{content}</div></div></div>, document.body)}
  </>;
}
