import { storage } from '../../storage/s3-storage.js';

import { activeAllocationsForScreenhost } from './active-allocations.js';
import { type PlaylistMessage, type PlaylistSource, buildPlaylist } from './playlist.js';

// Derive a screen's playlist from the SHARED airability gate (activeAllocationsForScreenhost:
// ACCEPTE + campaign active + creative approved + window covers now) → presigned MinIO url.
// video.id = campaign.id, resolvable on VIDEO_ENDED.
export const computeScreenPlaylist = async (
  screenhostId: string,
  now: Date,
): Promise<PlaylistMessage> => {
  const allocations = await activeAllocationsForScreenhost(screenhostId, now);

  const sources: PlaylistSource[] = [];
  for (const allocation of allocations) {
    const presigned = await storage.getPresignedUrl({ key: allocation.storageKey });
    if ('error' in presigned) continue; // a presign failure skips one entry, never breaks the push
    sources.push({
      campaignId: allocation.campaignId,
      campaignName: allocation.campaignName,
      url: presigned.url,
      durationSeconds: allocation.durationSeconds,
    });
  }
  return buildPlaylist(sources);
};
