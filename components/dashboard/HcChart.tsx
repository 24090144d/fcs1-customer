'use client';

import { useRef, useEffect, useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import type { ChartDef } from '@/types/dashboard';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';

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

function applyLabelRules(raw: Highcharts.Options, textColor: string, pointPalette: string[]): Highcharts.Options {
  const opts = { ...raw };
  const series = (opts.series ?? []) as Highcharts.SeriesOptionsType[];
  const seriesType = String((series[0] as { type?: string } | undefined)?.type ?? '');
  const chartType = String((opts.chart as { type?: string } | undefined)?.type ?? '');
  const firstType = seriesType || chartType;
  const labelStyle = { color: textColor, textOutline: 'none', fontWeight: '600' as const };

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

  // Bar/Column: if <=10 points, show data value
  const barPointCount = Array.isArray((series[0] as { data?: unknown[] } | undefined)?.data)
    ? (((series[0] as { data?: unknown[] }).data)?.length ?? 0)
    : 0;
  if ((firstType === 'bar' || firstType === 'column') && barPointCount > 0 && barPointCount <= 10) {
    const plotOptions = (opts.plotOptions ?? {}) as Highcharts.PlotOptions;
    const target = firstType === 'bar' ? (plotOptions.bar ?? {}) : (plotOptions.column ?? {});
    const shouldUseDistinctColors = barPointCount < 6;
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

  // Heatmap: show labels for top 3 cells only
  if (firstType === 'heatmap') {
    const hmSeries = series as Array<{ type?: string; data?: Array<unknown> }>;
    const enhanced = hmSeries.map((s) => {
      const data = Array.isArray(s.data) ? [...s.data] : [];
      const ranked = data
        .map((p, i) => {
          if (Array.isArray(p)) return { i, v: Number(p[2] ?? 0) };
          if (p && typeof p === 'object') {
            const po = p as Record<string, unknown>;
            return { i, v: Number(po.value ?? po.z ?? po.y ?? 0) };
          }
          return { i, v: 0 };
        })
        .sort((a, b) => b.v - a.v)
        .slice(0, 3);
      const topIdx = new Set(ranked.map((r) => r.i));
      const withLabels = data.map((p, i) => {
        if (Array.isArray(p)) {
          const cloned = [...p];
          const value = Number(cloned[2] ?? 0);
          return {
            x: Number(cloned[0] ?? 0),
            y: Number(cloned[1] ?? 0),
            value,
            dataLabels: topIdx.has(i)
              ? { enabled: true, format: '{point.value}', style: labelStyle }
              : { enabled: false },
          };
        }
        if (p && typeof p === 'object') {
          const po = p as Record<string, unknown>;
          return {
            ...po,
            dataLabels: topIdx.has(i)
              ? { enabled: true, format: '{point.value}', style: labelStyle }
              : { enabled: false },
          };
        }
        return p;
      });
      return { ...s, data: withLabels };
    });
    opts.series = enhanced as unknown as Highcharts.SeriesOptionsType[];
    return opts;
  }

  // Treemap: show data labels for top 3 by value
  if (firstType === 'treemap') {
    const tmSeries = series as Array<{ type?: string; data?: Array<Record<string, unknown>> }>;
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
          : {
              enabled: true,
              format: `<b>{point.name}</b>`,
              style: labelStyle,
            },
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
  pointPalette: string[],
): Highcharts.Options {
  if (!ids.has(chartId)) return raw;
  const opts = { ...raw };
  const series = (opts.series ?? []) as Highcharts.SeriesOptionsType[];
  const firstType = String((series[0] as { type?: string } | undefined)?.type ?? '');
  if (firstType !== 'bar' && firstType !== 'column') return opts;

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

function makeTheme(tokens: ReturnType<typeof getAppThemeTokens>): Highcharts.Options {
  const text    = tokens.chart.text;
  const muted   = tokens.chart.muted;
  const grid    = tokens.chart.grid;
  const tooltip = tokens.chart.tooltipBg;
  const palette = tokens.chart.palette;

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
      itemHoverStyle: { color: text },
    },
    tooltip: {
      backgroundColor: tooltip,
      borderColor:     tokens.chart.tooltipBorder,
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
      menuStyle:         { background: tooltip, borderColor: tokens.chart.tooltipBorder },
      menuItemStyle:     { color: text, fontFamily: "'Manrope', sans-serif", fontSize: '12px' },
      menuItemHoverStyle:{ background: tokens.chart.menuHoverBg, color: text },
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
  const { theme: selectedTheme } = useTheme();
  const chartRef = useRef<HighchartsReact.RefObject>(null);
  const tokens = useMemo(() => getAppThemeTokens(selectedTheme, dark), [selectedTheme, dark]);
  const theme    = useMemo(() => makeTheme(tokens), [tokens]);

  const options = useMemo<Highcharts.Options>(() => {
    const base = overrideOptions ?? (def.options as Highcharts.Options);
    const merged = deepMerge(
      theme as unknown as Record<string, unknown>,
      base  as unknown as Record<string, unknown>,
    ) as unknown as Highcharts.Options;
    // Keep a single visible title source (card header) to avoid duplicate naming.
    merged.title = { ...((merged.title ?? {}) as Highcharts.TitleOptions), text: undefined };
    const withLabelRules = applyLabelRules(merged, tokens.chart.text, tokens.chart.palette);
    const forceDistinctIds = new Set(['him06', 'him22', 'him26', 'him28', 'him29', 'him33', 'him37']);
    return applyForcedDistinctPointColors(withLabelRules, forceDistinctIds, def.id, tokens.chart.palette);
  }, [theme, def.options, overrideOptions, tokens, def.id]);

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
  const surface  = tokens.chart.cardBg;
  const border   = tokens.chart.cardBorder;
  const teal     = tokens.chart.cardAccent;
  const titleCol = tokens.chart.titleText;
  const footMut  = tokens.chart.footerMuted;
  const footBd   = tokens.chart.footerBorder;
  const codeCol  = teal;
  const codeBg   = tokens.chart.codeBg;

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
                background:    tokens.chart.codeBg,
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
              background: tokens.chart.alertBg,
              color:      tokens.chart.alertText,
              border:     `1px solid ${tokens.chart.alertBorder}`,
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
            <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>{t('dashboard_ui.note', 'Note')}</span>
            &nbsp;{def.note}
        </p>
        <p
          className="font-sans leading-relaxed"
          style={{ fontSize: '0.67rem', color: footMut }}
        >
          <span className="font-semibold" style={{ color: tokens.chart.noteLabel }}>{t('dashboard_ui.formula', 'Formula')}</span>
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
