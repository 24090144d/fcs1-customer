'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Upload, X, Pin, PinOff, ChevronRight, PanelLeftClose, PanelLeftOpen, Hourglass, Palette, Wrench, Check, PieChart, BarChart2, LineChart, Settings, Sparkles, LayoutDashboard, Globe } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavChain } from '@/app/api/nav/dashboards/route';
import { loadMyDashConfig, type MyDashScope } from '@/lib/my-dashboard-defs';
import { APP_VERSION } from '@/lib/version';
import { useI18n } from './I18nProvider';
import { useTheme } from './ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';

interface AppSidebarProps {
  open:        boolean;
  onClose:     () => void;
  pinned:      boolean;
  onTogglePin: () => void;
}

// ── Section label with hair tick ──────────────────────────────────────────────

function SectionLabel({ label, T: t }: { label: string; T: { dim: string; rule: string } }) {
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

function moduleLabel(moduleCode: string): string {
  return moduleCode === 'co' ? 'CO ACSR' : moduleCode.toUpperCase();
}

// ── Nav item — 4px left border accent (mirrors KPI / chart card spec) ─────────

function NavItem({
  href, active, onClose, onNavigateStart, T: t, collapsed, children,
}: {
  href: string; active: boolean; onClose: () => void; onNavigateStart?: () => void; T: { text: string; nav: string; hoverBg: string; accent: string }; collapsed: boolean; children: React.ReactNode;
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
        background: active ? `${t.accent}2A` : hovered ? t.hoverBg : 'transparent',
        borderLeft: '4px solid transparent',
        outline:    active ? `1px solid ${t.accent}66` : 'none',
        boxShadow:  active ? `inset 4px 0 0 ${t.accent}, inset 0 0 0 1px ${t.accent}33` : 'none',
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
  const [collapsed, setCollapsed] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [hasPublishedBuilder, setHasPublishedBuilder] = useState(false);
  const [myDashLinks, setMyDashLinks] = useState<{ scope: MyDashScope; chain: string; hotels: string[] }[]>([]);
  const { t: tr } = useI18n();
  const { theme, setTheme, options } = useTheme();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
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

  const fetchNav = useCallback(() => {
    fetch('/api/nav/dashboards?t=' + Date.now())
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
  }, [currentHotel, currentModule]);

  useEffect(() => { fetchNav(); }, [pathname, fetchNav]);

  // Re-fetch nav whenever a DB reset fires this event (stays on /configuration,
  // so pathname doesn't change — the event is the only trigger).
  useEffect(() => {
    window.addEventListener('fcs1:nav-refresh', fetchNav);
    return () => window.removeEventListener('fcs1:nav-refresh', fetchNav);
  }, [fetchNav]);

  useEffect(() => {
    fetch(`/api/ai/charts/list?user_id=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => {
        const published = (d.charts ?? []).some((c: { is_published?: boolean; is_hidden?: boolean }) => (c.is_published ?? false) && !(c.is_hidden ?? false));
        setHasPublishedBuilder(published);
      })
      .catch(() => {});
  }, [pathname, userId]);

  // Published "My Dashboard" entries (localStorage, written by Configuration → My Dashboard)
  useEffect(() => {
    const reload = () => {
      const links: { scope: MyDashScope; chain: string; hotels: string[] }[] = [];
      for (const scope of ['hotel', 'corp'] as MyDashScope[]) {
        const cfg = loadMyDashConfig(scope);
        if (!cfg.published || !cfg.chain) continue;
        // Always one entry per scope — hotel scope carries the full hotels[] list
        links.push({ scope, chain: cfg.chain, hotels: scope === 'hotel' ? (cfg.hotels ?? []) : [] });
      }
      setMyDashLinks(links);
    };
    reload();
    window.addEventListener('storage', reload);
    window.addEventListener('fcs1:mydash-refresh', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('fcs1:mydash-refresh', reload);
    };
  }, []);

  useEffect(() => {
    setNavigating(false);
  }, [pathname, currentHotel, currentModule]);

  useEffect(() => {
    if (!navigating) return;
    const timer = window.setTimeout(() => setNavigating(false), 8000);
    return () => window.clearTimeout(timer);
  }, [navigating]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!themeMenuRef.current?.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [themeMenuOpen]);

  const themeTokens = getAppThemeTokens(theme, dark);
  const t = {
    ...themeTokens.sidebar,
    accent: themeTokens.accent,
  };

  return (
    <>
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
          <div className={`flex items-center ${collapsed ? 'justify-center w-full' : 'gap-2.5'} min-w-0 relative`} ref={themeMenuRef}>
            <button
              type="button"
              onClick={() => setThemeMenuOpen((prev) => !prev)}
              className="w-6 h-6 flex items-center justify-center shrink-0 transition-opacity hover:opacity-80"
              style={{ background: 'transparent', border: `1px solid ${themeTokens.accent}` }}
              aria-label="Select theme"
              aria-expanded={themeMenuOpen}
            >
              <Palette size={12} style={{ color: themeTokens.accent }} />
            </button>
            {!collapsed && (
              <span
                className="font-mono uppercase truncate"
                style={{ fontSize: '0.66rem', letterSpacing: '0.22em', color: t.text }}
              >
                {tr('sidebar.brand_title', 'FCS1 Dashboard')}
              </span>
            )}
            {themeMenuOpen && (
              <div
                className="absolute left-0 top-9 z-50 min-w-[180px] p-1.5"
                style={{
                  background: t.menuBg,
                  border: `1px solid ${t.menuBorder}`,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
                }}
              >
                {options.map((option) => {
                  const active = option.value === theme;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setTheme(option.value);
                        setThemeMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-2 text-left transition-colors"
                      style={{
                        background: active ? t.menuSelectedBg : 'transparent',
                        color: active ? t.text : t.nav,
                      }}
                    >
                      <span
                        className="font-mono uppercase"
                        style={{ fontSize: '0.68rem', letterSpacing: '0.14em' }}
                      >
                        {option.label}
                      </span>
                      {active && <Check size={12} style={{ color: themeTokens.accent }} />}
                    </button>
                  );
                })}
              </div>
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

        {/* ── My Dashboard (published via Configuration → My Dashboard) ──── */}
        {myDashLinks.length > 0 && (
          <>
            {!collapsed && <SectionLabel label={tr('sidebar.section_my_dashboard', 'My Dashboard')} T={t} />}
            <nav className="px-1 shrink-0">
              {myDashLinks.map(({ scope, chain, hotels }) => {
                // Single hotel → pass it explicitly; multiple → let page default to first
                const firstHotel = hotels.length === 1 ? hotels[0] : '';
                const href = `/my-dashboard?scope=${scope}&chain=${encodeURIComponent(chain)}${firstHotel ? `&hotel=${encodeURIComponent(firstHotel)}` : ''}`;
                const active = pathname === '/my-dashboard' && (searchParams.get('scope') ?? 'hotel') === scope;
                const hotelSuffix = scope === 'hotel'
                  ? (hotels.length === 1 ? ` · ${hotels[0]}` : hotels.length > 1 ? ` · ${hotels.length} hotels` : '')
                  : '';
                return (
                  <NavItem
                    key={`${scope}-${chain}`}
                    href={href}
                    active={active}
                    onClose={onClose}
                    onNavigateStart={() => setNavigating(true)}
                    T={t}
                    collapsed={collapsed}
                  >
                    {scope === 'corp'
                      ? <Globe size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                      : <LayoutDashboard size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />}
                    {!collapsed && (
                      <span className="truncate">
                        {scope === 'hotel' ? 'My Hotel' : 'My Corp'}
                        <span style={{ opacity: 0.55 }}>{' · '}{chain}{hotelSuffix}</span>
                      </span>
                    )}
                  </NavItem>
                );
              })}
            </nav>
          </>
        )}

        {/* ── Workspace nav ──────────────────────────────────────────────── */}
        {!collapsed && <SectionLabel label={tr('sidebar.section_workspace', 'Workspace')} T={t} />}
        <nav className="px-1 shrink-0">
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
            const moduleGroups = (['im', 'jo', 'mo', 'co'] as const).map((m) => ({
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
                              {moduleLabel(group.module)}
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
                              ) : item.module === 'mo' ? (
                                <Wrench size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                              ) : item.module === 'co' ? (
                                <Sparkles size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                              ) : (
                                <LineChart size={14} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                              )}
                              {!collapsed && (
                                <span className="truncate">
                                  {isCorp ? (
                                      <span style={{ fontWeight: 700, color: active ? '#F4C27A' : '#DDA15E' }}>
                                      Corp · {moduleLabel(item.module)}
                                    </span>
                                  ) : (
                                    <>
                                      <span style={{ fontWeight: 600 }}>{item.hotel_code}</span>
                                      <span style={{ opacity: 0.55 }}>
                                        {' · '}
                                        {moduleLabel(item.module)}
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

          {/* Builder rollout menu below chain section */}
          {hasPublishedBuilder && (
            <div className="mt-3 px-1">
              {!collapsed && <SectionLabel label="Builder" T={t} />}
              <NavItem
                href="/dashboard-im"
                active={pathname === '/dashboard-im'}
                onClose={onClose}
                onNavigateStart={() => setNavigating(true)}
                T={t}
                collapsed={collapsed}
              >
                <BarChart2 size={14} strokeWidth={pathname === '/dashboard-im' ? 2.5 : 2} className="shrink-0" />
                {!collapsed && 'Dashboard · IM'}
              </NavItem>
            </div>
          )}
        </div>

        {/* ── User strip ─────────────────────────────────────────────────── */}
        <Link
          href="/configuration"
          onClick={() => {
            if (pathname !== '/configuration') setNavigating(true);
            onClose();
          }}
          aria-label={tr('sidebar.configuration', 'Configuration')}
          className={`${collapsed ? 'px-2' : 'px-4'} py-3 shrink-0`}
          style={{
            borderTop: `1px solid ${t.border}`,
            background: pathname === '/configuration' ? `${t.accent}22` : t.band,
            boxShadow: pathname === '/configuration' ? `inset 4px 0 0 ${t.accent}` : 'none',
          }}
        >
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} min-w-0`}>
            <div
              className="w-6 h-6 flex items-center justify-center shrink-0"
              style={{
                background: 'transparent',
                border:     `1px solid ${t.accent}66`,
              }}
            >
              <Settings size={12} style={{ color: t.accent }} />
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 leading-tight flex-1">
                  <p className="font-mono uppercase truncate" style={{ fontSize: '0.58rem', letterSpacing: '0.14em', color: t.text }}>
                    {tr('sidebar.configuration', 'Configuration')}
                  </p>
                  <p className="font-mono truncate" style={{ fontSize: '0.55rem', letterSpacing: '0.06em', color: t.dim, marginTop: '2px' }}>
                    {tr('sidebar.configuration_status', 'System Settings')}
                  </p>
                </div>
                <span
                  className="font-mono shrink-0"
                  style={{
                    fontSize:    '0.52rem',
                    letterSpacing: '0.04em',
                    color:       t.accent,
                    border:      `1px solid ${t.accent}55`,
                    padding:     '1px 5px',
                  }}
                >
                  {APP_VERSION}
                </span>
              </>
            )}
          </div>
        </Link>
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
