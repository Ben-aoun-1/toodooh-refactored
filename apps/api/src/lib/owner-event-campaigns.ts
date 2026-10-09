import { desc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
  users,
} from '../db/schema.js';

import { ownerShareTnd } from './owner-share.js';
import type { ReversementPcts } from './reversement/split.js';

// Operator ticket 2026-10-09 — the screenhost's « Mes campagnes » lists its EVENT positionings
// too (it read campaign_dispatch_allocation only). One entry per positioning carrying the
// owner's venues on it, in the SAME wire shape as a classic campaign, plus an `event` block. The
// money is the owner's share of each venue's montant (lib/owner-share), never the full montant.

export type OwnerEventStatut = 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';

/** event_allocations.statut is CHECK-constrained to these three; anything else reads as pending. */
const asOwnerEventStatut = (statut: string): OwnerEventStatut =>
  statut === 'ACCEPTE' || statut === 'REFUSE' ? statut : 'EN_ATTENTE';

export interface OwnerEventAllocationLine {
  id: string;
  screenhost_id: string;
  screenhost_name: string;
  statut_acceptation: OwnerEventStatut;
  ii_potentiel: number;
  /** Classic campaigns carry diffusions per hour; a positioning airs minutes — null here. */
  r_i: null;
  /** One bloc = one minute of the advertiser's seat. */
  minutes: number;
  revenu_previsionnel: number;
}

export interface OwnerEventCampaignGroup {
  campaignId: string;
  name: string;
  campaignType: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  advertiserName: string;
  creative: { kind: string; duration_seconds: number | null } | null;
  createdAt: Date;
  event: { kickoff_at: string; ends_at: string };
  allocations: OwnerEventAllocationLine[];
}

export const loadOwnerEventCampaigns = async (
  ownerId: string,
  pcts: ReversementPcts,
): Promise<OwnerEventCampaignGroup[]> => {
  const rows = await db
    .select({
      allocationId: eventAllocations.id,
      statut: eventAllocations.statut,
      blocs: eventAllocations.blocs,
      impressionsTotal: eventAllocations.impressionsTotal,
      montantTnd: eventAllocations.montantTnd,
      screenhostId: screenhosts.id,
      screenhostName: screenhosts.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignType: campaigns.campaignType,
      campaignStatus: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      campaignCreatedAt: campaigns.createdAt,
      advertiserBusinessName: users.businessName,
      advertiserContactName: users.contactName,
      creativeKind: creatives.creativeType,
      creativeDuration: creatives.durationSeconds,
      kickoffAt: events.kickoffAt,
      endsAt: events.endsAt,
    })
    .from(eventAllocations)
    .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .innerJoin(users, eq(campaigns.advertiserId, users.id))
    .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(eq(screenhosts.ownerId, ownerId))
    .orderBy(desc(campaigns.createdAt), desc(campaigns.id), screenhosts.name);

  const byCampaign = new Map<string, OwnerEventCampaignGroup>();
  for (const r of rows) {
    const group = byCampaign.get(r.campaignId) ?? {
      campaignId: r.campaignId,
      name: r.campaignName,
      campaignType: r.campaignType,
      status: r.campaignStatus,
      startDate: r.startDate,
      endDate: r.endDate,
      advertiserName: r.advertiserBusinessName ?? r.advertiserContactName,
      creative:
        r.creativeKind === null
          ? null
          : { kind: r.creativeKind, duration_seconds: r.creativeDuration },
      createdAt: r.campaignCreatedAt,
      event: { kickoff_at: r.kickoffAt.toISOString(), ends_at: r.endsAt.toISOString() },
      allocations: [],
    };
    group.allocations.push({
      id: r.allocationId,
      screenhost_id: r.screenhostId,
      screenhost_name: r.screenhostName,
      statut_acceptation: asOwnerEventStatut(r.statut),
      ii_potentiel: r.impressionsTotal,
      r_i: null,
      minutes: Array.isArray(r.blocs) ? r.blocs.length : 0,
      revenu_previsionnel: ownerShareTnd(Number(r.montantTnd), pcts),
    });
    byCampaign.set(r.campaignId, group);
  }
  return [...byCampaign.values()];
};
