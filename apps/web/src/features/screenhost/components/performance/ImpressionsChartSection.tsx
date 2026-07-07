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

import { CHART_DEEP } from './chart-colors';
import { ChartPlaceholder } from './Pending';
import { SectionHeading } from './SectionHeading';

interface ImpressionsChartSectionProps {
  /** The period's delivered-impressions days (already filtered, ascending). */
  days: DailyImpressionsPoint[];
}

/** S03 — "Évolution des impressions": the per-day delivered impressions of the period. */
export function ImpressionsChartSection({ days }: ImpressionsChartSectionProps) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 03"
        title="Évolution des impressions"
        lead="Volume d'impressions servies dans votre lieu, jour par jour, sur la période analysée."
      />
      <div className="mt-5 rounded-xl border border-gray-100 p-4">
        <div className="flex items-baseline justify-between">
          <div className="font-semibold text-brand-deep">Impressions par jour</div>
          <div className="text-xs text-gray-400">Sur la période sélectionnée</div>
        </div>
        <div className="mt-3">
          {days.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="impressionsArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_DEEP} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={CHART_DEEP} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    tickFormatter={(d) => formatDateFr(String(d)).slice(0, 5)}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={44} />
                  <Tooltip
                    formatter={(v) => [formatIntFr(Number(v)), 'Impressions servies']}
                    labelFormatter={(d) => formatDateFr(String(d))}
                  />
                  <Area
                    type="monotone"
                    dataKey="impressions"
                    stroke={CHART_DEEP}
                    strokeWidth={2}
                    fill="url(#impressionsArea)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartPlaceholder />
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <span className="h-2 w-2 rounded-full bg-brand-deep" aria-hidden />
          Impressions servies
        </div>
      </div>
    </section>
  );
}
