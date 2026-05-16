'use client';

import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

export type ValidationSeverity = 'success' | 'error' | 'warning' | 'info';

export interface ValidationMessage {
  id:       string;
  severity: ValidationSeverity;
  message:  string;
}

const SEVERITY_STYLES: Record<
  ValidationSeverity,
  { icon: React.ElementType; iconClass: string; bg: string; border: string; text: string }
> = {
  success: {
    icon:      CheckCircle2,
    iconClass: 'text-emerald-500',
    bg:        'bg-emerald-50',
    border:    'border-emerald-200',
    text:      'text-emerald-800',
  },
  error: {
    icon:      XCircle,
    iconClass: 'text-red-500',
    bg:        'bg-red-50',
    border:    'border-red-200',
    text:      'text-red-800',
  },
  warning: {
    icon:      AlertTriangle,
    iconClass: 'text-amber-500',
    bg:        'bg-amber-50',
    border:    'border-amber-200',
    text:      'text-amber-800',
  },
  info: {
    icon:      Info,
    iconClass: 'text-blue-500',
    bg:        'bg-blue-50',
    border:    'border-blue-200',
    text:      'text-blue-800',
  },
};

interface ValidationPanelProps {
  messages: ValidationMessage[];
}

export function ValidationPanel({ messages }: ValidationPanelProps) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-lg border border-dashed border-slate-200 bg-slate-50">
        <Info size={13} className="text-slate-300 shrink-0" />
        <p className="font-sans text-xs text-slate-400 italic">
          Validation messages will appear here after a file is selected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map(({ id, severity, message }) => {
        const { icon: Icon, iconClass, bg, border, text } = SEVERITY_STYLES[severity];
        return (
          <div
            key={id}
            className={`flex items-start gap-2.5 px-3.5 py-3 rounded-lg border ${bg} ${border}`}
          >
            <Icon size={13} className={`${iconClass} mt-0.5 shrink-0`} />
            <p className={`font-sans text-xs leading-relaxed ${text}`}>{message}</p>
          </div>
        );
      })}
    </div>
  );
}
