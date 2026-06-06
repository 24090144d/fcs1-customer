'use client';

import { useState } from 'react';
import type { KpiDef } from '@/types/dashboard';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { benchmarkLines, benchmarkStatus } from '@/lib/kpi-benchmarks';

// ── Value formatter ───────────────────────────────────────────────────────────
function fmtValue(kpi: KpiDef): string {
  if (!kpi.available || kpi.value === null) return '—';
  if (kpi.fmt !== 'pct1' && Math.abs(kpi.value) >= 100000) {
    return `${Math.round(kpi.value / 1000)}K`;
  }
  if (kpi.fmt === 'integer')  return Math.round(kpi.value).toLocaleString();
  if (kpi.fmt === 'pct1')     return kpi.value.toFixed(1);
  if (kpi.fmt === 'decimal2') return kpi.value.toFixed(2);
  return String(kpi.value);
}

function fmtUnit(kpi: KpiDef): string {
  if (!kpi.available || kpi.value === null) return '';
  if (kpi.fmt === 'pct1') return '%';
  return kpi.unit ?? '';
}

function badgeLabel(status: ReturnType<typeof benchmarkStatus>): string {
  if (status === 'good') return 'GOOD';
  if (status === 'watch') return 'NEEDS IMPROVEMENT';
  if (status === 'bad') return 'BAD';
  return 'INFO';
}

function badgeColors(tokens: ReturnType<typeof getAppThemeTokens>, status: ReturnType<typeof benchmarkStatus>) {
  if (status === 'good') return { border: '#16a34a', bg: 'rgba(22,163,74,0.12)', text: '#16a34a' };
  if (status === 'watch') return { border: '#d97706', bg: 'rgba(217,119,6,0.12)', text: '#d97706' };
  if (status === 'bad') return { border: '#dc2626', bg: 'rgba(220,38,38,0.12)', text: '#dc2626' };
  return { border: tokens.accent, bg: tokens.accentTint, text: tokens.accent };
}

// ── Component ─────────────────────────────────────────────────────────────────
interface KpiCardProps { kpi: KpiDef; dark: boolean }

export function KpiCard({ kpi, dark }: KpiCardProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);
  const status = benchmarkStatus(kpi.benchmark, kpi.value, kpi.available);

  const na      = !kpi.available;
  const surface = tokens.card.bg;
  const border  = tokens.card.border;
  const label   = tokens.card.label;
  const value   = na ? tokens.card.naValue : tokens.card.value;
  const sub     = tokens.card.sub;

  const tooltipSurface = tokens.card.tooltipBg;
  const tooltipBorder  = tokens.card.tooltipBorder;
  const tooltipText    = tokens.card.tooltipText;
  const badge = badgeColors(tokens, status);

  return (
    <div
      className="relative transition-all duration-150 cursor-default select-none print:break-inside-avoid"
      style={{
        background:   surface,
        border:       `1px solid ${border}`,
        borderLeft:   `4px solid ${badge.border}`,
        borderRadius: '10px',
        transition:   'border-left-color 180ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Subtle accent tint on hover */}
      {hovered && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: badge.bg, borderRadius: '10px', transition: 'opacity 180ms' }}
          aria-hidden
        />
      )}

      <div className="relative px-4 pt-3.5 pb-3">
        {/* Label row */}
        <div className="flex items-start justify-between gap-1 mb-2">
          <div className="space-y-1">
            <span
              className="block font-mono uppercase leading-tight"
              style={{ fontSize: '0.6rem', letterSpacing: '0.14em', color: label }}
            >
              {kpi.label}
            </span>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 font-mono"
              style={{
                background: badge.bg,
                color: badge.text,
                fontSize: '0.56rem',
                letterSpacing: '0.12em',
                border: `1px solid ${badge.border}33`,
              }}
            >
              {badgeLabel(status)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowInfo(v => !v)}
            className="shrink-0 mt-0.5 transition-opacity hover:opacity-70"
            aria-label="Show definition"
            style={{ color: label }}
          >
            {/* Inline question-mark glyph — avoids importing Lucide for a single icon */}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1.2"/>
              <text x="6" y="9.2" textAnchor="middle" fontSize="7.5" fontFamily="inherit" fill="currentColor">?</text>
            </svg>
          </button>
        </div>

        {/* Value */}
        <div className="flex items-baseline gap-1 leading-none">
          <span
            className="font-serif font-bold tabular-nums"
            style={{ fontSize: '1.7rem', color: value, lineHeight: 1 }}
          >
            {fmtValue(kpi)}
          </span>
          {!na && fmtUnit(kpi) && (
            <span
              className="font-mono"
              style={{ fontSize: '0.67rem', color: sub, marginBottom: '2px' }}
            >
              {fmtUnit(kpi)}
            </span>
          )}
        </div>

      </div>

      {/* Info tooltip */}
      {showInfo && (
        <div
          className="absolute z-30 top-full left-0 mt-1 w-64 p-3 shadow-xl space-y-1.5"
          style={{
            background:   tooltipSurface,
            border:       `1px solid ${tooltipBorder}`,
            borderLeft:   `3px solid ${badge.border}`,
            borderRadius: '8px',
          }}
        >
          <p className="font-sans leading-relaxed" style={{ fontSize: '0.7rem', color: tooltipText }}>
            {kpi.note}
          </p>
          {kpi.benchmark && (
            <div className="space-y-0.5 pt-1">
              <p className="font-mono uppercase" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: tooltipText }}>
                Benchmark
              </p>
              {benchmarkLines(kpi.benchmark).map((line) => (
                <p
                  key={line}
                  className="font-mono leading-relaxed"
                  style={{ fontSize: '0.62rem', color: sub }}
                >
                  {line}
                </p>
              ))}
            </div>
          )}
          <p
            className="font-mono leading-relaxed"
            style={{ fontSize: '0.62rem', color: sub }}
          >
            {kpi.formula}
          </p>
          {!kpi.available && (
            <p className="font-mono font-semibold" style={{ fontSize: '0.62rem', color: tokens.accentAlt }}>
              Field not available in this upload
            </p>
          )}
        </div>
      )}
    </div>
  );
}
