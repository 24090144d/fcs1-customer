'use client';

import { FileSpreadsheet, X, CheckCircle2, XCircle } from 'lucide-react';

export interface ParsedFileName {
  chainCode:   string;
  hotelCode:   string;
  hotelName:   string;
  module:      string;
  countryCode: string;
  dataRange:   string;
  isValid:     boolean;
}

interface FileMetadataProps {
  file:     File;
  parsed:   ParsedFileName | null;
  onRemove: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024)             return `${bytes} B`;
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const FIELD_LABELS: [keyof Omit<ParsedFileName, 'isValid'>, string][] = [
  ['chainCode',   'Chain Code'],
  ['hotelCode',   'Hotel Code'],
  ['hotelName',   'Hotel Name'],
  ['module',      'Module'],
  ['countryCode', 'Country'],
  ['dataRange',   'Data Range'],
];

export function FileMetadata({ file, parsed, onRemove }: FileMetadataProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">

      {/* File row */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <FileSpreadsheet size={17} className="text-emerald-600" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-sans font-semibold text-slate-800 text-sm truncate leading-tight">
            {file.name}
          </p>
          <p className="font-sans text-xs text-slate-400 mt-0.5">{formatSize(file.size)}</p>
        </div>

        <button
          onClick={onRemove}
          aria-label="Remove selected file"
          className="text-slate-300 hover:text-slate-600 transition-colors shrink-0 p-1 rounded hover:bg-slate-100"
        >
          <X size={15} />
        </button>
      </div>

      {/* Parsed breakdown */}
      <div className="px-4 py-4 space-y-3">

        {/* Status row */}
        <div className="flex items-center gap-1.5">
          {parsed ? (
            <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
          ) : (
            <XCircle size={13} className="text-red-500 shrink-0" />
          )}
          <span className="font-sans text-xs font-semibold text-slate-600">
            {parsed ? 'File name format valid' : 'Invalid file name format'}
          </span>
        </div>

        {parsed && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {FIELD_LABELS.map(([key, label]) => (
              <div key={key} className="bg-slate-50 rounded-lg p-2.5 min-w-0">
                <p className="text-[10px] font-sans font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">
                  {label}
                </p>
                <p className="font-sans font-semibold text-slate-700 text-sm truncate">
                  {parsed[key] || '—'}
                </p>
              </div>
            ))}
          </div>
        )}

        {!parsed && (
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5">
            <p className="font-sans text-xs text-slate-600 leading-relaxed">
              Expected:{' '}
              <code className="font-mono text-red-600 bg-red-100 px-1 rounded">
                [ChainCode]-[HotelCode]-[HotelName]-[Module]-[CountryCode]-[DataRange].csv
              </code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
