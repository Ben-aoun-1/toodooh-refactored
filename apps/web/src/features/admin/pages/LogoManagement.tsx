import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { AdminLogoCard } from '@/features/admin/components/logos/AdminLogoCard';
import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { useUsers } from '@/features/admin/hooks/useUsers';
import { type PendingLogo, adminLogosService } from '@/features/admin/services/admin-logos.service';
import { formatDateFr } from '@/features/screenhost/lib/facture-view';
import { getErrorMessage } from '@/lib/errors';

const FRAME =
  'flex aspect-[4/3] w-36 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white';

// Agent specs VF « Logos » — a logo added by an agent stays « En attente de validation » until an
// admin validates or refuses it here. Below the queue, the admin sets a Screencaster's logo
// himself (a Screenhost's is on its Fiche Host).
export default function LogoManagement() {
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [advertiserId, setAdvertiserId] = useState('');
  const pending = useQuery({
    queryKey: adminKeys.logosPending(),
    queryFn: () => adminLogosService.pending(),
  });
  const { users } = useUsers();
  const advertisers = users
    .filter((u) => u.role === 'advertiser')
    .sort((a, b) =>
      (a.business_name || a.contact_name).localeCompare(b.business_name || b.contact_name),
    );

  const decide = useMutation({
    mutationFn: (v: { row: PendingLogo; accept: boolean }) =>
      v.accept
        ? adminLogosService.validate(v.row.id)
        : adminLogosService.refuse(v.row.id, reasons[v.row.id]?.trim() || null),
    onSuccess: async (_r, v) => {
      toast.success(v.accept ? 'Logo validé.' : 'Logo refusé.');
      await queryClient.invalidateQueries({ queryKey: adminKeys.logosAll() });
    },
    onError: (e: unknown) => {
      toast.error(getErrorMessage(e) || 'L’action a échoué. Merci de réessayer.');
    },
  });
  const rows = pending.data ?? [];

  return (
    <AdminLayout title="Logos">
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-gray-900">Logos à valider ({rows.length})</h2>
          <p className="mt-1 text-sm text-gray-500">
            Un logo ajouté par un agent n’est visible de tous qu’après votre validation.
          </p>
          {rows.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">
              {pending.isPending ? 'Chargement…' : 'Aucun logo en attente.'}
            </p>
          ) : (
            <ul className="mt-5 space-y-4">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-5 rounded-xl border border-gray-100 p-4"
                >
                  <div className={FRAME}>
                    {row.url && (
                      <img
                        src={row.url}
                        alt={`Logo proposé pour ${row.subject_name}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <p className="font-semibold text-gray-900">{row.subject_name}</p>
                    <p className="text-sm text-gray-600">
                      {row.subject_kind === 'screenhost' ? 'Screenhost' : 'Screencaster'} · ajouté
                      par {row.agent_name} le {formatDateFr(row.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {row.current_url ? 'Remplace le logo actuel.' : 'Aucun logo actuellement.'}
                    </p>
                    <input
                      type="text"
                      value={reasons[row.id] ?? ''}
                      onChange={(e) => setReasons((r) => ({ ...r, [row.id]: e.target.value }))}
                      placeholder="Motif du refus (facultatif)"
                      aria-label="Motif du refus"
                      maxLength={500}
                      className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ row, accept: false })}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                    >
                      Refuser
                    </button>
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ row, accept: true })}
                      className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
                    >
                      Valider
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-gray-900">Logo d’un Screencaster</h2>
          <p className="mt-1 text-sm text-gray-500">
            Ajoutez ou remplacez le logo d’un Screencaster. Le logo d’un Screenhost se gère depuis
            sa Fiche Host.
          </p>
          <select
            value={advertiserId}
            onChange={(e) => setAdvertiserId(e.target.value)}
            aria-label="Screencaster"
            className="mt-4 w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choisissez un Screencaster</option>
            {advertisers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.business_name || u.contact_name} ({u.email})
              </option>
            ))}
          </select>
          {advertiserId && (
            <div className="mt-5">
              <AdminLogoCard key={advertiserId} kind="advertiser" id={advertiserId} />
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
