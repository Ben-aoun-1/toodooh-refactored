import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  deletionBody,
  deletionSummary,
  deletionTotal,
} from '@/features/admin/lib/account-deletion';
import { adminUserService } from '@/features/admin/services/admin-user.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * DEL-1 (operator 2026-10-19, rulings A A B A) — complete account deletion, superadmin only. Shows
 * what goes (from the api's dry run), asks for a reason and the account's email retyped, then
 * deletes the account here and in the hub. Only the financial archive is kept.
 */
export default function AdminDeleteAccountModal({
  userId,
  name,
  onClose,
}: {
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [typedEmail, setTypedEmail] = useState('');
  const preview = useQuery({
    queryKey: ['admin', 'users', userId, 'deletion'],
    queryFn: () => adminUserService.getDeletionPreview(userId),
  });
  const remove = useMutation({
    mutationFn: (body: { reason: string; confirm_email: string }) =>
      adminUserService.deleteAccount(userId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });

  const submit = async () => {
    if (!preview.data) return;
    const body = deletionBody(reason, typedEmail, preview.data.email);
    if (!body.ok) {
      toast.error(body.error);
      return;
    }
    try {
      await remove.mutateAsync(body.value);
      toast.success('Compte supprimé définitivement');
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Suppression impossible');
    }
  };

  const summary = preview.data ? deletionSummary(preview.data.counts) : [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 pb-20 pt-4">
        <div className="fixed inset-0 bg-gray-500 opacity-75" aria-hidden="true" />
        <div className="relative w-full max-w-lg overflow-hidden rounded-lg bg-white text-left shadow-xl">
          <div className="space-y-4 px-6 pb-4 pt-5">
            <h3 className="flex items-center gap-2 text-lg font-medium text-red-700">
              <Trash2 className="h-5 w-5" />
              Supprimer définitivement {name} ?
            </h3>
            <p className="text-sm text-gray-600">
              Le compte et tout ce qui lui est lié sont effacés de Toodooh et du hub : campagnes en
              cours arrêtées, solde et revenus non versés perdus, établissements retirés. Seules les
              pièces comptables (factures, recharges, versements) sont archivées en interne.
              Irréversible.
            </p>
            {preview.isLoading && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Calcul de ce qui sera supprimé…
              </p>
            )}
            {preview.isError && (
              <p className="text-sm text-red-700">{getErrorMessage(preview.error)}</p>
            )}
            {preview.data && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
                <p className="font-medium">
                  {deletionTotal(preview.data.counts)} lignes seront supprimées
                  {summary.length > 0 ? ', dont :' : '.'}
                </p>
                {summary.length > 0 && <p className="mt-1">{summary.join(' · ')}</p>}
              </div>
            )}
            <label htmlFor="delete-reason" className="block text-sm text-gray-600">
              Motif (obligatoire)
              <textarea
                id="delete-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Demande du client, compte en double…"
              />
            </label>
            <label htmlFor="delete-email" className="block text-sm text-gray-600">
              Pour confirmer, tapez l’e-mail du compte
              {preview.data && <span className="font-medium"> ({preview.data.email})</span>}
              <input
                id="delete-email"
                type="email"
                value={typedEmail}
                autoComplete="off"
                onChange={(e) => setTypedEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 bg-gray-50 px-6 py-3 sm:flex-row-reverse">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={remove.isPending || !preview.data}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer définitivement
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={remove.isPending}
              className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
