import { useCreative, useCreativePreviewUrl } from '@/features/campaigns/hooks/useCreativeApi';
import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';

/**
 * SPOT-PREV1 (Myriam 2026-10-20, 21/10) — the Création step shows the chosen spot itself: right
 * after an upload (or a pick from « Vos créations ») the screencaster sees it and can play it. It
 * reads the creative by id (the upload seeds that cache), so a fresh upload shows at once, before
 * the library list has refreshed. The same tile as the Validation step (CreativePreviewTile).
 */
export default function SelectedSpotPreview({ creativeId }: { creativeId: string }) {
  const creative = useCreative(creativeId);
  const url = useCreativePreviewUrl(creativeId);
  return (
    <div>
      <p className="text-sm font-bold text-gray-900 mb-2">Aperçu de votre spot</p>
      <div className="max-w-xl">
        <CreativePreviewTile
          creativeType={creative.data?.creative_type}
          title={creative.data?.title ?? null}
          durationSeconds={creative.data?.duration_seconds ?? null}
          url={url.data?.url}
          isLoading={url.isLoading || creative.isLoading}
        />
      </div>
    </div>
  );
}
