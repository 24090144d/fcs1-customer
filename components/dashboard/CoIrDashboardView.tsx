'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { CalendarDays } from 'lucide-react';
import Highcharts from 'highcharts';
import type { ChainEntry, ChartDef, DashboardJson } from '@/types/dashboard';
import type { CoIrRow } from '@/types/csv';
import { useTheme } from '@/components/layout/ThemeProvider';
import { useI18n } from '@/components/layout/I18nProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { localHour } from '@/lib/timezone';
import { CoIrDrilldownTable } from '@/components/dashboard/CoIrDrilldownTable';
import { defaultModuleConfig, loadModuleConfig, type ModuleConfig } from '@/lib/dash-config-defs';
import { applyMyDashFilter, type MyDashEmbed, type MyDashOverride } from '@/lib/my-dashboard-defs';

const HcChart = dynamic(() => import('@/components/dashboard/HcChart').then((module) => module.HcChart), { ssr: false });
type Props = {
  data: DashboardJson;
  rows: CoIrRow[];
  chainEntries: ChainEntry[];
  myDash?: MyDashOverride;
  myDashEmbed?: MyDashEmbed;
};
type KpiTone = 'good' | 'watch' | 'bad';
type Kpi = { id: string; label: string; value: number; unit: string; decimals?: number; note: string; formula: string; tone: KpiTone; statusDetail: string; benchmark: string[] };

const validNumbers = (values: Array<number | null>) => values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
const average = (values: Array<number | null>) => { const valid = validNumbers(values); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0; };
const percentile = (values: Array<number | null>, p: number) => { const valid = validNumbers(values).sort((a, b) => a - b); return valid.length ? valid[Math.floor((valid.length - 1) * p)] : 0; };
const percent = (part: number, total: number) => total ? (part / total) * 100 : 0;
const dateInput = (value: string | null | undefined) => value ? String(value).slice(0, 10) : '';
const localDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const QUICK_RANGES: Record<string, number> = { '1D': 1, '1W': 7, '2W': 14, '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1Y': 365 };
const kpiToneLabel = (tone: KpiTone) => tone === 'good' ? 'GOOD' : tone === 'watch' ? 'NEEDS IMPROVEMENT' : 'BAD';
const higherTone = (value: number, good: number, watch: number): KpiTone => value >= good ? 'good' : value >= watch ? 'watch' : 'bad';
const lowerTone = (value: number, good: number, watch: number): KpiTone => value <= good ? 'good' : value <= watch ? 'watch' : 'bad';
const kpiToneColors = (tone: KpiTone) => tone === 'good'
  ? { border: '#16a34a', badgeBg: 'rgba(22,163,74,0.12)', badgeText: '#16a34a' }
  : tone === 'watch'
    ? { border: '#d97706', badgeBg: 'rgba(217,119,6,0.12)', badgeText: '#d97706' }
    : { border: '#dc2626', badgeBg: 'rgba(220,38,38,0.12)', badgeText: '#dc2626' };
const chart = (id: string, title: string, note: string, formula: string, options: Record<string, unknown>, height = 330): ChartDef => ({ id, title, note, formula, options, filterable: true, height });

function SectionHead({ label, color, border }: { label: string; color: string; border: string }) {
  return <div className="flex items-center gap-3 mb-3"><span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] whitespace-nowrap" style={{ color }}>{label}</span><span className="flex-1" style={{ borderTop: `1px solid ${border}` }} /></div>;
}
function CoIrKpiCard({ kpi, dark }: { kpi: Kpi; dark: boolean }) {
  const { theme } = useTheme();
  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);
  const [open, setOpen] = useState(false);
  const palette = kpiToneColors(kpi.tone);
  return <div className="relative overflow-visible rounded-xl transition-all duration-150 print:break-inside-avoid" style={{ background: tokens.card.bg, border: `1px solid ${tokens.card.border}`, borderLeft: `4px solid ${palette.border}` }}>
    <div className="px-4 pb-3 pt-3.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="font-mono uppercase leading-tight" style={{ fontSize: '0.6rem', letterSpacing: '0.14em', color: tokens.card.label }}>{kpi.label}</div>
          <div className="inline-flex rounded-full px-2 py-0.5 font-mono" style={{ background: palette.badgeBg, color: palette.badgeText, fontSize: '0.56rem', letterSpacing: '0.12em' }}>{kpiToneLabel(kpi.tone)}</div>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={`Show ${kpi.label} details`} className="mt-0.5 shrink-0 transition-opacity hover:opacity-70" style={{ color: tokens.card.label }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1.2" /><text x="6" y="9.1" textAnchor="middle" fontSize="7.5" fontFamily="inherit" fill="currentColor">i</text></svg>
        </button>
      </div>
      <div className="flex items-baseline gap-1 leading-none"><span className="font-serif font-bold tabular-nums" style={{ fontSize: '1.72rem', color: tokens.card.value, lineHeight: 1 }}>{kpi.value.toLocaleString(undefined, { minimumFractionDigits: kpi.decimals ?? 0, maximumFractionDigits: kpi.decimals ?? 0 })}</span><span className="font-mono" style={{ fontSize: '0.68rem', color: tokens.card.sub }}>{kpi.unit}</span></div>
    </div>
    {open && <div className="absolute left-0 top-full z-30 mt-1 w-72 space-y-1.5 p-3 shadow-xl" style={{ background: tokens.card.tooltipBg, border: `1px solid ${tokens.card.tooltipBorder}`, borderLeft: `3px solid ${palette.border}`, color: tokens.card.tooltipText, borderRadius: '8px' }}>
      <p className="font-sans leading-relaxed" style={{ fontSize: '0.7rem' }}>{kpi.note}</p>
      <p className="font-sans leading-relaxed" style={{ fontSize: '0.7rem' }}>{kpi.statusDetail}</p>
      <div className="space-y-0.5 pt-1"><p className="font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: tokens.card.sub }}>Benchmark</p>{kpi.benchmark.map((line) => <p key={line} className="font-mono leading-relaxed" style={{ fontSize: '0.62rem', color: tokens.card.sub }}>{line}</p>)}</div>
      <p className="font-mono leading-relaxed" style={{ fontSize: '0.62rem', color: tokens.card.sub }}>Formula: {kpi.formula}</p>
    </div>}
  </div>;
}

type Translate = (key: string, fallback?: string) => string;

type CoIrPersonMetric = { name: string; credit: number; avgDuration: number; passRate: number };
const CO_IR_LEAF_COLORS = {
  credit: '#0F766E',
  passRate: '#9B2335',
  duration: '#C2410C',
} as const;

function coIrPersonDistBuckets(rows: CoIrRow[], personOf: (row: CoIrRow) => string): Array<{ name: string; total: number; people: Array<[string, CoIrRow[]]> }> {
  const people = new Map<string, CoIrRow[]>();
  for (const row of rows) {
    const person = personOf(row).trim();
    const name = person || 'Unknown';
    people.set(name, [...(people.get(name) ?? []), row]);
  }
  const totalPeople = people.size;
  const width = totalPeople > 500 ? 50 : totalPeople > 200 ? 20 : 10;
  const ranked = Array.from(people.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const buckets: Array<{ name: string; total: number; people: Array<[string, CoIrRow[]]> }> = [];
  const fullBucketCount = Math.floor(totalPeople / width);
  for (let index = 0; index < fullBucketCount; index++) {
    const start = index * width + 1;
    const end = (index + 1) * width;
    const bucketPeople = ranked.slice(index * width, (index + 1) * width);
    buckets.push({ name: `${start}-${end}`, total: bucketPeople.reduce((sum, [, values]) => sum + values.length, 0), people: bucketPeople });
  }
  if (totalPeople % width !== 0) {
    const start = fullBucketCount * width + 1;
    const bucketPeople = ranked.slice(fullBucketCount * width);
    buckets.push({ name: `${start}+`, total: bucketPeople.reduce((sum, [, values]) => sum + values.length, 0), people: bucketPeople });
  }
  return buckets;
}

function coIrPersonMetrics(people: Array<[string, CoIrRow[]]>): CoIrPersonMetric[] {
  return people.map(([name, values]) => {
    const credit = values.reduce((sum, row) => sum + (row.inspection_credit ?? 0), 0);
    const passed = values.filter((row) => ['pass', 'passed'].includes(row.inspection_result.trim().toLowerCase())).length;
    return {
      name,
      credit: Number(credit.toFixed(1)),
      avgDuration: Number(average(values.map((row) => row.inspection_duration_minutes)).toFixed(1)),
      passRate: Number(percent(passed, values.length).toFixed(1)),
    };
  });
}

function coIrComboDrilldownEvents(leafData: Record<string, CoIrPersonMetric[]>, personLabel: string, rootAxisTitle = 'Date') {
  return {
    drilldown: function (this: Highcharts.Chart, event: Highcharts.DrilldownEventObject) {
      const axisChart = this as Highcharts.Chart & { fcsAxisTitleStack?: string[] };
      const currentTitle = (this.xAxis[0] as unknown as { axisTitle?: { textStr?: string } } | undefined)?.axisTitle?.textStr ?? rootAxisTitle;
      axisChart.fcsAxisTitleStack = [...(axisChart.fcsAxisTitleStack ?? []), currentTitle];
      if (event.seriesOptions) {
        const axisTitle = (event.seriesOptions as Highcharts.SeriesOptionsType & { custom?: { xAxisTitle?: string } }).custom?.xAxisTitle;
        if (axisTitle && this.xAxis[0]) this.xAxis[0].setTitle({ text: axisTitle }, false);
        return;
      }
      const leafId = (event.point as unknown as { drilldown?: string }).drilldown;
      const metrics = leafId ? leafData[leafId] : undefined;
      if (!leafId || !metrics) return;
      const activeChart = this as unknown as Highcharts.Chart & {
        addSingleSeriesAsDrilldown: (point: Highcharts.Point, series: Highcharts.SeriesOptionsType) => void;
        applyDrilldown: () => void;
      };
      this.xAxis[0]?.update({ type: 'category', categories: metrics.map((metric) => metric.name), title: { text: personLabel } }, false);
      activeChart.addSingleSeriesAsDrilldown(event.point, {
        id: `${leafId}-credit`, type: 'column', name: 'Total Credit', color: CO_IR_LEAF_COLORS.credit,
        dataLabels: { enabled: true, format: '{point.y:.1f}' },
        data: metrics.map((metric) => ({ name: metric.name, y: metric.credit })),
      } as Highcharts.SeriesOptionsType);
      activeChart.addSingleSeriesAsDrilldown(event.point, {
        id: `${leafId}-pass`, type: 'column', name: 'Pass Rate (%)', color: CO_IR_LEAF_COLORS.passRate, yAxis: 1,
        dataLabels: { enabled: true, format: '{point.y:.1f}%' },
        data: metrics.map((metric) => ({ name: metric.name, y: metric.passRate })),
      } as Highcharts.SeriesOptionsType);
      activeChart.addSingleSeriesAsDrilldown(event.point, {
        id: `${leafId}-duration`, type: 'spline', name: 'Average Duration (min)', color: CO_IR_LEAF_COLORS.duration, yAxis: 1,
        lineWidth: 3, marker: { enabled: true, radius: 4 }, dataLabels: { enabled: true, format: '{point.y:.1f}' },
        data: metrics.map((metric) => ({ name: metric.name, y: metric.avgDuration })),
      } as Highcharts.SeriesOptionsType);
      activeChart.applyDrilldown();
    },
    drillup: function (this: Highcharts.Chart) {
      const axisChart = this as Highcharts.Chart & { fcsAxisTitleStack?: string[] };
      const titles = axisChart.fcsAxisTitleStack ?? [];
      const previousTitle = titles.pop() ?? rootAxisTitle;
      axisChart.fcsAxisTitleStack = titles;
      this.xAxis[0]?.setTitle({ text: previousTitle }, false);
    },
    drillupall: function (this: Highcharts.Chart) {
      const axisChart = this as Highcharts.Chart & { fcsAxisTitleStack?: string[] };
      axisChart.fcsAxisTitleStack = [];
      this.xAxis[0]?.setTitle({ text: rootAxisTitle }, false);
    },
  };
}

function buildCorpCoIrPersonDrilldown(
  rows: CoIrRow[],
  id: string,
  title: string,
  dimensionLabel: string,
  dimensionOf: (row: CoIrRow) => string,
  personLabel: string,
  personOf: (row: CoIrRow) => string,
  donut: boolean,
): ChartDef {
  const levelType = donut ? 'pie' : 'column';
  const level2: Highcharts.SeriesOptionsType[] = [];
  const level3: Highcharts.SeriesOptionsType[] = [];
  const level4: Highcharts.SeriesOptionsType[] = [];
  const leafData: Record<string, CoIrPersonMetric[]> = {};
  const dateMap = new Map<string, CoIrRow[]>();
  for (const row of rows) {
    const date = row.inspection_date?.trim() || 'Unknown Date';
    dateMap.set(date, [...(dateMap.get(date) ?? []), row]);
  }
  const dates = Array.from(dateMap.entries()).sort((a, b) => a[0] === 'Unknown Date' ? 1 : b[0] === 'Unknown Date' ? -1 : a[0].localeCompare(b[0]));
  const idPart = (value: string) => encodeURIComponent(value);
  const seriesShape = (name: string, color: string, data: Array<{ name: string; y: number; drilldown: string }>, axisTitle: string) => ({
    type: levelType,
    name,
    color,
    innerSize: donut ? '55%' : undefined,
    dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
    custom: { xAxisTitle: axisTitle },
    data,
  }) as Highcharts.SeriesOptionsType;

  for (const [date, dateRows] of dates) {
    const dateKey = idPart(date);
    const hotelMap = new Map<string, CoIrRow[]>();
    for (const row of dateRows) {
      const hotel = row.hotel_code?.trim() || 'Unknown Hotel';
      hotelMap.set(hotel, [...(hotelMap.get(hotel) ?? []), row]);
    }
    const hotels = Array.from(hotelMap.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    level2.push(seriesShape(
      `${date} · Hotel`,
      '#C2410C',
      hotels.map(([hotel, values]) => ({ name: hotel, y: values.length, drilldown: `${id}-hotel:${dateKey}:${idPart(hotel)}` })),
      'Hotel',
    ));
    (level2[level2.length - 1] as Highcharts.SeriesOptionsType & { id?: string }).id = `${id}-date:${dateKey}`;

    for (const [hotel, hotelRows] of hotels) {
      const hotelKey = idPart(hotel);
      const dimensions = new Map<string, CoIrRow[]>();
      for (const row of hotelRows) {
        const dimension = dimensionOf(row).trim() || 'Unknown';
        dimensions.set(dimension, [...(dimensions.get(dimension) ?? []), row]);
      }
      const dimensionEntries = Array.from(dimensions.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      level3.push(seriesShape(
        `${date} · ${hotel} · ${dimensionLabel}`,
        '#7C3AED',
        dimensionEntries.map(([dimension, values]) => ({ name: dimension, y: values.length, drilldown: `${id}-dist:${dateKey}:${hotelKey}:${idPart(dimension)}` })),
        dimensionLabel,
      ));
      (level3[level3.length - 1] as Highcharts.SeriesOptionsType & { id?: string }).id = `${id}-hotel:${dateKey}:${hotelKey}`;

      for (const [dimension, dimensionRows] of dimensionEntries) {
        const dimensionKey = idPart(dimension);
        const buckets = coIrPersonDistBuckets(dimensionRows, personOf);
        level4.push(seriesShape(
          `${date} · ${hotel} · ${dimension} · ${personLabel} Dist`,
          '#0891B2',
          buckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-leaf:${dateKey}:${hotelKey}:${dimensionKey}:${idPart(bucket.name)}` })),
          `${personLabel} Dist`,
        ));
        (level4[level4.length - 1] as Highcharts.SeriesOptionsType & { id?: string }).id = `${id}-dist:${dateKey}:${hotelKey}:${dimensionKey}`;

        for (const bucket of buckets) {
          const leafId = `${id}-leaf:${dateKey}:${hotelKey}:${dimensionKey}:${idPart(bucket.name)}`;
          leafData[leafId] = coIrPersonMetrics(bucket.people);
        }
      }
    }
  }

  const options: Highcharts.Options = {
    chart: {
      type: levelType,
      events: coIrComboDrilldownEvents(leafData, personLabel),
    },
    xAxis: { type: 'category', title: { text: 'Date' } },
    yAxis: [
      { min: 0, title: { text: 'Inspections / Total Credit' } },
      { min: 0, title: { text: 'Duration (min) / Pass Rate (%)' }, opposite: true },
    ],
    series: [{
      type: levelType,
      name: 'Inspections',
      colorByPoint: true,
      innerSize: donut ? '55%' : undefined,
      dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
      data: dates.map(([date, values]) => ({ name: date, y: values.length, drilldown: `${id}-date:${idPart(date)}` })),
    } as Highcharts.SeriesOptionsType],
    plotOptions: donut ? { pie: { dataLabels: { enabled: true } } } : { column: { dataLabels: { enabled: true } } },
    drilldown: { series: [...level2, ...level3, ...level4] },
    tooltip: { shared: true },
  };

  return chart(
    id,
    title,
    `Drill from date, hotel, and ${dimensionLabel.toLowerCase()} into ranked ${personLabel.toLowerCase()} ranges, then compare individual performance.`,
    `Inspection count by Date → Hotel → ${dimensionLabel} → ${personLabel} rank range; leaf = SUM(inspection_credit), AVG(inspection_duration_minutes), Pass / Total × 100`,
    options as Record<string, unknown>,
    420,
  );
}

type CoIrRowBucket = { name: string; rows: CoIrRow[] };

function coIrDateGroups(rows: CoIrRow[]): Array<[string, CoIrRow[]]> {
  const dates = new Map<string, CoIrRow[]>();
  for (const row of rows) {
    const date = row.inspection_date?.trim() || 'Unknown Date';
    dates.set(date, [...(dates.get(date) ?? []), row]);
  }
  return Array.from(dates.entries()).sort((a, b) => a[0] === 'Unknown Date' ? 1 : b[0] === 'Unknown Date' ? -1 : a[0].localeCompare(b[0]));
}

function coIrNamedBuckets(rows: CoIrRow[], order: string[], keyOf: (row: CoIrRow) => string): CoIrRowBucket[] {
  const buckets = new Map(order.map((name) => [name, [] as CoIrRow[]]));
  for (const row of rows) {
    const key = keyOf(row);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }
  return Array.from(buckets.entries()).filter(([, values]) => values.length > 0).map(([name, values]) => ({ name, rows: values }));
}

function coIrLocationDistBuckets(rows: CoIrRow[]): CoIrRowBucket[] {
  return coIrPersonDistBuckets(rows, (row) => row.location || 'Unknown Location')
    .map((bucket) => ({ name: bucket.name, rows: bucket.people.flatMap(([, values]) => values) }));
}

function coIrPassRateDistBuckets(rows: CoIrRow[]): CoIrRowBucket[] {
  const inspectors = new Map<string, CoIrRow[]>();
  for (const row of rows) {
    const inspector = row.inspector.trim() || 'Inspector';
    inspectors.set(inspector, [...(inspectors.get(inspector) ?? []), row]);
  }
  const order = ['<80%', '80-89%', '90-94%', '95-99%', '100%'];
  const buckets = new Map(order.map((name) => [name, [] as CoIrRow[]]));
  for (const values of inspectors.values()) {
    const passed = values.filter((row) => ['pass', 'passed'].includes(row.inspection_result.trim().toLowerCase())).length;
    const rate = percent(passed, values.length);
    const bucket = rate >= 100 ? '100%' : rate >= 95 ? '95-99%' : rate >= 90 ? '90-94%' : rate >= 80 ? '80-89%' : '<80%';
    buckets.get(bucket)!.push(...values);
  }
  return order.map((name) => ({ name, rows: buckets.get(name)! })).filter((bucket) => bucket.rows.length > 0);
}

function buildHotelCoIrDimensionPersonDrilldown(
  rows: CoIrRow[],
  id: string,
  title: string,
  dimensionLabel: string,
  dimensionOf: (row: CoIrRow) => string,
  personLabel: string,
  personOf: (row: CoIrRow) => string,
  donut: boolean,
  height = 420,
): ChartDef {
  const dates = coIrDateGroups(rows);
  const idPart = (value: string) => encodeURIComponent(value);
  const levelType = donut ? 'pie' : 'column';
  const level2: Highcharts.SeriesOptionsType[] = [];
  const level3: Highcharts.SeriesOptionsType[] = [];
  const leafData: Record<string, CoIrPersonMetric[]> = {};
  const series = (idValue: string, name: string, color: string, axisTitle: string, data: Array<{ name: string; y: number; drilldown: string }>) => ({
    id: idValue,
    type: levelType,
    name,
    color,
    colorByPoint: donut,
    innerSize: donut ? '55%' : undefined,
    custom: { xAxisTitle: axisTitle },
    dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
    data,
  }) as Highcharts.SeriesOptionsType;

  for (const [date, dateRows] of dates) {
    const dateKey = idPart(date);
    const dimensions = new Map<string, CoIrRow[]>();
    for (const row of dateRows) {
      const dimension = dimensionOf(row).trim() || 'Unknown';
      dimensions.set(dimension, [...(dimensions.get(dimension) ?? []), row]);
    }
    const dimensionEntries = Array.from(dimensions.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    level2.push(series(
      `${id}-date:${dateKey}`,
      `${date} · ${dimensionLabel}`,
      '#C2410C',
      dimensionLabel,
      dimensionEntries.map(([dimension, values]) => ({ name: dimension, y: values.length, drilldown: `${id}-person-dist:${dateKey}:${idPart(dimension)}` })),
    ));

    for (const [dimension, dimensionRows] of dimensionEntries) {
      const dimensionKey = idPart(dimension);
      const buckets = coIrPersonDistBuckets(dimensionRows, personOf);
      level3.push(series(
        `${id}-person-dist:${dateKey}:${dimensionKey}`,
        `${date} · ${dimension} · ${personLabel} Dist`,
        '#7C3AED',
        `${personLabel} Dist`,
        buckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-leaf:${dateKey}:${dimensionKey}:${idPart(bucket.name)}` })),
      ));
      for (const bucket of buckets) {
        leafData[`${id}-leaf:${dateKey}:${dimensionKey}:${idPart(bucket.name)}`] = coIrPersonMetrics(bucket.people);
      }
    }
  }

  const options: Highcharts.Options = {
    chart: { type: levelType, events: coIrComboDrilldownEvents(leafData, personLabel) },
    xAxis: { type: 'category', title: { text: 'Date' } },
    yAxis: [
      { min: 0, title: { text: 'Inspections / Total Credit' } },
      { min: 0, title: { text: 'Duration (min) / Pass Rate (%)' }, opposite: true },
    ],
    series: [{
      type: levelType,
      name: 'Inspections',
      colorByPoint: true,
      innerSize: donut ? '55%' : undefined,
      dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
      data: dates.map(([date, values]) => ({ name: date, y: values.length, drilldown: `${id}-date:${idPart(date)}` })),
    } as Highcharts.SeriesOptionsType],
    plotOptions: donut ? { pie: { dataLabels: { enabled: true } } } : { column: { dataLabels: { enabled: true } } },
    drilldown: { series: [...level2, ...level3] },
    tooltip: { shared: true },
  };
  return chart(
    id,
    title,
    `Drill from date and ${dimensionLabel.toLowerCase()} into ranked ${personLabel.toLowerCase()} ranges, then compare individual performance.`,
    `Inspection count by Date → ${dimensionLabel} → ${personLabel} rank range; leaf = SUM(inspection_credit), AVG(inspection_duration_minutes), Pass / Total × 100`,
    options as Record<string, unknown>,
    height,
  );
}

function buildCorpCoIrDateInspectorDrilldown(
  rows: CoIrRow[],
  id: string,
  title: string,
  dimensionLabel: string,
  dimensionBuckets: (dateRows: CoIrRow[]) => CoIrRowBucket[],
): ChartDef {
  const dates = coIrDateGroups(rows);
  const idPart = (value: string) => encodeURIComponent(value);
  const level2: Highcharts.SeriesOptionsType[] = [];
  const level3: Highcharts.SeriesOptionsType[] = [];
  const leafData: Record<string, CoIrPersonMetric[]> = {};
  const series = (idValue: string, name: string, color: string, axisTitle: string, data: Array<{ name: string; y: number; drilldown: string }>) => ({
    id: idValue, type: 'column', name, color, custom: { xAxisTitle: axisTitle },
    dataLabels: { enabled: true, format: '{point.y}' }, data,
  }) as Highcharts.SeriesOptionsType;

  for (const [date, dateRows] of dates) {
    const dateKey = idPart(date);
    const dimensions = dimensionBuckets(dateRows);
    level2.push(series(
      `${id}-date:${dateKey}`,
      `${date} · ${dimensionLabel}`,
      '#C2410C',
      dimensionLabel,
      dimensions.map((bucket) => ({ name: bucket.name, y: bucket.rows.length, drilldown: `${id}-inspector-dist:${dateKey}:${idPart(bucket.name)}` })),
    ));
    for (const dimension of dimensions) {
      const dimensionKey = idPart(dimension.name);
      const inspectorBuckets = coIrPersonDistBuckets(dimension.rows, (row) => row.inspector.trim() || 'Inspector');
      level3.push(series(
        `${id}-inspector-dist:${dateKey}:${dimensionKey}`,
        `${date} · ${dimension.name} · Inspector Dist`,
        '#7C3AED',
        'Inspector Dist',
        inspectorBuckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-leaf:${dateKey}:${dimensionKey}:${idPart(bucket.name)}` })),
      ));
      for (const bucket of inspectorBuckets) {
        leafData[`${id}-leaf:${dateKey}:${dimensionKey}:${idPart(bucket.name)}`] = coIrPersonMetrics(bucket.people);
      }
    }
  }

  const options: Highcharts.Options = {
    chart: { type: 'column', events: coIrComboDrilldownEvents(leafData, 'Inspector') },
    xAxis: { type: 'category', title: { text: 'Date' } },
    yAxis: [
      { min: 0, title: { text: 'Inspections / Total Credit' } },
      { min: 0, title: { text: 'Duration (min) / Pass Rate (%)' }, opposite: true },
    ],
    series: [{
      type: 'column', name: 'Inspections', colorByPoint: true,
      dataLabels: { enabled: true, format: '{point.y}' },
      data: dates.map(([date, values]) => ({ name: date, y: values.length, drilldown: `${id}-date:${idPart(date)}` })),
    } as Highcharts.SeriesOptionsType],
    plotOptions: { column: { dataLabels: { enabled: true } } },
    drilldown: { series: [...level2, ...level3] },
    tooltip: { shared: true },
  };
  return chart(
    id,
    title,
    `Drill from date and ${dimensionLabel.toLowerCase()} into ranked inspector ranges, then compare inspector performance.`,
    `Inspection count by Date → ${dimensionLabel} → Inspector rank range; leaf = SUM(inspection_credit), AVG(inspection_duration_minutes), Pass / Total × 100`,
    options as Record<string, unknown>,
    420,
  );
}

function buildHotelCoIrCleanedByInspectorDrilldown(rows: CoIrRow[], title: string): ChartDef {
  const id = 'coir-10';
  const dates = coIrDateGroups(rows);
  const idPart = (value: string) => encodeURIComponent(value);
  const level2: Highcharts.SeriesOptionsType[] = [];
  const level3: Highcharts.SeriesOptionsType[] = [];
  const level4: Highcharts.SeriesOptionsType[] = [];
  const leafData: Record<string, CoIrPersonMetric[]> = {};
  const series = (idValue: string, name: string, color: string, axisTitle: string, data: Array<{ name: string; y: number; drilldown: string }>) => ({
    id: idValue, type: 'column', name, color, custom: { xAxisTitle: axisTitle },
    dataLabels: { enabled: true, format: '{point.y}' }, data,
  }) as Highcharts.SeriesOptionsType;

  for (const [date, dateRows] of dates) {
    const dateKey = idPart(date);
    const cleanerBuckets = coIrPersonDistBuckets(dateRows, (row) => row.cleaned_by?.trim() || 'Unknown Cleaner');
    level2.push(series(
      `${id}-date:${dateKey}`, `${date} · Cleaned By Dist`, '#C2410C', 'Cleaned By Dist',
      cleanerBuckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-cleaner:${dateKey}:${idPart(bucket.name)}` })),
    ));
    for (const cleanerBucket of cleanerBuckets) {
      const cleanerBucketKey = idPart(cleanerBucket.name);
      level3.push(series(
        `${id}-cleaner:${dateKey}:${cleanerBucketKey}`, `${date} · ${cleanerBucket.name} · Cleaned By`, '#7C3AED', 'Cleaned By',
        cleanerBucket.people.map(([cleaner, values]) => ({ name: cleaner, y: values.length, drilldown: `${id}-inspector-dist:${dateKey}:${cleanerBucketKey}:${idPart(cleaner)}` })),
      ));
      for (const [cleaner, cleanerRows] of cleanerBucket.people) {
        const cleanerKey = idPart(cleaner);
        const inspectorBuckets = coIrPersonDistBuckets(cleanerRows, (row) => row.inspector.trim() || 'Inspector');
        level4.push(series(
          `${id}-inspector-dist:${dateKey}:${cleanerBucketKey}:${cleanerKey}`, `${date} · ${cleaner} · Inspector Dist`, '#0891B2', 'Inspector Dist',
          inspectorBuckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-leaf:${dateKey}:${cleanerBucketKey}:${cleanerKey}:${idPart(bucket.name)}` })),
        ));
        for (const inspectorBucket of inspectorBuckets) {
          leafData[`${id}-leaf:${dateKey}:${cleanerBucketKey}:${cleanerKey}:${idPart(inspectorBucket.name)}`] = coIrPersonMetrics(inspectorBucket.people);
        }
      }
    }
  }

  const options: Highcharts.Options = {
    chart: { type: 'column', events: coIrComboDrilldownEvents(leafData, 'Inspector') },
    xAxis: { type: 'category', title: { text: 'Date' } },
    yAxis: [
      { min: 0, title: { text: 'Inspections / Total Credit' } },
      { min: 0, title: { text: 'Duration (min) / Pass Rate (%)' }, opposite: true },
    ],
    series: [{
      type: 'column', name: 'Inspections', colorByPoint: true,
      dataLabels: { enabled: true, format: '{point.y}' },
      data: dates.map(([date, values]) => ({ name: date, y: values.length, drilldown: `${id}-date:${idPart(date)}` })),
    } as Highcharts.SeriesOptionsType],
    plotOptions: { column: { dataLabels: { enabled: true } } },
    drilldown: { series: [...level2, ...level3, ...level4] },
    tooltip: { shared: true },
  };
  return chart(
    id,
    title,
    'Drill from date into ranked cleaners, each cleaner, ranked inspectors, and individual inspector performance.',
    'Inspection count by Date → Cleaned By rank range → Cleaned By → Inspector rank range; leaf = SUM(inspection_credit), AVG(inspection_duration_minutes), Pass / Total × 100',
    options as Record<string, unknown>,
    420,
  );
}

function buildCorpCoIrDateHotelInspectorDrilldown(
  rows: CoIrRow[],
  id: string,
  title: string,
  dimensionLabel: string,
  dimensionBuckets: (hotelRows: CoIrRow[]) => CoIrRowBucket[],
): ChartDef {
  const dates = coIrDateGroups(rows);
  const idPart = (value: string) => encodeURIComponent(value);
  const level2: Highcharts.SeriesOptionsType[] = [];
  const level3: Highcharts.SeriesOptionsType[] = [];
  const level4: Highcharts.SeriesOptionsType[] = [];
  const leafData: Record<string, CoIrPersonMetric[]> = {};
  const series = (idValue: string, name: string, color: string, axisTitle: string, data: Array<{ name: string; y: number; drilldown: string }>) => ({
    id: idValue, type: 'column', name, color, custom: { xAxisTitle: axisTitle },
    dataLabels: { enabled: true, format: '{point.y}' }, data,
  }) as Highcharts.SeriesOptionsType;

  for (const [date, dateRows] of dates) {
    const dateKey = idPart(date);
    const hotels = new Map<string, CoIrRow[]>();
    for (const row of dateRows) {
      const hotel = row.hotel_code?.trim() || 'Unknown Hotel';
      hotels.set(hotel, [...(hotels.get(hotel) ?? []), row]);
    }
    const hotelEntries = Array.from(hotels.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    level2.push(series(
      `${id}-date:${dateKey}`,
      `${date} · Hotel`,
      '#C2410C',
      'Hotel',
      hotelEntries.map(([hotel, values]) => ({ name: hotel, y: values.length, drilldown: `${id}-hotel:${dateKey}:${idPart(hotel)}` })),
    ));

    for (const [hotel, hotelRows] of hotelEntries) {
      const hotelKey = idPart(hotel);
      const dimensions = dimensionBuckets(hotelRows);
      level3.push(series(
        `${id}-hotel:${dateKey}:${hotelKey}`,
        `${date} · ${hotel} · ${dimensionLabel}`,
        '#7C3AED',
        dimensionLabel,
        dimensions.map((bucket) => ({ name: bucket.name, y: bucket.rows.length, drilldown: `${id}-inspector-dist:${dateKey}:${hotelKey}:${idPart(bucket.name)}` })),
      ));
      for (const dimension of dimensions) {
        const dimensionKey = idPart(dimension.name);
        const inspectorBuckets = coIrPersonDistBuckets(dimension.rows, (row) => row.inspector.trim() || 'Inspector');
        level4.push(series(
          `${id}-inspector-dist:${dateKey}:${hotelKey}:${dimensionKey}`,
          `${date} · ${hotel} · ${dimension.name} · Inspector Dist`,
          '#0891B2',
          'Inspector Dist',
          inspectorBuckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-leaf:${dateKey}:${hotelKey}:${dimensionKey}:${idPart(bucket.name)}` })),
        ));
        for (const bucket of inspectorBuckets) {
          leafData[`${id}-leaf:${dateKey}:${hotelKey}:${dimensionKey}:${idPart(bucket.name)}`] = coIrPersonMetrics(bucket.people);
        }
      }
    }
  }

  const options: Highcharts.Options = {
    chart: { type: 'column', events: coIrComboDrilldownEvents(leafData, 'Inspector') },
    xAxis: { type: 'category', title: { text: 'Date' } },
    yAxis: [
      { min: 0, title: { text: 'Inspections / Total Credit' } },
      { min: 0, title: { text: 'Duration (min) / Pass Rate (%)' }, opposite: true },
    ],
    series: [{
      type: 'column', name: 'Inspections', colorByPoint: true,
      dataLabels: { enabled: true, format: '{point.y}' },
      data: dates.map(([date, values]) => ({ name: date, y: values.length, drilldown: `${id}-date:${idPart(date)}` })),
    } as Highcharts.SeriesOptionsType],
    plotOptions: { column: { dataLabels: { enabled: true } } },
    drilldown: { series: [...level2, ...level3, ...level4] },
    tooltip: { shared: true },
  };
  return chart(
    id,
    title,
    `Drill from date and hotel through ${dimensionLabel.toLowerCase()} and ranked inspector ranges, then compare inspector performance.`,
    `Inspection count by Date → Hotel → ${dimensionLabel} → Inspector rank range; leaf = SUM(inspection_credit), AVG(inspection_duration_minutes), Pass / Total × 100`,
    options as Record<string, unknown>,
    420,
  );
}

function buildCorpCoIrCleanedByInspectorDrilldown(rows: CoIrRow[], title: string): ChartDef {
  const id = 'coir-10';
  const dates = coIrDateGroups(rows);
  const idPart = (value: string) => encodeURIComponent(value);
  const level2: Highcharts.SeriesOptionsType[] = [];
  const level3: Highcharts.SeriesOptionsType[] = [];
  const level4: Highcharts.SeriesOptionsType[] = [];
  const level5: Highcharts.SeriesOptionsType[] = [];
  const leafData: Record<string, CoIrPersonMetric[]> = {};
  const series = (idValue: string, name: string, color: string, axisTitle: string, data: Array<{ name: string; y: number; drilldown: string }>) => ({
    id: idValue, type: 'column', name, color, custom: { xAxisTitle: axisTitle },
    dataLabels: { enabled: true, format: '{point.y}' }, data,
  }) as Highcharts.SeriesOptionsType;

  for (const [date, dateRows] of dates) {
    const dateKey = idPart(date);
    const hotels = new Map<string, CoIrRow[]>();
    for (const row of dateRows) {
      const hotel = row.hotel_code?.trim() || 'Unknown Hotel';
      hotels.set(hotel, [...(hotels.get(hotel) ?? []), row]);
    }
    const hotelEntries = Array.from(hotels.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    level2.push(series(
      `${id}-date:${dateKey}`, `${date} · Hotel`, '#C2410C', 'Hotel',
      hotelEntries.map(([hotel, values]) => ({ name: hotel, y: values.length, drilldown: `${id}-hotel:${dateKey}:${idPart(hotel)}` })),
    ));
    for (const [hotel, hotelRows] of hotelEntries) {
      const hotelKey = idPart(hotel);
      const cleanerBuckets = coIrPersonDistBuckets(hotelRows, (row) => row.cleaned_by?.trim() || 'Unknown Cleaner');
      level3.push(series(
        `${id}-hotel:${dateKey}:${hotelKey}`, `${date} · ${hotel} · Cleaned By Dist`, '#7C3AED', 'Cleaned By Dist',
        cleanerBuckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-cleaner:${dateKey}:${hotelKey}:${idPart(bucket.name)}` })),
      ));
      for (const cleanerBucket of cleanerBuckets) {
        const cleanerBucketKey = idPart(cleanerBucket.name);
        level4.push(series(
          `${id}-cleaner:${dateKey}:${hotelKey}:${cleanerBucketKey}`, `${date} · ${hotel} · ${cleanerBucket.name} · Cleaned By`, '#0891B2', 'Cleaned By',
          cleanerBucket.people.map(([cleaner, values]) => ({ name: cleaner, y: values.length, drilldown: `${id}-inspector-dist:${dateKey}:${hotelKey}:${cleanerBucketKey}:${idPart(cleaner)}` })),
        ));
        for (const [cleaner, cleanerRows] of cleanerBucket.people) {
          const cleanerKey = idPart(cleaner);
          const inspectorBuckets = coIrPersonDistBuckets(cleanerRows, (row) => row.inspector.trim() || 'Inspector');
          level5.push(series(
            `${id}-inspector-dist:${dateKey}:${hotelKey}:${cleanerBucketKey}:${cleanerKey}`, `${date} · ${hotel} · ${cleaner} · Inspector Dist`, '#0F766E', 'Inspector Dist',
            inspectorBuckets.map((bucket) => ({ name: bucket.name, y: bucket.total, drilldown: `${id}-leaf:${dateKey}:${hotelKey}:${cleanerBucketKey}:${cleanerKey}:${idPart(bucket.name)}` })),
          ));
          for (const inspectorBucket of inspectorBuckets) {
            leafData[`${id}-leaf:${dateKey}:${hotelKey}:${cleanerBucketKey}:${cleanerKey}:${idPart(inspectorBucket.name)}`] = coIrPersonMetrics(inspectorBucket.people);
          }
        }
      }
    }
  }

  const options: Highcharts.Options = {
    chart: { type: 'column', events: coIrComboDrilldownEvents(leafData, 'Inspector') },
    xAxis: { type: 'category', title: { text: 'Date' } },
    yAxis: [
      { min: 0, title: { text: 'Inspections / Total Credit' } },
      { min: 0, title: { text: 'Duration (min) / Pass Rate (%)' }, opposite: true },
    ],
    series: [{
      type: 'column', name: 'Inspections', colorByPoint: true,
      dataLabels: { enabled: true, format: '{point.y}' },
      data: dates.map(([date, values]) => ({ name: date, y: values.length, drilldown: `${id}-date:${idPart(date)}` })),
    } as Highcharts.SeriesOptionsType],
    plotOptions: { column: { dataLabels: { enabled: true } } },
    drilldown: { series: [...level2, ...level3, ...level4, ...level5] },
    tooltip: { shared: true },
  };
  return chart(
    id,
    title,
    'Drill from date and hotel into ranked cleaners, each cleaner, ranked inspectors, and individual inspector performance.',
    'Inspection count by Date → Hotel → Cleaned By rank range → Cleaned By → Inspector rank range; leaf = SUM(inspection_credit), AVG(inspection_duration_minutes), Pass / Total × 100',
    options as Record<string, unknown>,
    420,
  );
}

function buildCorpCoIrCharts(rows: CoIrRow[], t: Translate, timezone: string): ChartDef[] {
  const scoreOrder = ['<70', '70-79', '80-89', '90-94', '95-99', '100', 'Missing'];
  const durationOrder = ['<1m', '1-3m', '3-5m', '5-10m', '10-15m', '15-30m', '30m+', 'Missing'];
  return [
    buildCorpCoIrPersonDrilldown(rows, 'coir-01', t('co_ir.chart_01', 'Room Status → Inspector'), 'Room Status', (row) => row.room_status, 'Inspector', (row) => row.inspector.trim() || 'Inspector', true),
    buildCorpCoIrPersonDrilldown(rows, 'coir-02', t('co_ir.chart_02', 'Inspection Status → Inspector'), 'Inspection Status', (row) => row.inspection_result, 'Inspector', (row) => row.inspector.trim() || 'Inspector', true),
    buildCorpCoIrPersonDrilldown(rows, 'coir-03', t('co_ir.chart_03', 'Room Status → Cleaned By'), 'Room Status', (row) => row.room_status, 'Cleaned By', (row) => row.cleaned_by ?? 'Unknown Cleaner', false),
    buildCorpCoIrPersonDrilldown(rows, 'coir-04', t('co_ir.chart_04', 'Inspection Status → Cleaned By'), 'Inspection Status', (row) => row.inspection_result, 'Cleaned By', (row) => row.cleaned_by ?? 'Unknown Cleaner', false),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-05', t('co_ir.chart_05', 'Score Dist → Inspector'), 'Inspection Score Dist', (dateRows) => coIrNamedBuckets(dateRows, scoreOrder, (row) => {
      const score = row.inspection_score;
      return score === null ? 'Missing' : score < 70 ? '<70' : score < 80 ? '70-79' : score < 90 ? '80-89' : score < 95 ? '90-94' : score < 100 ? '95-99' : '100';
    })),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-06', t('co_ir.chart_06', 'Pass Rate Dist → Inspector'), 'Inspection Pass Rate Dist', coIrPassRateDistBuckets),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-07', t('co_ir.chart_07', '24 Hour Dist → Inspector'), '24 Hour Dist', (dateRows) => coIrNamedBuckets(dateRows, [...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`), 'Unknown Hour'], (row) => {
      const source = row.start_time ?? row.complete_time;
      if (!source) return 'Unknown Hour';
      const date = new Date(source);
      return Number.isNaN(date.getTime()) ? 'Unknown Hour' : `${String(localHour(date, timezone)).padStart(2, '0')}:00`;
    })),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-08', t('co_ir.chart_08', 'Duration Dist → Inspector'), 'Inspection Duration Dist', (dateRows) => coIrNamedBuckets(dateRows, durationOrder, (row) => {
      const duration = row.inspection_duration_minutes;
      return duration === null ? 'Missing' : duration < 1 ? '<1m' : duration < 3 ? '1-3m' : duration < 5 ? '3-5m' : duration < 10 ? '5-10m' : duration < 15 ? '10-15m' : duration < 30 ? '15-30m' : '30m+';
    })),
    buildCorpCoIrDateHotelInspectorDrilldown(rows, 'coir-09', t('co_ir.chart_09', 'Location Dist → Inspector'), 'Location Dist', coIrLocationDistBuckets),
    buildCorpCoIrCleanedByInspectorDrilldown(rows, t('co_ir.chart_10', 'Cleaned By → Inspector')),
  ];
}

function buildHotelCoIrCharts(rows: CoIrRow[], t: Translate, timezone: string): ChartDef[] {
  const scoreOrder = ['<70', '70-79', '80-89', '90-94', '95-99', '100', 'Missing'];
  const durationOrder = ['<1m', '1-3m', '3-5m', '5-10m', '10-15m', '15-30m', '30m+', 'Missing'];
  return [
    buildHotelCoIrDimensionPersonDrilldown(rows, 'coir-01', t('co_ir.chart_01', 'Room Status → Inspector'), 'Room Status', (row) => row.room_status, 'Inspector', (row) => row.inspector.trim() || 'Inspector', true),
    buildHotelCoIrDimensionPersonDrilldown(rows, 'coir-02', t('co_ir.chart_02', 'Inspection Status → Inspector'), 'Inspection Status', (row) => row.inspection_result, 'Inspector', (row) => row.inspector.trim() || 'Inspector', true),
    buildHotelCoIrDimensionPersonDrilldown(rows, 'coir-03', t('co_ir.chart_03', 'Room Status → Cleaned By'), 'Room Status', (row) => row.room_status, 'Cleaned By', (row) => row.cleaned_by?.trim() || 'Unknown Cleaner', false),
    buildHotelCoIrDimensionPersonDrilldown(rows, 'coir-04', t('co_ir.chart_04', 'Inspection Status → Cleaned By'), 'Inspection Status', (row) => row.inspection_result, 'Cleaned By', (row) => row.cleaned_by?.trim() || 'Unknown Cleaner', false),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-05', t('co_ir.chart_05', 'Score Dist → Inspector'), 'Inspection Score Dist', (dateRows) => coIrNamedBuckets(dateRows, scoreOrder, (row) => {
      const score = row.inspection_score;
      return score === null ? 'Missing' : score < 70 ? '<70' : score < 80 ? '70-79' : score < 90 ? '80-89' : score < 95 ? '90-94' : score < 100 ? '95-99' : '100';
    })),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-06', t('co_ir.chart_06', 'Pass Rate Dist → Inspector'), 'Inspection Pass Rate Dist', coIrPassRateDistBuckets),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-07', t('co_ir.chart_07', '24 Hour Dist → Inspector'), '24 Hour Dist', (dateRows) => coIrNamedBuckets(dateRows, [...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`), 'Unknown Hour'], (row) => {
      const source = row.start_time ?? row.complete_time;
      if (!source) return 'Unknown Hour';
      const date = new Date(source);
      return Number.isNaN(date.getTime()) ? 'Unknown Hour' : `${String(localHour(date, timezone)).padStart(2, '0')}:00`;
    })),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-08', t('co_ir.chart_08', 'Duration Dist → Inspector'), 'Inspection Duration Dist', (dateRows) => coIrNamedBuckets(dateRows, durationOrder, (row) => {
      const duration = row.inspection_duration_minutes;
      return duration === null ? 'Missing' : duration < 1 ? '<1m' : duration < 3 ? '1-3m' : duration < 5 ? '3-5m' : duration < 10 ? '5-10m' : duration < 15 ? '10-15m' : duration < 30 ? '15-30m' : '30m+';
    })),
    buildCorpCoIrDateInspectorDrilldown(rows, 'coir-09', t('co_ir.chart_09', 'Location Dist → Inspector'), 'Location Dist', coIrLocationDistBuckets),
    buildHotelCoIrCleanedByInspectorDrilldown(rows, t('co_ir.chart_10', 'Cleaned By → Inspector')),
  ];
}

function buildCorpCoIrLongCharts(rows: CoIrRow[], t: Translate): ChartDef[] {
  return [
    buildCorpCoIrPersonDrilldown(rows, 'coir-11', t('co_ir.corp_chart_11', 'Room Status → Inspector'), 'Room Status', (row) => row.room_status, 'Inspector', (row) => row.inspector.trim() || 'Inspector', true),
    buildCorpCoIrPersonDrilldown(rows, 'coir-12', t('co_ir.corp_chart_12', 'Inspection Status → Inspector'), 'Inspection Status', (row) => row.inspection_result, 'Inspector', (row) => row.inspector.trim() || 'Inspector', true),
  ];
}

function buildHotelCoIrLongCharts(rows: CoIrRow[], t: Translate): ChartDef[] {
  return [
    buildHotelCoIrDimensionPersonDrilldown(rows, 'coir-11', t('co_ir.chart_01', 'Room Status → Inspector'), 'Room Status', (row) => row.room_status, 'Inspector', (row) => row.inspector.trim() || 'Inspector', false, 500),
    buildHotelCoIrDimensionPersonDrilldown(rows, 'coir-12', t('co_ir.chart_02', 'Inspection Status → Inspector'), 'Inspection Status', (row) => row.inspection_result, 'Inspector', (row) => row.inspector.trim() || 'Inspector', false, 500),
  ];
}

export function CoIrDashboardView({ data, rows, chainEntries, myDash, myDashEmbed }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [dark, setDark] = useState(false);
  const [dashConfig, setDashConfig] = useState<ModuleConfig>(() => defaultModuleConfig('co-ir'));
  useEffect(() => {
    const html = document.documentElement;
    setDark(html.classList.contains('dark'));
    const observer = new MutationObserver(() => setDark(html.classList.contains('dark')));
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reload = () => setDashConfig(loadModuleConfig('co-ir'));
    reload();
    window.addEventListener('storage', reload);
    window.addEventListener('fcs1:dash-config-changed', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('fcs1:dash-config-changed', reload);
    };
  }, []);
  const tokens = getAppThemeTokens(theme, dark);
  const isCorp = String(data.meta.hotel_code).toLowerCase() === 'corp';
  const timezone = data.meta.timezone ?? 'Asia/Hong_Kong';
  const minDate = dateInput(data.meta.date_range.min) || rows.map((row) => row.inspection_date).filter(Boolean).sort()[0] || '';
  const maxDate = dateInput(data.meta.date_range.max) || rows.map((row) => row.inspection_date).filter(Boolean).sort().at(-1) || '';
  const [dateFrom, setDateFrom] = useState(minDate);
  const [dateTo, setDateTo] = useState(maxDate);
  const [hotel, setHotel] = useState('ALL');
  const hotelNames = useMemo(() => Object.fromEntries(chainEntries.map((entry) => [entry.hotel_code, entry.hotel_name])), [chainEntries]);
  const hotelOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.hotel_code).filter((value): value is string => Boolean(value)))).sort(), [rows]);
  const applyQuickRange = (option: string) => {
    if (option === 'ALL') {
      setDateFrom(minDate);
      setDateTo(maxDate);
      return;
    }
    const end = dateTo ? new Date(`${dateTo}T00:00:00`) : maxDate ? new Date(`${maxDate}T00:00:00`) : new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (QUICK_RANGES[option] ?? 0));
    setDateFrom(localDateKey(start));
    setDateTo(localDateKey(end));
  };
  const resetFilters = () => {
    setDateFrom(minDate);
    setDateTo(maxDate);
    setHotel('ALL');
  };
  const effectiveFrom = myDashEmbed?.range?.from ?? dateFrom;
  const effectiveTo = myDashEmbed?.range?.to ?? dateTo;
  const filtered = useMemo(() => rows.filter((row) => (!effectiveFrom || String(row.inspection_date) >= effectiveFrom) && (!effectiveTo || String(row.inspection_date) <= effectiveTo) && (hotel === 'ALL' || row.hotel_code === hotel)), [rows, effectiveFrom, effectiveTo, hotel]);
  const passed = filtered.filter((row) => row.inspection_result === 'Pass').length;
  const failed = filtered.filter((row) => row.inspection_result === 'Fail').length;
  const scores = filtered.map((row) => row.inspection_score);
  const durations = filtered.map((row) => row.inspection_duration_minutes);
  const roomsInspected = new Set(filtered.map((row) => row.location)).size;
  const passRate = percent(passed, filtered.length);
  const failedRate = percent(failed, filtered.length);
  const avgDuration = average(durations);
  const medianDuration = percentile(durations, 0.5);
  const p90Duration = percentile(durations, 0.9);
  const avgScore = average(scores);
  const scoreCapture = percent(validNumbers(scores).length, filtered.length);
  const inspectorCount = new Set(filtered.map((row) => row.inspector).filter(Boolean)).size;
  const inspectionsPerInspector = filtered.length / Math.max(1, inspectorCount);
  const workloadTone: KpiTone = inspectionsPerInspector >= 20 && inspectionsPerInspector <= 40 ? 'good' : inspectionsPerInspector >= 10 && inspectionsPerInspector <= 60 ? 'watch' : 'bad';
  const kpis: Kpi[] = [
    { id: 'coir-kpi-01', label: t('co_ir.kpi_01', 'Total Inspections'), value: filtered.length, unit: 'records', note: 'Inspection workload recorded in the selected scope.', formula: 'COUNT(*)', tone: filtered.length > 0 ? 'good' : 'bad', statusDetail: filtered.length > 0 ? 'Inspection activity is available for analysis.' : 'No inspection activity exists in the selected scope.', benchmark: ['Good > 0 inspections', 'Bad = 0 inspections'] },
    { id: 'coir-kpi-02', label: t('co_ir.kpi_02', 'Rooms Inspected'), value: roomsInspected, unit: 'rooms', note: 'Distinct room coverage achieved.', formula: 'COUNT(DISTINCT location)', tone: roomsInspected > 0 ? 'good' : 'bad', statusDetail: roomsInspected > 0 ? 'Room coverage is available.' : 'No rooms have inspection coverage.', benchmark: ['Good > 0 rooms', 'Bad = 0 rooms'] },
    { id: 'coir-kpi-03', label: t('co_ir.kpi_03', 'Pass Rate'), value: passRate, unit: '%', decimals: 1, note: 'Share of inspections passing without exception.', formula: 'Pass inspections / total inspections × 100', tone: higherTone(passRate, 95, 90), statusDetail: passRate >= 95 ? 'Quality outcomes meet the target.' : 'Quality outcomes require follow-up.', benchmark: ['Good >= 95%', 'Needs improvement 90-94.9%', 'Bad < 90%'] },
    { id: 'coir-kpi-04', label: t('co_ir.kpi_04', 'Failed Inspections'), value: failed, unit: 'records', note: 'Rooms requiring immediate quality follow-up.', formula: "COUNT(*) WHERE inspection_result = 'Fail'", tone: lowerTone(failedRate, 1, 3), statusDetail: `Failure rate is ${failedRate.toFixed(1)}% of inspections.`, benchmark: ['Good <= 1% failed', 'Needs improvement > 1% to 3%', 'Bad > 3%'] },
    { id: 'coir-kpi-05', label: t('co_ir.kpi_05', 'Average Duration'), value: avgDuration, unit: 'min', decimals: 1, note: 'Mean inspection effort per room.', formula: 'AVG(complete_time - start_time; fallback turn_over_minutes)', tone: lowerTone(avgDuration, 10, 15), statusDetail: avgDuration <= 10 ? 'Average inspection speed meets the target.' : 'Average inspection duration should be reviewed.', benchmark: ['Good <= 10 min', 'Needs improvement > 10 to 15 min', 'Bad > 15 min'] },
    { id: 'coir-kpi-06', label: t('co_ir.kpi_06', 'Median Duration'), value: medianDuration, unit: 'min', decimals: 1, note: 'Typical inspection effort, resistant to outliers.', formula: 'P50(inspection_duration_minutes)', tone: lowerTone(medianDuration, 7, 10), statusDetail: medianDuration <= 7 ? 'Typical inspection duration meets the target.' : 'Typical inspection duration is elevated.', benchmark: ['Good <= 7 min', 'Needs improvement > 7 to 10 min', 'Bad > 10 min'] },
    { id: 'coir-kpi-07', label: t('co_ir.kpi_07', 'P90 Duration'), value: p90Duration, unit: 'min', decimals: 1, note: 'Upper-tail inspection effort for exception management.', formula: 'P90(inspection_duration_minutes)', tone: lowerTone(p90Duration, 15, 25), statusDetail: p90Duration <= 15 ? 'Long-running inspections remain controlled.' : 'The slowest inspections require investigation.', benchmark: ['Good <= 15 min', 'Needs improvement > 15 to 25 min', 'Bad > 25 min'] },
    { id: 'coir-kpi-08', label: t('co_ir.kpi_08', 'Average Inspection Score'), value: avgScore, unit: 'pts', decimals: 1, note: 'Average recorded quality score.', formula: 'AVG(inspection_score) WHERE score IS NOT NULL', tone: higherTone(avgScore, 95, 90), statusDetail: avgScore >= 95 ? 'Recorded inspection quality meets the target.' : 'Recorded inspection quality requires improvement.', benchmark: ['Good >= 95 points', 'Needs improvement 90-94.9 points', 'Bad < 90 points'] },
    { id: 'coir-kpi-09', label: t('co_ir.kpi_09', 'Score Capture Rate'), value: scoreCapture, unit: '%', decimals: 1, note: 'Data-completeness guardrail for scored inspections.', formula: 'Scored inspections / total inspections × 100', tone: higherTone(scoreCapture, 95, 80), statusDetail: scoreCapture >= 95 ? 'Inspection score capture is complete.' : 'Missing inspection scores reduce quality visibility.', benchmark: ['Good >= 95%', 'Needs improvement 80-94.9%', 'Bad < 80%'] },
    { id: 'coir-kpi-10', label: t('co_ir.kpi_10', 'Inspections per Inspector'), value: inspectionsPerInspector, unit: 'avg', decimals: 1, note: 'Workload balance indicator across active inspectors.', formula: 'Total inspections / COUNT(DISTINCT inspector)', tone: workloadTone, statusDetail: workloadTone === 'good' ? 'Inspector workload is within the balanced range.' : 'Inspector workload may indicate under-utilization or overload.', benchmark: ['Good 20-40 inspections per inspector', 'Needs improvement 10-19.9 or 40.1-60', 'Bad < 10 or > 60'] },
  ];
  const simpleCharts = useMemo(() => {
    return isCorp ? buildCorpCoIrCharts(filtered, t, timezone) : buildHotelCoIrCharts(filtered, t, timezone);
  }, [filtered, timezone, t, isCorp]);
  const longCharts = useMemo(() => isCorp
    ? buildCorpCoIrLongCharts(filtered, t)
    : buildHotelCoIrLongCharts(filtered, t), [filtered, isCorp, t]);
  const visibleKpis = useMemo(() => applyMyDashFilter(kpis, myDash?.kpis, (id) => dashConfig.kpis[id] !== false), [kpis, dashConfig, myDash]);
  const visibleSimpleCharts = useMemo(() => applyMyDashFilter(simpleCharts, myDash?.charts, (id) => dashConfig.charts[id] !== false), [simpleCharts, dashConfig, myDash]);
  const visibleLongCharts = useMemo(() => applyMyDashFilter(longCharts, myDash?.charts, (id) => dashConfig.charts[id] !== false), [longCharts, dashConfig, myDash]);
  const visibleEmbedCharts = useMemo(() => applyMyDashFilter([...simpleCharts, ...longCharts], myDash?.charts, (id) => dashConfig.charts[id] !== false), [simpleCharts, longCharts, dashConfig, myDash]);
  const tableId = isCorp ? 'ccoirt-01' : 'coirt-01';
  const showTable = dashConfig.tables[tableId] !== false;
  const performance = useMemo(() => {
    const key = (row: CoIrRow) => row.hotel_code ?? data.meta.hotel_code ?? 'Unknown Hotel';
    const map: Record<string, CoIrRow[]> = {};
    for (const row of filtered) (map[key(row)] ??= []).push(row);
    return Object.entries(map).map(([name, values]) => ({ name, inspections: values.length, rooms: new Set(values.map((row) => row.location)).size, passRate: percent(values.filter((row) => row.inspection_result === 'Pass').length, values.length), failures: values.filter((row) => row.inspection_result === 'Fail').length, avgDuration: average(values.map((row) => row.inspection_duration_minutes)), p90: percentile(values.map((row) => row.inspection_duration_minutes), .9), avgScore: average(values.map((row) => row.inspection_score)), scoreCoverage: percent(validNumbers(values.map((row) => row.inspection_score)).length, values.length), credits: values.reduce((sum, row) => sum + (row.inspection_credit ?? 0), 0) })).sort((a, b) => b.passRate - a.passRate || a.avgDuration - b.avgDuration);
  }, [filtered, data.meta.hotel_code]);

  if (myDashEmbed) {
    if (myDashEmbed.part === 'kpis') {
      return <>{visibleKpis.map((kpi) => <CoIrKpiCard key={kpi.id} kpi={kpi} dark={dark} />)}</>;
    }
    return <>{visibleEmbedCharts.map((item, index) => (
      <HcChart key={item.id} def={item} dark={dark} index={index + 1} codeLabel={`${isCorp ? 'CCOIR' : 'COIR'}-${item.id.slice(-2)}`} />
    ))}</>;
  }

  return <div className="min-h-screen" style={{ background: tokens.dashboard.bg, color: tokens.text }}>
    <div className="sticky top-0 z-20 px-6 py-4 space-y-3" style={{ background: tokens.dashboard.toolbarBg, borderBottom: `1px solid ${tokens.dashboard.toolbarBorder}` }}>
      <div><h3 className="font-serif text-xl font-semibold" style={{ color: tokens.dashboard.metaTitle }}>{isCorp ? `${data.meta.chain_code} · CO IR` : `${data.meta.hotel_name} · ${data.meta.hotel_code} · CO IR`}</h3><p className="font-mono text-[0.62rem]" style={{ color: tokens.dashboard.metaSub }}>{filtered.length.toLocaleString()} records · Inspection Report Dashboard · {isCorp ? `${new Set(filtered.map((row) => row.hotel_code)).size} hotels in scope` : 'Hotel inspection view'}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={13} style={{ color: tokens.accent }} />
        <input type="date" value={dateFrom} min={minDate} max={dateTo || maxDate} onChange={(event) => setDateFrom(event.target.value)} className="w-[145px] px-2 py-1.5 font-mono text-[0.68rem] outline-none focus:ring-1" style={{ background: tokens.dashboard.inputBg, border: `1px solid ${tokens.dashboard.inputBorder}`, color: tokens.dashboard.inputText, '--tw-ring-color': tokens.accent } as React.CSSProperties} />
        <span className="font-mono text-[0.7rem]" style={{ color: tokens.dashboard.metaSub }}>→</span>
        <input type="date" value={dateTo} min={dateFrom || minDate} max={maxDate} onChange={(event) => setDateTo(event.target.value)} className="w-[145px] px-2 py-1.5 font-mono text-[0.68rem] outline-none focus:ring-1" style={{ background: tokens.dashboard.inputBg, border: `1px solid ${tokens.dashboard.inputBorder}`, color: tokens.dashboard.inputText, '--tw-ring-color': tokens.accent } as React.CSSProperties} />
        <button type="button" onClick={() => { setDateFrom(dateFrom); setDateTo(dateTo); }} className="px-3 py-1.5 font-mono uppercase" style={{ fontSize: '0.68rem', letterSpacing: '0.08em', background: tokens.accent, color: '#f8f7f2' }}>APPLY</button>
        <div className="flex items-center gap-2">
          {['ALL', '1D', '1W', '2W', '1M', '2M', '3M', '6M', '1Y'].map((option) => (
            <button key={option} type="button" onClick={() => applyQuickRange(option)} className="px-2.5 py-1.5 font-mono uppercase" style={{ fontSize: '0.66rem', border: `1px solid ${tokens.dashboard.toolbarBorder}`, background: tokens.dashboard.inputBg, color: tokens.dashboard.inputText }}>{option}</button>
          ))}
        </div>
        <button type="button" onClick={resetFilters} className="px-3 py-1.5 font-mono text-[0.68rem] uppercase" style={{ border: `1px solid ${tokens.accent}`, background: tokens.accent, color: '#f8f7f2' }}>Reset</button>
      </div>
    </div>
    <div className="px-6 py-5 space-y-7 max-w-screen-2xl mx-auto">
      <section><SectionHead label="KPI" color={tokens.dashboard.metaSub} border={tokens.dashboard.sectionRule} /><div className="kpi-grid mt-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">{visibleKpis.map((kpi) => <CoIrKpiCard key={kpi.id} kpi={kpi} dark={dark} />)}</div></section>
      <section><SectionHead label="Simple Charts" color={tokens.dashboard.metaSub} border={tokens.dashboard.sectionRule} /><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{visibleSimpleCharts.map((item, index) => <HcChart key={item.id} def={item} dark={dark} index={index + 1} codeLabel={`${isCorp ? 'CCOIR' : 'COIR'}-${item.id.slice(-2)}`} />)}</div></section>
      <section><SectionHead label="Long Charts" color={tokens.dashboard.metaSub} border={tokens.dashboard.sectionRule} /><div className="grid grid-cols-1 gap-4">{visibleLongCharts.map((item, index) => <HcChart key={item.id} def={item} dark={dark} index={index + 11} codeLabel={`${isCorp ? 'CCOIR' : 'COIR'}-${item.id.slice(-2)}`} />)}</div></section>
      {showTable && <section><SectionHead label="Table" color={tokens.dashboard.metaSub} border={tokens.dashboard.sectionRule} /><CoIrDrilldownTable key={`${isCorp ? 'corp' : 'hotel'}:${data.meta.chain_code}:${data.meta.hotel_code}`} rows={filtered} isCorp={isCorp} hotelNames={hotelNames} dark={dark} timezone={timezone} /></section>}
      <section><SectionHead label="Performance" color={tokens.dashboard.metaSub} border={tokens.dashboard.sectionRule} /><div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${tokens.card.border}`, background: tokens.card.bg }}><table className="min-w-[1250px] w-full"><thead style={{ background: tokens.dashboard.tableHeadBg }}><tr>{['Index', 'Hotel', 'Inspections', 'Rooms', 'Pass Rate', 'Failures', 'Avg Duration', 'P90 Duration', 'Avg Score', 'Score Capture', 'Credits'].map((label) => <th key={label} className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase" style={{ color: tokens.dashboard.tableHeadText }}>{label}</th>)}</tr></thead><tbody>{performance.map((row, index) => <tr key={row.name}>{[String(index + 1).padStart(2, '0'), `${row.name} · ${hotelNames[row.name] ?? data.meta.hotel_name ?? row.name}`, row.inspections.toLocaleString(), row.rooms.toLocaleString(), `${row.passRate.toFixed(1)}%`, row.failures.toLocaleString(), `${row.avgDuration.toFixed(1)} min`, `${row.p90.toFixed(1)} min`, row.avgScore ? row.avgScore.toFixed(1) : '—', `${row.scoreCoverage.toFixed(1)}%`, row.credits.toFixed(1)].map((value, cell) => <td key={cell} className="px-3 py-2 text-xs" style={{ borderBottom: `1px solid ${tokens.dashboard.tableCellBorder}` }}>{value}</td>)}</tr>)}</tbody></table></div></section>
    </div>
  </div>;
}
