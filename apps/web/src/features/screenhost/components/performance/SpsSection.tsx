import { Info } from 'lucide-react';

import { spsCriteria, spsScoreLabel } from '../../lib/sps-view';
import type { VenueSps } from '../../services/performance.service';

import { SectionHeading } from './SectionHeading';

/** SVG-attribute bar (the DemographicsSection idiom — no inline styles). */
function CriterionBar({ pct }: { pct: number }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <svg className="h-[5px] w-full" role="presentation" aria-hidden>
      <rect width="100%" height="100%" rx="3" className="fill-perf-soft" />
      {width > 0 && <rect width={`${width}%`} height="100%" rx="3" className="fill-perf-green" />}
    </svg>
  );
}

interface SpsSectionProps {
  /** undefined while loading — the card keeps its wait-state until the wire answers. */
  sps: VenueSps | undefined;
  isError: boolean;
}

/**
 * S08 — "Votre score de priorité". PERF-QA1 R6: LIVE from the owner SPS wire — score + the four
 * ruled variables, weights ALWAYS from the dispatch config via the wire (the 25/30/20/10 Σ-85 %
 * hardcode is dead, pinned by test). « À venir » only while the venue has no computable score
 * (wire nulls, loading, or error) — never invented numbers. The Classement stays « À venir »
 * (no ranking data yet).
 */
export function SpsSection({ sps, isError }: SpsSectionProps) {
  const live = !isError && sps !== undefined && sps.sps !== null && sps.variables !== null;
  const criteria = live && sps.variables ? spsCriteria(sps.variables) : null;
  const scoreLabel = live ? spsScoreLabel(sps.sps) : 'À venir';

  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 08"
        title="Votre score de priorité"
        lead="Le score de priorité reflète votre engagement sur la plateforme. Plus il est élevé, plus vous êtes positionné en priorité quand de nouvelles campagnes sont à diffuser dans le réseau."
      />

      <div className="relative mt-8 overflow-hidden rounded-[14px] border border-perf-line bg-white p-[34px]">
        <div className="mb-[18px] inline-block rounded-[10px] border border-perf-line bg-perf-lavender px-[15px] py-[9px] text-right sm:absolute sm:right-[30px] sm:top-[26px] sm:mb-0">
          <div className="perf-mono text-[9px] uppercase tracking-[0.1em] text-perf-mist">
            Classement
          </div>
          <div className="mt-1 text-[15px] font-semibold text-brand-accent">À venir</div>
        </div>

        <div className="mb-8 border-b border-perf-line pb-[26px] sm:pr-[130px]">
          <div className="perf-mono text-[10px] uppercase tracking-[0.1em] text-perf-mist">
            Score actuel
          </div>
          <div className="mt-3 text-[46px] font-semibold leading-none tracking-[-0.025em] text-perf-ink">
            {scoreLabel}
            {live && (
              <span className="ml-1 text-[17px] font-medium tracking-normal text-perf-grey">
                / 100
              </span>
            )}
          </div>
        </div>

        <div className="mb-7 flex flex-col gap-5">
          {criteria
            ? criteria.map((criterion) => (
                <div key={criterion.label}>
                  <div className="mb-2 flex items-baseline gap-2 text-[13.5px] text-perf-ink">
                    {criterion.label}
                    <span className="perf-mono text-[10px] text-perf-mist">
                      {criterion.weightLabel}
                    </span>
                  </div>
                  <div className="perf-mono mb-2 text-[12.5px] font-medium text-perf-grey">
                    {criterion.valueLabel}
                  </div>
                  <CriterionBar pct={criterion.pct} />
                </div>
              ))
            : [
                "Taux d'acceptation des campagnes",
                'Respect des événements acceptés',
                "Activité de l'écran",
                'Taux de remplissage',
              ].map((label) => (
                <div key={label}>
                  <div className="mb-2 flex items-baseline gap-2 text-[13.5px] text-perf-ink">
                    {label}
                  </div>
                  <div className="perf-mono mb-2 text-[12.5px] font-medium italic text-perf-mist">
                    À venir
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-[3px] bg-perf-soft" />
                </div>
              ))}
        </div>

        <div className="flex gap-[13px] border-t border-perf-line pt-[22px]">
          <Info className="mt-0.5 h-[15px] w-[15px] flex-shrink-0 text-perf-mist" aria-hidden />
          <p className="text-[11.5px] leading-[1.6] text-perf-mist">
            <strong className="font-semibold text-perf-grey">Comment lire votre score.</strong>{' '}
            Votre score est mis à jour à chaque campagne ou événement. Votre score et votre
            classement sont strictement personnels — vous êtes le seul à pouvoir les consulter.
          </p>
        </div>
      </div>
    </section>
  );
}
