import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { type DailyImpressionsPoint, formatIntFr } from '../../lib/performance-derive';
import { formatDateFr } from '../../lib/performance-period';

import { AXIS_LINE, AXIS_TICK, CHART_DEEP } from './chart-colors';
import { ChartPlaceholder } from './Pending';
import { SectionHeading } from './SectionHeading';

interface ImpressionsChartSectionProps {
  /** The period's days — ZERO-FILLED by the page once hasCastData (0 on days without data). */
  days: DailyImpressionsPoint[];
  /** CAST first-data flag — until true, the chart shows the pending placeholder. */
  hasCastData: boolean;
}

/**
 * S03 — "Évolution des impressions": the per-day delivered impressions of the period. Once
 * hasCastData the chart always draws (zero-filled days); the placeholder only remains for the
 * pre-first-data state or a period entirely outside the 400-day fetch window.
 */
export function ImpressionsChartSection({ days, hasCastData }: ImpressionsChartSectionProps) {
  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 03"
        title="Évolution des impressions"
        lead="Volume d'impressions servies dans votre lieu, jour par jour, sur la période analysée."
      />
      <div className="mt-8 rounded-xl border border-perf-line bg-white p-[26px]">
        <div className="mb-[18px] flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[17px] font-semibold text-perf-ink">Impressions par jour</div>
          <div className="perf-mono text-[11px] text-perf-mist">Sur la période sélectionnée</div>
        </div>
        {hasCastData && days.length > 0 ? (
          <div className="aspect-[800/280] w-full rounded-xl border border-perf-line bg-white px-3 py-2.5">
            <ResponsiveContainer width="100%" height="100%">
              {/* right margin ≥ half the last date tick, so the end-of-axis label never clips */}
              <AreaChart data={days} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="impressionsArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_DEEP} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={CHART_DEEP} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F4" />
                <XAxis
                  dataKey="date"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={AXIS_LINE}
                  tickFormatter={(d) => formatDateFr(String(d)).slice(0, 5)}
                  minTickGap={24}
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={AXIS_LINE}
                  width={44}
                  allowDecimals={false}
                  tickFormatter={(v) => formatIntFr(Number(v))}
                />
                <Tooltip
                  formatter={(v) => [formatIntFr(Number(v)), 'Impressions servies']}
                  labelFormatter={(d) => formatDateFr(String(d))}
                />
                <Area
                  type="monotone"
                  dataKey="impressions"
                  stroke={CHART_DEEP}
                  strokeWidth={2.2}
                  fill="url(#impressionsArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartPlaceholder className="aspect-[800/280]" />
        )}
        <div className="perf-mono mt-3.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.04em] text-perf-grey">
          <span className="h-[3px] w-2.5 rounded-sm bg-brand-deep" aria-hidden />
          Impressions servies
        </div>
      </div>
    </section>
  );
}
