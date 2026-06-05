'use client';

import { useState } from 'react';
import type { KpiDef } from '@/types/dashboard';
import { useTheme } from '@/components/layout/ThemeProvider';
import { getAppThemeTokens } from '@/lib/theme';
import { benchmarkLines } from '@/lib/kpi-benchmarks';

// ── Accent assignment ─────────────────────────────────────────────────────────
// Orange border: raw volume / count KPIs
// Teal border:  performance / quality / VIP KPIs
const TEAL_KPIS = new Set(['kpi_02', 'kpi_06', 'kpi_07', 'kpi_08', 'kpi_09', 'kpi_10']);

function accentFor(id: string, accent: string, accentAlt: string, accentTint: string, accentAltTint: string) {
  const isTeal = TEAL_KPIS.has(id);
  return {
    color:       isTeal ? accent : accentAlt,
    colorAlt:    isTeal ? accentAlt : accent,
    subtleBg:    isTeal ? accentTint : accentAltTint,
  };
}

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

// ── Component ─────────────────────────────────────────────────────────────────
interface KpiCardProps { kpi: KpiDef; dark: boolean }

export function KpiCard({ kpi, dark }: KpiCardProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const { theme } = useTheme();
  const tokens = getAppThemeTokens(theme, dark);

  const { color, colorAlt, subtleBg } = accentFor(kpi.id, tokens.accent, tokens.accentAlt, tokens.accentTint, tokens.accentAltTint);
  const borderColor = hovered ? colorAlt : color;

  const na      = !kpi.available;
  const surface = tokens.card.bg;
  const border  = tokens.card.border;
  const label   = tokens.card.label;
  const value   = na ? tokens.card.naValue : tokens.card.value;
  const sub     = tokens.card.sub;

  const tooltipSurface = tokens.card.tooltipBg;
  const tooltipBorder  = tokens.card.tooltipBorder;
  const tooltipText    = tokens.card.tooltipText;

  return (
    <div
      className="relative transition-all duration-150 cursor-default select-none print:break-inside-avoid"
      style={{
        background:   surface,
        border:       `1px solid ${border}`,
        borderLeft:   `4px solid ${borderColor}`,
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
          style={{ background: subtleBg, borderRadius: '10px', transition: 'opacity 180ms' }}
          aria-hidden
        />
      )}

      <div className="relative px-4 pt-3.5 pb-3">
        {/* Label row */}
        <div className="flex items-start justify-between gap-1 mb-2">
          <span
            className="font-mono uppercase leading-tight"
            style={{ fontSize: '0.6rem', letterSpacing: '0.14em', color: label }}
          >
            {kpi.label}
          </span>
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
            borderLeft:   `3px solid ${color}`,
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
