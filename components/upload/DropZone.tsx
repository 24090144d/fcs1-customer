'use client';

import { useRef, useCallback } from 'react';
import { UploadCloud, FileSpreadsheet } from 'lucide-react';
import { useI18n } from '@/components/layout/I18nProvider';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  dragActive: boolean;
  onDragChange: (active: boolean) => void;
  disabled?: boolean;
}

export function DropZone({ onFileSelect, dragActive, onDragChange, disabled = false }: DropZoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      onDragChange(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      if (file?.name.toLowerCase().endsWith('.csv')) {
        onFileSelect(file);
      }
    },
    [onFileSelect, onDragChange, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
      e.target.value = ''; // allow re-selecting same file
    },
    [onFileSelect]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!disabled) onDragChange(true);
    },
    [onDragChange, disabled]
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={t('onboarding.dropzone_aria', 'Upload CSV file — drag and drop or click to browse')}
      onDragOver={handleDragOver}
      onDragLeave={() => onDragChange(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && !disabled && inputRef.current?.click()}
      className={[
        'relative flex flex-col items-center justify-center gap-5',
        'min-h-[220px] rounded-xl border-2 border-dashed px-8 py-10',
        'transition-all duration-150 outline-none',
        !disabled && 'cursor-pointer',
        dragActive
          ? 'border-gold bg-amber-50/60 scale-[1.005]'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/60',
        disabled && 'opacity-50 cursor-not-allowed',
      ].join(' ')}
    >
      {/* Icon */}
      <div
        className={[
          'w-14 h-14 rounded-2xl flex items-center justify-center transition-colors',
          dragActive ? 'bg-gold/15' : 'bg-white border border-slate-200 shadow-sm',
        ].join(' ')}
      >
        {dragActive ? (
          <UploadCloud size={26} className="text-gold" />
        ) : (
          <FileSpreadsheet size={24} className="text-slate-400" />
        )}
      </div>

      {/* Text */}
      <div className="text-center space-y-1 pointer-events-none">
        <p className="font-sans font-semibold text-slate-700 text-sm">
          {dragActive ? t('onboarding.dropzone_release', 'Release to upload') : t('onboarding.dropzone_drag', 'Drag & drop your CSV file')}
        </p>
        <p className="font-sans text-sm text-slate-500">
          or{' '}
          <span className="text-gold font-semibold underline underline-offset-2 pointer-events-auto">
            {t('onboarding.dropzone_browse', 'browse files')}
          </span>
        </p>
      </div>

      {/* Format hint */}
      <div className="text-center pointer-events-none space-y-1">
        <p className="font-sans text-xs font-semibold text-slate-500">
          Supports IM, JO, and MO CSV files
        </p>
        <p className="font-mono text-[11px] text-slate-400 bg-slate-100 rounded px-2.5 py-1 inline-block">
          [ChainCode]-[HotelCode]-[HotelName]-[Module]-[CountryCode]-[DataRange].csv
        </p>
        <p className="font-sans text-xs text-slate-400">
          {t('onboarding.dropzone_limit', '.csv only · max 50 MB')}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
