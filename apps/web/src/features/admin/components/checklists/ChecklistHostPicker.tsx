import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { adminScreensService } from '@/features/admin/services/admin-screens.service';

// A search box over every Screenhost (the admin venue list, name search), then a pick.
export function ChecklistHostPicker({
  initialSearch,
  busy,
  onPick,
}: {
  initialSearch: string;
  busy: boolean;
  onPick: (screenhost: { id: string; name: string }) => void;
}) {
  const [search, setSearch] = useState(initialSearch);
  const term = search.trim();
  const found = useQuery({
    queryKey: [...adminKeys.all, 'checklist-host-search', term],
    queryFn: () => adminScreensService.list({ search: term, page: 1, per_page: 8 }),
    enabled: term.length >= 2,
  });
  const hosts = found.data?.locations ?? [];

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher un Screenhost par son nom"
        aria-label="Rechercher un Screenhost"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {term.length < 2 ? (
        <p className="mt-2 text-xs text-gray-500">Saisissez au moins 2 lettres.</p>
      ) : hosts.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          {found.isPending ? 'Recherche…' : 'Aucun Screenhost trouvé.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg bg-white">
          {hosts.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{h.name}</p>
                <p className="truncate text-xs text-gray-500">
                  {[h.city, h.owner_business_name].filter(Boolean).join(' · ') || '–'}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick({ id: h.id, name: h.name })}
                className="shrink-0 rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-brand-deep disabled:opacity-50"
              >
                Relier
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
