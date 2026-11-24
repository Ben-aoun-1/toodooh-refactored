import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { ChecklistDetail } from '@/features/admin/components/checklists/ChecklistDetail';
import { ChecklistHostPicker } from '@/features/admin/components/checklists/ChecklistHostPicker';
import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  LINK_FILTERS,
  type LinkFilter,
  countFor,
  decisionLabel,
  decisionTone,
  filterChecklists,
} from '@/features/admin/lib/checklist-links';
import {
  type AdminChecklistRow,
  adminChecklistsService,
} from '@/features/admin/services/admin-checklists.service';
import { RESULT_FR } from '@/features/agent/lib/checklist-model';
import { formatDateFr } from '@/features/screenhost/lib/facture-view';
import { getErrorMessage } from '@/lib/errors';

const TONE = {
  ok: 'bg-green-50 text-green-700',
  ko: 'bg-red-50 text-red-700',
  wait: 'bg-indigo-50 text-indigo-700',
} as const;

// Mariem 15/11/2026 — « l'opération se fera manuellement via l'Admin, avec une interface simple
// permettant d'identifier directement le lien entre une fiche et un Host ». Every fiche an agent
// sent; the Admin links each one to the Screenhost it became, and the recap shows on its Fiche Host.
export default function ChecklistManagement() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LinkFilter>('a_relier');
  const [picking, setPicking] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: adminKeys.checklists(),
    queryFn: () => adminChecklistsService.list(),
  });
  const link = useMutation({
    mutationFn: (v: { row: AdminChecklistRow; screenhost: { id: string; name: string } | null }) =>
      adminChecklistsService.link(v.row.id, v.screenhost?.id ?? null),
    onSuccess: async (_r, v) => {
      toast.success(
        v.screenhost
          ? `Fiche « ${v.row.name} » reliée à ${v.screenhost.name}.`
          : `Lien de la fiche « ${v.row.name} » retiré.`,
      );
      setPicking(null);
      await queryClient.invalidateQueries({ queryKey: adminKeys.checklistsAll() });
    },
    onError: (e: unknown) => {
      toast.error(getErrorMessage(e) || 'L’action a échoué. Merci de réessayer.');
    },
  });
  const all = list.data ?? [];
  const rows = filterChecklists(all, filter);

  return (
    <AdminLayout title="Checklists">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold text-gray-900">Fiches de qualification</h2>
        <p className="mt-1 text-sm text-gray-500">
          Reliez chaque fiche envoyée par un agent au Screenhost correspondant, une fois son compte
          créé. Le récapitulatif apparaît alors sur sa Fiche Host.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {LINK_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                filter === f.id ? 'bg-brand-primary text-brand-deep' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f.label} ({countFor(all, f.id)})
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-gray-500">
            {list.isPending ? 'Chargement…' : 'Aucune fiche.'}
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[220px] flex-1">
                    <p className="font-semibold text-gray-900">{row.name}</p>
                    <p className="text-sm text-gray-600">
                      {[row.category, row.delegation, row.governorate].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Agent {row.agent_name}
                      {row.agent_code ? ` (${row.agent_code})` : ''} · envoyée le{' '}
                      {formatDateFr(row.sent_at)} · résultat {RESULT_FR[row.result]}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${TONE[decisionTone(row.status)]}`}
                  >
                    {decisionLabel(row.status)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {row.screenhost ? (
                    <>
                      <span className="text-gray-600">Screenhost :</span>
                      <Link
                        to={`/admin-screens/${row.screenhost.id}`}
                        className="font-medium text-brand-deep underline"
                      >
                        {row.screenhost.name}
                      </Link>
                      <button
                        type="button"
                        disabled={link.isPending}
                        onClick={() => link.mutate({ row, screenhost: null })}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
                      >
                        Retirer le lien
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPicking(picking === row.id ? null : row.id)}
                      className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-brand-deep"
                    >
                      Relier à un Screenhost
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(open === row.id ? null : row.id)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
                  >
                    {open === row.id ? 'Masquer la fiche' : 'Voir la fiche'}
                  </button>
                </div>
                {picking === row.id && (
                  <ChecklistHostPicker
                    initialSearch={row.name === 'Sans nom' ? '' : row.name}
                    busy={link.isPending}
                    onPick={(screenhost) => link.mutate({ row, screenhost })}
                  />
                )}
                {open === row.id && <ChecklistDetail id={row.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminLayout>
  );
}
