import { useCreativePreviewUrl } from '@/features/campaigns/hooks/useCreativeApi';
import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';
import type { CreativeView } from '@/features/campaigns/services/creatives.api';

/**
 * SPOT-PREV1 (Myriam 2026-10-20) — the Création step shows the chosen spot itself: right after an
 * upload (or a pick from « Vos créations ») the screencaster sees it and can play it, instead of a
 * bare file name. The same tile as the Validation step (CreativePreviewTile).
 */
export default function SelectedSpotPreview({ creative }: { creative: CreativeView }) {
  const url = useCreativePreviewUrl(creative.id);
  return (
    <div>
      <p className="text-sm font-bold text-gray-900 mb-2">Aperçu de votre spot</p>
      <div className="max-w-xl">
        <CreativePreviewTile
          creativeType={creative.creative_type}
          title={creative.title ?? null}
          durationSeconds={creative.duration_seconds ?? null}
          url={url.data?.url}
          isLoading={url.isLoading}
        />
      </div>
    </div>
  );
}
