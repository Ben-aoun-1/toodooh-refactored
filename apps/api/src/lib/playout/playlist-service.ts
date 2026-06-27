import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
} from '../../db/schema.js';
import { storage } from '../../storage/s3-storage.js';

import {
  type PlaylistMessage,
  type PlaylistSource,
  buildPlaylist,
  isWindowActive,
} from './playlist.js';

// Derive a screen's playlist from its screenhost's ACTIVE dispatch allocations:
//   allocation(screenhost, ACCEPTE) → plan → campaign (window covers now) → creative (approved)
//   → presigned MinIO url.
// The content gate is enforced here (only approved creatives air). A campaign with no linked creative
// is excluded by the inner join. video.id = campaign.id, resolvable on VIDEO_ENDED.
export const computeScreenPlaylist = async (
  screenhostId: string,
  now: Date,
): Promise<PlaylistMessage> => {
  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      storageKey: creatives.storageKey,
      durationSeconds: creatives.durationSeconds,
      validationStatus: creatives.validationStatus,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(
      and(
        eq(campaignDispatchAllocation.screenhostId, screenhostId),
        eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
      ),
    );

  const sources: PlaylistSource[] = [];
  for (const row of rows) {
    if (!isWindowActive(row.startDate, row.endDate, now)) continue;
    if (row.validationStatus !== 'approved') continue; // content gate — never air unapproved
    const presigned = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in presigned) continue; // a presign failure skips one entry, never breaks the push
    sources.push({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      url: presigned.url,
      durationSeconds: row.durationSeconds,
    });
  }
  return buildPlaylist(sources);
};
