'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  Eye,
  EyeOff,
  RotateCcw,
  BarChart2,
  Wrench,
  Sparkles,
  LineChart,
  MessageSquare,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { MyDashboardPanel } from '@/components/configuration/MyDashboardPanel';

const PlaygroundClient = dynamic(
  () => import('@/app/playground/PlaygroundClient'),
  { ssr: false }
);
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
import { kpiLevel } from '@/lib/my-dashboard-defs';

// ─────────────────────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'system' | ModuleConfigKey | 'mydash' | 'builder';

interface TabDef {
  key: Tab;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: 'system',  label: 'System',   Icon: Settings },
  { key: 'jo',      label: 'JO',       Icon: BarChart2 },
  { key: 'mo',      label: 'MO',       Icon: Wrench },
  { key: 'co',      label: 'CO',       Icon: Sparkles },
  { key: 'im',      label: 'IM',       Icon: LineChart },
  { key: 'mydash',  label: 'My Dashboard', Icon: LayoutDashboard },
  { key: 'builder', label: 'Builder',  Icon: MessageSquare },
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
  /** Optional display code override for the Code column — receives the item and
   *  its 0-based index in the rendered list. Defaults to item.id. */
  displayCodeOf?: (item: ConfigItem, index: number) => string;
}

function GroupPanel({ title, items, checked, onToggle, onAll, pal, t, formulaLabel = 'Formula', defaultOpen = true, scrollHeight = 380, displayCodeOf }: GroupPanelProps) {
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
              const displayCode = displayCodeOf ? displayCodeOf(item, i) : item.id;
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
                    {displayCode}
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

/** Position-based display code helpers — keep display consistent and sequential. */
const pad2 = (n: number) => String(n).padStart(2, '0');

function ModuleConfigPanel({ mod, pal, t }: ModuleConfigPanelProps) {
  const def = MODULE_DEFS[mod];

  // Split KPIs into hotel-level and corp-level groups
  const hotelKpis = useMemo(() => def.kpis.filter((k) => kpiLevel(mod, k.id) !== 'corp'),  [def.kpis, mod]);
  const corpKpis  = useMemo(() => def.kpis.filter((k) => kpiLevel(mod, k.id) !== 'hotel'), [def.kpis, mod]);

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
      {/* 1 — Hotel KPI Group */}
      {hotelKpis.length > 0 && (
        <GroupPanel
          title="Hotel KPI Group"
          items={hotelKpis}
          checked={draft.kpis}
          onToggle={(id) => toggle('kpis', id)}
          onAll={(v) => setSubset('kpis', hotelKpis, v)}
          pal={pal}
          t={t}
          defaultOpen={false}
          displayCodeOf={(_item, i) => `${mod}_kpi_${pad2(i + 1)}`}
        />
      )}

      {/* 2 — Hotel Charts Group */}
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
          displayCodeOf={(item) => item.id.replace(/-/g, '_')}
        />
      )}

      {/* 3 — Corp KPI Group */}
      {corpKpis.length > 0 && (
        <GroupPanel
          title="Corp KPI Group"
          items={corpKpis}
          checked={draft.kpis}
          onToggle={(id) => toggle('kpis', id)}
          onAll={(v) => setSubset('kpis', corpKpis, v)}
          pal={pal}
          t={t}
          defaultOpen={false}
          displayCodeOf={(_item, i) => `c${mod}_kpi_${pad2(i + 1)}`}
        />
      )}

      {/* 4 — Corp Charts Group */}
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
          displayCodeOf={(item) => item.id.replace(/-/g, '_')}
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

type ResetModule = 'ALL' | 'JO' | 'MO' | 'CO' | 'IM';
type ResetStep   = 'form' | 'previewing' | 'preview' | 'executing' | 'done';

interface TableStat {
  table_name: string;
  label: string;
  row_count: number;
  size: string;
  size_bytes: number;
}

interface ResetPanelProps {
  pal: Palette;
  t: (path: string, fallback?: string) => string;
}

const RESET_MODULES: { key: ResetModule; label: string; color: string }[] = [
  { key: 'ALL', label: 'ALL',  color: '#C55A10' },
  { key: 'JO',  label: 'JO',  color: '#2563EB' },
  { key: 'MO',  label: 'MO',  color: '#059669' },
  { key: 'CO',  label: 'CO',  color: '#7C3AED' },
  { key: 'IM',  label: 'IM',  color: '#B45309' },
];

function ResetPanel({ pal, t }: ResetPanelProps) {
  const [module, setModule]         = useState<ResetModule>('ALL');
  const [password, setPassword]     = useState('');
  const [showPwd, setShowPwd]       = useState(false);
  const [step, setStep]             = useState<ResetStep>('form');
  const [preview, setPreview]       = useState<TableStat[]>([]);
  const [errorMsg, setErrorMsg]     = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  function resetForm() {
    setStep('form');
    setPreview([]);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function handleModuleChange(m: ResetModule) {
    setModule(m);
    resetForm();
  }

  function handlePasswordChange(v: string) {
    setPassword(v);
    if (step !== 'previewing' && step !== 'executing') resetForm();
  }

  async function runPreview() {
    const trimmed = password.trim();
    if (!trimmed) { setErrorMsg('Password is required.'); return; }
    setStep('previewing');
    setErrorMsg('');
    try {
      const res  = await fetch('/api/admin/reset-database', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: trimmed, module, action: 'preview' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; tables?: TableStat[];
      };
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? 'Preview failed — check password.');
        setStep('form');
        return;
      }
      setPreview(body.tables ?? []);
      setStep('preview');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Preview failed.');
      setStep('form');
    }
  }

  async function runExecute() {
    const trimmed = password.trim();
    setStep('executing');
    setErrorMsg('');
    try {
      const res  = await fetch('/api/admin/reset-database', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: trimmed, module, action: 'execute' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; message?: string;
      };
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? 'Reset failed.');
        setStep('preview');
        return;
      }
      setSuccessMsg(body.message ?? 'Reset completed.');
      setPassword('');
      setStep('done');
      window.dispatchEvent(new CustomEvent('fcs1:nav-refresh'));
      if (module === 'ALL') {
        window.setTimeout(() => { window.location.href = '/onboarding'; }, 1400);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Reset failed.');
      setStep('preview');
    }
  }

  const busy         = step === 'previewing' || step === 'executing';
  const totalRows    = preview.reduce((s, r) => s + r.row_count, 0);
  const totalBytes   = preview.reduce((s, r) => s + r.size_bytes, 0);
  const fmtBytes     = (b: number) =>
    b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB`
    : b >= 1024    ? `${(b / 1024).toFixed(0)} kB`
    : `${b} B`;

  const selectedMeta = RESET_MODULES.find((m) => m.key === module)!;

  return (
    <section
      className="max-w-3xl p-5"
      style={{ background: pal.panelBg, border: `1px solid ${pal.panelBorder}`, borderRadius: 6 }}
    >
      {/* Header */}
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
              'Truncate uploaded records and generated dashboard data while keeping the current database schema. Tables are vacuumed after truncation to reclaim disk space.',
            )}
          </p>
        </div>
      </div>

      {/* Module selector */}
      <div className="mt-5">
        <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
          Reset scope
        </p>
        <div className="flex flex-wrap gap-2">
          {RESET_MODULES.map(({ key, label, color }) => {
            const active = module === key;
            return (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => handleModuleChange(key)}
                className="px-3 py-1 font-mono transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{
                  fontSize:        '0.68rem',
                  letterSpacing:   '0.08em',
                  border:          `1px solid ${active ? color : pal.panelBorder}`,
                  background:      active ? `${color}22` : 'transparent',
                  color:           active ? color : pal.muted,
                  fontWeight:      active ? 700 : 400,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>
          {module === 'ALL'
            ? 'Clears all module tables + shared tables (organizations, upload jobs, files, settings)'
            : `Clears only ${module} records, staging rows, and dashboard cache`}
        </p>
      </div>

      {/* Password row */}
      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <input
            type={showPwd ? 'text' : 'password'}
            value={password}
            onChange={(e) => handlePasswordChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && step === 'form') void runPreview(); }}
            className="w-full px-3 py-2 pr-8 font-mono outline-none focus:ring-1"
            style={{
              border:            `1px solid ${pal.panelBorder}`,
              background:        pal.inputBg,
              color:             pal.text,
              fontSize:          '0.76rem',
              '--tw-ring-color': pal.accent,
            } as React.CSSProperties}
            placeholder="Reset password"
            disabled={busy}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-80"
            style={{ color: pal.muted }}
          >
            {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>

        {(step === 'form' || step === 'previewing') && (
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-60"
            style={{ background: pal.accent, color: pal.accentFg, fontSize: '0.68rem', letterSpacing: '0.08em' }}
          >
            <Database size={12} className={step === 'previewing' ? 'animate-pulse' : ''} />
            {step === 'previewing' ? 'Loading…' : 'Preview'}
          </button>
        )}

        {(step === 'preview' || step === 'executing') && (
          <button
            type="button"
            onClick={() => resetForm()}
            disabled={busy}
            className="px-3 py-2 font-mono uppercase transition-opacity hover:opacity-75 disabled:opacity-40"
            style={{ border: `1px solid ${pal.panelBorder}`, color: pal.muted, fontSize: '0.62rem', letterSpacing: '0.06em' }}
          >
            ← Back
          </button>
        )}
      </div>

      {/* Error message */}
      {errorMsg && (
        <div
          className="mt-3 flex items-start gap-2 px-3 py-2"
          style={{ border: `1px solid ${pal.danger}55`, background: `${pal.danger}12`, color: pal.danger }}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <p className="font-mono" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>{errorMsg}</p>
        </div>
      )}

      {/* Preview summary table */}
      {(step === 'preview' || step === 'executing') && preview.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: selectedMeta.color }}>
            ⚠ Reset summary — {module} scope — {preview.length} table{preview.length !== 1 ? 's' : ''}
          </p>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: pal.headerBg }}>
                {['Table', 'Rows', 'Size'].map((h) => (
                  <th
                    key={h}
                    className="text-left px-3 py-1.5 font-mono uppercase"
                    style={{ fontSize: '0.58rem', letterSpacing: '0.08em', color: pal.muted }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr
                  key={r.table_name}
                  style={{ background: i % 2 === 0 ? pal.rowEven : pal.rowOdd }}
                >
                  <td className="px-3 py-1.5 font-mono" style={{ fontSize: '0.69rem', color: pal.text }}>
                    {r.label}
                    <span style={{ color: pal.muted, marginLeft: 6, fontSize: '0.58rem' }}>({r.table_name})</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-right" style={{ fontSize: '0.69rem', color: r.row_count > 0 ? pal.danger : pal.muted }}>
                    {r.row_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-right" style={{ fontSize: '0.69rem', color: pal.muted }}>
                    {r.size}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr style={{ background: pal.headerBg, borderTop: `1px solid ${pal.panelBorder}` }}>
                <td className="px-3 py-1.5 font-mono uppercase" style={{ fontSize: '0.6rem', letterSpacing: '0.07em', color: pal.muted }}>
                  Total
                </td>
                <td className="px-3 py-1.5 font-mono text-right font-bold" style={{ fontSize: '0.69rem', color: totalRows > 0 ? pal.danger : pal.muted }}>
                  {totalRows.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 font-mono text-right" style={{ fontSize: '0.69rem', color: pal.muted }}>
                  {fmtBytes(totalBytes)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Confirm button */}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void runExecute()}
              disabled={step === 'executing'}
              className="inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-60"
              style={{ background: selectedMeta.color, color: '#FAF7F2', fontSize: '0.68rem', letterSpacing: '0.08em' }}
            >
              <RotateCcw size={13} className={step === 'executing' ? 'animate-spin' : ''} />
              {step === 'executing' ? 'Resetting…' : `Confirm Reset ${module}`}
            </button>
            <p className="font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>
              This action cannot be undone.
            </p>
          </div>
        </div>
      )}

      {/* Success */}
      {step === 'done' && (
        <div
          className="mt-4 flex items-start gap-2 px-3 py-2"
          style={{ border: `1px solid ${pal.accent}55`, background: `${pal.accent}14`, color: pal.accent }}
        >
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <p className="font-mono" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
            {successMsg}
            {module === 'ALL' && ' Redirecting to onboarding…'}
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset by Hotel panel (System tab)
// ─────────────────────────────────────────────────────────────────────────────

type ResetHotelModule = 'ALL' | 'JO' | 'MO' | 'CO' | 'IM';
type ResetHotelStep   = 'idle' | 'loading' | 'ready' | 'previewing' | 'preview' | 'executing' | 'done';

interface HotelModuleStat { module_code: string; job_count: number; total_rows: number; }
interface HotelEntry     { hotel_code: string; hotel_name: string | null; modules: HotelModuleStat[]; }
interface UploadJobEntry {
  id: string; module_code: string; status: string; total_rows: number; created_at: string;
  hotel_code: string | null; hotel_name: string | null; source_name: string | null;
  date_range_min: string | null; date_range_max: string | null;
}
interface HotelTableStat { table_name: string; label: string; row_count: number; }

const HOTEL_MODULES: { key: ResetHotelModule; label: string; color: string }[] = [
  { key: 'ALL', label: 'ALL', color: '#C55A10' },
  { key: 'JO',  label: 'JO',  color: '#2563EB' },
  { key: 'MO',  label: 'MO',  color: '#059669' },
  { key: 'CO',  label: 'CO',  color: '#7C3AED' },
  { key: 'IM',  label: 'IM',  color: '#B45309' },
];

function ResetByHotelPanel({ pal, t: _t }: ResetPanelProps) {
  const [step, setStep]           = useState<ResetHotelStep>('idle');
  const [password, setPassword]   = useState('');
  const [showPwd, setShowPwd]     = useState(false);
  const [module, setModule]       = useState<ResetHotelModule>('ALL');
  const [hotels, setHotels]         = useState<HotelEntry[]>([]);
  const [selectedHotel, setSelected]= useState('');
  const [uploadJobs, setJobs]       = useState<UploadJobEntry[]>([]);
  const [tables, setTables]         = useState<HotelTableStat[]>([]);
  const [errorMsg, setErrorMsg]     = useState('');
  const [successMsg, setSuccess]    = useState('');

  function resetToReady() {
    setStep('ready'); setJobs([]); setTables([]); setErrorMsg(''); setSuccess('');
  }

  async function loadHotels() {
    const pw = password.trim();
    if (!pw) { setErrorMsg('Password is required.'); return; }
    setStep('loading'); setErrorMsg('');
    try {
      const res  = await fetch(`/api/admin/reset-by-hotel?password=${encodeURIComponent(pw)}`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; hotels?: HotelEntry[] };
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? 'Failed to load hotels — check password.');
        setStep('idle'); return;
      }
      setHotels(body.hotels ?? []);
      if ((body.hotels ?? []).length > 0) setSelected(body.hotels![0].hotel_code);
      setStep('ready');
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Load failed.'); setStep('idle'); }
  }

  async function runPreview() {
    if (!selectedHotel) { setErrorMsg('Select a hotel first.'); return; }
    setStep('previewing'); setErrorMsg('');
    try {
      const res  = await fetch('/api/admin/reset-by-hotel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim(), hotel_code: selectedHotel, module, action: 'preview' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; upload_jobs?: UploadJobEntry[]; tables?: HotelTableStat[];
      };
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? 'Preview failed.'); setStep('ready'); return;
      }
      setJobs(body.upload_jobs ?? []); setTables(body.tables ?? []);
      setStep('preview');
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Preview failed.'); setStep('ready'); }
  }

  async function runExecute() {
    setStep('executing'); setErrorMsg('');
    try {
      const res  = await fetch('/api/admin/reset-by-hotel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim(), hotel_code: selectedHotel, module, action: 'execute' }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? 'Reset failed.'); setStep('preview'); return;
      }
      setSuccess(body.message ?? 'Hotel reset completed.');
      setPassword(''); setJobs([]); setTables([]);
      setStep('done');
      window.dispatchEvent(new CustomEvent('fcs1:nav-refresh'));
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Reset failed.'); setStep('preview'); }
  }

  const busy             = step === 'loading' || step === 'previewing' || step === 'executing';
  const selectedEntry    = hotels.find((h) => h.hotel_code === selectedHotel);
  const selectedModMeta  = HOTEL_MODULES.find((m) => m.key === module)!;
  const totalDeleteRows  = tables.reduce((s, t) => s + t.row_count, 0);

  return (
    <section
      className="max-w-3xl p-5 mt-6"
      style={{ background: pal.panelBg, border: `1px solid ${pal.panelBorder}`, borderRadius: 6 }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 h-9 w-9 shrink-0 grid place-items-center"
          style={{ border: `1px solid ${pal.danger}66`, color: pal.danger, background: '#241914' }}
        >
          <Database size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-xl font-semibold" style={{ color: pal.text }}>
            Reset by Hotel
          </h2>
          <p className="mt-1 text-sm leading-6" style={{ color: pal.muted }}>
            Select a hotel and module to preview all uploaded data before deleting. Rows are removed
            by upload job — schema and other hotels are untouched.
          </p>
        </div>
      </div>

      {/* Step 1 — password + load */}
      <div className="mt-5">
        <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
          Step 1 — authenticate
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (step !== 'idle' && step !== 'loading') resetToReady(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && step === 'idle') void loadHotels(); }}
              className="w-full px-3 py-2 pr-8 font-mono outline-none focus:ring-1"
              style={{
                border: `1px solid ${pal.panelBorder}`, background: pal.inputBg, color: pal.text,
                fontSize: '0.76rem', '--tw-ring-color': pal.accent,
              } as React.CSSProperties}
              placeholder="Reset password"
              disabled={busy}
            />
            <button
              type="button" tabIndex={-1} onClick={() => setShowPwd((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-80"
              style={{ color: pal.muted }}
            >
              {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <button
            type="button" onClick={() => void loadHotels()} disabled={busy || step === 'ready'}
            className="inline-flex items-center gap-2 px-4 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: pal.accent, color: pal.accentFg, fontSize: '0.68rem', letterSpacing: '0.08em' }}
          >
            <Database size={12} className={step === 'loading' ? 'animate-pulse' : ''} />
            {step === 'loading' ? 'Loading…' : step === 'ready' || step === 'preview' || step === 'previewing' || step === 'executing' || step === 'done' ? 'Loaded ✓' : 'Load Hotels'}
          </button>
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2"
          style={{ border: `1px solid ${pal.danger}55`, background: `${pal.danger}12`, color: pal.danger }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <p className="font-mono" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>{errorMsg}</p>
        </div>
      )}

      {/* Step 2 — select hotel + module */}
      {(step === 'ready' || step === 'previewing' || step === 'preview' || step === 'executing' || step === 'done') && (
        <div className="mt-5">
          <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
            Step 2 — select hotel &amp; module
          </p>

          {/* Hotel selector — dropdown */}
          <div className="mb-3">
            <label className="block mb-1 font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>Hotel</label>
            {hotels.length === 0 ? (
              <p className="font-mono" style={{ fontSize: '0.68rem', color: pal.muted }}>No hotel data found.</p>
            ) : (
              <>
                <select
                  value={selectedHotel}
                  onChange={(e) => { setSelected(e.target.value); if (step === 'preview') resetToReady(); }}
                  disabled={busy}
                  className="w-full px-3 py-2 font-mono outline-none focus:ring-1"
                  style={{
                    border: `1px solid ${pal.panelBorder}`, background: pal.inputBg, color: pal.text,
                    fontSize: '0.74rem', '--tw-ring-color': pal.accent,
                  } as React.CSSProperties}
                >
                  {hotels.map((h) => (
                    <option key={h.hotel_code} value={h.hotel_code}>
                      {h.hotel_code}{h.hotel_name ? ` — ${h.hotel_name}` : ''}
                    </option>
                  ))}
                </select>
                {/* Show module data for selected hotel */}
                {selectedEntry && selectedEntry.modules.some((m) => m.job_count > 0) && (
                  <div className="flex flex-wrap gap-3 mt-2">
                    {selectedEntry.modules.filter((m) => m.job_count > 0).map((m) => (
                      <span key={m.module_code} className="font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>
                        <span style={{ color: HOTEL_MODULES.find((hm) => hm.key === m.module_code)?.color ?? pal.accent }}>
                          {m.module_code}
                        </span>
                        {' '}{m.job_count} job{m.job_count !== 1 ? 's' : ''} · {m.total_rows.toLocaleString()} rows
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Module chips */}
          <label className="block mb-2 font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>Module scope</label>
          <div className="flex flex-wrap gap-2 mb-4">
            {HOTEL_MODULES.map(({ key, label, color }) => {
              const active = module === key;
              return (
                <button
                  key={key} type="button" disabled={busy}
                  onClick={() => { setModule(key); if (step === 'preview') resetToReady(); }}
                  className="px-3 py-1 font-mono transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{
                    fontSize: '0.68rem', letterSpacing: '0.08em',
                    border: `1px solid ${active ? color : pal.panelBorder}`,
                    background: active ? `${color}22` : 'transparent',
                    color: active ? color : pal.muted,
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Preview button */}
          {(step === 'ready' || step === 'previewing') && (
            <button
              type="button" onClick={() => void runPreview()} disabled={busy || !selectedHotel}
              className="inline-flex items-center gap-2 px-4 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: pal.panelBorder, color: pal.text, fontSize: '0.68rem', letterSpacing: '0.08em', border: `1px solid ${pal.panelBorder}` }}
            >
              <Database size={12} className={step === 'previewing' ? 'animate-pulse' : ''} />
              {step === 'previewing' ? 'Loading preview…' : 'Preview Data'}
            </button>
          )}
        </div>
      )}

      {/* Step 3 — preview: upload history + table stats */}
      {(step === 'preview' || step === 'executing') && (
        <div className="mt-5">
          <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: selectedModMeta.color }}>
            Step 3 — upload history ({selectedEntry?.hotel_code}{selectedEntry?.hotel_name ? ` · ${selectedEntry.hotel_name}` : ''} · {module})
          </p>

          {/* Upload jobs history table */}
          {uploadJobs.length === 0 ? (
            <p className="font-mono mb-3" style={{ fontSize: '0.68rem', color: pal.muted }}>
              No upload jobs found for this hotel / module combination.
            </p>
          ) : (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 480 }}>
                <thead>
                  <tr style={{ background: pal.headerBg }}>
                    {['Hotel', 'Module', 'Source / Date Range', 'Rows', 'Status', 'Uploaded'].map((h) => (
                      <th key={h} className="text-left px-3 py-1.5 font-mono uppercase whitespace-nowrap"
                        style={{ fontSize: '0.58rem', letterSpacing: '0.08em', color: pal.muted }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadJobs.map((job, i) => (
                    <tr key={job.id} style={{ background: i % 2 === 0 ? pal.rowEven : pal.rowOdd }}>
                      <td className="px-3 py-1.5 font-mono font-bold whitespace-nowrap"
                        style={{ fontSize: '0.68rem', color: selectedModMeta.color }}>
                        {job.hotel_code ?? selectedEntry?.hotel_code ?? '—'}
                        {job.hotel_name && (
                          <span className="ml-1 font-normal" style={{ color: pal.muted, fontSize: '0.58rem' }}>
                            {job.hotel_name}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap"
                        style={{ fontSize: '0.68rem', color: pal.muted }}>
                        {job.module_code}
                      </td>
                      <td className="px-3 py-1.5 font-mono" style={{ fontSize: '0.62rem', color: pal.muted }}>
                        {job.source_name ?? '—'}
                        {job.date_range_min && (
                          <span className="block" style={{ fontSize: '0.58rem' }}>
                            {job.date_range_min} → {job.date_range_max}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-right whitespace-nowrap"
                        style={{ fontSize: '0.68rem', color: job.total_rows > 0 ? pal.danger : pal.muted }}>
                        {job.total_rows.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap"
                        style={{ fontSize: '0.62rem', color: job.status === 'completed' ? pal.accent : pal.muted }}>
                        {job.status}
                      </td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap"
                        style={{ fontSize: '0.62rem', color: pal.muted }}>
                        {job.created_at ? new Date(job.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Table-level stats */}
          {tables.length > 0 && (
            <>
              <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
                Rows to be deleted
              </p>
              <table className="w-full mb-3" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: pal.headerBg }}>
                    {['Table', 'Rows'].map((h) => (
                      <th key={h} className="text-left px-3 py-1.5 font-mono uppercase"
                        style={{ fontSize: '0.58rem', letterSpacing: '0.08em', color: pal.muted }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tables.map((tbl, i) => (
                    <tr key={tbl.table_name} style={{ background: i % 2 === 0 ? pal.rowEven : pal.rowOdd }}>
                      <td className="px-3 py-1.5 font-mono" style={{ fontSize: '0.69rem', color: pal.text }}>
                        {tbl.label}
                        <span style={{ color: pal.muted, marginLeft: 6, fontSize: '0.58rem' }}>({tbl.table_name})</span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-right"
                        style={{ fontSize: '0.69rem', color: tbl.row_count > 0 ? pal.danger : pal.muted }}>
                        {tbl.row_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: pal.headerBg, borderTop: `1px solid ${pal.panelBorder}` }}>
                    <td className="px-3 py-1.5 font-mono uppercase"
                      style={{ fontSize: '0.6rem', letterSpacing: '0.07em', color: pal.muted }}>Total</td>
                    <td className="px-3 py-1.5 font-mono text-right font-bold"
                      style={{ fontSize: '0.69rem', color: totalDeleteRows > 0 ? pal.danger : pal.muted }}>
                      {totalDeleteRows.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* Confirm + back */}
          <div className="flex items-center gap-3">
            <button
              type="button" onClick={() => void runExecute()} disabled={step === 'executing'}
              className="inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-60"
              style={{ background: pal.danger, color: '#FAF7F2', fontSize: '0.68rem', letterSpacing: '0.08em' }}
            >
              <RotateCcw size={13} className={step === 'executing' ? 'animate-spin' : ''} />
              {step === 'executing' ? 'Resetting…' : `Confirm Reset`}
            </button>
            <button
              type="button" onClick={resetToReady} disabled={busy}
              className="px-3 py-2 font-mono uppercase transition-opacity hover:opacity-75 disabled:opacity-40"
              style={{ border: `1px solid ${pal.panelBorder}`, color: pal.muted, fontSize: '0.62rem', letterSpacing: '0.06em' }}
            >
              ← Back
            </button>
            <p className="font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>
              Only this hotel&apos;s {module === 'ALL' ? 'data' : `${module} data`} will be removed.
            </p>
          </div>
        </div>
      )}

      {/* Success */}
      {step === 'done' && (
        <div className="mt-4 flex items-start gap-2 px-3 py-2"
          style={{ border: `1px solid ${pal.accent}55`, background: `${pal.accent}14`, color: pal.accent }}>
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <p className="font-mono" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>{successMsg}</p>
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
      <div className="grain min-h-full" style={{ background: tokens.appBg }}>

        {/* Page header + tab bar — always constrained */}
        <div className="px-6 pt-7">
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

            {/* Tab bar — outer wrapper holds the bottom rule; inner div scrolls.
                 Active indicator is an absolute span INSIDE the button so it
                 is never clipped by overflow-x:auto (which also clips y). */}
            <div className="relative mb-0">
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{ height: '2px', background: pal.panelBorder }}
              />
              <div className="flex items-end gap-0 overflow-x-auto">
                {TABS.map(({ key, label, Icon }) => {
                  const isActive = activeTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className="relative inline-flex items-center gap-1.5 px-4 py-3 font-mono uppercase whitespace-nowrap transition-colors"
                      style={{
                        fontSize: '0.65rem',
                        letterSpacing: '0.08em',
                        color: isActive ? pal.accent : pal.muted,
                        background: isActive ? `${pal.accent}12` : 'transparent',
                        borderRadius: '3px 3px 0 0',
                      }}
                    >
                      {isActive && (
                        <span
                          className="absolute bottom-0 left-0 right-0 pointer-events-none"
                          style={{ height: '3px', background: pal.accent, zIndex: 2 }}
                        />
                      )}
                      <Icon size={12} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* ── Builder tab — full width, PlaygroundClient has its own padding ── */}
        {activeTab === 'builder' && <PlaygroundClient />}

        {/* ── All other tabs — constrained to max-w-7xl ────────────────────── */}
        {activeTab !== 'builder' && (
          <div className="px-6 py-6">
            <div className="max-w-7xl">

              {/* ── System tab ───────────────────────────────────────────── */}
              {activeTab === 'system' && (
                <>
                  <ResetPanel pal={pal} t={t} />
                  <ResetByHotelPanel pal={pal} t={t} />
                </>
              )}

              {/* ── My Dashboard tab ─────────────────────────────────────── */}
              {activeTab === 'mydash' && (
                <MyDashboardPanel pal={pal} t={t} />
              )}

              {/* ── Module tabs (JO / MO / CO / IM) ─────────────────────── */}
              {(MODULE_TABS as Tab[]).includes(activeTab) && (
                <div>
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
                    key={activeTab}
                    mod={activeTab as ModuleConfigKey}
                    pal={pal}
                    t={t}
                  />
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
