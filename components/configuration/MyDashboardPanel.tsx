'use client';

// ─────────────────────────────────────────────────────────────────────────────
// My Dashboard configuration panel (Configuration → My Dashboard tab)
//
// Lets the user compose "My Hotel" / "My Corp" dashboards from the existing
// JO/MO/CO-ACSR/CO-IR/IM KPI and chart lists: max 10 KPIs + 20 charts, drag-n-drop
// re-order, bound to one chain, published to the sidebar.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, GripVertical, Plus, X, Globe, Building2 } from 'lucide-react';
import { MODULE_DEFS, type ConfigItem } from '@/lib/dash-config-defs';
import {
  type MyDashScope,
  type MyDashboardConfig,
  MAX_MYDASH_KPIS,
  MAX_MYDASH_CHARTS,
  MYDASH_MODULES,
  MYDASH_MODULE_LABELS,
  type MyDashModuleKey,
  itemKey,
  parseItemKey,
  getMyDashItems,
  loadMyDashConfig,
  persistMyDashConfig,
  defaultMyDashConfig,
  kpiAlias,
  kpiIdFromAlias,
  kpiDisplayCode,
  chartDisplayCode,
} from '@/lib/my-dashboard-defs';

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

interface MyDashboardPanelProps {
  pal: Palette;
  t: (path: string, fallback?: string) => string;
}

const MODULE_COLORS: Record<MyDashModuleKey, string> = {
  jo: '#2563EB',
  mo: '#059669',
  co: '#7C3AED',
  'co-ir': '#0891B2',
  im: '#B45309',
};

function itemLabel(key: string, t: (p: string, f?: string) => string): { mod: MyDashModuleKey; id: string; label: string } | null {
  const parsed = parseItemKey(key);
  if (!parsed) return null;
  const def = MODULE_DEFS[parsed.mod];
  // KPI keys store uniform aliases (mod_kpi_NN) — resolve to the native id
  // for the i18n label lookup; the displayed code stays the alias.
  const nativeKpiId = kpiIdFromAlias(parsed.mod, parsed.id);
  const item: ConfigItem | undefined =
    def.charts.find((c) => c.id === parsed.id) ?? def.kpis.find((k) => k.id === nativeKpiId);
  const label = item ? t(item.labelPath, item.label ?? parsed.id).replace(/^[🟣🟢]\s*/u, '') : parsed.id;
  return { ...parsed, label };
}

// ─── Selected list with drag-n-drop ──────────────────────────────────────────

function SelectedList({
  keys, scope, onRemove, onReorder, pal, t, emptyHint,
}: {
  keys: string[];
  scope: MyDashScope;
  onRemove: (key: string) => void;
  onReorder: (from: number, to: number) => void;
  pal: Palette;
  t: (p: string, f?: string) => string;
  emptyHint: string;
}) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (keys.length === 0) {
    return (
      <p className="px-3 py-6 text-center font-mono" style={{ color: pal.muted, fontSize: '0.64rem' }}>
        {emptyHint}
      </p>
    );
  }

  return (
    <div>
      {keys.map((key, i) => {
        const info = itemLabel(key, t);
        if (!info) return null;
        const color = MODULE_COLORS[info.mod];
        // Resolve a display code: KPI aliases get scope-aware prefix; chart IDs get hyphens → underscores.
        const nativeKpiId = kpiIdFromAlias(info.mod, info.id);
        const displayId = nativeKpiId !== info.id
          ? kpiDisplayCode(info.mod, nativeKpiId, scope)
          : chartDisplayCode(info.id, info.mod, scope);
        return (
          <div
            key={key}
            draggable
            onDragStart={() => { dragFrom.current = i; }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i);
              dragFrom.current = null;
              setDragOver(null);
            }}
            onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
            className="flex items-center gap-2 px-2 py-1.5"
            style={{
              background: i % 2 === 0 ? pal.rowEven : pal.rowOdd,
              borderTop: dragOver === i ? `2px solid ${pal.accent}` : '2px solid transparent',
              cursor: 'grab',
            }}
          >
            <GripVertical size={12} style={{ color: pal.muted, flexShrink: 0 }} />
            <span
              className="font-mono font-bold shrink-0 px-1 rounded"
              style={{ fontSize: '0.56rem', letterSpacing: '0.06em', color, background: `${color}18`, border: `1px solid ${color}44` }}
            >
              {MYDASH_MODULE_LABELS[info.mod]}
            </span>
            <span className="font-mono shrink-0" style={{ fontSize: '0.6rem', color: pal.accent }}>
              {displayId}
            </span>
            <span className="flex-1 truncate" style={{ fontSize: '0.7rem', color: pal.text }} title={info.label}>
              {info.label}
            </span>
            <button
              type="button"
              onClick={() => onRemove(key)}
              className="shrink-0 opacity-50 hover:opacity-100"
              style={{ color: pal.danger }}
              aria-label={`Remove ${info.id}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Available picker (per kind) ─────────────────────────────────────────────

function AvailableList({
  items, mod, selected, atLimit, onAdd, pal, t, codeOf, displayCodeOf,
}: {
  items: ConfigItem[];
  mod: MyDashModuleKey;
  selected: string[];
  atLimit: boolean;
  onAdd: (key: string) => void;
  pal: Palette;
  t: (p: string, f?: string) => string;
  /** Storage code for an item — used for key construction; defaults to native id (charts). */
  codeOf?: (item: ConfigItem) => string;
  /** Visual code shown in the picker — defaults to `codeOf` result. */
  displayCodeOf?: (item: ConfigItem) => string;
}) {
  return (
    <div>
      {items.map((item, i) => {
        const code = codeOf ? codeOf(item) : item.id;
        const key = itemKey(mod, code);
        const displayCode = displayCodeOf ? displayCodeOf(item) : code;
        const isSelected = selected.includes(key);
        const disabled = isSelected || atLimit;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(key)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left transition-opacity hover:opacity-80 disabled:cursor-default"
            style={{
              background: i % 2 === 0 ? pal.rowEven : pal.rowOdd,
              opacity: isSelected ? 0.35 : atLimit ? 0.5 : 1,
            }}
          >
            <Plus size={11} style={{ color: isSelected ? pal.muted : pal.accent, flexShrink: 0 }} />
            <span className="font-mono shrink-0" style={{ fontSize: '0.6rem', color: pal.accent }}>
              {displayCode}
            </span>
            <span className="flex-1 truncate" style={{ fontSize: '0.7rem', color: isSelected ? pal.muted : pal.text }}>
              {t(item.labelPath, item.label ?? item.id).replace(/^[🟣🟢]\s*/u, '')}
            </span>
            {isSelected && (
              <CheckCircle2 size={11} style={{ color: pal.accent, flexShrink: 0 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function MyDashboardPanel({ pal, t }: MyDashboardPanelProps) {
  const [scope, setScope] = useState<MyDashScope>('hotel');
  const [cfg, setCfg] = useState<MyDashboardConfig>(() => defaultMyDashConfig());
  const [saved, setSaved] = useState<MyDashboardConfig | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [chainHotels, setChainHotels] = useState<Record<string, { regular: string[]; co: string[] }>>({});
  const [pickerModule, setPickerModule] = useState<MyDashModuleKey>('jo');
  const [status, setStatus] = useState<'idle' | 'saved' | 'published'>('idle');
  const [hotelDropOpen, setHotelDropOpen] = useState(false);
  const hotelDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hotelDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (hotelDropRef.current && !hotelDropRef.current.contains(e.target as Node)) {
        setHotelDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [hotelDropOpen]);

  // Load config when scope changes
  useEffect(() => {
    const loaded = loadMyDashConfig(scope);
    setCfg(loaded);
    setSaved(loaded);
    setStatus('idle');
  }, [scope]);

  // Chain + hotel lists from nav API
  useEffect(() => {
    fetch('/api/nav/dashboards?t=' + Date.now())
      .then((r) => r.json())
      .then((d: { chains?: { chain: string; items?: { hotel_code?: string; module?: string }[] }[] }) => {
        const list = d.chains ?? [];
        setChains(list.map((c) => c.chain));
        const hotels: Record<string, { regular: string[]; co: string[] }> = {};
        for (const c of list) {
          const regularSet = new Set<string>();
          const coSet = new Set<string>();
          for (const item of c.items ?? []) {
            const code = (item.hotel_code ?? '').trim().toUpperCase();
            if (!code || code === 'CORP') continue;
            if (item.module === 'co') coSet.add(code);
            else regularSet.add(code);
          }
          // CO-only = appears under CO but not under any other module
          const coOnly = Array.from(coSet).filter((h) => !regularSet.has(h)).sort();
          hotels[c.chain] = { regular: Array.from(regularSet).sort(), co: coOnly };
        }
        setChainHotels(hotels);
        // If a chain is already selected but no hotels chosen yet (e.g. chain was
        // picked before this API response arrived), auto-select all hotels now.
        setCfg((prev) => {
          if (!prev.chain || prev.hotels.length > 0) return prev;
          const g = hotels[prev.chain] ?? { regular: [], co: [] };
          const all = [...g.regular, ...g.co];
          return all.length > 0 ? { ...prev, hotels: all } : prev;
        });
      })
      .catch(() => { setChains([]); setChainHotels({}); });
  }, []);

  const moduleItems = useMemo(() => getMyDashItems(scope), [scope]);
  const activeItems = moduleItems.find((m) => m.mod === pickerModule) ?? moduleItems[0];

  const kpiAtLimit = cfg.kpis.length >= MAX_MYDASH_KPIS;
  const chartAtLimit = cfg.charts.length >= MAX_MYDASH_CHARTS;
  const isDirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  const addItem = useCallback((kind: 'kpis' | 'charts', key: string) => {
    setCfg((prev) => {
      const limit = kind === 'kpis' ? MAX_MYDASH_KPIS : MAX_MYDASH_CHARTS;
      if (prev[kind].includes(key) || prev[kind].length >= limit) return prev;
      return { ...prev, [kind]: [...prev[kind], key] };
    });
  }, []);

  const removeItem = useCallback((kind: 'kpis' | 'charts', key: string) => {
    setCfg((prev) => ({ ...prev, [kind]: prev[kind].filter((k) => k !== key) }));
  }, []);

  const reorderItem = useCallback((kind: 'kpis' | 'charts', from: number, to: number) => {
    setCfg((prev) => {
      const list = [...prev[kind]];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...prev, [kind]: list };
    });
  }, []);

  // NOTE: persist must happen here in the event handler, NOT inside a setCfg
  // updater — React treats updaters as pure and side effects there can be
  // dropped or deferred, which loses the publish silently.
  const doSave = useCallback((publish: boolean | null) => {
    // Corp is chain-scoped only — never persist hotel bindings for it.
    const next = {
      ...cfg,
      hotels: scope === 'corp' ? [] : cfg.hotels,
      published: publish === null ? cfg.published : publish,
    };
    persistMyDashConfig(scope, next);
    setCfg(next);
    setSaved(next);
    setStatus(publish ? 'published' : 'saved');
    setTimeout(() => setStatus('idle'), 2200);
  }, [scope, cfg]);

  const scopeTitle = scope === 'hotel' ? 'My Hotel' : 'My Corp';
  const chainSelected = cfg.chain.trim() !== '';
  // My Hotel must bind to at least one hotel; My Corp binds to the chain only.
  const hotelSelected = scope === 'corp' || cfg.hotels.length > 0;
  const hotelGroups = chainHotels[cfg.chain] ?? { regular: [], co: [] };
  const allHotelOptions = [...hotelGroups.regular, ...hotelGroups.co];

  const sectionHeader = (title: string, count: number, max: number) => (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{ background: pal.headerBg, borderBottom: `1px solid ${pal.panelBorder}` }}
    >
      <span className="font-serif font-semibold" style={{ color: pal.text, fontSize: '0.82rem' }}>{title}</span>
      <span
        className="font-mono px-1.5 py-0.5 rounded"
        style={{
          background: count >= max ? `${pal.danger}22` : `${pal.accent}22`,
          color: count >= max ? pal.danger : pal.accent,
          fontSize: '0.62rem',
          letterSpacing: '0.06em',
        }}
      >
        {count} / {max}
      </span>
    </div>
  );

  return (
    <div>
      {/* Intro */}
      <p className="mb-4 font-mono" style={{ color: pal.muted, fontSize: '0.68rem', letterSpacing: '0.04em' }}>
        Compose your own dashboard from existing{' '}
        <span style={{ color: pal.accent }}>JO / MO / CO-ACSR / CO-IR / IM</span>{' '}
        KPIs and charts — max {MAX_MYDASH_KPIS} KPIs and {MAX_MYDASH_CHARTS} charts.
        Published dashboards appear in the sidebar under <span style={{ color: pal.accent }}>My Dashboard</span>.
      </p>

      {/* Scope + chain selectors */}
      <div className="flex flex-wrap items-end gap-5 mb-5">
        <div>
          <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
            Dashboard
          </p>
          <div className="flex gap-2">
            {([
              { key: 'hotel' as const, label: 'My Hotel', Icon: Building2 },
              { key: 'corp'  as const, label: 'My Corp',  Icon: Globe },
            ]).map(({ key, label, Icon }) => {
              const active = scope === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono uppercase transition-opacity hover:opacity-85"
                  style={{
                    fontSize: '0.66rem',
                    letterSpacing: '0.08em',
                    border: `1px solid ${active ? pal.accent : pal.panelBorder}`,
                    background: active ? `${pal.accent}22` : 'transparent',
                    color: active ? pal.accent : pal.muted,
                    fontWeight: active ? 700 : 400,
                    borderRadius: 3,
                  }}
                >
                  <Icon size={12} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
            Chain Hotel <span style={{ color: pal.danger }}>*</span>
          </p>
          <select
            value={cfg.chain}
            onChange={(e) => {
              const newChain = e.target.value;
              const g = chainHotels[newChain] ?? { regular: [], co: [] };
              setCfg((prev) => ({ ...prev, chain: newChain, hotels: [...g.regular, ...g.co] }));
            }}
            className="px-3 py-1.5 font-mono outline-none focus:ring-1"
            style={{
              border: `1px solid ${chainSelected ? pal.panelBorder : pal.danger}`,
              background: pal.inputBg,
              color: pal.text,
              fontSize: '0.72rem',
              minWidth: 220,
              '--tw-ring-color': pal.accent,
            } as React.CSSProperties}
          >
            <option value="">— Select chain —</option>
            {chains.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {scope === 'hotel' && (
          <div>
            <p className="mb-2 font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
              Hotels <span style={{ color: pal.danger }}>*</span>
            </p>
            {!chainSelected ? (
              <p className="font-mono" style={{ fontSize: '0.65rem', color: pal.muted, opacity: 0.7 }}>Select chain first</p>
            ) : allHotelOptions.length === 0 ? (
              <p className="font-mono" style={{ fontSize: '0.65rem', color: pal.muted, opacity: 0.7 }}>No hotels found</p>
            ) : (
              <div ref={hotelDropRef} style={{ position: 'relative', display: 'inline-block' }}>
                {/* Trigger */}
                <button
                  type="button"
                  onClick={() => setHotelDropOpen((v) => !v)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 font-mono"
                  style={{
                    minWidth: 200,
                    border: `1px solid ${hotelSelected ? pal.panelBorder : pal.danger}`,
                    background: pal.inputBg,
                    color: cfg.hotels.length === 0 ? pal.muted : pal.text,
                    fontSize: '0.72rem',
                    borderRadius: 3,
                    cursor: 'pointer',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>
                    {cfg.hotels.length === 0
                      ? '— Select hotels —'
                      : cfg.hotels.length === allHotelOptions.length
                        ? `All selected (${cfg.hotels.length})`
                        : `${cfg.hotels.length} of ${allHotelOptions.length} selected`}
                  </span>
                  <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0, transform: hotelDropOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                </button>

                {/* Dropdown panel */}
                {hotelDropOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      zIndex: 50,
                      minWidth: 200,
                      border: `1px solid ${pal.panelBorder}`,
                      background: pal.inputBg,
                      borderRadius: 4,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Select All row */}
                    <button
                      type="button"
                      onClick={() =>
                        setCfg((prev) => ({
                          ...prev,
                          hotels: prev.hotels.length === allHotelOptions.length ? [] : [...allHotelOptions],
                        }))
                      }
                      className="w-full flex items-center gap-2 px-3 py-2 font-mono hover:opacity-80"
                      style={{ fontSize: '0.68rem', color: pal.accent, background: `${pal.accent}0E`, borderBottom: `1px solid ${pal.panelBorder}` }}
                    >
                      <span
                        style={{
                          width: 13, height: 13, border: `1px solid ${pal.accent}`,
                          borderRadius: 2, flexShrink: 0, display: 'inline-flex',
                          alignItems: 'center', justifyContent: 'center',
                          background: cfg.hotels.length === allHotelOptions.length ? pal.accent : 'transparent',
                        }}
                      >
                        {cfg.hotels.length === allHotelOptions.length && <span style={{ color: pal.accentFg, fontSize: '0.55rem', lineHeight: 1 }}>✓</span>}
                        {cfg.hotels.length > 0 && cfg.hotels.length < allHotelOptions.length && (
                          <span style={{ color: pal.accent, fontSize: '0.65rem', lineHeight: 1 }}>–</span>
                        )}
                      </span>
                      {cfg.hotels.length === allHotelOptions.length ? 'Deselect All' : 'Select All'}
                    </button>

                    {/* Regular hotels */}
                    {hotelGroups.regular.map((h) => {
                      const checked = cfg.hotels.includes(h);
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() =>
                            setCfg((prev) => ({
                              ...prev,
                              hotels: checked ? prev.hotels.filter((x) => x !== h) : [...prev.hotels, h],
                            }))
                          }
                          className="w-full flex items-center gap-2 px-3 py-1.5 font-mono hover:opacity-80"
                          style={{ fontSize: '0.7rem', color: checked ? pal.text : pal.muted, background: checked ? `${pal.accent}0A` : 'transparent' }}
                        >
                          <span
                            style={{
                              width: 13, height: 13, border: `1px solid ${checked ? pal.accent : pal.panelBorder}`,
                              borderRadius: 2, flexShrink: 0, display: 'inline-flex',
                              alignItems: 'center', justifyContent: 'center',
                              background: checked ? pal.accent : 'transparent',
                            }}
                          >
                            {checked && <span style={{ color: pal.accentFg, fontSize: '0.55rem', lineHeight: 1 }}>✓</span>}
                          </span>
                          {h}
                        </button>
                      );
                    })}

                    {/* CO group at the end */}
                    {hotelGroups.co.length > 0 && (
                      <>
                        <div
                          className="flex items-center gap-2 px-3 py-1"
                          style={{ borderTop: `1px solid ${pal.panelBorder}`, background: pal.headerBg }}
                        >
                          <span className="font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.1em', color: pal.muted }}>CO</span>
                          <span style={{ flex: 1, borderTop: `1px dashed ${pal.panelBorder}` }} />
                        </div>
                        {hotelGroups.co.map((h) => {
                          const checked = cfg.hotels.includes(h);
                          return (
                            <button
                              key={h}
                              type="button"
                              onClick={() =>
                                setCfg((prev) => ({
                                  ...prev,
                                  hotels: checked ? prev.hotels.filter((x) => x !== h) : [...prev.hotels, h],
                                }))
                              }
                              className="w-full flex items-center gap-2 px-3 py-1.5 font-mono hover:opacity-80"
                              style={{ fontSize: '0.7rem', color: checked ? pal.text : pal.muted, background: checked ? `${pal.accent}0A` : 'transparent' }}
                            >
                              <span
                                style={{
                                  width: 13, height: 13, border: `1px solid ${checked ? pal.accent : pal.panelBorder}`,
                                  borderRadius: 2, flexShrink: 0, display: 'inline-flex',
                                  alignItems: 'center', justifyContent: 'center',
                                  background: checked ? pal.accent : 'transparent',
                                }}
                              >
                                {checked && <span style={{ color: pal.accentFg, fontSize: '0.55rem', lineHeight: 1 }}>✓</span>}
                              </span>
                              {h}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {cfg.published && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 font-mono uppercase"
            style={{ fontSize: '0.6rem', letterSpacing: '0.08em', color: pal.accent, border: `1px solid ${pal.accent}55`, background: `${pal.accent}14`, borderRadius: 3 }}
          >
            <CheckCircle2 size={11} />
            Published
          </span>
        )}
      </div>

      {!chainSelected && (
        <p className="mb-4 font-mono" style={{ color: pal.danger, fontSize: '0.64rem' }}>
          Select the Chain Hotel first — {scopeTitle} only works on a single chain&apos;s data source.
        </p>
      )}
      {chainSelected && !hotelSelected && (
        <p className="mb-4 font-mono" style={{ color: pal.danger, fontSize: '0.64rem' }}>
          Select at least one Hotel — My Hotel requires at least one hotel from the chain.
        </p>
      )}

      {/* Module picker chips for the available lists */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono uppercase" style={{ fontSize: '0.62rem', letterSpacing: '0.09em', color: pal.muted }}>
          Pick from
        </span>
        {MYDASH_MODULES.map((m) => {
          const active = pickerModule === m;
          const color = MODULE_COLORS[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => setPickerModule(m)}
              className="px-3 py-1 font-mono transition-opacity hover:opacity-85"
              style={{
                fontSize: '0.66rem',
                letterSpacing: '0.08em',
                border: `1px solid ${active ? color : pal.panelBorder}`,
                background: active ? `${color}22` : 'transparent',
                color: active ? color : pal.muted,
                fontWeight: active ? 700 : 400,
              }}
            >
              {MYDASH_MODULE_LABELS[m]}
            </button>
          );
        })}
        <span className="font-mono" style={{ fontSize: '0.6rem', color: pal.muted }}>
          ({scope === 'hotel' ? 'Hotel-level items only' : 'Corp-level items only'})
        </span>
      </div>

      {/* KPI row: available | selected */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div style={{ border: `1px solid ${pal.panelBorder}`, borderRadius: 5, overflow: 'hidden', background: pal.panelBg }}>
          {sectionHeader(`Available KPIs — ${MYDASH_MODULE_LABELS[pickerModule]}`, cfg.kpis.length, MAX_MYDASH_KPIS)}
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            <AvailableList
              items={activeItems.kpis}
              mod={activeItems.mod}
              selected={cfg.kpis}
              atLimit={kpiAtLimit}
              onAdd={(key) => addItem('kpis', key)}
              pal={pal}
              t={t}
              codeOf={(item) => kpiAlias(activeItems.mod, item.id)}
              displayCodeOf={(item) => kpiDisplayCode(activeItems.mod, item.id, scope)}
            />
          </div>
        </div>
        <div style={{ border: `1px solid ${pal.panelBorder}`, borderRadius: 5, overflow: 'hidden', background: pal.panelBg }}>
          {sectionHeader(`${scopeTitle} KPIs — drag to re-order`, cfg.kpis.length, MAX_MYDASH_KPIS)}
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            <SelectedList
              keys={cfg.kpis}
              scope={scope}
              onRemove={(key) => removeItem('kpis', key)}
              onReorder={(from, to) => reorderItem('kpis', from, to)}
              pal={pal}
              t={t}
              emptyHint="No KPIs selected — click items on the left to add."
            />
          </div>
        </div>
      </div>

      {/* Chart row: available | selected */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div style={{ border: `1px solid ${pal.panelBorder}`, borderRadius: 5, overflow: 'hidden', background: pal.panelBg }}>
          {sectionHeader(`Available Charts — ${MYDASH_MODULE_LABELS[pickerModule]}`, cfg.charts.length, MAX_MYDASH_CHARTS)}
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            <AvailableList
              items={activeItems.charts}
              mod={activeItems.mod}
              selected={cfg.charts}
              atLimit={chartAtLimit}
              onAdd={(key) => addItem('charts', key)}
              pal={pal}
              t={t}
              displayCodeOf={(item) => chartDisplayCode(item.id, activeItems.mod, scope)}
            />
          </div>
        </div>
        <div style={{ border: `1px solid ${pal.panelBorder}`, borderRadius: 5, overflow: 'hidden', background: pal.panelBg }}>
          {sectionHeader(`${scopeTitle} Charts — drag to re-order`, cfg.charts.length, MAX_MYDASH_CHARTS)}
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            <SelectedList
              keys={cfg.charts}
              scope={scope}
              onRemove={(key) => removeItem('charts', key)}
              onReorder={(from, to) => reorderItem('charts', from, to)}
              pal={pal}
              t={t}
              emptyHint="No charts selected — click items on the left to add."
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => doSave(null)}
          disabled={!chainSelected || !hotelSelected}
          className="inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-40"
          style={{ background: pal.accent, color: pal.accentFg, fontSize: '0.68rem', letterSpacing: '0.08em', borderRadius: 3 }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => doSave(true)}
          disabled={!chainSelected || !hotelSelected || (cfg.kpis.length === 0 && cfg.charts.length === 0)}
          className="inline-flex items-center gap-2 px-5 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-40"
          style={{ border: `1px solid ${pal.accent}`, background: 'transparent', color: pal.accent, fontSize: '0.68rem', letterSpacing: '0.08em', borderRadius: 3 }}
        >
          Save &amp; Publish
        </button>
        {cfg.published && (
          <button
            type="button"
            onClick={() => doSave(false)}
            className="inline-flex items-center gap-2 px-4 py-2 font-mono uppercase transition-opacity hover:opacity-85"
            style={{ border: `1px solid ${pal.panelBorder}`, background: 'transparent', color: pal.muted, fontSize: '0.68rem', letterSpacing: '0.08em', borderRadius: 3 }}
          >
            Unpublish
          </button>
        )}
        {status !== 'idle' && (
          <span className="inline-flex items-center gap-1.5 font-mono" style={{ color: pal.accent, fontSize: '0.68rem' }}>
            <CheckCircle2 size={13} />
            {status === 'published' ? `${scopeTitle} published to sidebar` : 'Configuration saved'}
          </span>
        )}
        {isDirty && status === 'idle' && (
          <span className="font-mono" style={{ color: pal.muted, fontSize: '0.62rem', opacity: 0.8 }}>
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}
