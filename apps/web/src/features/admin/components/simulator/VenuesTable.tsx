import { useMemo, useState } from 'react';

import { OwnerBehaviourEditor } from '@/features/admin/components/simulator/OwnerBehaviourEditor';
import type { WorldVenue } from '@/features/admin/services/admin-simulator.service';

type SortKey = 'name' | 'sector' | 'class' | 'sps' | 'acceptance';

const CLASS_CLASS: Record<string, string> = {
  populaire: 'bg-sky-100 text-sky-800',
  moyen: 'bg-violet-100 text-violet-800',
  premium: 'bg-amber-100 text-amber-800',
};

const hours = (v: WorldVenue): string =>
  v.opening_hour === null || v.closing_hour === null
    ? '—'
    : `${String(v.opening_hour).padStart(2, '0')}h — ${String(v.closing_hour).padStart(2, '0')}h`;

export function VenuesTable({
  simulationId,
  venues,
}: {
  simulationId: string;
  venues: WorldVenue[];
}) {
  const [sort, setSort] = useState<SortKey>('name');
  const rows = useMemo(() => {
    const copy = [...venues];
    copy.sort((a, b) => {
      switch (sort) {
        case 'sps':
          return b.sps - a.sps;
        case 'acceptance':
          return (b.acceptance_rate ?? 0) - (a.acceptance_rate ?? 0);
        case 'sector':
          return (a.sector ?? '').localeCompare(b.sector ?? '');
        case 'class':
          return (a.class ?? '').localeCompare(b.class ?? '');
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return copy;
  }, [venues, sort]);

  const header = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-left font-medium">
      <button
        type="button"
        onClick={() => setSort(key)}
        className={sort === key ? 'text-brand-deep underline' : 'text-gray-600 hover:underline'}
      >
        {label}
      </button>
    </th>
  );

  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Établissements ({venues.length})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs uppercase tracking-wide">
            <tr>
              {header('name', 'Nom')}
              {header('sector', 'Secteur')}
              {header('class', 'Gamme')}
              <th className="px-3 py-2 text-left font-medium text-gray-600">Horaires</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Écrans</th>
              {header('sps', 'SPS')}
              <th className="px-3 py-2 text-left font-medium text-gray-600">Propriétaire</th>
              {header('acceptance', 'Acceptation')}
              <th className="px-3 py-2 text-left font-medium text-gray-600">Comportement</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{v.name}</td>
                <td className="px-3 py-2 text-gray-600">{v.sector ?? '—'}</td>
                <td className="px-3 py-2">
                  {v.class ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${CLASS_CLASS[v.class] ?? ''}`}
                    >
                      {v.class}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">{hours(v)}</td>
                <td className="px-3 py-2">{v.screens}</td>
                <td className="px-3 py-2">{v.sps.toFixed(2)}</td>
                <td className="px-3 py-2 text-gray-600">
                  {v.owner.name ?? '—'}
                  {v.owner.role === 'fleet_owner' && (
                    <span className="ml-1 rounded bg-gray-100 px-1 text-xs">parc</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {v.acceptance_rate === null ? '—' : `${Math.round(v.acceptance_rate * 100)} %`}
                </td>
                <td className="px-3 py-2">
                  {v.owner.id ? (
                    <OwnerBehaviourEditor
                      simulationId={simulationId}
                      ownerId={v.owner.id}
                      acceptanceRate={v.acceptance_rate}
                      responseDelayHours={v.response_delay_hours}
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
