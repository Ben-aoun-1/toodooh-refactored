import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { AXIS_LINE, AXIS_TICK } from '@/features/screenhost/components/performance/chart-colors';
import { formatIntFr } from '@/features/screenhost/lib/performance-derive';
import { formatDateFr } from '@/features/screenhost/lib/performance-period';

import { WAITING_FOOTPRINT, WAITING_TITLE } from '../../lib/performances-derive';
import type { FootprintWire } from '../../services/performances.service';

import { CHART_DEEP, CHART_GREEN, WaitingCard } from './shared';

/**
 * Epic 5 — « Empreinte cumulée » (RG-PERF-13/14): two graphs side by side, x = time since the
 * advertiser's first clôture, y = the cumulative value; only closed campaigns contribute; own
 * waiting state pre-first-clôture (US-5.2). Filter-independent.
 */
function HeroCard({
  label,
  total,
  suffix,
  series,
  dataKey,
  color,
  gradientId,
}: {
  label: string;
  total: number;
  suffix: string;
  series: FootprintWire['points'];
  dataKey: 'impressions_cumulative' | 'hours_cumulative';
  color: string;
  gradientId: string;
}) {
  return (
    <div className="rounded-[14px] border border-perf-line bg-white p-6 pb-[18px] transition-shadow hover:shadow-[0_4px_18px_rgba(16,37,26,0.05)]">
      <div className="text-[12.5px] font-medium text-perf-grey">{label}</div>
      <div className="mt-2.5 text-[32px] font-semibold tracking-[-0.02em] text-perf-ink">
        {formatIntFr(total)}
        <span className="ml-1 text-[15px] font-medium tracking-normal text-perf-mist">
          {suffix}
        </span>
      </div>
      <div className="mt-3.5 aspect-[400/140] w-full rounded-xl border border-perf-line bg-white px-3 py-2.5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="closed_on"
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
              width={48}
              tickCount={4}
              allowDecimals={false}
              tickFormatter={(v) => formatIntFr(Number(v))}
            />
            <Tooltip
              formatter={(v) => [`${formatIntFr(Number(v))} ${suffix}`, label]}
              labelFormatter={(d, payload) => {
                const name = (payload?.[0]?.payload as { name?: string } | undefined)?.name;
                return `${formatDateFr(String(d))}${name ? ` · ${name}` : ''}`;
              }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2.2}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FootprintSection({ footprint }: { footprint: FootprintWire }) {
  const hasClosed = footprint.points.length > 0;
  return (
    <section className="mb-[64px]">
      <div className="perf-mono inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-perf-green">
        <span className="h-1.5 w-1.5 rounded-full bg-perf-green" aria-hidden />
        Votre impact depuis le début
      </div>
      <h2 className="mt-3.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-perf-ink sm:text-[28px]">
        Empreinte cumulée
      </h2>
      <p className="mt-3 max-w-[640px] text-[15px] leading-[1.6] text-perf-grey">
        Vos impressions générées et heures de diffusion, cumulées depuis le début. Seules les
        campagnes clôturées y contribuent.
      </p>
      <div className="mt-6">
        {hasClosed ? (
          <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
            <HeroCard
              label="Impressions générées depuis le début"
              total={footprint.totals.impressions}
              suffix="impr."
              series={footprint.points}
              dataKey="impressions_cumulative"
              color={CHART_GREEN}
              gradientId="scpFootprintImpr"
            />
            <HeroCard
              label="Heures de diffusion depuis le début"
              total={footprint.totals.hours}
              suffix="h"
              series={footprint.points}
              dataKey="hours_cumulative"
              color={CHART_DEEP}
              gradientId="scpFootprintHours"
            />
          </div>
        ) : (
          <WaitingCard title={WAITING_TITLE} text={WAITING_FOOTPRINT} />
        )}
      </div>
    </section>
  );
}
