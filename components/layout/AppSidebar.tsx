'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Upload, BarChart2, LineChart, PieChart, X, Database, Pin, PinOff, ChevronRight, PanelLeftClose, PanelLeftOpen, Hourglass, MessageSquare, EyeOff, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NavChain } from '@/app/api/nav/dashboards/route';
import { APP_VERSION } from '@/lib/version';
import { useI18n } from './I18nProvider';

interface AppSidebarProps {
  open:        boolean;
  onClose:     () => void;
  pinned:      boolean;
  onTogglePin: () => void;
}

// ── Surface elevation system ──────────────────────────────────────────────────
// Aligned with the dashboard's card surfaces:
//
//   Dashboard outer bg ─────  #1A1916   (the "negative space" between cards)
//   Toolbar / chart cards ──  #1F1D1A → #252220
//   Sidebar surface ────────  #252220   (same plane as cards — an elevated panel)
//
// The sidebar now reads as a card-level panel anchored to the left edge,
// not a backing surface that the cards float above.

function tokens(dark: boolean) {
  const lightVariant = false;
  return {
    // Surfaces
    bg:        lightVariant ? '#e0d6c2' : '#2f2924',
    band:      lightVariant ? '#d8cdb8' : '#29231f',
    border:    lightVariant ? '#6b6253' : '#1f1a16',
    rule:      lightVariant ? '#8a7f6f' : '#4a4238',
    activeBg:  lightVariant ? '#d7ccb6' : '#35302a',
    hoverBg:   lightVariant ? '#dcd1bc' : '#332d28',

    // Accents (Editorial Vintage)
    teal:      '#1f5e57',
    orange:    dark ? '#E87030' : '#C55A10',

    // Text
    text:      lightVariant ? '#2f2924' : '#f3ebdf',
    nav:       lightVariant ? '#6b6253' : '#e0d6c2',
    dim:       lightVariant ? '#7b7264' : '#9a9083',
    chrome:    lightVariant ? '#6b6253' : '#b9ae9f',
  };
}

type T = ReturnType<typeof tokens>;

// ── Section label with hair tick ──────────────────────────────────────────────

function SectionLabel({ label, T: t }: { label: string; T: T }) {
  return (
    <div className="px-4 pt-5 pb-1.5 flex items-center gap-2">
      <span
        className="font-mono uppercase"
        style={{ fontSize: '0.575rem', letterSpacing: '0.2em', color: t.dim }}
      >
        {label}
      </span>
      <span aria-hidden className="flex-1" style={{ borderTop: `1px dashed ${t.rule}`, opacity: 0.8 }} />
    </div>
  );
}

// ── Nav item — 4px left border accent (mirrors KPI / chart card spec) ─────────

function NavItem({
  href, active, onClose, onNavigateStart, T: t, collapsed, children,
}: {
  href: string; active: boolean; onClose: () => void; onNavigateStart?: () => void; T: T; collapsed: boolean; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onClick={() => {
        // Prevent sticky loading state when user clicks the current page item.
        if (!active) onNavigateStart?.();
        onClose();
      }}
      className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-3 py-2.5 font-sans`}
      style={{
        fontSize:   '0.8rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono)',
        fontWeight: active ? 600 : 500,
        color:      active || hovered ? t.text : t.nav,
        background: active ? `${t.teal}2A` : hovered ? t.hoverBg : 'transparent',
        borderLeft: '4px solid transparent',
        outline:    active ? `1px solid ${t.teal}66` : 'none',
        boxShadow:  active ? `inset 4px 0 0 ${t.teal}, inset 0 0 0 1px ${t.teal}33` : 'none',
        borderRadius: '2px',
        position: 'relative',
        transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </Link>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AppSidebar({ open, onClose, pinned, onTogglePin }: AppSidebarProps) {
  const pathname      = usePathname();
  const searchParams  = useSearchParams();
  const currentHotel  = searchParams.get('hotel') ?? '';
  const currentChain  = searchParams.get('chain') ?? '';
  const currentModule = searchParams.get('module') ?? 'im';
  const [chains, setChains] = useState<NavChain[]>([]);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  const [resettingDb, setResettingDb] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [savedCharts, setSavedCharts] = useState<Array<{ id: string; title: string; is_hidden: boolean }>>([]);
  const { t: tr } = useI18n();
  const userId = typeof window !== 'undefined'
    ? (() => {
        const k = 'fcs1_user_id';
        const existing = localStorage.getItem(k);
        if (existing) return existing;
        const generated = `user_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(k, generated);
        return generated;
      })()
    : 'anonymous';

  // Sync dark state from <html class="dark"> (toggled by DashboardClient)
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    setDark(html.classList.contains('dark'));
    const obs = new MutationObserver(() => setDark(html.classList.contains('dark')));
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    fetch('/api/nav/dashboards')
      .then(r => r.json())
      .then(d => {
        const loaded: NavChain[] = d.chains ?? [];
        setChains(loaded);
        // Auto-expand only the chain containing the active hotel
        setExpandedChains(prev => {
          const next = new Set(prev);
          loaded.forEach(({ chain, items }) => {
            const hasActive = items.some(
              item => item.hotel_code === currentHotel && item.module === currentModule
            );
            if (hasActive) next.add(chain);
          });
          return next;
        });
      })
      .catch(() => {});
  }, [pathname, currentHotel, currentModule]);

  useEffect(() => {
    fetch(`/api/ai/charts/list?user_id=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => setSavedCharts((d.charts ?? []).map((c: { id: string; title: string; is_hidden: boolean }) => ({
        id: c.id,
        title: c.title,
        is_hidden: c.is_hidden,
      }))))
      .catch(() => {});
  }, [pathname, userId]);

  useEffect(() => {
    setNavigating(false);
  }, [pathname, currentHotel, currentModule]);

  useEffect(() => {
    if (!navigating) return;
    const timer = window.setTimeout(() => setNavigating(false), 8000);
    return () => window.clearTimeout(timer);
  }, [navigating]);

  const t = tokens(dark);

  async function handleResetDatabase() {
    if (resettingDb) return;
    setResetPasswordInput('');
    setResetPasswordOpen(true);
  }

  async function toggleChartHidden(chartId: string, nextHidden: boolean) {
    await fetch('/api/ai/charts/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, chart_id: chartId, is_hidden: nextHidden }),
    }).catch(() => {});
    setSavedCharts((prev) => prev.map((c) => c.id === chartId ? { ...c, is_hidden: nextHidden } : c));
  }

  async function submitResetDatabase() {
    const password = resetPasswordInput.trim();
    if (!password) {
      alert(tr('sidebar.reset_password_empty', 'Reset cancelled: password is required.'));
      return;
    }

    const confirmed = window.confirm(
      `${tr('sidebar.confirm_reset_title', 'Reset Database?')}\n\n${tr('sidebar.confirm_reset_body', 'Yes: truncate all data and keep schema.\nNo: cancel.')}`
    );
    if (!confirmed) return;
    setResetPasswordOpen(false);

    setResettingDb(true);
    try {
      const res = await fetch('/api/admin/reset-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`${tr('sidebar.reset_failure_prefix', 'Reset failed:')} ${(body as { error?: string }).error ?? res.statusText}`);
        return;
      }
      alert(tr('sidebar.reset_success', 'Database reset completed.'));
      window.location.href = '/onboarding';
    } catch (error) {
      alert(`${tr('sidebar.reset_failure_prefix', 'Reset failed:')} ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setResettingDb(false);
    }
  }

  return (
    <>
      {resetPasswordOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(20,18,16,0.55)' }}>
          <div className="w-[min(92vw,360px)] p-4" style={{ background: '#FAF7F2', border: '1px solid #D9C8A8' }}>
            <p className="font-mono uppercase" style={{ fontSize: '0.66rem', letterSpacing: '0.12em', color: '#2f2924' }}>
              {tr('sidebar.reset_password_title', 'Reset password required')}
            </p>
            <input
              type="password"
              value={resetPasswordInput}
              onChange={(e) => setResetPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitResetDatabase();
              }}
              className="mt-3 w-full px-2 py-1.5 font-mono outline-none"
              style={{ border: '1px solid #C4B090', background: '#fff', color: '#2f2924', fontSize: '0.72rem' }}
              placeholder={tr('sidebar.password', 'Password')}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetPasswordOpen(false)}
                className="px-3 py-1.5 font-mono"
                style={{ fontSize: '0.66rem', border: '1px solid #C4B090', color: '#6b6253' }}
              >
                {tr('sidebar.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submitResetDatabase()}
                className="px-3 py-1.5 font-mono"
                style={{ fontSize: '0.66rem', border: '1px solid #0E7470', background: '#0E7470', color: '#FAF7F2' }}
              >
                {tr('sidebar.confirm', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backdrop */}
      {navigating && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(20, 18, 16, 0.22)' }}
          aria-live="polite"
          role="status"
        >
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ border: '1px solid #D9C8A8', background: '#FAF7F2' }}
          >
            <Hourglass size={16} className="animate-spin" style={{ color: '#1f5e57' }} />
            <span
              className="font-mono uppercase animate-pulse"
              style={{ fontSize: '0.72rem', letterSpacing: '0.12em', color: '#2f2924' }}
            >
              {tr('sidebar.loading', 'Loading...')}
            </span>
          </div>
        </div>
      )}

      {open && (
        <div
          className={['fixed inset-0 z-20', pinned ? 'lg:hidden' : ''].join(' ')}
          style={{ background: 'rgba(20,18,16,0.78)' }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 flex flex-col shrink-0 print:hidden',
          'transition-transform duration-200 ease-in-out',
          pinned ? 'lg:static lg:translate-x-0' : '',
          open   ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'w-16' : 'w-56',
        ].join(' ')}
        style={{
          background:  t.bg,
          borderRight: `1px solid ${t.border}`,
          transition:  'background 300ms ease, border-color 300ms ease',
        }}
      >

        {/* ── Editorial masthead rule ────────────────────────────────────── */}
        <div aria-hidden style={{ height: '1px', background: t.rule, opacity: 0.9 }} />

        {/* ── Brand ──────────────────────────────────────────────────────── */}
        <div
          className={`flex items-center justify-between ${collapsed ? 'px-2' : 'px-4'} py-3.5 shrink-0`}
          style={{ background: t.band, borderBottom: `1px solid ${t.border}` }}
        >
          <div className={`flex items-center ${collapsed ? 'justify-center w-full' : 'gap-2.5'} min-w-0`}>
            <div
              className="w-6 h-6 flex items-center justify-center shrink-0"
              style={{ background: 'transparent', border: `1px solid ${t.teal}` }}
            >
              <Database size={12} style={{ color: t.teal }} />
            </div>
            {!collapsed && (
              <span
                className="font-mono uppercase truncate"
                style={{ fontSize: '0.66rem', letterSpacing: '0.22em', color: t.text }}
              >
                {tr('sidebar.brand_title', 'FCS1 Dashboard')}
              </span>
            )}
          </div>

          <div className={`flex items-center gap-0.5 shrink-0 ${collapsed ? 'hidden' : ''}`}>
            <button
              onClick={onTogglePin}
              className="hidden lg:flex items-center justify-center p-1.5 transition-opacity hover:opacity-70"
              style={{ color: t.chrome }}
              aria-label={pinned ? tr('sidebar.unpin_sidebar', 'Unpin sidebar') : tr('sidebar.pin_sidebar', 'Pin sidebar')}
            >
              {pinned ? <Pin size={12} /> : <PinOff size={12} />}
            </button>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 transition-opacity hover:opacity-70"
              style={{ color: t.chrome }}
              aria-label={tr('sidebar.close_sidebar', 'Close sidebar')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Workspace nav ──────────────────────────────────────────────── */}
        {!collapsed && <SectionLabel label={tr('sidebar.section_workspace', 'Workspace')} T={t} />}
        <nav className="px-1 shrink-0">
          <NavItem
            href="/playground"
            active={pathname === '/playground'}
            onClose={onClose}
            onNavigateStart={() => setNavigating(true)}
            T={t}
            collapsed={collapsed}
          >
            <MessageSquare size={14} strokeWidth={pathname === '/playground' ? 2.5 : 2} className="shrink-0" />
            {!collapsed && 'AI Playground'}
          </NavItem>
          <NavItem
            href="/onboarding"
            active={pathname === '/onboarding'}
            onClose={onClose}
            onNavigateStart={() => setNavigating(true)}
            T={t}
            collapsed={collapsed}
          >
            <Upload size={14} strokeWidth={pathname === '/onboarding' ? 2.5 : 2} className="shrink-0" />
            {!collapsed && tr('sidebar.menu_upload_csv', 'Upload CSV')}
          </NavItem>
        </nav>

        {!collapsed && savedCharts.length > 0 && (
          <>
            <SectionLabel label="Saved AI Charts" T={t} />
            <div className="px-1 shrink-0 space-y-px">
              {savedCharts.map((c) => (
                <div key={c.id} className="flex items-center gap-1">
                  <Link
                    href="/playground"
                    onClick={() => setNavigating(true)}
                    className="flex-1 px-3 py-2 font-mono uppercase truncate"
                    style={{
                      fontSize: '0.68rem',
                      letterSpacing: '0.08em',
                      color: c.is_hidden ? t.dim : t.nav,
                      opacity: c.is_hidden ? 0.6 : 1,
                    }}
                  >
                    {c.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void toggleChartHidden(c.id, !c.is_hidden)}
                    className="p-1.5"
                    style={{ color: t.dim }}
                    aria-label={c.is_hidden ? 'Unhide chart' : 'Hide chart'}
                  >
                    {c.is_hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Hair rule ──────────────────────────────────────────────────── */}
        <div
          aria-hidden
          className="mx-4 mt-4"
          style={{ height: '1px', background: t.rule }}
        />

        {/* ── Chain sections ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {chains.map(({ chain, items }) => {
            const isExpanded = expandedChains.has(chain);
            const hasActive  = items.some(
              item => pathname === '/dashboard' &&
                      item.module === currentModule &&
                      (
                        (item.hotel_code === 'CORP' && currentHotel.toLowerCase() === 'corp' && currentChain.toUpperCase() === chain.toUpperCase()) ||
                        (item.hotel_code !== 'CORP' && item.hotel_code === currentHotel)
                      )
            );
            const moduleGroups = (['im', 'jo'] as const).map((m) => ({
              module: m,
              entries: items.filter((it) => it.module === m),
            })).filter((g) => g.entries.length > 0);
            return (
              <div key={chain}>
                {/* Collapsible chain header */}
                {!collapsed && (
                  <button
                    onClick={() => setExpandedChains(prev => {
                      const next = new Set(prev);
                      if (next.has(chain)) next.delete(chain); else next.add(chain);
                      return next;
                    })}
                    className="w-full flex items-center gap-2 px-4 pt-5 pb-1.5"
                    style={{ background: 'transparent' }}
                  >
                    <span
                      className="font-mono uppercase flex-1 text-left"
                      style={{
                        fontSize: '0.66rem',
                        letterSpacing: '0.15em',
                        color: hasActive ? '#6fc7bc' : t.nav,
                        fontWeight: hasActive ? 700 : 500,
                      }}
                    >
                      {chain}
                    </span>
                    <ChevronRight
                      size={10}
                      style={{
                        color:     hasActive ? '#6fc7bc' : t.dim,
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 150ms ease',
                        flexShrink: 0,
                      }}
                    />
                  </button>
                )}

                {/* Items — only when expanded */}
                {(collapsed || isExpanded) && (
                  <nav className="px-1 space-y-px">
                    {moduleGroups.map((group) => (
                      <div key={`${chain}-${group.module}`} className="pt-1">
                        {!collapsed && (
                          <div className="px-4 py-1.5">
                            <span
                              className="font-mono uppercase"
                              style={{ fontSize: '0.54rem', letterSpacing: '0.16em', color: t.dim }}
                            >
                              {group.module === 'jo' ? 'JO' : 'IM'}
                            </span>
                          </div>
                        )}
                        {group.entries.map(item => {
                          const active =
                            pathname === '/dashboard' &&
                            item.module === currentModule &&
                            (
                              (item.hotel_code === 'CORP' && currentHotel.toLowerCase() === 'corp' && currentChain.toUpperCase() === chain.toUpperCase()) ||
                              (item.hotel_code !== 'CORP' && item.hotel_code === currentHotel)
                            );
                          const isCorp = item.hotel_code === 'CORP';
                          return (
                            <NavItem
                              key={`${chain}-${item.hotel_code}-${item.module}`}
                              href={item.href}
                              active={active}
                              onClose={onClose}
                              onNavigateStart={() => setNavigating(true)}
                              T={t}
                              collapsed={collapsed}
                            >
                              {isCorp ? (
                                <PieChart size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                              ) : item.module === 'jo' ? (
                                <BarChart2 size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                              ) : (
                                <LineChart size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                              )}
                              {!collapsed && (
                                <span className="truncate">
                                  {isCorp ? (
                                    <span style={{ fontWeight: 700, color: active ? '#F4C27A' : '#DDA15E' }}>
                                      Corp · {item.module.toUpperCase()}
                                    </span>
                                  ) : (
                                    <>
                                      <span style={{ fontWeight: 600 }}>{item.hotel_code}</span>
                                      <span style={{ opacity: 0.55 }}>
                                        {' · '}
                                        {item.module.toUpperCase()}
                                      </span>
                                    </>
                                  )}
                                </span>
                              )}
                            </NavItem>
                          );
                        })}
                      </div>
                    ))}
                  </nav>
                )}
              </div>
            );
          })}
        </div>

        {/* ── User strip ─────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={handleResetDatabase}
          disabled={resettingDb}
          aria-label={tr('sidebar.reset_database', 'Reset Database')}
          className={`${collapsed ? 'px-2' : 'px-4'} py-3 shrink-0`}
          style={{ borderTop: `1px solid ${t.border}`, background: t.band }}
        >
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} min-w-0`}>
            <div
              className="w-6 h-6 flex items-center justify-center shrink-0"
              style={{
                background: 'transparent',
                border:     `1px solid ${t.teal}66`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.teal }} />
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 leading-tight flex-1">
                  <p className="font-mono uppercase truncate" style={{ fontSize: '0.58rem', letterSpacing: '0.14em', color: t.text }}>
                    {tr('sidebar.reset_database', 'Reset Database')}
                  </p>
                  <p className="font-mono truncate" style={{ fontSize: '0.55rem', letterSpacing: '0.06em', color: t.dim, marginTop: '2px' }}>
                    {tr('sidebar.status_live', 'Status Live')}
                  </p>
                </div>
                <span
                  className="font-mono shrink-0"
                  style={{
                    fontSize:    '0.52rem',
                    letterSpacing: '0.04em',
                    color:       t.teal,
                    border:      `1px solid ${t.teal}55`,
                    padding:     '1px 5px',
                  }}
                >
                  {resettingDb ? 'Resetting…' : APP_VERSION}
                </span>
              </>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="mx-2 mb-2 mt-1 h-8 flex items-center justify-center shrink-0"
          style={{ border: `1px solid ${t.rule}`, color: t.nav, background: 'transparent' }}
          aria-label={collapsed
            ? tr('sidebar.expand_sidebar', 'Expand sidebar')
            : tr('sidebar.collapse_sidebar', 'Collapse sidebar')}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </aside>
    </>
  );
}
