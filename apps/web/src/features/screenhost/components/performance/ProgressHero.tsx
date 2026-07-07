import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { type CumulativePoint, formatIntFr, formatTndFr } from '../../lib/performance-derive';
import { formatDateFr } from '../../lib/performance-period';

import { CHART_ACCENT, CHART_GREEN } from './chart-colors';
import { CHART_PENDING_LABEL, PENDING_LABEL } from './Pending';

interface HeroCardProps {
  label: string;
  value: string | null;
  suffix: string;
  series: CumulativePoint[];
  color: string;
  gradientId: string;
}

function HeroCard({ label, value, suffix, series, color, gradientId }: HeroCardProps) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</div>
      {value !== null ? (
        <div className="mt-1 text-3xl font-bold tabular-nums text-brand-deep">
          {value} <span className="text-base font-medium text-gray-400">{suffix}</span>
        </div>
      ) : (
        <div className="mt-1 text-sm font-medium italic text-gray-400">
          {PENDING_LABEL} <span className="not-italic text-gray-300">{suffix}</span>
        </div>
      )}
      <div className="mt-4 h-32">
        {series.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <Tooltip
                formatter={(v) => [formatIntFr(Number(v)), label]}
                labelFormatter={(d) => formatDateFr(String(d))}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-xs italic text-gray-400">
            {CHART_PENDING_LABEL}
          </div>
        )}
      </div>
    </div>
  );
}

interface ProgressHeroProps {
  revenueTotal: number;
  revenueSeries: CumulativePoint[];
  audienceTotal: number;
  audienceSeries: CumulativePoint[];
}

/** §5 — "Votre progression depuis le début": the two cumulative hero charts (unfiltered). */
export function ProgressHero({
  revenueTotal,
  revenueSeries,
  audienceTotal,
  audienceSeries,
}: ProgressHeroProps) {
  return (
    <section>
      <div className="text-xs font-semibold uppercase tracking-widest text-brand-accent">
        Évolution
      </div>
      <h2 className="mt-1 text-xl font-semibold text-brand-deep">
        Votre progression depuis le début
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HeroCard
          label="Revenu généré depuis le début"
          value={revenueSeries.length > 0 ? formatTndFr(revenueTotal) : null}
          suffix="TND"
          series={revenueSeries}
          color={CHART_ACCENT}
          gradientId="heroRevenue"
        />
        <HeroCard
          label="Personnes touchées depuis le début"
          value={audienceSeries.length > 0 ? formatIntFr(audienceTotal) : null}
          suffix="pers."
          series={audienceSeries}
          color={CHART_GREEN}
          gradientId="heroAudience"
        />
      </div>
    </section>
  );
}
