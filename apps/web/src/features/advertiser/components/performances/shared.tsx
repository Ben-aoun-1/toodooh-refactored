import { Clock } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatIntFr } from '@/features/screenhost/lib/performance-derive';

import { barWidthPct } from '../../lib/performances-derive';
import type { ShareWire } from '../../services/performances.service';

/**
 * SC-P — the page's small vocabulary, mirrored from simulator A (the UI/UX authority) in the
 * owner page's Tailwind idiom (perf-* tokens, Geist via .perf-page).
 */

export const CHART_GREEN = '#1D9E75';
export const CHART_DEEP = '#204B43';
export const CHART_ACCENT = '#9195F8';
export const CSP_COLORS = ['#9195F8', '#76E6AB', '#204B43'] as const;
export const SEX_COLORS = ['#9195F8', '#204B43'] as const;

/** The simulator's numbered section header: mono eyebrow with dot, title, lead. */
export function SectionHeading({
  num,
  title,
  lead,
}: {
  num: string;
  title: string;
  lead: ReactNode;
}) {
  return (
    <div>
      <div className="perf-mono inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-perf-green">
        <span className="h-1.5 w-1.5 rounded-full bg-perf-green" aria-hidden />
        {num}
      </div>
      <h2 className="mt-3.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-perf-ink sm:text-[28px]">
        {title}
      </h2>
      <p className="mt-3 max-w-[640px] text-[15px] leading-[1.6] text-perf-grey">{lead}</p>
    </div>
  );
}

/** Simulator B's waiting card — the ONE shape every pre-first-clôture state takes. */
export function WaitingCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-perf-line bg-white px-6 py-12 text-center">
      <Clock className="h-8 w-8 text-perf-mist" strokeWidth={1.6} aria-hidden />
      <div className="mt-4 text-[16px] font-semibold text-perf-ink">{title}</div>
      <p className="mt-2 max-w-[520px] text-[13.5px] leading-[1.6] text-perf-grey">{text}</p>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-perf-line bg-white p-[22px] sm:p-[26px] ${className}`}
    >
      {children}
    </div>
  );
}

export function NaturePill({ nature }: { nature: 'normal' | 'event' }) {
  return (
    <span
      className={`perf-mono inline-flex items-center rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.06em] ${
        nature === 'event' ? 'bg-perf-lavender text-[#4B4FB5]' : 'bg-[#E4F9EB] text-[#0D2B1F]'
      }`}
    >
      {nature === 'event' ? 'Événement' : 'Normale'}
    </span>
  );
}

/** Section 01's KPI cell (the simulator's kpi-cell). */
export function KpiCell({
  label,
  value,
  suffix,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`border-b border-perf-line py-[18px] md:border-b-0 md:border-r md:border-r-perf-soft md:py-[22px] md:pr-5 ${
        accent ? 'md:pl-0' : 'md:pl-5'
      }`}
    >
      <div className="perf-mono inline-flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-perf-grey">
        <span
          className={`h-1.5 w-1.5 rounded-full ${accent ? 'bg-brand-accent' : 'bg-perf-green'}`}
          aria-hidden
        />
        {label}
      </div>
      <div className="mt-2.5 text-[30px] font-semibold leading-none tracking-[-0.03em] text-perf-ink sm:text-[34px]">
        {value}
        {suffix ? (
          <span className="ml-1.5 text-[14px] font-medium tracking-normal text-perf-mist">
            {suffix}
          </span>
        ) : null}
      </div>
      {detail ? (
        <div className="mt-2 text-[12.5px] leading-[1.5] text-perf-grey">{detail}</div>
      ) : null}
    </div>
  );
}

/** A labelled horizontal bar row: « label — pct · value unit » + a fill relative to the max. */
export function BarRow({
  row,
  rows,
  unit,
  color = CHART_GREEN,
  muted = false,
  trailing,
}: {
  row: ShareWire;
  rows: readonly ShareWire[];
  unit: string;
  color?: string;
  muted?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className={muted ? 'opacity-70' : ''}>
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`text-[13.5px] font-medium ${muted ? 'italic text-perf-mist' : 'text-perf-ink'}`}
        >
          {row.label}
          {trailing}
        </span>
        <span className="perf-mono whitespace-nowrap text-[13px] font-semibold text-perf-ink">
          {row.pct.toLocaleString('fr-FR')} %
          <span className="ml-1.5 text-[11.5px] font-medium text-perf-mist">
            {formatIntFr(row.value)} {unit}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-perf-soft">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${barWidthPct(row.value, rows)}%`,
            background: muted ? '#C9CDD3' : color,
          }}
        />
      </div>
    </div>
  );
}

/** The simulator's CSP donut — SVG arcs, centre count + caption. */
export function Donut({
  segments,
  caption,
}: {
  segments: { value: number; color: string }[];
  caption: string;
}) {
  const size = 200;
  const cx = 100;
  const cy = 100;
  const r = 72;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let a0 = -Math.PI / 2;
  const arcs = segments.map((s, i) => {
    const a1 = a0 + (s.value / total) * 2 * Math.PI;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const d = `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
    a0 = a1;
    return s.value > 0 ? (
      <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={26} strokeLinecap="butt" />
    ) : null;
  });
  const nonZero = segments.filter((s) => s.value > 0).length;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto mt-1.5 w-full max-w-[210px]"
      role="img"
      aria-label={caption}
    >
      {arcs}
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="24" fontWeight="700" fill="#10251A">
        {nonZero}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fontSize="10.5"
        fill="#8A9E92"
        className="perf-mono"
      >
        {caption}
      </text>
    </svg>
  );
}

export function LegendDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 text-[12.5px] text-perf-grey">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
      {children}
    </div>
  );
}
