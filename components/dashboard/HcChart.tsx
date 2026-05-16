'use client';

import { useRef, useEffect, useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import type { ChartDef } from '@/types/dashboard';
import { useI18n } from '@/components/layout/I18nProvider';

// ── Optional Highcharts modules (load once) ───────────────────────────────────
if (typeof Highcharts === 'object') {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Exp     = require('highcharts/modules/exporting');
  const ExpData = require('highcharts/modules/export-data');
  const MapMod  = require('highcharts/modules/map');
  const Heatmap = require('highcharts/modules/heatmap');
  const Drill   = require('highcharts/modules/drilldown');
  const MoreMod = require('highcharts/highcharts-more');
  const FunnelMod = require('highcharts/modules/funnel');
  const TreemapMod = require('highcharts/modules/treemap');
  const SankeyMod = require('highcharts/modules/sankey');
  const XRangeMod = require('highcharts/modules/xrange');
  if (typeof Exp     === 'function') Exp(Highcharts);
  if (typeof ExpData === 'function') ExpData(Highcharts);
  if (typeof MapMod  === 'function') MapMod(Highcharts);
  if (typeof Heatmap === 'function') Heatmap(Highcharts);
  if (typeof Drill   === 'function') Drill(Highcharts);
  if (typeof MoreMod === 'function') MoreMod(Highcharts);
  if (typeof FunnelMod === 'function') FunnelMod(Highcharts);
  if (typeof TreemapMod === 'function') TreemapMod(Highcharts);
  if (typeof SankeyMod === 'function') SankeyMod(Highcharts);
  if (typeof XRangeMod === 'function') XRangeMod(Highcharts);
  /* eslint-enable @typescript-eslint/no-require-imports */
}

// ── Deep merge (avoids Highcharts.merge CJS/ESM issues) ──────────────────────
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function applyLabelRules(raw: Highcharts.Options): Highcharts.Options {
  const opts = { ...raw };
  const series = (opts.series ?? []) as Highcharts.SeriesOptionsType[];
  const seriesType = String((series[0] as { type?: string } | undefined)?.type ?? '');
  const chartType = String((opts.chart as { type?: string } | undefined)?.type ?? '');
  const firstType = seriesType || chartType;
  const labelStyle = { color: '#1A1714', textOutline: 'none', fontWeight: '600' as const };

  // Pie/Donut: show label + value
  if (firstType === 'pie') {
    const plotOptions = (opts.plotOptions ?? {}) as Highcharts.PlotOptions;
    const piePlot = (plotOptions.pie ?? {}) as Highcharts.PlotPieOptions;
    opts.plotOptions = {
      ...plotOptions,
      pie: {
        ...piePlot,
        dataLabels: {
          ...(piePlot.dataLabels ?? {}),
          enabled: true,
          format: '<b>{point.name}</b><br/>{point.y}',
          style: labelStyle,
        },
      },
    };
    return opts;
  }

  // Bar/Column: if <=10 categories, show data value
  const catCount = Array.isArray((opts.xAxis as Highcharts.XAxisOptions)?.categories)
    ? (((opts.xAxis as Highcharts.XAxisOptions).categories as unknown[])?.length ?? 0)
    : 0;
  if ((firstType === 'bar' || firstType === 'column') && catCount > 0 && catCount <= 10) {
    const plotOptions = (opts.plotOptions ?? {}) as Highcharts.PlotOptions;
    const target = firstType === 'bar' ? (plotOptions.bar ?? {}) : (plotOptions.column ?? {});
    const shouldUseDistinctColors = catCount < 6;
    opts.plotOptions = {
      ...plotOptions,
      [firstType]: {
        ...target,
        colorByPoint: shouldUseDistinctColors,
        dataLabels: {
          ...(((target as unknown as { dataLabels?: Record<string, unknown> }).dataLabels) ?? {}),
          enabled: true,
          format: '{point.y}',
          style: labelStyle,
        },
      },
    };
    // Force distinct point colors on short bar/column charts even when
    // individual series options are present.
    if (shouldUseDistinctColors) {
      opts.series = series.map((s) => {
        const so = (s as unknown as Record<string, unknown>);
        return {
          ...so,
          colorByPoint: true,
        };
      }) as Highcharts.SeriesOptionsType[];
    }
  }

  // Line family: if <=10 points, show node values
  const lineTypes = new Set(['line', 'spline', 'areaspline']);
  const firstSeriesDataLen = Array.isArray((series[0] as { data?: unknown[] } | undefined)?.data)
    ? (((series[0] as { data?: unknown[] }).data)?.length ?? 0)
    : 0;
  if (lineTypes.has(firstType) && firstSeriesDataLen > 0 && firstSeriesDataLen <= 10) {
    const plotOptions = (opts.plotOptions ?? {}) as Highcharts.PlotOptions;
    const target = (plotOptions[firstType as keyof Highcharts.PlotOptions] ?? {}) as Record<string, unknown>;
    opts.plotOptions = {
      ...plotOptions,
      [firstType]: {
        ...target,
        dataLabels: {
          ...((target.dataLabels as Record<string, unknown> | undefined) ?? {}),
          enabled: true,
          format: '{point.y}',
          style: labelStyle,
        },
      },
    };
  }

  // Bubble: show data labels for top 3 by z/value
  if (firstType === 'bubble') {
    const bubbleSeries = series as Array<{ type?: string; data?: Array<Record<string, unknown>> }>;
    const enhanced = bubbleSeries.map((s) => {
      const data = Array.isArray(s.data) ? [...s.data] : [];
      const ranked = data
        .map((p, i) => {
          const z = Number((p.z as number | undefined) ?? (p.value as number | undefined) ?? (p.y as number | undefined) ?? 0);
          return { i, z };
        })
        .sort((a, b) => b.z - a.z)
        .slice(0, 3);
      const topIdx = new Set(ranked.map((r) => r.i));
      const withLabels = data.map((p, i) => {
        const label = String((p.name as string | undefined) ?? '');
        const z = Number((p.z as number | undefined) ?? (p.value as number | undefined) ?? (p.y as number | undefined) ?? 0);
        return {
          ...p,
          dataLabels: topIdx.has(i)
            ? {
                enabled: true,
                format: label ? `<b>${label}</b><br/>${z}` : `${z}`,
                style: labelStyle,
              }
            : { enabled: false },
        };
      });
      return { ...s, data: withLabels };
    });
    opts.series = enhanced as unknown as Highcharts.SeriesOptionsType[];
    return opts;
  }

  // Treemap: show data labels for top 3 by value
  if (firstType === 'treemap') {
    const tmSeries = series as Array<{ type?: string; data?: Array<Record<string, unknown>> }>;
    const pointPalette = ['#C55A10', '#0E7470', '#7B3F28', '#1A6E6A', '#D4774A', '#3A9E9A', '#9B6A3A', '#5A8A6A'];
    const enhanced = tmSeries.map((s) => {
      const data = Array.isArray(s.data) ? [...s.data] : [];
      const ranked = data
        .map((p, i) => ({ i, v: Number((p.value as number | undefined) ?? 0) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 3);
      const topIdx = new Set(ranked.map((r) => r.i));
      const withLabels = data.map((p, i) => ({
        ...p,
        color: pointPalette[i % pointPalette.length],
        dataLabels: topIdx.has(i)
          ? {
              enabled: true,
              format: `<b>{point.name}</b><br/>{point.value}`,
              style: labelStyle,
            }
          : { enabled: false },
      }));
      return { ...s, colorByPoint: true, data: withLabels };
    });
    opts.series = enhanced as unknown as Highcharts.SeriesOptionsType[];
    return opts;
  }

  return opts;
}

function applyForcedDistinctPointColors(
  raw: Highcharts.Options,
  ids: Set<string>,
  chartId: string,
): Highcharts.Options {
  if (!ids.has(chartId)) return raw;
  const opts = { ...raw };
  const series = (opts.series ?? []) as Highcharts.SeriesOptionsType[];
  const firstType = String((series[0] as { type?: string } | undefined)?.type ?? '');
  if (firstType !== 'bar' && firstType !== 'column') return opts;

  const pointPalette = ['#C55A10', '#0E7470', '#7B3F28', '#1A6E6A', '#D4774A', '#3A9E9A', '#9B6A3A', '#5A8A6A'];
  opts.series = series.map((s) => {
    const so = s as unknown as Record<string, unknown>;
    const data = (so.data as unknown[] | undefined) ?? [];
    const recolored = data.map((p, i) => {
      const color = pointPalette[i % pointPalette.length];
      if (typeof p === 'number') return { y: p, color };
      if (Array.isArray(p)) {
        const name = String(p[0] ?? '');
        const y = Number(p[1] ?? 0);
        return { name, y, color };
      }
      if (p && typeof p === 'object') {
        return { ...(p as Record<string, unknown>), color };
      }
      return p;
    });
    return {
      ...so,
      colorByPoint: true,
      data: recolored,
    };
  }) as Highcharts.SeriesOptionsType[];

  return opts;
}

// ── Editorial Vintage Highcharts theme ───────────────────────────────────────

const LIGHT_PALETTE = ['#C55A10', '#0E7470', '#7B3F28', '#1A6E6A', '#D4774A', '#3A9E9A', '#9B6A3A', '#5A8A6A'];
const DARK_PALETTE  = ['#E87030', '#14A89E', '#C07050', '#20C4B8', '#F5A060', '#45D8CC', '#E8C078', '#88C098'];

function makeTheme(dark: boolean): Highcharts.Options {
  const text    = dark ? '#EDE8E0' : '#1A1714';
  const muted   = dark ? '#8A857E' : '#6B6560';
  const grid    = dark ? '#302D2A' : '#D9C8A8';
  const tooltip = dark ? '#1F1D1A' : '#FAF7F2';
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;

  return {
    colors: palette,
    chart: {
      backgroundColor:     'transparent',
      plotBackgroundColor: 'transparent',
      style: {
        fontFamily: "'Manrope', system-ui, sans-serif",
      },
    },
    title:    { text: undefined, style: { color: text } },
    subtitle: { style: { color: muted } },
    xAxis: {
      gridLineColor: grid,
      lineColor:     grid,
      tickColor:     grid,
      labels: { style: { color: muted, fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" } },
      title:  { style: { color: muted, fontSize: '10px' } },
    },
    yAxis: {
      gridLineColor: grid,
      lineColor:     grid,
      tickColor:     grid,
      labels: { style: { color: muted, fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" } },
      title:  { style: { color: muted, fontSize: '10px' } },
    },
    legend: {
      itemStyle:      { color: text, fontWeight: '500', fontSize: '11px', fontFamily: "'Manrope', sans-serif" },
      itemHoverStyle: { color: dark ? '#FAF7F2' : '#1A1714' },
    },
    tooltip: {
      backgroundColor: tooltip,
      borderColor:     dark ? '#302D2A' : '#C4B090',
      borderRadius:    2,
      style:           { color: text, fontFamily: "'Manrope', sans-serif", fontSize: '11px' },
    },
    plotOptions: {
      series: { animation: { duration: 350 } },
    },
    exporting: {
      enabled: true,
      buttons: {
        contextButton: {
          symbolStroke: muted,
          theme: { fill: 'transparent' },
          menuItems: [
            'viewFullscreen', 'printChart', 'separator',
            'downloadPNG', 'downloadJPEG', 'downloadSVG', 'separator',
            'downloadCSV', 'downloadXLS', 'viewData',
          ],
        },
      },
    },
    navigation: {
      menuStyle:         { background: tooltip, borderColor: dark ? '#302D2A' : '#C4B090' },
      menuItemStyle:     { color: text, fontFamily: "'Manrope', sans-serif", fontSize: '12px' },
      menuItemHoverStyle:{ background: dark ? '#302D2A' : '#EDE8E0', color: text },
    },
    credits: {
      enabled: false,
    },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface HcChartProps {
  def:             ChartDef;
  dark:            boolean;
  overrideOptions?: Highcharts.Options;
  fullPeriod?:     boolean;
  index?:          number;
  codeLabel?:      string;
}

export function HcChart({ def, dark, overrideOptions, fullPeriod, index, codeLabel }: HcChartProps) {
  const { t } = useI18n();
  const chartRef = useRef<HighchartsReact.RefObject>(null);
  const theme    = useMemo(() => makeTheme(dark), [dark]);

  const options = useMemo<Highcharts.Options>(() => {
    const base = overrideOptions ?? (def.options as Highcharts.Options);
    const merged = deepMerge(
      theme as unknown as Record<string, unknown>,
      base  as unknown as Record<string, unknown>,
    ) as unknown as Highcharts.Options;
    const withLabelRules = applyLabelRules(merged);
    const forceDistinctIds = new Set(['him06', 'him22', 'him26', 'him28', 'him29', 'him33', 'him37']);
    return applyForcedDistinctPointColors(withLabelRules, forceDistinctIds, def.id);
  }, [theme, def.options, overrideOptions]);

  const constructorType = useMemo(() => {
    const series = (options.series ?? []) as Array<{ type?: string }>;
    const hasMap = series.some((s) => s?.type === 'map' || s?.type === 'mapline' || s?.type === 'mappoint');
    return hasMap ? 'mapChart' : 'chart';
  }, [options.series]);

  // Re-apply theme on dark/light toggle; skip if user is mid-drilldown
  useEffect(() => {
    const chart = chartRef.current?.chart;
    if (!chart) return;
    if ((chart as unknown as { drilldownLevels?: unknown[] }).drilldownLevels?.length) return;
    chart.update(theme as Highcharts.Options, true, true);
  }, [theme]);

  // ── Card surface colors ───────────────────────────────────────────────────
  const surface  = dark ? '#252220' : '#FAF7F2';
  const border   = dark ? '#3A3530' : '#B9A88A';
  const teal     = dark ? '#14A89E' : '#0E7470';
  const titleCol = dark ? '#EDE8E0' : '#1A1714';
  const footMut  = dark ? '#6B6560' : '#8A857E';
  const footBd   = dark ? '#302D2A' : '#D9C8A8';
  const codeCol  = teal;
  const codeBg   = dark ? 'rgba(20,168,158,0.10)' : 'rgba(14,116,112,0.07)';

  return (
    <div
      className="chart-card flex flex-col overflow-hidden"
      style={{
        background:   surface,
        border:       `1px solid ${border}`,
        borderLeft:   `4px solid ${teal}`,
        borderRadius: '12px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1 gap-3 shrink-0">
        <h3
          className="font-serif font-semibold leading-snug flex items-center gap-2"
          style={{ fontSize: '0.9rem', color: titleCol }}
        >
          {(index !== undefined || codeLabel) && (
            <span
              className="font-mono shrink-0"
              style={{
                fontSize:      '0.62rem',
                letterSpacing: '0.04em',
                fontWeight:    700,
                color:         teal,
                background:    dark ? 'rgba(20,168,158,0.10)' : 'rgba(14,116,112,0.07)',
                border:        `1px solid ${teal}40`,
                padding:       '1px 5px',
                lineHeight:    1.4,
              }}
            >
              {codeLabel ?? String(index).padStart(2, '0')}
            </span>
          )}
          {def.title}
        </h3>
        {fullPeriod && (
          <span
            className="font-mono shrink-0"
            style={{
              fontSize:   '0.58rem',
              letterSpacing: '0.08em',
              padding:    '2px 6px',
              background: dark ? 'rgba(232,112,48,0.12)' : 'rgba(197,90,16,0.08)',
              color:      dark ? '#E87030' : '#C55A10',
              border:     `1px solid ${dark ? 'rgba(232,112,48,0.25)' : 'rgba(197,90,16,0.2)'}`,
            }}
          >
            FULL PERIOD
          </span>
        )}
      </div>

      {/* Chart canvas */}
      <div className="px-2 py-1 chart-canvas-wrap" style={{ flex: '1 1 auto' }}>
        <HighchartsReact
          ref={chartRef}
          highcharts={Highcharts}
          constructorType={constructorType}
          options={options}
          containerProps={{ style: { height: `${def.height ?? 310}px` } }}
        />
      </div>

      {/* Footer: Note + Formula */}
      <div
        className="px-4 pt-2.5 pb-3.5 space-y-1 shrink-0"
        style={{ borderTop: `1px solid ${footBd}` }}
      >
        <p
          className="font-sans leading-relaxed"
          style={{ fontSize: '0.67rem', color: footMut }}
        >
            <span className="font-semibold" style={{ color: dark ? '#C4B8A8' : '#4A4540' }}>{t('dashboard_ui.note', 'Note')}</span>
            &nbsp;{def.note}
        </p>
        <p
          className="font-sans leading-relaxed"
          style={{ fontSize: '0.67rem', color: footMut }}
        >
          <span className="font-semibold" style={{ color: dark ? '#C4B8A8' : '#4A4540' }}>{t('dashboard_ui.formula', 'Formula')}</span>
          {' '}
          <code
            className="font-mono"
            style={{
              fontSize:  '0.6rem',
              padding:   '1px 5px',
              background: codeBg,
              color:      codeCol,
              borderRadius: '2px',
            }}
          >
            {def.formula}
          </code>
        </p>
      </div>
    </div>
  );
}
