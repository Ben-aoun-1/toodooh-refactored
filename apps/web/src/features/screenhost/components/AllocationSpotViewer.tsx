import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';
import { useAllocationCreativeUrl } from '@/features/screenhost/hooks/useScreenhostAllocations';
import {
  type PendingAllocation,
  spotViewerProps,
} from '@/features/screenhost/services/screenhost-allocations.service';

/**
 * CF-O1 — the owner-facing spot viewer on an allocation card. Mounted only when the owner expands
 * « Voir le spot », so the short-TTL presigned url (GET /allocations/:id/creative-url) is fetched
 * lazily on demand. Reuses the wizard's CreativePreviewTile: a video plays inline with native
 * controls, a photo fills the 16:9 tile — the same per-kind behavior the advertiser already sees.
 */
export default function AllocationSpotViewer({ allocation }: { allocation: PendingAllocation }) {
  const tileProps = spotViewerProps(allocation);
  const { url, isLoading, isError } = useAllocationCreativeUrl(allocation.id, tileProps !== null);

  if (tileProps === null) return null;
  if (isError) {
    return (
      <p className="text-sm text-[#FB3748]">Impossible de charger le spot. Veuillez réessayer.</p>
    );
  }
  return (
    <div className="max-w-md">
      <CreativePreviewTile
        creativeType={tileProps.creativeType}
        title={tileProps.title}
        durationSeconds={tileProps.durationSeconds}
        url={url}
        isLoading={isLoading}
      />
    </div>
  );
}
