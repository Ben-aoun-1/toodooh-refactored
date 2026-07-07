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
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 08"
        title="Votre score de priorité"
        lead="Le score de priorité reflète votre engagement sur la plateforme. Plus il est élevé, plus vous êtes positionné en priorité quand de nouvelles campagnes sont à diffuser dans le réseau."
      />

      <div className="mt-5 rounded-2xl border border-gray-100 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Classement
            </div>
            <div className="mt-1 text-2xl font-bold text-gray-400">À venir</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Score actuel
            </div>
            <div className="mt-1 text-2xl font-bold text-gray-400">À venir</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CRITERIA.map((criterion) => (
            <div key={criterion.name}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-gray-600">
                  {criterion.name} <span className="text-xs text-gray-400">{criterion.weight}</span>
                </span>
                <span className="text-sm font-medium italic text-gray-400">À venir</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-100" />
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-2 text-xs text-gray-500">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden />
          <p>
            <strong className="font-semibold text-gray-600">Comment lire votre score.</strong> Votre
            score est mis à jour à chaque campagne ou événement. Votre score et votre classement
            sont strictement personnels — vous êtes le seul à pouvoir les consulter.
          </p>
        </div>
      </div>
    </section>
  );
}
