import { DAY_SOURCE_LABEL, fmt } from '@/features/admin/lib/testing-labels';
import type { TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS1 — the day rows, the PEAK-MAX1 grid and the raw half-hour cells of the période, moved
// out of TestingReportView (ADM-OBS2). The day rows now say how many of their half-hours were
// measured and how many came from the grid, so an « estimé » day shows why (item 5).

const SLOT_LABEL = (slot: number): string =>
  `${String(Math.floor(slot / 2)).padStart(2, '0')}h${slot % 2 ? '30' : '00'}`;
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function DayRowsSection({ audience }: { audience: TestingReport['audience'] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Jours de la période</h2>
      <p className="mb-2 text-xs text-gray-500">
        Un jour est « estimé » dès qu’UNE seule de ses demi-heures vient de la grille : une
        demi-heure sans relevé du capteur, ou un 0 alors que le capteur n’est pas signalé en ligne,
        est remplacée par la grille saisie par l’admin. Les colonnes demi-heures disent combien.
      </p>
      <div className="max-h-72 overflow-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pr-4">date</th>
              <th className="pr-4">affluence (pers.)</th>
              <th className="pr-4">source</th>
              <th className="pr-4">demi-heures mesurées</th>
              <th className="pr-4">demi-heures de la grille</th>
              <th className="pr-4">≥ 1 demi-heure mesurée</th>
            </tr>
          </thead>
          <tbody>
            {audience.day_rows.map((d) => (
              <tr key={d.date} className="border-t">
                <td className="py-0.5 pr-4 font-mono">{d.date}</td>
                <td className="py-0.5 pr-4 tabular-nums">{fmt(d.audience)}</td>
                <td className="py-0.5 pr-4">{DAY_SOURCE_LABEL[d.source] ?? d.source}</td>
                <td className="py-0.5 pr-4 tabular-nums">{d.measured_cells}</td>
                <td className="py-0.5 pr-4 tabular-nums">{d.backup_cells}</td>
                <td className="py-0.5 pr-4">{d.has_measured ? 'oui' : 'non'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PeakHoursSection({ week }: { week: TestingReport['audience']['week'] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        « Vos peak hours » — max par (jour, créneau) sur la période (PEAK-MAX1)
      </h2>
      <div className="overflow-auto">
        <table className="text-[11px]">
          <thead>
            <tr>
              <th className="pr-2" />
              {Array.from({ length: 48 }, (_, s) => (
                <th key={s} className="px-0.5 font-normal text-gray-500">
                  {s % 2 === 0 ? SLOT_LABEL(s) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.map((row, dow) => (
              <tr key={dow}>
                <td className="pr-2 font-medium">{DOW[dow]}</td>
                {row.map((c, s) => (
                  <td
                    key={s}
                    title={c.value === null ? 'aucune donnée' : `${c.value} (${c.source})`}
                    className={`px-0.5 text-center tabular-nums ${
                      c.value === null
                        ? 'text-gray-300'
                        : c.source === 'backup'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-emerald-50 text-emerald-900'
                    }`}
                  >
                    {c.value === null ? '·' : c.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        vert = mesuré · ambre = grille (estimation) · point = aucune donnée
      </p>
    </section>
  );
}

export function RawCellsSection({ cells }: { cells: TestingReport['audience']['cell_rows'] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        Cases brutes de la période — demi-heures ({cells.length})
      </h2>
      <div className="max-h-80 overflow-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pr-4">date</th>
              <th className="pr-4">créneau</th>
              <th className="pr-4">valeur (pers.)</th>
              <th className="pr-4">source</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={`${c.date}-${c.slot}`} className="border-t">
                <td className="py-0.5 pr-4 font-mono">{c.date}</td>
                <td className="py-0.5 pr-4 font-mono">{SLOT_LABEL(c.slot)}</td>
                <td className="py-0.5 pr-4 tabular-nums">{c.value}</td>
                <td className="py-0.5 pr-4">{c.source === 'backup' ? 'grille' : 'mesuré'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
