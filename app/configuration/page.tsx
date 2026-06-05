'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, RotateCcw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useI18n } from '@/components/layout/I18nProvider';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { APP_VERSION } from '@/lib/version';

type ResetStatus = 'idle' | 'running' | 'success' | 'error';

export default function ConfigurationPage() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [dark, setDark] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ResetStatus>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const html = document.documentElement;
    setDark(html.classList.contains('dark'));
    const obs = new MutationObserver(() => setDark(html.classList.contains('dark')));
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const tokens = useMemo(() => getAppThemeTokens(theme, dark), [theme, dark]);
  const panelBg = dark ? '#171D1E' : '#FAF7F2';
  const panelBorder = dark ? '#35505A' : '#D9C8A8';
  const muted = dark ? '#9CA9A5' : '#6B6253';
  const text = dark ? '#F4EFE5' : '#1A1714';
  const inputBg = dark ? '#101516' : '#fff';
  const inputText = dark ? '#F4EFE5' : '#1A1714';
  const accent = tokens.accent;
  const danger = '#C55A10';

  async function resetDatabase() {
    const trimmed = password.trim();
    if (!trimmed) {
      setStatus('error');
      setMessage(t('configuration.reset_password_empty', 'Password is required.'));
      return;
    }

    const confirmed = window.confirm(
      `${t('configuration.reset_confirm_title', 'Reset Database?')}\n\n${t('configuration.reset_confirm_body', 'This will truncate all uploaded data and keep the schema. Continue?')}`
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
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (!res.ok) {
        setStatus('error');
        setMessage(body.error ?? t('configuration.reset_failed', 'Reset failed.'));
        return;
      }
      setStatus('success');
      setPassword('');
      setMessage(body.message ?? t('configuration.reset_success', 'Database reset completed.'));
      window.setTimeout(() => {
        window.location.href = '/onboarding';
      }, 900);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : t('configuration.reset_failed', 'Reset failed.'));
    }
  }

  return (
    <AppLayout breadcrumbs={[{ label: t('configuration.breadcrumb', 'Configuration') }]}>
      <div className="grain min-h-full px-6 py-7" style={{ background: tokens.appBg }}>
        <div className="max-w-5xl">
          <header className="mb-6">
            <h1 className="font-serif text-2xl font-bold leading-tight" style={{ color: text }}>
              {t('configuration.page_title', 'Configuration')}
            </h1>
            <p className="mt-1 font-mono" style={{ color: muted, fontSize: '0.68rem', letterSpacing: '0.05em' }}>
              {t('configuration.page_subtitle', 'System settings and administrative actions.')} · {APP_VERSION}
            </p>
          </header>

          <section
            className="max-w-3xl p-5"
            style={{ background: panelBg, border: `1px solid ${panelBorder}`, borderRadius: 6 }}
          >
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 h-9 w-9 shrink-0 grid place-items-center"
                style={{ border: `1px solid ${danger}66`, color: danger, background: dark ? '#241914' : '#FFF7ED' }}
              >
                <Database size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-xl font-semibold" style={{ color: text }}>
                  {t('configuration.reset_title', 'Reset Database')}
                </h2>
                <p className="mt-1 text-sm leading-6" style={{ color: muted }}>
                  {t('configuration.reset_description', 'Truncate uploaded records and generated dashboard data while keeping the current database schema.')}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (status !== 'running') {
                    setStatus('idle');
                    setMessage('');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void resetDatabase();
                }}
                className="w-full px-3 py-2 font-mono outline-none focus:ring-1"
                style={{
                  border: `1px solid ${panelBorder}`,
                  background: inputBg,
                  color: inputText,
                  fontSize: '0.76rem',
                  '--tw-ring-color': accent,
                } as React.CSSProperties}
                placeholder={t('configuration.reset_password_placeholder', 'Reset password')}
                disabled={status === 'running'}
              />
              <button
                type="button"
                onClick={() => void resetDatabase()}
                disabled={status === 'running'}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 font-mono uppercase transition-opacity hover:opacity-85 disabled:opacity-60"
                style={{
                  background: danger,
                  color: '#FAF7F2',
                  fontSize: '0.68rem',
                  letterSpacing: '0.08em',
                }}
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
                  border: `1px solid ${status === 'success' ? accent : danger}55`,
                  background: status === 'success' ? `${accent}14` : `${danger}12`,
                  color: status === 'success' ? accent : danger,
                }}
              >
                {status === 'success' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                <p className="font-mono" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>{message}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppLayout>
  );
}
