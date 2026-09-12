import { OPPORTUNITIES_INTRO, OPPORTUNITY_CARDS } from '../../lib/performances-derive';

import { SectionHeading } from './shared';

/**
 * Epic 9 — « Prochaines opportunités de campagne » (US-9.1 / US-9.2): a STATIC bloc, identical
 * for every Screencaster, independent of the filter, the mode and the clôture state. Exactly
 * three cards, hardcoded front-side (no data model — dev note explicit), no button, no link. The
 * intro marks it as generic pistes, not a personalised analysis (wording = open point, retained).
 */
export function OpportunitiesSection() {
  return (
    <section className="mb-10">
      <SectionHeading
        num="Recommandations"
        title="Prochaines opportunités de campagne"
        lead={OPPORTUNITIES_INTRO}
      />
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {OPPORTUNITY_CARDS.map((card) => (
          <article key={card.title} className="rounded-[14px] border border-perf-line bg-white p-5">
            <div className="text-[15px] font-semibold text-perf-ink">{card.title}</div>
            <p className="mt-2 text-[13.5px] leading-[1.6] text-perf-grey">{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
