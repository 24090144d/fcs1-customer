'use client';

import { AlertTriangle } from 'lucide-react';

interface DuplicateWarningProps {
  fileName:           string;
  previousFileName:   string;
  firstUploadedAt:    string;     // ISO 8601
  onDismiss:          () => void; // Cancel — recommended
  onContinue:         () => void; // Override — proceed anyway
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function DuplicateWarning({
  fileName,
  previousFileName,
  firstUploadedAt,
  onDismiss,
  onContinue,
}: DuplicateWarningProps) {
  const sameFile = fileName === previousFileName;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle size={15} className="text-amber-600" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <div>
            <p className="font-sans font-semibold text-amber-900 text-sm">
              Duplicate File Detected
            </p>
            <p className="font-sans text-xs text-amber-800 leading-relaxed mt-1">
              {sameFile
                ? 'This exact file has already been uploaded.'
                : 'A file with identical content was previously uploaded under a different name.'}
              {' '}Previously uploaded as{' '}
              <code className="font-mono bg-amber-100 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded text-[11px] break-all">
                {previousFileName}
              </code>
              {' '}on {fmtDate(firstUploadedAt)}.
            </p>
          </div>

          {/* Recommendation */}
          <div className="rounded-lg bg-amber-100 border border-amber-200 px-3 py-2">
            <p className="font-sans text-[11px] font-semibold text-amber-900 mb-0.5">
              Recommendation
            </p>
            <p className="font-sans text-[11px] text-amber-800 leading-relaxed">
              Cancel this upload and verify whether the data has already been processed.
              If you need to overwrite existing records, switch the upload mode to{' '}
              <span className="font-semibold">Replace</span> before continuing.
            </p>
          </div>

          {/* Actions — Cancel is primary in V1 */}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={onDismiss}
              className="font-sans text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-md transition-colors"
            >
              Cancel upload
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="font-sans text-xs font-medium text-amber-800 hover:text-amber-900 px-3 py-1.5 transition-colors"
            >
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
