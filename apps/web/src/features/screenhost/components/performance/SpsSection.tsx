import { Info } from 'lucide-react';

import { SectionHeading } from './SectionHeading';

/**
 * S08 — "Votre score de priorité". DEVIATION (ruled): PERMANENTLY the empty variant — the SPS
 * engine does not exist yet, so ranking/score/criteria all read 'À venir' with 0% bars. Never
 * show invented numbers.
 */
const CRITERIA = [
  { name: 'Acceptation des campagnes', weight: 'poids 25 %' },
  { name: 'Respect des événements acceptés', weight: 'poids 30 %' },
  { name: 'Activité de votre écran', weight: 'poids 20 %' },
  { name: 'Taux de remplissage', weight: 'poids 10 %' },
];

export function SpsSection() {
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
            À venir
          </div>
        </div>

        <div className="mb-7 flex flex-col gap-5">
          {CRITERIA.map((criterion) => (
            <div key={criterion.name}>
              <div className="mb-2 flex items-baseline gap-2 text-[13.5px] text-perf-ink">
                {criterion.name}
                <span className="perf-mono text-[10px] text-perf-mist">{criterion.weight}</span>
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
