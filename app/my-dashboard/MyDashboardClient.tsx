'use client';

// ─────────────────────────────────────────────────────────────────────────────
// My Dashboard renderer — composes the user-selected KPIs and charts from the
// JO/MO/CO-ACSR/CO-IR/IM dashboards (Configuration → My Dashboard) into one page.
//
// My Hotel: one shared date-range bar (with quick patterns) drives all
// modules; all selected KPIs render in a single pooled grid, all selected
// charts in a single pooled grid (module toolbars and department filters are
// not rendered — the dashboard components run in embedded fragment mode).
//
// My Corp: module sections reuse the full corp dashboard components, keeping
// their own hotel filters and corp benchmark tables.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, LayoutDashboard, Settings } from 'lucide-react';
import { DashboardClient } from '@/app/dashboard/DashboardClient';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import type { DashboardJson, ChainEntry } from '@/types/dashboard';
import type { CoIrRow, CoRow } from '@/types/csv';
import {
  type MyDashScope,
  type MyDashboardConfig,
  loadMyDashConfig,
  groupByModule,
  parseItemKey,
  MYDASH_MODULES,
  MYDASH_MODULE_LABELS,
  type MyDashModuleKey,
} from '@/lib/my-dashboard-defs';

export interface MyDashModuleData {
  data: DashboardJson | null;
  chainEntries: ChainEntry[];
  coRows: CoRow[];
  coIrRows: CoIrRow[];
}

const QUICK_RANGES = ['RESET', '1D', '1W', '2W', '1M', '2M', '3M', '6M', '1Y'] as const;

/** Modules in the order they first appear in the user's selection list. */
function moduleOrder(list: string[]): MyDashModuleKey[] {
  const seen: MyDashModuleKey[] = [];
  for (const key of list) {
    const p = parseItemKey(key);
    if (p && !seen.includes(p.mod)) seen.push(p.mod);
  }
  return seen;
}

export function MyDashboardClient({
  scope,
  chain,
  hotel,
  hotels,
  modules,
}: {
  scope: MyDashScope;
  chain: string;
  hotel: string;
  hotels: string[];
  modules: Record<string, MyDashModuleData>;
}) {
  const { theme } = useTheme();
  const [dark, setDark] = useState(false);
  const [cfg, setCfg] = useState<MyDashboardConfig | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setDark(html.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const reload = () => setCfg(loadMyDashConfig(scope));
    reload();
    window.addEventListener('storage', reload);
    window.addEventListener('fcs1:mydash-refresh', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('fcs1:mydash-refresh', reload);
    };
  }, [scope]);

  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);
  const overrides = useMemo(() => (cfg ? groupByModule(cfg) : {}), [cfg]);

  // ── Shared date range (union of all module date ranges) ──────────────────
  const unionRange = useMemo(() => {
    let min = '';
    let max = '';
    for (const mod of MYDASH_MODULES) {
      let m0 = '';
      let m1 = '';
      if (mod === 'co') {
        // CO stores raw rows; date range comes from created_date, not meta.
        // created_date may deserialize as a Date object — normalize to ISO day.
        for (const row of (modules['co']?.coRows ?? [])) {
          const v: unknown = row.created_date;
          if (!v) continue;
          const dt = v instanceof Date ? v : new Date(String(v));
          if (Number.isNaN(dt.getTime())) continue;
          const d = dt.toISOString().slice(0, 10);
          if (!m0 || d < m0) m0 = d;
          if (!m1 || d > m1) m1 = d;
        }
      } else {
        const meta = modules[mod]?.data?.meta;
        if (!meta?.date_range) continue;
        m0 = (meta.date_range.min ?? '').slice(0, 10);
        m1 = (meta.date_range.max ?? '').slice(0, 10);
      }
      if (m0 && (!min || m0 < min)) min = m0;
      if (m1 && (!max || m1 > max)) max = m1;
    }
    return { min, max };
  }, [modules]);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [activePreset, setActivePreset] = useState<string>('ALL');

  // Default filter: pre-fill with full data span and apply it.
  useEffect(() => {
    const { min, max } = unionRange;
    setDateFrom(min);
    setDateTo(max);
    setApplied(min && max ? { from: min, to: max } : null);
    setActivePreset('');
  }, [unionRange.min, unionRange.max]);

  const applyQuickRange = (preset: string) => {
    setActivePreset(preset);
    const { min, max } = unionRange;
    if (!min || !max) return;
    if (preset === 'RESET') {
      // Clear all filters — blank inputs, no range applied.
      setDateFrom('');
      setDateTo('');
      setApplied(null);
      return;
    }
    const end = new Date(max);
    if (Number.isNaN(end.getTime())) return;
    const start = new Date(end);
    const minusDays = (days: number) => { start.setDate(start.getDate() - days); };
    if (preset === '1D') minusDays(1);
    else if (preset === '1W') minusDays(7);
    else if (preset === '2W') minusDays(14);
    else if (preset === '1M') start.setMonth(start.getMonth() - 1);
    else if (preset === '2M') start.setMonth(start.getMonth() - 2);
    else if (preset === '3M') start.setMonth(start.getMonth() - 3);
    else if (preset === '6M') start.setMonth(start.getMonth() - 6);
    else if (preset === '1Y') start.setFullYear(start.getFullYear() - 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const from = fmt(start) < min ? min : fmt(start);
    setDateFrom(from);
    setDateTo(max);
    setApplied({ from, to: max });
  };

  const applyManual = () => {
    if (dateFrom && dateTo && dateFrom <= dateTo) {
      setActivePreset('');
      setApplied({ from: dateFrom, to: dateTo });
    }
  };

  const title = `${scope === 'hotel' ? 'My Hotel' : 'My Corp'}${chain ? ` - ${chain}` : ''}`;
  const muted = dark ? '#9CA9A5' : '#6B6253';
  const text = dark ? '#F4EFE5' : '#1A1714';
  const border = dark ? '#35505A' : '#D9C8A8';
  const inputBg = dark ? '#101516' : '#fff';
  const teal = tokens.accent;

  // Sections to render: configured modules, that have at least one selected item.
  const sections = MYDASH_MODULES
    .map((mod) => ({ mod, override: overrides[mod], payload: modules[mod] }))
    .filter((s): s is { mod: MyDashModuleKey; override: NonNullable<typeof s.override>; payload: MyDashModuleData } =>
      Boolean(s.override && (s.override.kpis.length > 0 || s.override.charts.length > 0)));

  const configured = cfg !== null && (cfg.kpis.length > 0 || cfg.charts.length > 0) && cfg.chain.trim() !== '';
  const chainMismatch = configured && cfg!.chain.trim().toUpperCase() !== chain;

  // Pooled grids (hotel scope): modules ordered by first occurrence in the
  // user's selection lists; modules without data are skipped.
  const hasModuleData = (mod: MyDashModuleKey) =>
    mod === 'co'
      ? (modules[mod]?.coRows?.length ?? 0) > 0
      : mod === 'co-ir'
        ? (modules[mod]?.coIrRows?.length ?? 0) > 0
        : Boolean(modules[mod]?.data);

  const kpiModules = cfg
    ? moduleOrder(cfg.kpis).filter((mod) => overrides[mod] && hasModuleData(mod))
    : [];
  const chartModules = cfg
    ? moduleOrder(cfg.charts).filter((mod) => overrides[mod] && hasModuleData(mod))
    : [];
  const missingModules = sections.filter((s) => !hasModuleData(s.mod)).map((s) => s.mod);

  return (
    <div className="grain min-h-full" style={{ background: tokens.appBg }}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-7 pb-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold leading-tight flex items-center gap-2.5" style={{ color: text }}>
            <LayoutDashboard size={22} style={{ color: teal }} />
            {title}
          </h1>
          <p className="mt-1 font-mono" style={{ color: muted, fontSize: '0.68rem', letterSpacing: '0.05em' }}>
            {scope === 'hotel'
              ? 'Custom hotel dashboard — selected KPIs and charts from JO / MO / CO-ACSR / CO-IR / IM.'
              : 'Custom corp dashboard — selected chain-level KPIs and charts from JO / MO / CO-ACSR / CO-IR / IM.'}
          </p>
        </div>

      </div>

      {/* ── Empty / misconfigured states ───────────────────────────────── */}
      {cfg !== null && (!configured || chainMismatch || sections.length === 0) && (
        <div className="flex flex-col items-center justify-center py-24 text-center px-6" style={{ color: muted }}>
          <Settings size={32} style={{ opacity: 0.35, marginBottom: 12 }} />
          <p className="font-serif text-lg font-semibold" style={{ color: text }}>
            {chainMismatch
              ? `This dashboard is configured for chain ${cfg!.chain.toUpperCase()}`
              : `${scope === 'hotel' ? 'My Hotel' : 'My Corp'} is not configured yet`}
          </p>
          <p className="mt-2 font-mono" style={{ fontSize: '0.7rem', letterSpacing: '0.04em' }}>
            {chainMismatch
              ? 'Open the link from the sidebar, or re-save the configuration for this chain.'
              : 'Pick up to 10 KPIs and 20 charts in Configuration → My Dashboard, then Save & Publish.'}
          </p>
          <Link
            href="/configuration"
            className="mt-5 inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85"
            style={{ background: teal, color: '#FAF7F2', fontSize: '0.68rem', letterSpacing: '0.08em', borderRadius: 3 }}
          >
            <Settings size={13} />
            Open Configuration
          </Link>
        </div>
      )}

      {/* ── Shared filter + pooled grids (both scopes) ─────────────────── */}
      {!chainMismatch && sections.length > 0 && (
        <>
          {/* Shared date-range bar */}
          <div
            className="sticky top-0 z-20 px-6 py-3 flex flex-wrap items-center gap-2"
            style={{ background: tokens.dashboard?.toolbarBg ?? (dark ? '#171D1E' : '#FAF7F2'), borderBottom: `1px solid ${border}`, borderTop: `1px solid ${border}` }}
          >
            <CalendarDays size={13} style={{ color: teal }} />
            <input
              type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
              style={{ background: inputBg, border: `1px solid ${border}`, color: text, '--tw-ring-color': teal } as React.CSSProperties}
            />
            <span className="font-mono text-[0.7rem]" style={{ color: muted }}>→</span>
            <input
              type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="font-mono text-[0.68rem] px-2 py-1.5 outline-none focus:ring-1"
              style={{ background: inputBg, border: `1px solid ${border}`, color: text, '--tw-ring-color': teal } as React.CSSProperties}
            />
            <button
              type="button" onClick={applyManual}
              className="font-mono font-medium px-3 py-1.5 transition-opacity hover:opacity-85"
              style={{ fontSize: '0.68rem', letterSpacing: '0.06em', background: teal, color: '#FAF7F2' }}
            >
              APPLY
            </button>
            {QUICK_RANGES.map((r) => {
              const active = activePreset === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => applyQuickRange(r)}
                  className="font-mono px-2 py-1.5 transition-opacity hover:opacity-85"
                  style={{
                    fontSize: '0.66rem',
                    letterSpacing: '0.06em',
                    border: `1px solid ${active ? teal : border}`,
                    background: active ? `${teal}22` : 'transparent',
                    color: active ? teal : muted,
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {r}
                </button>
              );
            })}
            {unionRange.min && unionRange.max && (
              <span className="font-mono ml-1" style={{ fontSize: '0.6rem', color: muted, opacity: 0.65 }}>
                {unionRange.min} → {unionRange.max}
              </span>
            )}
            {applied && activePreset !== 'RESET'
              && !(applied.from === unionRange.min && applied.to === unionRange.max) && (
              <span className="font-mono" style={{ fontSize: '0.6rem', color: teal }}>
                · filtered {applied.from} → {applied.to}
              </span>
            )}
          </div>

          <div className="px-6 py-5 space-y-7">
            {/* Pooled KPI grid */}
            {kpiModules.length > 0 && (
              <section className="kpi-print-section">
                <p className="mb-3 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.12em', color: muted }}>
                  KPIs
                </p>
                <div className="kpi-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {kpiModules.map((mod) => (
                    <DashboardClient
                      key={`kpi-${mod}`}
                      data={modules[mod].data ?? null}
                      chainEntries={modules[mod].chainEntries}
                      coRows={modules[mod].coRows}
                      coIrRows={modules[mod].coIrRows}
                      myDash={overrides[mod]}
                      myDashEmbed={{ part: 'kpis', range: applied }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Pooled chart grid */}
            {chartModules.length > 0 && (
              <section>
                <p className="mb-3 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.12em', color: muted }}>
                  Charts
                </p>
                <div className="chart-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                  {chartModules.map((mod) => (
                    <DashboardClient
                      key={`chart-${mod}`}
                      data={modules[mod].data ?? null}
                      chainEntries={modules[mod].chainEntries}
                      coRows={modules[mod].coRows}
                      coIrRows={modules[mod].coIrRows}
                      myDash={overrides[mod]}
                      myDashEmbed={{ part: 'charts', range: applied }}
                    />
                  ))}
                </div>
              </section>
            )}

            {missingModules.length > 0 && (
              <p className="font-mono" style={{ fontSize: '0.64rem', color: muted }}>
                No data for {missingModules.map((m) => MYDASH_MODULE_LABELS[m]).join(', ')}{' '}
                {scope === 'hotel'
                  ? `at ${hotel || 'this hotel'}`
                  : `for chain ${chain} (corp view needs at least 2 hotels with data)`}
                {' '}— those selections are skipped.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
