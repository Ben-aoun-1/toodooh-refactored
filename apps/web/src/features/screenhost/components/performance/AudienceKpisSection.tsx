import { AUDIENCE_KPIS_LEAD, NO_MEASURE_NOTE, PER_HOUR_DESC } from '../../lib/audience-copy';
import { type AudienceKpis, formatDecimalFr, formatIntFr } from '../../lib/performance-derive';
import { peakObservedLabel } from '../../lib/performance-period';

import { PENDING_LABEL, PendingValue } from './Pending';
import { SectionHeading } from './SectionHeading';
import { Var } from './Var';

// PERF-R1 — the S01 literals live in lib/audience-copy.ts (pinnable, byte-twinned with the
// PDF's template.ts). Re-exported for compatibility with existing imports.
export { NO_MEASURE_NOTE } from '../../lib/audience-copy';

function KpiLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="perf-mono flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-perf-mist">
      <span className="h-[5px] w-[5px] rounded-full bg-perf-mist opacity-70" aria-hidden />
      {children}
    </div>
  );
}

function KpiValue({
  value,
  suffix,
  compact,
  decimal,
}: {
  value: number | null;
  suffix?: string;
  compact?: boolean;
  /** Render with at most one comma decimal (moyenne/h — Mejri prod-test #3). */
  decimal?: boolean;
}) {
  // The mockup's cascade renders the STACKED cells' pending state at 28px — reproduced as-is.
  if (value === null && compact)
    return (
      <span className="text-[28px] font-semibold italic leading-tight text-perf-mist">
        {PENDING_LABEL}
      </span>
    );
  if (value === null) return <PendingValue />;
  return (
    <span
      className={`font-semibold leading-none tracking-[-0.03em] text-perf-ink ${
        compact ? 'text-[28px]' : 'text-[46px]'
      }`}
    >
      {decimal ? formatDecimalFr(value) : formatIntFr(value)}
      {suffix && (
        <span className="ml-1 text-[17px] font-medium tracking-normal text-perf-grey">
          {suffix}
        </span>
      )}
    </span>
  );
}

interface AudienceKpisSectionProps {
  kpis: AudienceKpis;
  /** HOST first-data flag — once true, KPIs show real values, 0 rendered as 0 (Mejri ruling). */
  hasHostData: boolean;
  /** PERF-QA1 R9 — true when the 14 h open-hours fallback applied (marked « estimation 14 h »). */
  hoursEstimated: boolean;
}

/** S01 — "Votre audience en chiffres": the mockups' ruled KPI row (2px green top border). */
export function AudienceKpisSection({
  kpis,
  hasHostData,
  hoursEstimated,
}: AudienceKpisSectionProps) {
  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 01"
        title="Votre audience en chiffres"
        lead={AUDIENCE_KPIS_LEAD}
      />
      <div className="mt-8 grid grid-cols-1 border-t-2 border-t-perf-green md:grid-cols-3 md:border-b md:border-b-perf-line">
        <div className="border-b border-perf-line py-[22px] md:border-b-0 md:border-r md:border-r-perf-soft md:py-[26px] md:pr-6">
          <KpiLabel>Audience globale</KpiLabel>
          <div className="mt-4">
            <KpiValue value={hasHostData ? kpis.global : null} />
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.45] text-perf-grey">
            {/* PERF-R1 — the « jours mesurés » caption becomes the provenance share. */}
            Personnes touchées dans votre lieu sur la période
            {hasHostData && kpis.estimatedPct !== null && kpis.estimatedPct > 0 ? (
              kpis.estimatedPct === 100 ? (
                <> — 100 % estimation.</>
              ) : (
                <> — dont {kpis.estimatedPct} % estimés.</>
              )
            ) : (
              '.'
            )}
          </p>
        </div>

        <div className="flex flex-col gap-[22px] border-b border-perf-line py-[22px] md:border-b-0 md:border-r md:border-r-perf-soft md:py-[26px] md:pl-6 md:pr-6">
          <div>
            <KpiLabel>Audience moyenne / heure</KpiLabel>
            <div className="mt-4">
              <KpiValue
                value={hasHostData ? (kpis.perHour ?? 0) : null}
                suffix="pers/h"
                compact
                decimal
              />
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.45] text-perf-grey">
              {PER_HOUR_DESC}
              {hoursEstimated ? <> (estimation 14 h).</> : '.'}
            </p>
          </div>
          <div>
            <KpiLabel>Audience moyenne / jour</KpiLabel>
            <div className="mt-4">
              <KpiValue value={hasHostData ? (kpis.perDay ?? 0) : null} compact />
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.45] text-perf-grey">
              Personnes par jour d'ouverture en moyenne.
            </p>
          </div>
        </div>

        <div className="py-[22px] md:py-[26px] md:pl-6">
          <KpiLabel>Pic d'audience</KpiLabel>
          <div className="mt-4">
            {/* US-P.4 — no measure on the period reads « — », never a 0 (which would claim the
                sensor counted nobody) and never a placeholder date. */}
            {hasHostData && !kpis.peak ? (
              <span className="text-[46px] font-semibold leading-none tracking-[-0.03em] text-perf-mist">
                —
              </span>
            ) : (
              <KpiValue value={hasHostData ? (kpis.peak?.value ?? 0) : null} />
            )}
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.45] text-perf-grey">
            {kpis.peak ? (
              <>
                Maximum observé le <Var>{peakObservedLabel(kpis.peak)}</Var>
              </>
            ) : (
              'Aucun maximum observé sur la période.'
            )}
          </p>
        </div>
      </div>

      {/* PERF-R1 — the note renders ONLY when NEITHER a reading NOR a backup cell fed the
          période (measuredDays 0 AND estimatedPct null): with a backup, the caption already
          says « 100 % estimation ». The two-independent-sensors statement stays. */}
      {hasHostData && kpis.measuredDays === 0 && kpis.estimatedPct === null && (
        <p className="mt-4 text-[12.5px] leading-[1.5] text-perf-grey">{NO_MEASURE_NOTE}</p>
      )}
    </section>
  );
}
