import { Info } from 'lucide-react';

import { type DemographicBreakdown, formatIntFr } from '../../lib/performance-derive';

import { PENDING_LABEL } from './Pending';
import { SectionHeading } from './SectionHeading';

/** SVG-attribute bar (no inline styles) — width as a percentage of the row. */
function DemoBar({ pct, muted }: { pct: number; muted?: boolean }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <svg className="h-2 w-full" role="presentation">
      <rect width="100%" height="100%" rx="4" className="fill-gray-100" />
      {width > 0 && !muted && (
        <rect width={`${width}%`} height="100%" rx="4" className="fill-brand-accent" />
      )}
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
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-gray-600">{label}</span>
        {pending ? (
          <span className="text-xs font-medium italic text-gray-400">{PENDING_LABEL}</span>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-brand-deep">
            {formatIntFr(count)} <span className="font-normal text-gray-400">pers.</span>
          </span>
        )}
      </div>
      <div className="mt-1">
        <DemoBar pct={maxCount > 0 ? (count / maxCount) * 100 : 0} muted={pending} />
      </div>
    </div>
  );
}

interface DemographicsSectionProps {
  /** null → the EMPTY variant (the venue's ratios have not been synced). */
  breakdown: DemographicBreakdown | null;
  /** The §7 category string, quoted in the how-to-read note. */
  category: string;
}

/**
 * S04 — "Profil typologique de votre clientèle". DEVIATION (ruled): only the four REAL age bands
 * are rendered — the mockup's 0–9 and 10–16 bands have no data source and are dropped.
 */
export function DemographicsSection({ breakdown, category }: DemographicsSectionProps) {
  const pending = breakdown === null;
  const sexeMax = breakdown ? Math.max(breakdown.femmes, breakdown.hommes) : 0;
  const ageMax = breakdown ? Math.max(...breakdown.ages.map((b) => b.count)) : 0;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 04"
        title="Profil typologique de votre clientèle"
        lead="Photographie typologique de l'audience qui fréquente votre lieu, établie à partir des mesures réalisées dans un établissement pilote de votre catégorie."
      />

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-brand-accent/10 p-3 text-sm text-gray-600">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-accent" aria-hidden />
        <p>
          <strong className="font-semibold text-brand-deep">Comment lire ce profil.</strong> Les
          répartitions par sexe et tranche d'âge proviennent des mesures réalisées dans un lieu
          pilote représentatif de la catégorie «{' '}
          <span className="font-medium text-brand-deep">
            {category === '—' ? 'Catégorie de lieu' : category}
          </span>{' '}
          ». Elles sont exprimées ici en nombre de personnes estimées, et non en pourcentage.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-brand-deep">Répartition par sexe</h4>
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
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-brand-deep">Répartition par tranche d'âge</h4>
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
    </section>
  );
}
