import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, XOctagon } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  canStopCampaign,
  parseStopReason,
  stopConsequence,
  stopLabel,
  stoppedToast,
} from '@/features/admin/lib/campaign-stop';
import { adminCampaignsService } from '@/features/admin/services/admin-campaigns.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

/**
 * STOP-1 (operator rulings 2026-10-27) — « Arrêter la campagne » in the admin campaign review:
 * superadmin only, on an active or upcoming campaign — since Mariem 05/11, a match positioning
 * too. A confirm window says what happens to the money and asks for a reason; the api settles
 * the campaign at once.
 */
export default function CampaignStopButton({
  campaign,
  onStopped,
}: {
  campaign: {
    id: string;
    name: string;
    status: string;
    campaign_type: string;
    event_id: string | null;
  };
  onStopped: () => void;
}) {
  const role = useAuthStore((s) => s.role);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const stop = useMutation({
    mutationFn: (motif: string) => adminCampaignsService.stop(campaign.id, motif),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
    },
  });

  if (!canStopCampaign(role, campaign)) return null;

  const confirm = async () => {
    const parsed = parseStopReason(reason);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    try {
      const result = await stop.mutateAsync(parsed.value);
      toast.success(stoppedToast(result.refund_tnd));
      setOpen(false);
      onStopped();
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Arrêt impossible');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-base font-medium text-red-700 shadow-sm hover:bg-red-50 sm:w-auto sm:text-sm"
      >
        <XOctagon className="mr-2 h-4 w-4" />
        {stopLabel(campaign)}
      </button>
      {/* A portal: inside the scrolling review window, `fixed` would centre on that window. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
            <div
              role="dialog"
              aria-label={stopLabel(campaign)}
              className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"
            >
              <h3 className="text-lg font-semibold text-gray-900">Arrêter « {campaign.name} » ?</h3>
              <p className="text-sm text-gray-600">{stopConsequence(campaign)}</p>
              <p className="text-sm text-gray-600">
                L’annonceur est prévenu. Cette action est définitive.
              </p>
              <label htmlFor="stop-reason" className="block text-sm text-gray-700">
                Motif (obligatoire)
                <textarea
                  id="stop-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Demande de l’annonceur, contenu non conforme…"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={stop.isPending}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={stop.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {stop.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirmer l’arrêt
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
