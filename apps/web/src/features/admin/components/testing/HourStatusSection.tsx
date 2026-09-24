import {
  HOUR_STATE_CLASS,
  HOUR_STATE_LABEL,
  configNumber,
  fmt,
  statusCounts,
} from '@/features/admin/lib/testing-labels';
import type { HourStatusRow, TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS2 item 9 — the status per open hour, as two tables: « Historique » (the elapsed hours of
// the période) and « À venir » (from the current hour to the last planned day, whatever « Au »
// says — ruling E). Engaged counts the pending shares too (ruling D), shown apart.

function HourStatusTable({ title, rows }: { title: string; rows: readonly HourStatusRow[] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-700">{title}</h3>
      <p className="mb-2 text-xs text-gray-500">{statusCounts(rows)}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune heure d’ouverture.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-4">date</th>
                <th className="pr-4">heure</th>
                <th className="pr-4">état</th>
                <th className="pr-4">campagnes</th>
                <th className="pr-4">libre (s)</th>
                <th className="pr-4">engagé (s)</th>
                <th className="pr-4">dont en attente (s)</th>
                <th className="pr-4">répétitions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={`${h.date}-${h.hour}`} className="border-t">
                  <td className="py-0.5 pr-4 font-mono">{h.date}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{String(h.hour).padStart(2, '0')}h</td>
                  <td className={`py-0.5 pr-4 ${HOUR_STATE_CLASS[h.state]}`}>
                    {HOUR_STATE_LABEL[h.state]}
                  </td>
                  <td className="py-0.5 pr-4 tabular-nums">{h.campaigns}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{fmt(h.seconds_free)}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{h.engaged_seconds}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{h.pending_seconds}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{h.reps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function HourStatusSection({ r }: { r: TestingReport }) {
  const f = configNumber(r.config, 'fMaxSeconds');
  return (
    <section className="space-y-4 rounded-xl border bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">
          Statut par heure d’ouverture — libre / partiel / plein / indisponible / réservée
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          engagé = Σ (répétitions × durée du spot) des parts ACCEPTÉES et EN ATTENTE (le dispatch
          les tient toutes les deux) ; libre = 3600 s (l’heure de l’écran, partagée par toutes les
          campagnes) − engagé ; chaque campagne est plafonnée à F
          {f === null ? '' : ` = ${f} s par heure`} ; réservée = heure tenue par un événement, hors
          vente classique ; répétitions = nombre de passages prévus dans l’heure.
        </p>
      </div>
      <HourStatusTable
        title={`Historique — heures écoulées du ${r.periode.from} au ${r.periode.to}`}
        rows={r.status_hours.past}
      />
      <HourStatusTable
        title="À venir — de l’heure en cours au dernier jour planifié sur cet établissement"
        rows={r.status_hours.future}
      />
    </section>
  );
}
