import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { type CumulativePoint, formatIntFr, formatTndFr } from '../../lib/performance-derive';
import { formatDateFr } from '../../lib/performance-period';

import { CHART_ACCENT, CHART_GREEN } from './chart-colors';
import { ChartPlaceholder, PENDING_LABEL } from './Pending';

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
    <div className="rounded-[14px] border border-perf-line bg-white p-6 pb-[18px] transition-shadow hover:shadow-[0_4px_18px_rgba(16,37,26,0.05)]">
      <div className="text-[12.5px] font-medium text-perf-grey">{label}</div>
      {value !== null ? (
        <div className="mt-2.5 text-[32px] font-semibold tracking-[-0.02em] text-perf-ink">
          {value}
          <span className="ml-1 text-[15px] font-medium tracking-normal text-perf-mist">
            {suffix}
          </span>
        </div>
      ) : (
        <div className="mt-2.5 text-base font-semibold italic text-perf-mist">
          {PENDING_LABEL}
          <span className="ml-1 text-[15px] font-medium not-italic">{suffix}</span>
        </div>
      )}
      <div className="mt-3.5">
        {series.length > 0 ? (
          <div className="aspect-[400/130] w-full rounded-xl border border-perf-line bg-white px-3 py-2.5">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
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
                  strokeWidth={2.2}
                  fill={`url(#${gradientId})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartPlaceholder className="aspect-[400/130]" />
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
  /** HOST flag gates "Personnes touchées"; CAST gates "Revenu généré" (Mejri ruling). */
  hasHostData: boolean;
  hasCastData: boolean;
}

/** §5 — "Votre progression depuis le début": the two cumulative hero charts (unfiltered). */
export function ProgressHero({
  revenueTotal,
  revenueSeries,
  audienceTotal,
  audienceSeries,
  hasHostData,
  hasCastData,
}: ProgressHeroProps) {
  return (
    <section className="mb-10">
      <div className="perf-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-perf-green">
        Évolution
      </div>
      <h2 className="mt-2.5 text-2xl font-semibold tracking-[-0.012em] text-perf-ink">
        Votre progression depuis le début
      </h2>
      <div className="mt-[22px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <HeroCard
          label="Revenu généré depuis le début"
          value={hasCastData ? formatTndFr(revenueTotal) : null}
          suffix="TND"
          series={revenueSeries}
          color={CHART_ACCENT}
          gradientId="heroRevenue"
        />
        <HeroCard
          label="Personnes touchées depuis le début"
          value={hasHostData ? formatIntFr(audienceTotal) : null}
          suffix="pers."
          series={audienceSeries}
          color={CHART_GREEN}
          gradientId="heroAudience"
        />
      </div>
    </section>
  );
}
