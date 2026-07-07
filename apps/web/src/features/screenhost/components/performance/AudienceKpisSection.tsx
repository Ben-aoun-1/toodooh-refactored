import { type AudienceKpis, formatIntFr } from '../../lib/performance-derive';
import { formatDateFr } from '../../lib/performance-period';

import { PendingValue } from './Pending';
import { SectionHeading } from './SectionHeading';

interface AudienceKpisSectionProps {
  kpis: AudienceKpis;
}

function KpiValue({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <PendingValue />;
  return (
    <span className="text-2xl font-bold tabular-nums text-brand-deep">
      {formatIntFr(value)}
      {suffix && <span className="ml-1 text-sm font-medium text-gray-400">{suffix}</span>}
    </span>
  );
}

/** S01 — "Votre audience en chiffres": global / per-hour / per-day / peak KPIs over the period. */
export function AudienceKpisSection({ kpis }: AudienceKpisSectionProps) {
  const hasData = kpis.peak !== null;
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 01"
        title="Votre audience en chiffres"
        lead="Indicateurs de densité d'audience mesurés dans votre lieu sur la période analysée, croisés avec vos heures d'ouverture."
      />
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
            Audience globale
          </div>
          <div className="mt-2">
            <KpiValue value={hasData ? kpis.global : null} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Personnes mesurées dans votre lieu sur la période.
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
              Audience moyenne / heure
            </div>
            <div className="mt-2">
              <KpiValue value={kpis.perHour} suffix="pers/h" />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Densité moyenne d'audience pendant les heures d'ouverture.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
              Audience moyenne / jour
            </div>
            <div className="mt-2">
              <KpiValue value={kpis.perDay} />
            </div>
            <p className="mt-2 text-xs text-gray-500">Personnes par jour d'ouverture en moyenne.</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
            Pic d'audience
          </div>
          <div className="mt-2">
            <KpiValue value={kpis.peak?.value ?? null} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Maximum observé —{' '}
            <span className="font-medium text-gray-600">
              {kpis.peak ? formatDateFr(kpis.peak.date) : 'JJ/MM/AAAA'}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
