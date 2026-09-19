import {
  DayRowsSection,
  PeakHoursSection,
  RawCellsSection,
} from '@/features/admin/components/testing/AudienceDetailSections';
import { CampaignsOnVenueSection } from '@/features/admin/components/testing/CampaignsOnVenueSection';
import { HourStatusSection } from '@/features/admin/components/testing/HourStatusSection';
import { KeyValues, StatsTable } from '@/features/admin/components/testing/KeyValues';
import { SpsSection } from '@/features/admin/components/testing/SpsSection';
import { dayCountLabel, dayRangesLabel, fmt } from '@/features/admin/lib/testing-labels';
import type { TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS1 — the « Tests » report view, moved VERBATIM out of pages/TestingPage.tsx (SIM-5,
// 2026-09-16) so the Simulateur can render the very same view for a sandbox venue.
//
// ADM-OBS2 (Mejri 17/09, rulings of 2026-09-18) — split into sections under ./testing, and:
// the creation day and first sensor reading replace the estimation floor (ruling B); the
// unavailable days read as a count and ranges (item 3); the audience statistics are over HOURS
// (item 4); A_max joins the audience KPIs and the dispatch inputs leave the page (items 7–8).
// ADM-OBS2 (Mejri 19/09, R3) — a half-hour entered by hand is « manuelle », not « de la grille ».

export function TestingReportView({ r }: { r: TestingReport }) {
  const a = r.audience;
  const p = r.periode;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <KeyValues
          title="Période"
          rows={[
            ['du → au', `${p.from} → ${p.to}`],
            ["aujourd'hui (Tunis)", p.today],
            ['Date de création', p.created_date],
            ['Première mesure du capteur', p.first_reading ?? 'aucune'],
            [
              'heures d’ouverture',
              r.screenhost.opening_hour === null
                ? '—'
                : `${r.screenhost.opening_hour}h → ${r.screenhost.closing_hour}h (${r.screenhost.broadcastable_hours.length} h)`,
            ],
            ['Jours indisponibles (E2) — nombre', dayCountLabel(p.unavailable_days.length)],
            ['Jours indisponibles (E2) — période', dayRangesLabel(p.unavailable_days)],
          ]}
        />
        <KeyValues
          title="Audience — les KPI de « Mes performances »"
          rows={[
            ['Affluence globale (Σ des valeurs horaires, pers.)', fmt(a.total)],
            ['Affluence moyenne / jour (pers.)', fmt(a.mean_per_day)],
            ['Affluence moyenne / heure d’ouverture (pers.)', fmt(a.mean_per_hour)],
            ['A_max — heure la plus chargée (pers.)', fmt(a.a_max)],
            ['Jours mesurés / estimés', `${a.measured_days} / ${a.estimated_days}`],
            [
              'dont estimés (part de l’affluence, %)',
              a.estimated_pct === null ? '—' : `${a.estimated_pct} %`,
            ],
          ]}
        />
      </div>

      <StatsTable
        title="Affluence — min / médiane / moyenne / max (pers.) — une heure = moyenne de ses demi-heures"
        rows={[
          ['jours (Σ des valeurs horaires du jour)', a.days],
          ['heures, toutes', a.hours],
          ['heures entièrement mesurées', a.measured_hours],
          ['heures avec ≥ 1 demi-heure manuelle', a.estimated_hours],
        ]}
      />

      <SpsSection sps={r.sps} periode={p} />
      <HourStatusSection r={r} />
      <CampaignsOnVenueSection r={r} />
      <DayRowsSection audience={a} />
      <PeakHoursSection week={a.week} />
      <RawCellsSection cells={a.cell_rows} />

      <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          JSON brut (tout ce que l’API renvoie, config de dispatch incluse)
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto text-xs">{JSON.stringify(r, null, 2)}</pre>
      </details>
    </div>
  );
}
