import { Loader2, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ScreencasterCpmBulkBar } from '@/features/admin/components/screencaster-cpm/ScreencasterCpmBulkBar';
import { useScreencasterCpmList } from '@/features/admin/hooks/useScreencasterCpm';
import { formatAdminDateTime } from '@/features/admin/lib/admin-dates';
import {
  allFilteredSelected,
  draftsAffected,
  filterScreencasters,
  screencasterName,
  setFilteredSelected,
  toggleSelected,
} from '@/features/admin/lib/screencaster-cpm';

// CPM-3 (operator rulings 2026-09-18) — every screencaster with its own CPMs; search, select one
// or many, change their CPM together (ScreencasterCpmBulkBar).

const STATUS_LABEL: Record<string, string> = {
  pending: 'en attente',
  approved: 'validé',
  rejected: 'refusé',
  banned: 'banni',
};

export function ScreencasterCpmSection() {
  const { rows, loading, isError, refetch } = useScreencasterCpmList();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => filterScreencasters(rows, query), [rows, query]);
  const allOn = allFilteredSelected(selected, filtered);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-brand-primary" />
        <h3 className="text-lg font-semibold text-gray-900">CPM par screencaster</h3>
      </div>
      <p className="text-sm text-gray-500">
        Chaque screencaster a son propre CPM. Un changement s’applique à ses brouillons et à ses
        prochaines campagnes ; les campagnes déjà confirmées gardent leur prix.
      </p>
      <label className="relative block max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un screencaster (société, contact, e-mail)"
          aria-label="Rechercher un screencaster"
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 focus:ring-2 focus:ring-brand-primary focus:border-transparent"
        />
      </label>

      {selected.size > 0 && (
        <ScreencasterCpmBulkBar
          selectedIds={[...selected]}
          draftCount={draftsAffected(rows, selected)}
          onDone={() => setSelected(new Set())}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
        </div>
      ) : isError ? (
        <div className="text-sm text-rose-600">
          Impossible de charger les screencasters.{' '}
          <button type="button" onClick={refetch} className="underline">
            Réessayer
          </button>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-3">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner (résultats filtrés)"
                    checked={allOn}
                    onChange={() => setSelected(setFilteredSelected(selected, filtered, !allOn))}
                  />
                </th>
                <th className="py-2 pr-4">screencaster</th>
                <th className="py-2 pr-4">e-mail</th>
                <th className="py-2 pr-4">type</th>
                <th className="py-2 pr-4">statut</th>
                <th className="py-2 pr-4">CPM standard (TND / 1000)</th>
                <th className="py-2 pr-4">CPM événement (TND / 1000)</th>
                <th className="py-2 pr-4">brouillons</th>
                <th className="py-2 pr-4">dernière modification</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${screencasterName(r)}`}
                      checked={selected.has(r.id)}
                      onChange={() => setSelected(toggleSelected(selected, r.id))}
                    />
                  </td>
                  <td className="py-1.5 pr-4 font-medium text-gray-900">{screencasterName(r)}</td>
                  <td className="py-1.5 pr-4 text-gray-600">{r.email}</td>
                  <td className="py-1.5 pr-4">
                    {r.business_type === 'agency' ? 'agence' : 'annonceur'}
                  </td>
                  <td className="py-1.5 pr-4">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{r.cpm_standard_tnd.toFixed(3)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{r.cpm_event_tnd.toFixed(3)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{r.draft_count}</td>
                  <td className="py-1.5 pr-4 text-xs text-gray-500">
                    {r.last_change === null
                      ? '—'
                      : `${formatAdminDateTime(r.last_change.changed_at)} · ${r.last_change.changed_by_name}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-400">Aucun screencaster trouvé.</p>
          )}
        </div>
      )}
    </div>
  );
}
