'use client';

import { useI18n } from '@/components/layout/I18nProvider';

export type ProgressStatus = 'uploading' | 'success' | 'error';

interface ProgressBarProps {
  progress: number;  // 0–100
  status:   ProgressStatus;
}

const statusConfig: Record<ProgressStatus, { bar: string; label: string; text: string }> = {
  uploading: { bar: 'bg-gold',        label: 'Uploading…',      text: 'text-slate-600' },
  success:   { bar: 'bg-emerald-500', label: 'Upload complete',  text: 'text-emerald-700' },
  error:     { bar: 'bg-red-500',     label: 'Upload failed',    text: 'text-red-700' },
};

export function ProgressBar({ progress, status }: ProgressBarProps) {
  const { t } = useI18n();
  const base = statusConfig[status];
  const label =
    status === 'uploading'
      ? t('onboarding.status_uploading', base.label)
      : status === 'success'
        ? t('onboarding.status_success', base.label)
        : t('onboarding.status_failed', base.label);
  const { bar, text } = base;
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`font-sans text-xs font-medium ${text}`}>{label}</span>
        <span className="font-sans text-xs font-semibold text-slate-600 tabular-nums">
          {clamped}%
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${bar}`}
          style={{ width: `${clamped}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
