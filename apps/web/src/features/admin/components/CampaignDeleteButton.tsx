import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  DELETED_TOAST,
  DELETE_CONSEQUENCE,
  canDeleteCampaign,
} from '@/features/admin/lib/campaign-stop';
import { adminCampaignsService } from '@/features/admin/services/admin-campaigns.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

/**
 * Mariem 05/11 (ruling 1A) — « Supprimer » in the admin campaign review: superadmin only, on a
 * campaign or positioning already STOPPED. The api refuses one that aired (it stays in history).
 */
export default function CampaignDeleteButton({
  campaign,
  onDeleted,
}: {
  campaign: { id: string; name: string; stopped_at?: string | null };
  onDeleted: () => void;
}) {
  const role = useAuthStore((s) => s.role);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => adminCampaignsService.remove(campaign.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
    },
  });

  if (!canDeleteCampaign(role, campaign)) return null;

  const confirm = async () => {
    try {
      await remove.mutateAsync();
      toast.success(DELETED_TOAST);
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Suppression impossible');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-base font-medium text-red-700 shadow-sm hover:bg-red-50 sm:w-auto sm:text-sm"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Supprimer
      </button>
      {/* A portal: inside the scrolling review window, `fixed` would centre on that window. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
            <div
              role="dialog"
              aria-label="Supprimer la campagne"
              className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"
            >
              <h3 className="text-lg font-semibold text-gray-900">
                Supprimer « {campaign.name} » ?
              </h3>
              <p className="text-sm text-gray-600">{DELETE_CONSEQUENCE}</p>
              <p className="text-sm text-gray-600">Cette action est définitive.</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={remove.isPending}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={remove.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirmer la suppression
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
