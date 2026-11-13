import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, QrCode } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { adminCampaignsService } from '@/features/admin/services/admin-campaigns.service';
import CtaCornerPicker from '@/features/campaigns/components/CtaCornerPicker';
import { CTA_POSITION_FR } from '@/features/campaigns/lib/spot-cta';
import type { CtaPosition } from '@/features/campaigns/services/campaigns.api';
import { getErrorMessage } from '@/lib/errors';

/**
 * Mariem 04/11 (Foot point 1, ruling 2A) — the campaign's QR card at the review: the spot as the
 * TVs will air it, and the corner, which the admin may move while the campaign was never on air
 * (the copy is made again; the campaign waits for it). Nothing when the campaign has no QR code.
 */
export default function CampaignQrPanel({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const cta = useQuery({
    queryKey: adminKeys.campaignCta(campaignId),
    queryFn: () => adminCampaignsService.getCta(campaignId),
    // While the copy is being made, look again every few seconds.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3000 : false),
  });
  const move = useMutation({
    mutationFn: (position: CtaPosition) =>
      adminCampaignsService.setCtaPosition(campaignId, position),
    onSuccess: (view) => {
      queryClient.setQueryData(adminKeys.campaignCta(campaignId), view);
      toast.success(`QR code déplacé : ${CTA_POSITION_FR[view.position].toLowerCase()}.`);
    },
    onError: (err) => toast.error(getErrorMessage(err) || 'Déplacement impossible'),
  });

  const view = cta.data;
  if (!view || view.url === null) return null;

  return (
    <section className="mb-6 space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-brand-deep" />
        <p className="text-sm font-semibold text-gray-900">QR code du spot</p>
      </div>
      <p className="break-all text-xs text-gray-500">
        {view.url}
        {view.label ? ` — « ${view.label} »` : ''}
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <CtaCornerPicker
          value={view.position}
          onChange={(position) => move.mutate(position)}
          disabled={!view.position_editable || move.isPending}
        />
        <div className="min-w-0 flex-1">
          {view.status === 'pending' || move.isPending ? (
            <p className="inline-flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Préparation du QR code sur le spot…
            </p>
          ) : view.status === 'failed' ? (
            <p className="text-sm text-red-700">Le QR code n’a pas pu être ajouté à ce spot.</p>
          ) : view.preview_url ? (
            // Since QR-CTA2 a copy is a video; an older photo copy stays an image.
            view.preview_url.split('?')[0]?.endsWith('.mp4') ? (
              <video controls className="max-h-48 w-full rounded-md bg-black">
                {/* Empty caption track — satisfies jsx-a11y/media-has-caption. */}
                <track kind="captions" />
                <source src={view.preview_url} type="video/mp4" />
              </video>
            ) : (
              <img
                src={view.preview_url}
                alt="Le spot avec son QR code"
                className="max-h-48 w-full rounded-md bg-black object-contain"
              />
            )
          ) : null}
        </div>
      </div>
      {!view.position_editable && (
        <p className="text-xs text-gray-500">
          La campagne est déjà diffusée : son QR code ne peut plus être déplacé (les écrans gardent
          le fichier reçu).
        </p>
      )}
    </section>
  );
}
