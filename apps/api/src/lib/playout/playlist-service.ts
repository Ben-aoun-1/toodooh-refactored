import { storage } from '../../storage/s3-storage.js';
import { activeEventSpots } from '../event-playout/spots.js';

import { activeAllocationsForScreenhost } from './active-allocations.js';
import { type PlaylistMessage, type PlaylistSource, buildPlaylist } from './playlist.js';

// Derive a screen's playlist from the SHARED airability gate (activeAllocationsForScreenhost:
// ACCEPTE + campaign active + creative approved + window covers now) → presigned MinIO url.
// video.id = campaign.id, resolvable on VIDEO_ENDED.
//
// EV5 — THE COMPOSITION POINT: the campaign sources are built EXACTLY as before, then the venue's
// currently-airable EVENT spots (activeEventSpots: ACCEPTE allocation + active positioning + now
// inside one of its blocs) are CONCATENATED onto the same array. A venue with no event allocation
// — or one outside every bloc — yields the byte-identical pre-EV5 playlist (pinned in tests): the
// campaign loop above is untouched and the event loop appends nothing. Event entries ride the same
// UPDATE_PLAYLIST message, the same id-is-campaign-id contract (so VIDEO_ENDED resolves the
// positioning) and the EV4 creative_type wire; only their cadence differs (900 ÷ S).
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
      repsPerHour: allocation.repsPerHour,
      // EV4 rider — the media kind rides the wire ('photo' maps to 'image' at build).
      creativeType: allocation.creativeType === 'photo' ? 'photo' : 'video',
    });
  }

  // EV5 — the event spots airing in THIS instant's bloc (usually none).
  for (const spot of await activeEventSpots(screenhostId, now)) {
    const presigned = await storage.getPresignedUrl({ key: spot.storageKey });
    if ('error' in presigned) continue;
    sources.push({
      campaignId: spot.campaignId,
      campaignName: spot.campaignName,
      url: presigned.url,
      durationSeconds: spot.durationSeconds,
      repsPerHour: spot.repsPerHour,
      creativeType: spot.creativeType === 'photo' ? 'photo' : 'video',
    });
  }
  return buildPlaylist(sources);
};
