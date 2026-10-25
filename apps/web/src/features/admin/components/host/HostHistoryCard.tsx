import { useMemo } from 'react';

import { useHostHistory } from '@/features/admin/hooks/useAdminHost';
import { formatAdminDateTime } from '@/features/admin/lib/admin-dates';
import { HISTORY_SECTION_LABELS, historyChanges } from '@/features/admin/lib/host-fiche';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';

import { HostSection } from './HostField';

/** HOST-EDIT1 (ruling Q3 A) — « Historique des modifications »: every admin edit, newest first. */
export default function HostHistoryCard({ screenhostId }: { screenhostId: string }) {
  const { data, isPending, isError } = useHostHistory(screenhostId);
  const { data: governorates = [] } = useGovernorates();
  const { data: sectors = [] } = useOwnerBusinessSectors();
  const names = useMemo(
    () => ({
      governorates: new Map(governorates.map((g) => [g.id, g.name])),
      sectors: new Map(sectors.map((s) => [s.id, s.name])),
    }),
    [governorates, sectors],
  );

  return (
    <HostSection
      title="Historique des modifications"
      description="Chaque modification faite par un administrateur depuis cette fiche."
    >
      {isPending && <p className="text-sm text-gray-500">Chargement…</p>}
      {isError && <p className="text-sm text-red-600">Impossible de charger l&apos;historique.</p>}
      {data && data.entries.length === 0 && (
        <p className="text-sm text-gray-500">Aucune modification pour le moment.</p>
      )}
      {data && data.entries.length > 0 && (
        <ol className="divide-y divide-gray-100">
          {data.entries.map((entry) => (
            <li key={entry.id} className="py-3">
              <p className="text-sm text-gray-900">
                <span className="font-medium">
                  {HISTORY_SECTION_LABELS[entry.section] ?? entry.section}
                </span>
                <span className="text-gray-500">
                  {' '}
                  · {formatAdminDateTime(entry.created_at)} ·{' '}
                  {entry.changed_by?.label ?? 'Compte supprimé'}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5">
                {historyChanges(entry, names).map((c) => (
                  <li key={c.label} className="text-sm text-gray-600">
                    {c.label} : <span className="line-through">{c.before}</span> →{' '}
                    <span className="font-medium text-gray-900">{c.after}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </HostSection>
  );
}
