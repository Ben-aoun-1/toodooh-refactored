import { Info } from 'lucide-react';

import { demoBarPct } from '../../lib/demographic-bar';
import { type DemographicBreakdown, formatIntFr } from '../../lib/performance-derive';

import { PENDING_LABEL } from './Pending';
import { SectionHeading } from './SectionHeading';
import { Var } from './Var';

/** SVG-attribute bar (no inline styles) — width as a percentage of the row. */
function DemoBar({ pct }: { pct: number }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <svg className="h-[5px] w-full" role="presentation">
      <rect width="100%" height="100%" rx="3" className="fill-perf-soft" />
      {width > 0 && <rect width={`${width}%`} height="100%" rx="3" className="fill-perf-green" />}
    </svg>
  );
}

function DemoRow({
  label,
  count,
  maxCount,
  pending,
}: {
  label: string;
  count: number;
  maxCount: number;
  pending: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] text-perf-ink">{label}</span>
        {pending ? (
          <span className="perf-mono text-[11px] font-medium italic text-perf-mist">
            {PENDING_LABEL}
          </span>
        ) : (
          <span className="perf-mono text-[12.5px] font-medium text-perf-ink">
            <Var>{formatIntFr(count)}</Var> pers.
          </span>
        )}
      </div>
      <div className="mt-2">
        {/* MEJ-14a — pending draws the track only; the mockup's decorative widths are gone. */}
        <DemoBar pct={demoBarPct({ pending, count, maxCount })} />
      </div>
    </div>
  );
}

interface DemographicsSectionProps {
  /** null → the venue's ratios have not been synced (no counts computable). */
  breakdown: DemographicBreakdown | null;
  /** The §7 category string, quoted in the how-to-read note. */
  category: string;
  /** HOST first-data flag — counts derive from the audience pipeline (Mejri ruling). */
  hasHostData: boolean;
}

/**
 * S04 — "Profil typologique de votre clientèle". DEVIATION (ruled): only the four REAL age bands
 * are rendered — the mockup's 0–9 and 10–16 bands have no data source and are dropped. Counts
 * stay pending until hasHostData AND the ratios exist (both feed the computation).
 */
export function DemographicsSection({
  breakdown,
  category,
  hasHostData,
}: DemographicsSectionProps) {
  const pending = !hasHostData || breakdown === null;
  const sexeMax = breakdown ? Math.max(breakdown.femmes, breakdown.hommes) : 0;
  const ageMax = breakdown ? Math.max(...breakdown.ages.map((b) => b.count)) : 0;

  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 04"
        title="Profil typologique de votre clientèle"
        lead="Photographie typologique de l'audience qui fréquente votre lieu, établie à partir des mesures réalisées dans un établissement pilote de votre catégorie."
      />

      <div className="mt-8 flex gap-3.5 rounded-md border border-perf-line border-l-[3px] border-l-perf-green bg-[#E7F5EE] p-[18px] px-[22px]">
        <Info className="mt-px h-[17px] w-[17px] flex-shrink-0 text-perf-green" aria-hidden />
        <p className="text-[12.5px] leading-[1.6] text-perf-grey">
          <strong className="font-semibold text-perf-ink">Comment lire ce profil.</strong> Les
          répartitions par sexe et tranche d'âge proviennent des mesures réalisées dans un lieu
          pilote représentatif de la catégorie «{' '}
          <Var>{category === '—' ? 'Catégorie de lieu' : category}</Var> ». Elles sont exprimées ici
          en nombre de personnes estimées, et non en pourcentage.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
        <div>
          <h4 className="perf-mono mb-1 border-b border-perf-line pb-[11px] text-[10px] font-semibold uppercase tracking-[0.1em] text-perf-grey">
            Répartition par sexe
          </h4>
          <div className="space-y-4 pt-4">
            <DemoRow
              label="Femmes"
              count={breakdown?.femmes ?? 0}
              maxCount={sexeMax}
              pending={pending}
            />
            <DemoRow
              label="Hommes"
              count={breakdown?.hommes ?? 0}
              maxCount={sexeMax}
              pending={pending}
            />
          </div>
        </div>
        <div>
          <h4 className="perf-mono mb-1 border-b border-perf-line pb-[11px] text-[10px] font-semibold uppercase tracking-[0.1em] text-perf-grey">
            Répartition par tranche d'âge
          </h4>
          <div className="space-y-4 pt-4">
            {(
              breakdown?.ages ?? [
                { key: 'age_17_30_pct' as const, label: '17 – 30 ans', count: 0 },
                { key: 'age_31_45_pct' as const, label: '31 – 45 ans', count: 0 },
                { key: 'age_46_60_pct' as const, label: '46 – 60 ans', count: 0 },
                { key: 'age_60_plus_pct' as const, label: '60 ans et plus', count: 0 },
              ]
            ).map((band) => (
              <DemoRow
                key={band.key}
                label={band.label}
                count={band.count}
                maxCount={ageMax}
                pending={pending}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
