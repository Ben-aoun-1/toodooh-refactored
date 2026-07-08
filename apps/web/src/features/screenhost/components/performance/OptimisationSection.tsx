import { Sun } from 'lucide-react';

import { SectionHeading } from './SectionHeading';

/**
 * S07 — "Vos pistes d'optimisation futures". DEVIATION (ruled): V1 ships the mockups' GENERIC
 * pistes verbatim — Piste 01 the events copy, Piste 02 the EMPTY file's generic wording, Piste 03
 * the empty SPS variant. No fake personalization.
 */
const PISTES = [
  {
    num: 'Piste 01',
    title: 'Anticipez les temps forts',
    body: "Un grand match international est à l'affiche ce mois-ci (Coupe du Monde, CAN…) — profitez-en pour communiquer sa diffusion et inviter vos clients à venir le suivre dès maintenant sur vos réseaux.",
    numClass: 'text-brand-accent',
    dotClass: 'bg-brand-accent',
    pending: false,
  },
  {
    num: 'Piste 02',
    title: 'Repérez vos angles morts',
    body: 'Vous avez 2 périodes creuses à valoriser autrement. Mardi matin et jeudi après-midi sont vos créneaux les plus faibles — essayez X et Y pour les redynamiser.',
    numClass: 'text-perf-green',
    dotClass: 'bg-perf-green',
    pending: false,
  },
  {
    num: 'Piste 03',
    title: 'Résumé du SPS et recommandations',
    body: 'En attente de votre score de priorité.',
    numClass: 'text-brand-deep',
    dotClass: 'bg-brand-deep',
    pending: true,
  },
];

export function OptimisationSection() {
  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 07"
        title="Vos pistes d'optimisation futures"
        lead="Quelques observations issues de l'activité de votre lieu sur la période, transformées en pistes concrètes pour développer vos revenus."
      />

      <div className="mt-8 flex gap-3.5 rounded-md border border-perf-line border-l-[3px] border-l-brand-deep bg-[#E3EBE8] p-[18px] px-[22px]">
        <Sun className="mt-px h-[17px] w-[17px] flex-shrink-0 text-brand-deep" aria-hidden />
        <p className="text-[12.5px] leading-[1.6] text-perf-grey">
          <strong className="font-semibold text-perf-ink">Lecture personnalisée.</strong> Ces pistes
          s'appuient sur les données mesurées dans votre lieu — audience, profil typologique,
          performance des campagnes diffusées.
        </p>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-3.5">
        {PISTES.map((piste) => (
          <div
            key={piste.num}
            className="rounded-xl border border-dashed border-perf-line bg-white p-[22px] px-[26px]"
          >
            <div
              className={`perf-mono inline-flex items-center gap-[7px] text-[10px] font-semibold uppercase tracking-[0.1em] ${piste.numClass}`}
            >
              <span className={`h-[5px] w-[5px] rounded-full ${piste.dotClass}`} aria-hidden />
              {piste.num}
            </div>
            <h3 className="mt-2 text-[17px] font-semibold tracking-[-0.01em] text-perf-ink">
              {piste.title}
            </h3>
            <p
              className={`mt-2 text-[13.5px] leading-[1.6] ${
                piste.pending ? 'italic text-perf-mist' : 'text-perf-grey'
              }`}
            >
              {piste.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
