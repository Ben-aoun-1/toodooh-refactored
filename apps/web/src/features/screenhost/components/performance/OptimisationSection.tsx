import { Sun } from 'lucide-react';

import type { VenuePiste } from '../../services/performance.service';

import { SectionHeading } from './SectionHeading';

/**
 * S07 — "Vos pistes d'optimisation futures". PERF-QA1 R5: rendered from the owner pistes wire
 * (GET /:id/pistes?from&to), which serves the SAME generator+cache and the SAME constants the
 * PDF renders — the module-level hardcode (whose Piste 02 still carried the mockup's literal
 * « essayez X et Y » in prod) is DEAD. Colors stay presentation-side, keyed by position.
 */
const PISTE_STYLES = [
  { numClass: 'text-brand-accent', dotClass: 'bg-brand-accent' },
  { numClass: 'text-perf-green', dotClass: 'bg-perf-green' },
  { numClass: 'text-brand-deep', dotClass: 'bg-brand-deep' },
] as const;

interface OptimisationSectionProps {
  /** undefined while loading; the section keeps its frame either way. */
  pistes: VenuePiste[] | undefined;
  isError: boolean;
}

export function OptimisationSection({ pistes, isError }: OptimisationSectionProps) {
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

      {isError ? (
        <p className="mt-7 rounded-xl border border-dashed border-perf-line bg-white p-[22px] px-[26px] text-[13.5px] italic text-perf-mist">
          Pistes momentanément indisponibles. Réessayez plus tard.
        </p>
      ) : !pistes ? (
        <p className="mt-7 rounded-xl border border-dashed border-perf-line bg-white p-[22px] px-[26px] text-[13.5px] italic text-perf-mist">
          Chargement des pistes…
        </p>
      ) : (
        <div className="mt-7 grid grid-cols-1 gap-3.5">
          {pistes.map((piste, idx) => {
            const style = PISTE_STYLES[idx % PISTE_STYLES.length] ?? PISTE_STYLES[0];
            return (
              <div
                key={piste.num}
                className="rounded-xl border border-dashed border-perf-line bg-white p-[22px] px-[26px]"
              >
                <div
                  className={`perf-mono inline-flex items-center gap-[7px] text-[10px] font-semibold uppercase tracking-[0.1em] ${style.numClass}`}
                >
                  <span className={`h-[5px] w-[5px] rounded-full ${style.dotClass}`} aria-hidden />
                  Piste {piste.num}
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
            );
          })}
        </div>
      )}
    </section>
  );
}
