import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Power, PowerOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  deactivatedToast,
  parseDeactivationReason,
} from '@/features/admin/lib/account-deactivation';
import { adminUserService } from '@/features/admin/services/admin-user.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * DEACT-1 (Mariem's sheet row 11, operator rulings 2026-10-28) — deactivate a validated Host or
 * Cast (reason required; for a Cast, its running standard campaigns finish or stop with refund,
 * match campaigns always finish, pending ones are rejected), or reactivate a deactivated one.
 */
export default function AdminDeactivateUserModal({
  user,
  onClose,
}: {
  user: { id: string; name: string; status: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reactivating = user.status === 'deactivated';
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState<'finish' | 'stop'>('finish');
  const preview = useQuery({
    queryKey: ['admin', 'users', user.id, 'deactivation'],
    queryFn: () => adminUserService.getDeactivationPreview(user.id),
    enabled: !reactivating,
  });
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    onClose();
  };
  const deactivate = useMutation({
    mutationFn: (motif: string) =>
      adminUserService.deactivateUser(user.id, { reason: motif, campaigns: choice }),
  });
  const reactivate = useMutation({ mutationFn: () => adminUserService.reactivateUser(user.id) });
  const busy = deactivate.isPending || reactivate.isPending;

  const confirm = async () => {
    try {
      if (reactivating) {
        await reactivate.mutateAsync();
        toast.success('Compte réactivé.');
      } else {
        const parsed = parseDeactivationReason(reason);
        if (!parsed.ok) {
          toast.error(parsed.error);
          return;
        }
        toast.success(deactivatedToast(await deactivate.mutateAsync(parsed.value)));
      }
      done();
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  const p = preview.data;
  const standard = p?.campaigns.filter((c) => !c.is_event && c.status !== 'pending') ?? [];
  const events = p?.campaigns.filter((c) => c.is_event) ?? [];
  const pending = p?.campaigns.filter((c) => c.status === 'pending') ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-label={reactivating ? 'Réactiver le compte' : 'Désactiver le compte'}
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"
      >
        <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          {reactivating ? <Power className="h-5 w-5" /> : <PowerOff className="h-5 w-5" />}
          {reactivating ? `Réactiver ${user.name} ?` : `Désactiver ${user.name} ?`}
        </h3>
        {reactivating ? (
          <p className="text-sm text-gray-600">
            Le compte peut de nouveau se connecter ; un Host revient dans le dispatching (ses écrans
            doivent se reconnecter), un Cast peut de nouveau lancer des campagnes.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Le compte ne peut plus se connecter. Son historique, ses rapports, factures et
              reversements sont conservés. Réactivation possible à tout moment.
            </p>
            {preview.isLoading && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
              </p>
            )}
            {preview.isError && (
              <p className="text-sm text-red-700">{getErrorMessage(preview.error)}</p>
            )}
            {p?.kind === 'host' && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {p.venues} établissement{p.venues > 1 ? 's' : ''} retiré{p.venues > 1 ? 's' : ''} du
                dispatching. Ses écrans s’arrêtent maintenant ;{' '}
                {p.shared_campaigns > 0
                  ? `les diffusions à venir de ${p.shared_campaigns} campagne${p.shared_campaigns > 1 ? 's' : ''} sont redistribuées à d’autres établissements, `
                  : ''}
                les diffusions déjà faites sont reversées normalement.
              </p>
            )}
            {p?.kind === 'cast' && (
              <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {standard.length > 0 ? (
                  <>
                    <p>
                      {standard.length} campagne{standard.length > 1 ? 's' : ''} en cours ou à venir
                      :
                    </p>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={choice === 'finish'}
                        onChange={() => setChoice('finish')}
                      />
                      Les laisser se terminer
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={choice === 'stop'}
                        onChange={() => setChoice('stop')}
                      />
                      Les arrêter et rembourser la partie non diffusée
                    </label>
                  </>
                ) : (
                  <p>Aucune campagne standard en cours.</p>
                )}
                {events.length > 0 && (
                  <p>
                    {events.length} campagne{events.length > 1 ? 's' : ''} de match se termine
                    {events.length > 1 ? 'nt' : ''} normalement.
                  </p>
                )}
                {pending.length > 0 && (
                  <p>
                    {pending.length} campagne{pending.length > 1 ? 's' : ''} en attente de
                    validation {pending.length > 1 ? 'sont rejetées' : 'est rejetée'}.
                  </p>
                )}
              </div>
            )}
            <label htmlFor="deactivate-reason" className="block text-sm text-gray-700">
              Motif (obligatoire)
              <textarea
                id="deactivate-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Quitte Toodooh, fin de contrat…"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || (!reactivating && !p)}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              reactivating ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {reactivating ? 'Réactiver' : 'Désactiver le compte'}
          </button>
        </div>
      </div>
    </div>
  );
}
