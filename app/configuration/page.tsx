'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  RotateCcw,
  BarChart2,
  Wrench,
  Sparkles,
  LineChart,
  MoreHorizontal,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { APP_VERSION } from '@/lib/version';
import {
  MODULE_DEFS,
  type ModuleConfigKey,
  type ModuleConfig,
  type ConfigItem,
  defaultModuleConfig,
  loadModuleConfig,
  persistModuleConfig,
} from '@/lib/dash-config-defs';

// ─────────────────────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'system' | ModuleConfigKey | 'others';

interface TabDef {
  key: Tab;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: 'system',  label: 'System',               Icon: Settings },
  { key: 'jo',      label: 'Job Order',             Icon: BarChart2 },
  { key: 'mo',      label: 'Maintenance Order',     Icon: Wrench },
  { key: 'co',      label: 'Cleaning Order',        Icon: Sparkles },
  { key: 'im',      label: 'Incident Management',   Icon: LineChart },
  { key: 'others',  label: 'Others',                Icon: MoreHorizontal },
];

const MODULE_TABS: ModuleConfigKey[] = ['jo', 'mo', 'co', 'im'];

// ─────────────────────────────────────────────────────────────────────────────
// Palette helper – keeps child components pure (no theme hook calls)
// ─────────────────────────────────────────────────────────────────────────────

interface Palette {
  panelBg: string;
  panelBorder: string;
  rowOdd: string;
  rowEven: string;
  headerBg: string;
  muted: string;
  text: string;
  accent: string;
  accentFg: string;
  danger: string;
  inputBg: string;
}

function makePalette(dark: boolean, accent: string): Palette {
  return {
    panelBg:     dark ? '#171D1E' : '#FAF7F2',
    panelBorder: dark ? '#35505A' : '#D9C8A8',
    rowOdd:      dark ? '#141A1B' : '#F4EFE8',
    rowEven:     dark ? '#171D1E' : '#FAF7F2',
    headerBg:    dark ? '#1E2A2D' : '#EDE5D8',
    muted:       dark ? '#9CA9A5' : '#6B6253',
    text:        dark ? '#F4EFE5' : '#1A1714',
    accent,
    accentFg:    '#FAF7F2',
    danger:      '#C55A10',
    inputBg:     dark ? '#101516' : '#fff',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupPanel – renders one KPI or Charts accordion section
// ─────────────────────────────────────────────────────────────────────────────

interface GroupPanelProps {
  title: string;
  items: ConfigItem[];
  checked: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAll: (value: boolean) => void;
  pal: Palette;
  t: (path: string, fallback?: string) => string;
  /** Override the last column header. Defaults to 'Formula'. When set to
   *  'Business Value' the cell renders in readable prose style (not mono). */
  formulaLabel?: string;
  /** Whether the accordion starts open. Defaults to true. */
  defaultOpen?: boolean;
  /** Inner scroll-container height in px. Determines how many rows are visible.
   *  The outer animation wrapper is set to scrollHeight + 50. Defaults to 380. */
  scrollHeight?: number;
}

function GroupPanel({ title, items, checked, onToggle, onAll, pal, t, formulaLabel = 'Formula', defaultOpen = true, scrollHeight = 380 }: GroupPanelProps) {
  const isBV = formulaLabel !== 'Formula';
  const visibleCount = items.filter((item) => checked[item.id] !== false).length;
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className="mb-5 overflow-hidden"
      style={{ border: `1px solid ${pal.panelBorder}`, borderRadius: 5 }}
    >
      {/* Group header — click left side to collapse, right side buttons work independently */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{
          background: pal.headerBg,
          borderBottom: isOpen ? `1px solid ${pal.panelBorder}` : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setIsOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          {/* Chevron */}
          <ChevronDown
            size={14}
            style={{
              color: pal.muted,
              flexShrink: 0,
              transition: 'transform 0.2s ease',
              transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
          <span className="font-serif font-semibold" style={{ color: pal.text, fontSize: '0.88rem' }}>
            {title}
          </span>
          <span
            className="font-mono px-1.5 py-0.5 rounded"
            style={{
              background: `${pal.accent}22`,
              color: pal.accent,
              fontSize: '0.62rem',
              letterSpacing: '0.06em',
            }}
          >
            {visibleCount} / {items.length} shown
          </span>
        </div>
        {/* Select All / Clear All — stop propagation so clicks don't toggle collapse */}
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {[
            { label: 'Select All', value: true },
            { label: 'Clear All', value: false },
          ].map(({ label, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => onAll(value)}
              className="px-2.5 py-1 font-mono transition-opacity hover:opacity-80"
              style={{
                border: `1px solid ${pal.panelBorder}`,
                background: pal.panelBg,
                color: pal.muted,
                fontSize: '0.62rem',
                letterSpacing: '0.06em',
                borderRadius: 3,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Collapsible body — max-height transition for smooth animation */}
      <div
        style={{
          maxHeight: isOpen ? scrollHeight + 50 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease',
        }}
      >
      {/* Table */}
      <div className="overflow-y-auto" style={{ maxHeight: scrollHeight }}>
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 42 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: isBV ? 160 : 200 }} />
            <col style={{ width: '1fr', minWidth: isBV ? 140 : 160 }} />
            <col style={{ width: isBV ? 300 : 220 }} />
          </colgroup>
          <thead>
            <tr style={{ background: pal.headerBg, position: 'sticky', top: 0, zIndex: 1 }}>
              {['Show', 'Code', 'Name', 'Notes', formulaLabel].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-mono font-semibold uppercase"
                  style={{
                    color: pal.muted,
                    fontSize: '0.58rem',
                    letterSpacing: '0.1em',
                    borderBottom: `1px solid ${pal.panelBorder}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const isOn = checked[item.id] !== false;
              const label    = t(item.labelPath, item.id);
              const note     = t(item.notePath, '—');
              const formula  = item.formulaPath ? t(item.formulaPath, '—') : '—';
              const rowBg    = i % 2 === 0 ? pal.rowEven : pal.rowOdd;

              return (
                <tr
                  key={item.id}
                  onClick={() => onToggle(item.id)}
                  style={{
                    background: rowBg,
                    cursor: 'pointer',
                    opacity: isOn ? 1 : 0.45,
                    transition: 'opacity 0.12s',
                  }}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => onToggle(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="cursor-pointer"
                      style={{ accentColor: pal.accent, width: 13, height: 13 }}
                    />
                  </td>

                  {/* Code */}
                  <td
                    className="px-3 py-2 font-mono align-top"
                    style={{ color: pal.accent, fontSize: '0.66rem', wordBreak: 'break-all' }}
                  >
                    {item.id}
                  </td>

                  {/* Name */}
                  <td
                    className="px-3 py-2 align-top font-medium"
                    style={{ color: pal.text, fontSize: '0.72rem', lineHeight: 1.4 }}
                  >
                    {label}
                  </td>

                  {/* Notes */}
                  <td
                    className="px-3 py-2 align-top"
                    title={note}
                    style={{ color: pal.muted, fontSize: '0.68rem', lineHeight: 1.4 }}
                  >
                    <div
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {note}
                    </div>
                  </td>

                  {/* Formula / Business Value */}
                  <td
                    className={`px-3 py-2 align-top${isBV ? '' : ' font-mono'}`}
                    title={formula}
                    style={{
                      color: isBV && formula !== '—' ? pal.text : pal.muted,
                      fontSize: isBV ? '0.68rem' : '0.62rem',
                      lineHeight: 1.45,
                    }}
                  >
                    {isBV && formula !== '—' ? (
                      /* Rank badge + explanation prose */
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span
                          style={{
                            flexShrink: 0,
                            fontFamily: 'var(--font-mono, monospace)',
                            fontSize: '0.58rem',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: pal.accent,
                            background: `${pal.accent}18`,
                            border: `1px solid ${pal.accent}44`,
                            borderRadius: 3,
                            padding: '1px 5px',
                            lineHeight: 1.6,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formula.match(/^(#\d+)/)?.[1] ?? ''}
                        </span>
                        <span
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          } as React.CSSProperties}
                        >
                          {/* Strip the "#N · " prefix from the prose part */}
                          {formula.replace(/^#\d+\s*·\s*/, '')}
                        </span>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {formula}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>{/* end collapsible body */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleConfigPanel – manages state for one module tab
// ─────────────────────────────────────────────────────────────────────────────

interface ModuleConfigPanelProps {
  mod: ModuleConfigKey;
  pal: Palette;
  t: (path: string, fallback?: string) => string;
}

/** Corp chart IDs start with c + module prefix (cjo-, cmo-, cco-, cim-). */
const CORP_PREFIXES = ['cjo-', 'cmo-', 'cco-', 'cim-'];
function isCorpChart(id: string): boolean {
  return CORP_PREFIXES.some((p) => id.startsWith(p));
}

function ModuleConfigPanel({ mod, pal, t }: ModuleConfigPanelProps) {
  const def = MODULE_DEFS[mod];

  // Split charts into hotel and corp groups
  const hotelCharts = useMemo(() => def.charts.filter((c) => !isCorpChart(c.id)), [def.charts]);
  const corpCharts  = useMemo(() => def.charts.filter((c) =>  isCorpChart(c.id)), [def.charts]);

  const [draft, setDraft]     = useState<ModuleConfig>(() => defaultModuleConfig(mod));
  const [saved, setSaved]     = useState<ModuleConfig | null>(null);
  const [status, setStatus]   = useState<'idle' | 'saved'>('idle');

  // Load from localStorage once per module
  useEffect(() => {
    const loaded = loadModuleConfig(mod);
    setDraft(loaded);
    setSaved(loaded);
  }, [mod]);

  const toggle = useCallback((group: 'kpis' | 'charts', id: string) => {
    setDraft((prev) => ({
      ...prev,
      [group]: { ...prev[group], [id]: !(prev[group][id] !== false) },
    }));
  }, []);

  /** Toggle all items in a subset of a group (e.g. only hotel charts). */
  const setSubset = useCallback((group: 'kpis' | 'charts', items: ConfigItem[], value: boolean) => {
    const ids = items.map((item) => item.id);
    setDraft((prev) => ({
      ...prev,
      [group]: { ...prev[group], ...Object.fromEntries(ids.map((id) => [id, value])) },
    }));
  }, []);

  const handleSave = () => {
    persistModuleConfig(mod, draft);
    setSaved(draft);
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 2200);
  };

  const handleCancel = () => {
    if (saved) setDraft(saved);
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <div>
      {/* 1 — KPI Group — collapsed by default */}
      <GroupPanel
        title="KPI Group"
        items={def.kpis}
        checked={draft.kpis}
        onToggle={(id) => toggle('kpis', id)}
        onAll={(v) => setSubset('kpis', def.kpis, v)}
        pal={pal}
        t={t}
        defaultOpen={false}
      />

      {/* 2 — Hotel Charts Group — collapsed by default */}
      {hotelCharts.length > 0 && (
        <GroupPanel
          title="Hotel Charts Group"
          items={hotelCharts}
          checked={draft.charts}
          onToggle={(id) => toggle('charts', id)}
          onAll={(v) => setSubset('charts', hotelCharts, v)}
          pal={pal}
          t={t}
          formulaLabel="Business Value"
          defaultOpen={false}
          scrollHeight={420}
        />
      )}

      {/* 3 — Corp Charts Group — expanded by default */}
      {corpCharts.length > 0 && (
        <GroupPanel
          title="Corp Charts Group"
          items={corpCharts}
          checked={draft.charts}
          onToggle={(id) => toggle('charts', id)}
          onAll={(v) => setSubset('charts', corpCharts, v)}
          pal={pal}
          t={t}
          formulaLabel="Business Value"
          defaultOpen={true}
          scrollHeight={420}
        />
      )}

      {/* Footer actions */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85"
          style={{
            background: pal.accent,
            color: pal.accentFg,
            fontSize: '0.68rem',
            letterSpacing: '0.08em',
            borderRadius: 3,
          }}
        >
          Save
        </button>

        <button
          type="button"
          onClick={handleCancel}
          disabled={!isDirty}
          className="inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-40"
          style={{
            border: `1px solid ${pal.panelBorder}`,
            background: pal.panelBg,
            color: pal.muted,
            fontSize: '0.68rem',
            letterSpacing: '0.08em',
            borderRadius: 3,
          }}
        >
          Cancel
        </button>

        {/* Status feedback */}
        {status === 'saved' && (
          <span
            className="inline-flex items-center gap-1.5 font-mono"
            style={{ color: pal.accent, fontSize: '0.68rem' }}
          >
            <CheckCircle2 size={13} />
            Configuration saved
          </span>
        )}
        {isDirty && status === 'idle' && (
          <span
            className="font-mono"
            style={{ color: pal.muted, fontSize: '0.62rem', opacity: 0.8 }}
          >
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset Database panel (System tab)
// ─────────────────────────────────────────────────────────────────────────────

type ResetStatus = 'idle' | 'running' | 'success' | 'error';

interface ResetPanelProps {
  pal: Palette;
  t: (path: string, fallback?: string) => string;
}

function ResetPanel({ pal, t }: ResetPanelProps) {
  const [password, setPassword] = useState('');
  const [status, setStatus]     = useState<ResetStatus>('idle');
  const [message, setMessage]   = useState('');

  async function resetDatabase() {
    const trimmed = password.trim();
    if (!trimmed) {
      setStatus('error');
      setMessage(t('configuration.reset_password_empty', 'Password is required.'));
      return;
    }
    const confirmed = window.confirm(
      `${t('configuration.reset_confirm_title', 'Reset Database?')}\n\n${t('configuration.reset_confirm_body', 'This will truncate all uploaded data and keep the schema. Continue?')}`,
    );
    if (!confirmed) return;

    setStatus('running');
    setMessage(t('configuration.reset_running', 'Resetting database...'));
    try {
      const res = await fetch('/api/admin/reset-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setStatus('error');
        setMessage(body.error ?? t('configuration.reset_failed', 'Reset failed.'));
        return;
      }
      setStatus('success');
      setPassword('');
      setMessage(body.message ?? t('configuration.reset_success', 'Database reset completed.'));
      window.setTimeout(() => { window.location.href = '/onboarding'; }, 900);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : t('configuration.reset_failed', 'Reset failed.'));
    }
  }

  return (
    <section
      className="max-w-3xl p-5"
      style={{ background: pal.panelBg, border: `1px solid ${pal.panelBorder}`, borderRadius: 6 }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 h-9 w-9 shrink-0 grid place-items-center"
          style={{ border: `1px solid ${pal.danger}66`, color: pal.danger, background: '#241914' }}
        >
          <Database size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-xl font-semibold" style={{ color: pal.text }}>
            {t('configuration.reset_title', 'Reset Database')}
          </h2>
          <p className="mt-1 text-sm leading-6" style={{ color: pal.muted }}>
            {t(
              'configuration.reset_description',
              'Truncate uploaded records and generated dashboard data while keeping the current database schema.',
            )}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (status !== 'running') { setStatus('idle'); setMessage(''); }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') void resetDatabase(); }}
          className="w-full px-3 py-2 font-mono outline-none focus:ring-1"
          style={{
            border: `1px solid ${pal.panelBorder}`,
            background: pal.inputBg,
            color: pal.text,
            fontSize: '0.76rem',
            '--tw-ring-color': pal.accent,
          } as React.CSSProperties}
          placeholder={t('configuration.reset_password_placeholder', 'Reset password')}
          disabled={status === 'running'}
        />
        <button
          type="button"
          onClick={() => void resetDatabase()}
          disabled={status === 'running'}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-60"
          style={{ background: pal.danger, color: '#FAF7F2', fontSize: '0.68rem', letterSpacing: '0.08em' }}
        >
          <RotateCcw size={13} className={status === 'running' ? 'animate-spin' : ''} />
          {status === 'running'
            ? t('configuration.reset_running_button', 'Resetting')
            : t('configuration.reset_button', 'Reset')}
        </button>
      </div>

      {message && (
        <div
          className="mt-4 flex items-start gap-2 px-3 py-2"
          style={{
            border: `1px solid ${status === 'success' ? pal.accent : pal.danger}55`,
            background: status === 'success' ? `${pal.accent}14` : `${pal.danger}12`,
            color: status === 'success' ? pal.accent : pal.danger,
          }}
        >
          {status === 'success'
            ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
          <p className="font-mono" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
            {message}
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ConfigurationPage() {
  const { t }       = useI18n();
  const { theme }   = useTheme();
  const [dark, setDark]     = useState(false);
  const [activeTab, setTab] = useState<Tab>('system');

  useEffect(() => {
    const html = document.documentElement;
    setDark(html.classList.contains('dark'));
    const obs = new MutationObserver(() => setDark(html.classList.contains('dark')));
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);
  const pal    = useMemo(() => makePalette(dark, tokens.accent), [dark, tokens.accent]);

  return (
    <AppLayout breadcrumbs={[{ label: t('configuration.breadcrumb', 'Configuration') }]}>
      <div className="grain min-h-full px-6 py-7" style={{ background: tokens.appBg }}>
        <div className="max-w-7xl">

          {/* Page header */}
          <header className="mb-5">
            <h1 className="font-serif text-2xl font-bold leading-tight" style={{ color: pal.text }}>
              {t('configuration.page_title', 'Configuration')}
            </h1>
            <p
              className="mt-1 font-mono"
              style={{ color: pal.muted, fontSize: '0.68rem', letterSpacing: '0.05em' }}
            >
              {t('configuration.page_subtitle', 'System settings and administrative actions.')}
              {' '}· {APP_VERSION}
            </p>
          </header>

          {/* Tab bar */}
          <div
            className="flex items-end gap-0 mb-6 overflow-x-auto"
            style={{ borderBottom: `2px solid ${pal.panelBorder}` }}
          >
            {TABS.map(({ key, label, Icon }) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 font-mono uppercase whitespace-nowrap transition-colors"
                  style={{
                    fontSize: '0.65rem',
                    letterSpacing: '0.08em',
                    color: isActive ? pal.accent : pal.muted,
                    background: isActive ? `${pal.accent}12` : 'transparent',
                    borderBottom: isActive ? `2px solid ${pal.accent}` : '2px solid transparent',
                    marginBottom: -2,
                    borderRadius: '3px 3px 0 0',
                  }}
                >
                  <Icon size={12} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── System tab ─────────────────────────────────────────────── */}
          {activeTab === 'system' && (
            <ResetPanel pal={pal} t={t} />
          )}

          {/* ── Module tabs (JO / MO / CO / IM) ────────────────────────── */}
          {(MODULE_TABS as Tab[]).includes(activeTab) && (
            <div>
              {/* Section subtitle */}
              <p
                className="mb-5 font-mono"
                style={{ color: pal.muted, fontSize: '0.68rem', letterSpacing: '0.04em' }}
              >
                Configure which KPIs and charts are visible on the{' '}
                <span style={{ color: pal.accent }}>
                  {TABS.find((tb) => tb.key === activeTab)?.label}
                </span>{' '}
                dashboard. Uncheck an item to hide it. Changes take effect after saving.
              </p>

              <ModuleConfigPanel
                key={activeTab}               // re-mount cleanly when tab changes
                mod={activeTab as ModuleConfigKey}
                pal={pal}
                t={t}
              />
            </div>
          )}

          {/* ── Others tab ─────────────────────────────────────────────── */}
          {activeTab === 'others' && (
            <div
              className="flex flex-col items-center justify-center py-20 text-center"
              style={{ color: pal.muted }}
            >
              <MoreHorizontal size={32} style={{ opacity: 0.35, marginBottom: 12 }} />
              <p className="font-serif text-lg font-semibold" style={{ color: pal.text }}>
                Reserved for Future Use
              </p>
              <p className="mt-2 font-mono" style={{ fontSize: '0.70rem', letterSpacing: '0.04em' }}>
                Additional configuration options will appear here in a future release.
              </p>
            </div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
