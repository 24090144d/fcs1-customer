'use client';

import { useState, useEffect, Suspense } from 'react';
import { Menu } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useI18n } from './I18nProvider';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface AppLayoutProps {
  children:     React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  headerRight?: React.ReactNode;
}

export function AppLayout({ children, breadcrumbs, headerRight }: AppLayoutProps) {
  return <AppLayoutInner breadcrumbs={breadcrumbs} headerRight={headerRight}>{children}</AppLayoutInner>;
}

function AppLayoutInner({ children, breadcrumbs, headerRight }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const { t } = useI18n();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('sidebar-pinned');
      if (stored !== null) setPinned(stored === 'true');
    } catch { /* ignore */ }
  }, []);

  function togglePin() {
    setPinned(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-pinned', String(next)); } catch { /* ignore */ }
      if (!next) setSidebarOpen(false);
      return next;
    });
  }

  return (
    <div className="grain flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible" style={{ background: '#F5F0E8' }}>
      <Suspense fallback={null}>
        <AppSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          pinned={pinned}
          onTogglePin={togglePin}
        />
      </Suspense>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden print:block print:h-auto print:overflow-visible">

        {/* Top bar */}
        <header
          className="flex items-center gap-3 px-4 md:px-6 h-12 shrink-0 print:hidden"
          style={{ background: '#FAF7F2', borderBottom: '1px solid #D9C8A8' }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className={['transition-colors -ml-1', pinned ? 'lg:hidden' : ''].join(' ')}
            style={{ color: '#6B6560' }}
            aria-label={t('layout.open_menu', 'Open menu')}
          >
            <Menu size={18} />
          </button>

          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 font-mono">
              {breadcrumbs.map((bc, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && (
                    <span style={{ fontSize: '0.65rem', color: '#C4B090', userSelect: 'none' }}>/</span>
                  )}
                  <span
                    style={{
                      fontSize:      '0.65rem',
                      letterSpacing: '0.04em',
                      color: i === breadcrumbs.length - 1 ? '#1A1714' : '#8A857E',
                      fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                    }}
                  >
                    {bc.label === 'Dashboard'
                      ? t('layout.breadcrumb_dashboard', bc.label)
                      : bc.label === 'Onboarding'
                        ? t('layout.breadcrumb_onboarding', bc.label)
                        : bc.label === 'Upload CSV'
                          ? t('layout.breadcrumb_upload_csv', bc.label)
                          : bc.label}
                  </span>
                </span>
              ))}
            </nav>
          )}

          <div className="flex-1" />
          <LanguageSwitcher />
          {headerRight}
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto print:overflow-visible print:h-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
