import { Loader2, MonitorPlay, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useSetDemoVenues } from '@/features/admin/hooks/useAdminDemo';
import type { DemoVenue } from '@/features/admin/services/admin-demo.service';
import { getErrorMessage } from '@/lib/errors';

/** DEMO-1 (ruled Q2 A) — the REAL venues where demo campaigns air. */
export function DemoVenuesCard({ venues }: { venues: DemoVenue[] }) {
  const initial = useMemo(
    () => new Set(venues.filter((v) => v.is_demo_venue).map((v) => v.id)),
    [venues],
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [search, setSearch] = useState('');
  const save = useSetDemoVenues();
  useEffect(() => setSelected(initial), [initial]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const needle = search.trim().toLowerCase();
  const shown = venues.filter(
    (v) =>
      !needle ||
      v.name.toLowerCase().includes(needle) ||
      (v.owner_name ?? '').toLowerCase().includes(needle),
  );
  const dirty = selected.size !== initial.size || [...selected].some((id) => !initial.has(id));

  const submit = async () => {
    try {
      await save.mutateAsync([...selected]);
      toast.success('Établissements de démo enregistrés');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex items-center gap-2">
        <MonitorPlay className="h-5 w-5 text-brand-primary" />
        <h2 className="text-base font-semibold">Établissements de démo</h2>
        <span className="ml-auto text-sm text-gray-500">{selected.size} sélectionné(s)</span>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Les campagnes des comptes démo sont diffusées uniquement sur ces écrans réels. Le
        propriétaire n’a rien à accepter et ne perçoit aucun revenu pour ces campagnes.
      </p>
      <input
        type="search"
        placeholder="Rechercher un établissement…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-4 w-full rounded-lg border px-3 py-2 text-sm"
      />
      <ul className="mt-3 max-h-72 divide-y overflow-y-auto rounded-lg border">
        {shown.map((v) => (
          <li key={v.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
              <input
                type="checkbox"
                checked={selected.has(v.id)}
                onChange={() => toggle(v.id)}
                className="h-4 w-4 accent-brand-primary"
              />
              <span className="font-medium">{v.name}</span>
              <span className="text-gray-500">{v.owner_name ?? '—'}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-gray-500">Aucun établissement.</li>
        )}
      </ul>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
        >
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enregistrer la sélection
        </button>
      </div>
    </section>
  );
}
