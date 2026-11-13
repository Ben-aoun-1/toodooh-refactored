import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  deviceSessions,
  screenhosts,
  screens,
  sessions,
  users,
} from '../db/schema.js';

import { stopCampaign } from './campaign-stop.js';
import type { EngineTrace } from './engine-journal/trace.js';
import { pushPlaylistToVenue } from './playout/push.js';
import { screenRegistry } from './playout/registry.js';
import { recomputeVenueSps } from './sps-score.js';
import { type RedispatchedShare, moveVenueShares } from './venue-unavailability.js';

// DEACT-1 (Mariem's sheet row 11, operator rulings 2026-10-28) — the REVERSIBLE deactivation of a
// Host (screenhost owner) or a Cast (screencaster) by an admin or superadmin.
//   - the account is signed out everywhere and can no longer sign in (status 'deactivated', the
//     gates in require-auth / signin / device-auth / ws-auth);
//   - a HOST's venues leave dispatching (ownerApprovedSql) and stop airing NOW (ruling 2): every
//     future hour of its live shares is redispatched (moveVenueShares, the HOUR-UNAV1 machinery;
//     hours already aired stay and are paid normally), its TVs get an empty playlist, then their
//     connections close;
//   - a CAST's pending campaigns are rejected (ruling 3); its active / upcoming STANDARD campaigns
//     finish or are stopped with refund, as the admin chooses (ruling 1: an admin may stop them
//     here); MATCH campaigns always finish (ruling 4).
// History, reports, invoices and reversements are untouched. Reactivation → 'approved'.

const OWNER_ROLES = ['individual_owner', 'fleet_owner'];
const ADVERTISER_ROLE = 'advertiser';
export const DEACTIVATION_REJECT_REASON = 'Compte désactivé';
const PLAYOUT_TZ = 'Africa/Tunis';

export type DeactivationKind = 'host' | 'cast';
export type CastCampaignChoice = 'finish' | 'stop';

export class DeactivationRefused extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'SELF' | 'NOT_DEACTIVATABLE' | 'NOT_ACTIVE' | 'NOT_DEACTIVATED',
  ) {
    super(code);
  }
}

const kindOf = (role: string): DeactivationKind | null =>
  OWNER_ROLES.includes(role) ? 'host' : role === ADVERTISER_ROLE ? 'cast' : null;

/** A créneau strictly AFTER the current Tunis hour (the hour on air now is left alone). */
export const isFutureCell =
  (now: Date) =>
  (c: { date: string; hour: number }): boolean => {
    const date = formatInTimeZone(now, PLAYOUT_TZ, 'yyyy-MM-dd');
    const hour = Number(formatInTimeZone(now, PLAYOUT_TZ, 'H'));
    return c.date > date || (c.date === date && c.hour > hour);
  };

export interface DeactivationPreview {
  kind: DeactivationKind;
  status: string;
  venues: number;
  /** HOST — campaigns with live shares on its venues (they move to other venues). */
  shared_campaigns: number;
  /** CAST — its live campaigns, for the admin's « finir » / « arrêter » choice. */
  campaigns: { id: string; name: string; status: string; is_event: boolean }[];
}

const loadTarget = async (userId: string) => {
  const [u] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new DeactivationRefused('NOT_FOUND');
  const kind = kindOf(u.role);
  if (!kind) throw new DeactivationRefused('NOT_DEACTIVATABLE');
  return { ...u, kind };
};

const venuesOf = async (ownerId: string): Promise<string[]> =>
  (
    await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(eq(screenhosts.ownerId, ownerId))
  ).map((v) => v.id);

const liveCampaignsOf = async (advertiserId: string) =>
  db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      eventId: campaigns.eventId,
      campaignType: campaigns.campaignType,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.advertiserId, advertiserId),
        inArray(campaigns.status, ['pending', 'upcoming', 'active']),
      ),
    );

/** What deactivating this account would touch (the confirm window). */
export async function previewDeactivation(userId: string): Promise<DeactivationPreview> {
  const t = await loadTarget(userId);
  if (t.kind === 'host') {
    const venues = await venuesOf(userId);
    const shared =
      venues.length === 0
        ? []
        : await db
            .selectDistinct({ id: campaigns.id })
            .from(campaignDispatchAllocation)
            .innerJoin(
              campaignDispatchPlan,
              eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
            )
            .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
            .where(
              and(
                inArray(campaignDispatchAllocation.screenhostId, venues),
                inArray(campaignDispatchAllocation.statutAcceptation, ['ACCEPTE', 'EN_ATTENTE']),
                inArray(campaigns.status, ['pending', 'upcoming', 'active']),
              ),
            );
    return {
      kind: 'host',
      status: t.status,
      venues: venues.length,
      shared_campaigns: shared.length,
      campaigns: [],
    };
  }
  const live = await liveCampaignsOf(userId);
  return {
    kind: 'cast',
    status: t.status,
    venues: 0,
    shared_campaigns: 0,
    campaigns: live.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      is_event: c.eventId !== null || c.campaignType === 'event',
    })),
  };
}

export interface DeactivationResult {
  kind: DeactivationKind;
  moved: RedispatchedShare[];
  rejected: number;
  stopped: { campaign_id: string; refund_tnd: number }[];
  finishing: number;
}

export async function deactivateAccount(input: {
  userId: string;
  adminId: string;
  reason: string;
  castCampaigns: CastCampaignChoice;
  now?: Date;
  log?: FastifyBaseLogger;
}): Promise<DeactivationResult> {
  const now = input.now ?? new Date();
  if (input.userId === input.adminId) throw new DeactivationRefused('SELF');
  const target = await loadTarget(input.userId);
  if (target.status !== 'approved') throw new DeactivationRefused('NOT_ACTIVE');
  const venues = target.kind === 'host' ? await venuesOf(input.userId) : [];

  const traces: EngineTrace[] = [];
  const { moved, rejected } = await db
    .transaction(async (tx) => {
      // The status FIRST, in this transaction: the cascades below already see the owner as not
      // approved, so no share lands back on another of its venues (fleet owner).
      const [flipped] = await tx
        .update(users)
        .set({
          status: 'deactivated',
          deactivatedAt: now,
          deactivatedBy: input.adminId,
          deactivationReason: input.reason,
        })
        .where(and(eq(users.id, input.userId), eq(users.status, 'approved')))
        .returning({ id: users.id });
      if (!flipped) throw new DeactivationRefused('NOT_ACTIVE');
      await tx.delete(sessions).where(eq(sessions.userId, input.userId));
      await tx
        .update(deviceSessions)
        .set({ revokedAt: now })
        .where(and(eq(deviceSessions.userId, input.userId), isNull(deviceSessions.revokedAt)));

      const movedShares: RedispatchedShare[] = [];
      for (const venueId of venues) {
        movedShares.push(
          ...(await moveVenueShares(
            tx,
            venueId,
            isFutureCell(now),
            { firstDate: formatInTimeZone(now, PLAYOUT_TZ, 'yyyy-MM-dd'), lastDate: '9999-12-31' },
            traces,
            now,
          )),
        );
      }
      let rejectedCount = 0;
      if (target.kind === 'cast') {
        const rows = await tx
          .update(campaigns)
          .set({ status: 'rejected', rejectedAt: now, rejectReason: DEACTIVATION_REJECT_REASON })
          .where(and(eq(campaigns.advertiserId, input.userId), eq(campaigns.status, 'pending')))
          .returning({ id: campaigns.id });
        rejectedCount = rows.length;
      }
      return { moved: movedShares, rejected: rejectedCount };
    })
    .catch(async (err: unknown) => {
      await Promise.all(traces.map((tr) => tr.finish('rolled_back', { reason: 'ERROR' })));
      throw err;
    });
  await Promise.all(traces.map((tr) => tr.finish('committed', {})));

  // CAST — stop (ruling 1) or let finish; match campaigns always finish (ruling 4).
  const stopped: { campaign_id: string; refund_tnd: number }[] = [];
  let finishing = 0;
  if (target.kind === 'cast') {
    for (const c of await liveCampaignsOf(input.userId)) {
      const isEvent = c.eventId !== null || c.campaignType === 'event';
      if (input.castCampaigns === 'stop' && !isEvent) {
        const outcome = await stopCampaign({
          campaignId: c.id,
          adminId: input.adminId,
          reason: `${DEACTIVATION_REJECT_REASON} : ${input.reason}`,
          now,
          ...(input.log ? { log: input.log } : {}),
        });
        if (outcome.ok) {
          stopped.push({ campaign_id: c.id, refund_tnd: outcome.refundTnd });
          continue;
        }
      }
      finishing += 1;
    }
  }

  // HOST — the TVs: an empty playlist first (a TV replays its last playlist offline), then the
  // connections close (the WebSocket refuses a deactivated owner from now on).
  for (const venueId of venues) {
    await pushPlaylistToVenue(venueId, input.log);
    const venueScreens = await db
      .select({ id: screens.id })
      .from(screens)
      .where(eq(screens.screenhostId, venueId));
    for (const s of venueScreens) {
      for (const socket of screenRegistry.get(s.id)) socket.close(4401, 'account deactivated');
    }
    try {
      await recomputeVenueSps(venueId);
    } catch (err) {
      input.log?.warn({ err, screenhostId: venueId }, 'SPS on-deactivation recompute failed');
    }
  }
  input.log?.info(
    {
      userId: input.userId,
      kind: target.kind,
      moved: moved.length,
      rejected,
      stopped: stopped.length,
    },
    'account deactivated',
  );
  return { kind: target.kind, moved, rejected, stopped, finishing };
}

/** Reactivation: back to 'approved'. A Host's venues return to dispatching; its TVs sign in again. */
export async function reactivateAccount(userId: string): Promise<void> {
  const [row] = await db
    .update(users)
    .set({
      status: 'approved',
      deactivatedAt: null,
      deactivatedBy: null,
      deactivationReason: null,
    })
    .where(and(eq(users.id, userId), eq(users.status, 'deactivated')))
    .returning({ id: users.id });
  if (!row) {
    await loadTarget(userId);
    throw new DeactivationRefused('NOT_DEACTIVATED');
  }
}
