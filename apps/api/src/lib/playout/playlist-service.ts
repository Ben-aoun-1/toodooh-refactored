import { storage } from '../../storage/s3-storage.js';
import {
  BLACKOUT_HORIZON_MS,
  eventBlackouts,
  isInBlackout,
  upcomingBlackouts,
  windowsForVenue,
} from '../event-blackout.js';
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
  // EVT-PLAY1 — inside a confirmed match's window (kickoff − 1 h → end + 1 h) NO classic entry
  // airs on a venue that shows events; outside, every classic entry carries the next 48 h of
  // windows so an offline player honours them too.
  const windows = upcomingBlackouts(
    windowsForVenue(
      await eventBlackouts(now, new Date(now.getTime() + BLACKOUT_HORIZON_MS)),
      screenhostId,
    ),
    now,
  );
  const blackedOut = isInBlackout(windows, now);
  const allocations = blackedOut ? [] : await activeAllocationsForScreenhost(screenhostId, now);

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
      validUntil: allocation.validUntil,
      blackouts: windows,
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
      validUntil: spot.validUntil,
      ...(spot.slots ? { slots: spot.slots } : {}),
    });
  }
  // EVT-MIN1 — the server clock rides the message (only when a pod slot is in it, so every other
  // playlist stays byte-identical) so a player can align its slots.
  return buildPlaylist(sources, sources.some((source) => source.slots) ? now : undefined);
};

/**
 * H1 — the proof side of the same composition: resolve a reported video_id (= the campaign id we
 * sent) through the SAME two gates computeScreenPlaylist reads — a classic campaign first, else an
 * event positioning whose bloc covers `now`. The event branch was missing from ingest, so every
 * real event report was dropped and EV5's settlement refunded every positioning in full. ONE `now`
 * for both gates, so an accepted event proof's received_at falls inside the bloc the settlement
 * buckets it into.
 */
export const resolveAirableVideo = async (
  screenhostId: string,
  videoId: string,
  now: Date,
): Promise<{ campaignId: string; creativeId: string; durationSeconds: number | null } | null> => {
  const [allocation] = await activeAllocationsForScreenhost(screenhostId, now, videoId);
  // EVT-PLAY1 — a classic play inside a confirmed match's window is not airable: never recorded, so
  // never delivered, billed or paid (the SAME gate the playlist applies).
  if (allocation) {
    const blackout = await eventBlackouts(now, new Date(now.getTime() + 1));
    return isInBlackout(windowsForVenue(blackout, screenhostId), now) ? null : allocation;
  }
  // EVT-MIN1 — the WHOLE bloc credits a minutes spot's proof (a VIDEO_ENDED landing just after
  // its pod closed is still its bloc's — settlement measures per bloc).
  const spot = (await activeEventSpots(screenhostId, now, { wholeBloc: true })).find(
    (s) => s.campaignId === videoId,
  );
  return spot ?? null;
};
