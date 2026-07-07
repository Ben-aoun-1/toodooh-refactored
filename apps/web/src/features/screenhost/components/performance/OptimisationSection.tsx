import { Lightbulb } from 'lucide-react';

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
  },
  {
    num: 'Piste 02',
    title: 'Repérez vos angles morts',
    body: 'Vous avez 2 périodes creuses à valoriser autrement. Mardi matin et jeudi après-midi sont vos créneaux les plus faibles — essayez X et Y pour les redynamiser.',
  },
  {
    num: 'Piste 03',
    title: 'Résumé du SPS et recommandations',
    body: 'En attente de votre score de priorité.',
  },
];

export function OptimisationSection() {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 07"
        title="Vos pistes d'optimisation futures"
        lead="Quelques observations issues de l'activité de votre lieu sur la période, transformées en pistes concrètes pour développer vos revenus."
      />

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-brand-primary/10 p-3 text-sm text-gray-600">
        <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-deep" aria-hidden />
        <p>
          <strong className="font-semibold text-brand-deep">Lecture personnalisée.</strong> Ces
          pistes s'appuient sur les données mesurées dans votre lieu — audience, profil typologique,
          performance des campagnes diffusées.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        {PISTES.map((piste) => (
          <div key={piste.num} className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" aria-hidden />
              {piste.num}
            </div>
            <h3 className="mt-2 font-semibold text-brand-deep">{piste.title}</h3>
            <p className="mt-1 text-sm text-gray-500">{piste.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
