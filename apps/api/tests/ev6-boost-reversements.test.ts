import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentReferrals,
  businessSectors,
  campaignBoosts,
  campaignZones,
  campaigns,
  creatives,
  eventAllocations,
  events,
  notifications,
  proofOfPlay,
  recharges,
  reversementLines,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
  zones,
} from '../src/db/schema.js';
import { settleEventPositioning } from '../src/lib/event-playout/settlement.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { eventBoostRoutes } from '../src/routes/event-boost.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// EV6 — the event booster (ZONES ONLY) + the venue reversement lines on E7's rail (source='event',
// DELIVERED value only). The campaign booster and the campaign reversement path are byte-untouched
// (zero edits in their suites). No business_sectors rows added (the fixture footgun); zones ARE
// inserted here because the boost's axis is zones and the seed set is per-test.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'advertiser'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `ev6-${seq}@example.com`,
      contactName: `EV6 User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

/**
 * A fresh zone (the boost's axis) — EV6 seeds its own rather than reusing the V1 Grand Tunis row.
 * The name carries a random token: zones.name is UNIQUE and the table is NOT swept between runs
 * (the Zone In/Out suites do the same). No suite pins a zone COUNT, so adding rows is safe.
 */
const seedZone = async (): Promise<string> => {
  seq += 1;
  const [z] = await db
    .insert(zones)
    .values({ name: `EV6 Zone ${seq}-${Math.random().toString(16).slice(2, 10)}`, active: true })
    .returning();
  return z?.id ?? '';
};

const seedVenue = async (
  opts: { zoneId?: string; sps?: string } = {},
): Promise<{
  id: string;
  ownerId: string;
}> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EV6 Venue ${seq}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium',
      sps: opts.sps ?? '80',
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
      ...(opts.zoneId ? { zoneId: opts.zoneId } : {}),
    })
    .returning();
  const id = sh?.id ?? '';
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: id, dayOfWeek: 1, hour: 19, estimatedImpressions: 100 }));
  return { id, ownerId };
};

const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');
const GRID = fenetreDiffusion(KICKOFF, ENDS);
const AFTER_WINDOW = new Date(GRID.windowEnd.getTime() + 60_000);

const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `EV6 Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

interface SeededPositioning {
  campaignId: string;
  advertiserId: string;
  eventId: string;
}

/** A LIVE positioning (upcoming by default) holding one allocation on `venueId`. */
const seedPositioning = async (
  eventId: string,
  venueId: string | null,
  opts: {
    status?: 'draft' | 'upcoming' | 'active' | 'completed';
    zoneIds?: string[];
    montant?: string;
    statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
    fundTnd?: string;
  } = {},
): Promise<SeededPositioning> => {
  const advertiserId = await seedUser();
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/ev6/${seq}`,
      durationSeconds: 15,
      validationStatus: 'approved',
      fileHash: `ev6-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  await db.insert(recharges).values({
    advertiserId,
    amountTnd: opts.fundTnd ?? '5000.00',
    status: 'confirmed',
    reference: `EV6-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement EV6 ${seq}`,
      campaignType: 'event',
      status: opts.status ?? 'upcoming',
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      requestedBudget: '300.00',
      eventId,
      creativeId: creative?.id,
    })
    .returning();
  const campaignId = campaign?.id ?? '';
  for (const zoneId of opts.zoneIds ?? []) {
    await db.insert(campaignZones).values({ campaignId, zoneId });
  }
  if (venueId) {
    await db.insert(eventAllocations).values({
      campaignId,
      screenhostId: venueId,
      blocs: GRID.blocs.map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        impressions: 2000,
      })),
      impressionsTotal: 12_000,
      montantTnd: opts.montant ?? '180.000',
      statut: opts.statut ?? 'ACCEPTE',
      ...(opts.statut === 'EN_ATTENTE' ? {} : { decidedAt: new Date() }),
    });
  }
  return { campaignId, advertiserId, eventId };
};

const seedProof = async (campaignId: string, venueId: string, receivedAt: Date): Promise<void> => {
  seq += 1;
  const [campaign] = await db
    .select({ creativeId: campaigns.creativeId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: venueId, name: `EV6 Screen ${seq}` })
    .returning();
  await db.insert(proofOfPlay).values({
    screenId: screen?.id ?? '',
    screenhostId: venueId,
    campaignId,
    creativeId: campaign?.creativeId ?? '',
    videoIdAsSent: campaignId,
    eventType: 'VIDEO_ENDED',
    receivedAt,
  });
};

const buildApp = () => Fastify({ logger: false });

describe('EV6 — the event booster + event reversements (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(eventBoostRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const preview = (campaignId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/event-boost/preview`,
      payload,
    });
  const boost = (campaignId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/event-boost`, payload });

  describe('the boost gating matrix (ZONES ONLY)', () => {
    it('boosts an À venir positioning: new EN_ATTENTE allocations reach the added zone’s owners', async () => {
      const baseZone = await seedZone();
      const newZone = await seedZone();
      const held = await seedVenue({ zoneId: baseZone, sps: '90' });
      const target = await seedVenue({ zoneId: newZone, sps: '70' });
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, held.id, {
        zoneIds: [baseZone],
      });
      mockSession(advertiserId);

      const previewRes = await preview(campaignId, { added_zone_ids: [newZone] });
      expect(previewRes.statusCode).toBe(200);
      const previewBody = previewRes.json() as { c_max_evt_tnd: number; eligible_count: number };
      expect(previewBody.eligible_count).toBe(1); // the added zone brings exactly one venue
      expect(previewBody.c_max_evt_tnd).toBeGreaterThan(0);
      // NOTHING persisted by the preview.
      expect(await db.select().from(campaignBoosts)).toHaveLength(0);

      const res = await boost(campaignId, { added_zone_ids: [newZone], amount_tnd: 150 });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { placed_venues: number; amount_tnd: number };
      expect(body.placed_venues).toBe(1);

      // The new allocation landed on the ADDED zone's venue, EN_ATTENTE, awaiting its owner.
      const allocations = await db
        .select()
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, campaignId));
      expect(allocations).toHaveLength(2);
      const fresh = allocations.find((a) => a.screenhostId === target.id);
      expect(fresh?.statut).toBe('EN_ATTENTE');
      // The already-held venue was NOT touched (merge semantics: never mutate an accepted row).
      const untouched = allocations.find((a) => a.screenhostId === held.id);
      expect(untouched?.statut).toBe('ACCEPTE');
      expect(Number(untouched?.montantTnd)).toBe(180);

      // The owner of the new venue was proposed to; the zone + budget + audit row landed.
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, target.ownerId));
      expect(notifs.some((n) => n.type === 'dispatch_pending_acceptance')).toBe(true);
      const zonesNow = await db
        .select({ zoneId: campaignZones.zoneId })
        .from(campaignZones)
        .where(eq(campaignZones.campaignId, campaignId));
      expect(zonesNow.map((z) => z.zoneId).sort()).toEqual([baseZone, newZone].sort());
      const [row] = await db
        .select({ requestedBudget: campaigns.requestedBudget })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      expect(Number(row?.requestedBudget)).toBe(450); // 300 + 150
      const [audit] = await db
        .select()
        .from(campaignBoosts)
        .where(eq(campaignBoosts.campaignId, campaignId));
      expect(audit?.addedZoneIds).toEqual([newZone]);
      expect(audit?.addedCategoryIds).toEqual([]); // the category axis is FROZEN for events
      expect(Number(audit?.amountTnd)).toBe(150);
    });

    it('refuses a draft / completed positioning, and a classic campaign outright', async () => {
      const newZone = await seedZone();
      await seedVenue({ zoneId: newZone });
      const eventId = await seedEvent();
      const draft = await seedPositioning(eventId, null, { status: 'draft' });
      mockSession(draft.advertiserId);
      const draftRes = await boost(draft.campaignId, {
        added_zone_ids: [newZone],
        amount_tnd: 150,
      });
      expect(draftRes.statusCode).toBe(409);
      expect((draftRes.json() as { error: string }).error).toBe('NOT_BOOSTABLE');

      const done = await seedPositioning(eventId, null, { status: 'completed' });
      mockSession(done.advertiserId);
      expect(
        (await boost(done.campaignId, { added_zone_ids: [newZone], amount_tnd: 150 })).statusCode,
      ).toBe(409);

      // A CLASSIC campaign never enters this route (it has CF-B1's).
      const advertiserId = await seedUser();
      const [classic] = await db
        .insert(campaigns)
        .values({
          advertiserId,
          name: 'Classique',
          campaignType: 'standard',
          status: 'active',
          startDate: '2027-06-10',
          endDate: '2027-06-12',
          requestedBudget: '300.00',
        })
        .returning();
      mockSession(advertiserId);
      const classicRes = await boost(classic?.id ?? '', {
        added_zone_ids: [newZone],
        amount_tnd: 150,
      });
      expect(classicRes.statusCode).toBe(404); // no event join → indistinguishable from missing
    });

    it('requires ≥1 NEW zone: an already-covered zone and an empty list are refused', async () => {
      const baseZone = await seedZone();
      const venue = await seedVenue({ zoneId: baseZone });
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, venue.id, {
        zoneIds: [baseZone],
      });
      mockSession(advertiserId);
      const already = await boost(campaignId, { added_zone_ids: [baseZone], amount_tnd: 150 });
      expect(already.statusCode).toBe(400);
      expect((already.json() as { error: string }).error).toBe('ZONE_ALREADY_TARGETED');
      // An empty list never reaches the lib — the body schema requires one.
      expect((await boost(campaignId, { added_zone_ids: [], amount_tnd: 150 })).statusCode).toBe(
        400,
      );
      // An unknown zone id is refused too.
      const unknown = await boost(campaignId, {
        added_zone_ids: ['00000000-0000-4000-8000-0000000000e6'],
        amount_tnd: 150,
      });
      expect((unknown.json() as { error: string }).error).toBe('ZONE_NOT_FOUND');
    });

    it('the ceiling nets the positioning’s OWN live allocations; floor 100; solde gated', async () => {
      const baseZone = await seedZone();
      const newZone = await seedZone();
      const held = await seedVenue({ zoneId: baseZone, sps: '90' });
      await seedVenue({ zoneId: newZone, sps: '70' });
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, held.id, {
        zoneIds: [baseZone],
        montant: '180.000',
        fundTnd: '120.00',
      });
      mockSession(advertiserId);

      const withOwn = (
        (await preview(campaignId, { added_zone_ids: [newZone] })).json() as {
          c_max_evt_tnd: number;
        }
      ).c_max_evt_tnd;
      // Release the venue's hold (REFUSE) → the ceiling grows back by its 180.
      await db
        .update(eventAllocations)
        .set({ statut: 'REFUSE' })
        .where(eq(eventAllocations.campaignId, campaignId));
      const withoutOwn = (
        (await preview(campaignId, { added_zone_ids: [newZone] })).json() as {
          c_max_evt_tnd: number;
        }
      ).c_max_evt_tnd;
      expect(Math.round(withoutOwn - withOwn)).toBe(180);

      // The floor.
      const low = await boost(campaignId, { added_zone_ids: [newZone], amount_tnd: 50 });
      expect((low.json() as { error: string }).error).toBe('BUDGET_BELOW_MINIMUM');
      // Over the ceiling.
      const over = await boost(campaignId, {
        added_zone_ids: [newZone],
        amount_tnd: withoutOwn + 1,
      });
      expect((over.json() as { error: string }).error).toBe('BUDGET_EXCEEDS_CMAX');
      // Inside the ceiling but over the SOLDE (funded 120).
      const broke = await boost(campaignId, { added_zone_ids: [newZone], amount_tnd: 200 });
      expect((broke.json() as { error: string }).error).toBe('INSUFFICIENT_BALANCE');
      // …and none of those refusals persisted anything.
      expect(await db.select().from(campaignBoosts)).toHaveLength(0);
      const zonesNow = await db
        .select()
        .from(campaignZones)
        .where(eq(campaignZones.campaignId, campaignId));
      expect(zonesNow).toHaveLength(1);
    });

    it('ATOMICITY: an added zone with no eligible venue refuses and persists NOTHING', async () => {
      const baseZone = await seedZone();
      const emptyZone = await seedZone(); // no venue sits in it
      const held = await seedVenue({ zoneId: baseZone });
      // Extra inventory so the complementary CEILING is comfortable — the refusal under test is
      // the empty perimeter, not the money gate (which is checked first, by design).
      await seedVenue({ zoneId: baseZone });
      await seedVenue({ zoneId: baseZone });
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, held.id, {
        zoneIds: [baseZone],
      });
      mockSession(advertiserId);
      const before = {
        zones: (
          await db.select().from(campaignZones).where(eq(campaignZones.campaignId, campaignId))
        ).length,
        allocations: (
          await db
            .select()
            .from(eventAllocations)
            .where(eq(eventAllocations.campaignId, campaignId))
        ).length,
        budget: Number(
          (
            await db
              .select({ b: campaigns.requestedBudget })
              .from(campaigns)
              .where(eq(campaigns.id, campaignId))
          )[0]?.b,
        ),
      };
      const res = await boost(campaignId, { added_zone_ids: [emptyZone], amount_tnd: 150 });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('NO_ELIGIBLE');
      const after = {
        zones: (
          await db.select().from(campaignZones).where(eq(campaignZones.campaignId, campaignId))
        ).length,
        allocations: (
          await db
            .select()
            .from(eventAllocations)
            .where(eq(eventAllocations.campaignId, campaignId))
        ).length,
        budget: Number(
          (
            await db
              .select({ b: campaigns.requestedBudget })
              .from(campaigns)
              .where(eq(campaigns.id, campaignId))
          )[0]?.b,
        ),
      };
      expect(after).toEqual(before);
      expect(await db.select().from(campaignBoosts)).toHaveLength(0);
    });

    it('an annulé event can no longer be boosted', async () => {
      const newZone = await seedZone();
      await seedVenue({ zoneId: newZone });
      const eventId = await seedEvent({ annule: true });
      const { campaignId, advertiserId } = await seedPositioning(eventId, null);
      mockSession(advertiserId);
      const res = await boost(campaignId, { added_zone_ids: [newZone], amount_tnd: 150 });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('EVENT_ANNULE');
    });

    it('the booster offers NO frozen axis: the body schema has no spot/category/date field', () => {
      const route = readFileSync(
        fileURLToPath(new URL('../src/routes/event-boost.ts', import.meta.url)),
        'utf8',
      );
      // Only two inputs exist, ever.
      expect(route).toContain('added_zone_ids');
      expect(route).toContain('amount_tnd');
      expect(route).not.toMatch(/added_category_ids|new_end_date|creative_id/);
    });
  });

  describe('the venue reversements (E7’s rail, source=event)', () => {
    it('Σ lines ≡ the DELIVERED value, split 50/44/3/3 exactly, source=event', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { montant: '180.000' });
      // 3 of 6 blocs proven → delivered 90.000 TND.
      for (const bloc of GRID.blocs.slice(0, 3)) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      const settled = await settleEventPositioning(campaignId, AFTER_WINDOW);
      expect(settled.deliveredTnd).toBe(90);
      expect(settled.refundTnd).toBe(90);

      const lines = await db
        .select()
        .from(reversementLines)
        .where(eq(reversementLines.campaignId, campaignId));
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line?.source).toBe('event');
      expect(line?.screenhostId).toBe(venue.id);
      // THE IDENTITY: the base IS the delivered value — the refunded half never enters it.
      expect(Number(line?.baseValueTnd)).toBe(90);
      expect(Number(line?.shAmountTnd)).toBe(45); // 50 %
      expect(Number(line?.toodoohAmountTnd)).toBe(39.6); // 44 %
      expect(Number(line?.agentShAmountTnd)).toBe(2.7); // 3 %
      expect(Number(line?.agentScAmountTnd)).toBe(2.7); // 3 %
      const sum =
        Number(line?.shAmountTnd) +
        Number(line?.toodoohAmountTnd) +
        Number(line?.agentShAmountTnd) +
        Number(line?.agentScAmountTnd);
      expect(Math.round(sum * 1000) / 1000).toBe(90); // exact-sum, no millime lost
    });

    it('a fully-refunded positioning writes NO line at all', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { montant: '180.000' });
      // No proof at all → nothing delivered → nothing to reverse.
      const settled = await settleEventPositioning(campaignId, AFTER_WINDOW);
      expect(settled.deliveredTnd).toBe(0);
      expect(settled.refundTnd).toBe(180);
      const lines = await db
        .select()
        .from(reversementLines)
        .where(eq(reversementLines.campaignId, campaignId));
      expect(lines).toHaveLength(0);
      const payouts =
        await sql`select count(*)::int as n from campaign_screenhost_payout where campaign_id = ${campaignId}`;
      expect(payouts[0]?.['n']).toBe(0);
    });

    it('agent attribution: the owner’s agent takes the SH line, the advertiser’s the SC line', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, venue.id, {
        montant: '180.000',
      });
      const ownerAgent = await seedUser({ role: 'screenhost_agent' });
      const castAgent = await seedUser({ role: 'screencast_agent' });
      await db.insert(agentReferrals).values({
        agentUserId: ownerAgent,
        referredUserId: venue.ownerId,
        agentCodeUsed: `EV6SH${seq}`,
      });
      await db.insert(agentReferrals).values({
        agentUserId: castAgent,
        referredUserId: advertiserId,
        agentCodeUsed: `EV6SC${seq}`,
      });
      for (const bloc of GRID.blocs) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      await settleEventPositioning(campaignId, AFTER_WINDOW);
      const [line] = await db
        .select()
        .from(reversementLines)
        .where(eq(reversementLines.campaignId, campaignId));
      expect(line?.agentShId).toBe(ownerAgent);
      expect(line?.agentScId).toBe(castAgent);
    });

    it('a venue NEGATED by attestation earns nothing (no line), the others still do', async () => {
      const good = await seedVenue({ sps: '90' });
      const bad = await seedVenue({ sps: '80' });
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, good.id, { montant: '180.000' });
      await db.insert(eventAllocations).values({
        campaignId,
        screenhostId: bad.id,
        blocs: GRID.blocs.map((b) => ({
          start: b.start.toISOString(),
          end: b.end.toISOString(),
          impressions: 2000,
        })),
        impressionsTotal: 12_000,
        montantTnd: '120.000',
        statut: 'ACCEPTE',
        decidedAt: new Date(),
      });
      for (const bloc of GRID.blocs) {
        await seedProof(campaignId, good.id, new Date(bloc.start.getTime() + 5_000));
        await seedProof(campaignId, bad.id, new Date(bloc.start.getTime() + 5_000));
      }
      // The agent says the second venue did not respect the event.
      const agentId = await seedUser({ role: 'screenhost_agent' });
      await sql`insert into event_attestations (event_id, screenhost_id, author_id, respecte) values (${eventId}, ${bad.id}, ${agentId}, false)`;

      await settleEventPositioning(campaignId, AFTER_WINDOW);
      const lines = await db
        .select()
        .from(reversementLines)
        .where(eq(reversementLines.campaignId, campaignId));
      expect(lines).toHaveLength(1);
      expect(lines[0]?.screenhostId).toBe(good.id);
      expect(Number(lines[0]?.baseValueTnd)).toBe(180);
    });

    it('THE RETROACTIVE GAP (pinned, not backfilled): a pre-EV6 settlement keeps zero lines', async () => {
      const venue = await seedVenue();
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, venue.id, { montant: '180.000' });
      for (const bloc of GRID.blocs) {
        await seedProof(campaignId, venue.id, new Date(bloc.start.getTime() + 5_000));
      }
      // Simulate a settlement that happened BEFORE this lane: the reconciliation row exists, the
      // lines do not. Re-running is a no-op (UNIQUE(campaign_id)) — EV6 does NOT backfill.
      await sql`insert into campaign_reconciliation (campaign_id, expected_imp, delivered_imp, manquement_imp, p_perte_tnd, refund_tnd, spend_tnd, status)
                values (${campaignId}, 12000, 12000, 0, 0, 0, 180, 'reussie')`;
      const again = await settleEventPositioning(campaignId, AFTER_WINDOW);
      expect(again.status).toBe('ALREADY_SETTLED');
      const lines = await db
        .select()
        .from(reversementLines)
        .where(eq(reversementLines.campaignId, campaignId));
      expect(lines).toHaveLength(0);
    });

    it('the E7 rail source is CALLED, never modified (source pin)', () => {
      const settlement = readFileSync(
        fileURLToPath(new URL('../src/lib/event-playout/settlement.ts', import.meta.url)),
        'utf8',
      );
      expect(settlement).toContain('computeReversement');
      expect(settlement).toContain("source: 'event'");
      const rail = readFileSync(
        fileURLToPath(new URL('../src/lib/reversement/split.ts', import.meta.url)),
        'utf8',
      );
      // The rail is PURE arithmetic: it imports nothing and reads no table — events reach it only
      // as millimes. (Its prose already anticipated an event origin; the code never learned one.)
      expect(rail).not.toMatch(/^import /m);
      expect(rail).not.toMatch(/eventAllocations|event_allocations|db\./);
    });
  });

  describe('THE RIDER — an inspecting agent reaches the catalogue + the attestation panel', () => {
    it('a screenhost_agent may READ the events list; every WRITE stays admin-only', () => {
      const routes = readFileSync(
        fileURLToPath(new URL('../src/routes/admin-events.ts', import.meta.url)),
        'utf8',
      );
      // The read guard names the agent — as a LOCAL guard, so the pinned French 403 copy an
      // advertiser reads on this route is unchanged (ev1-events pins that sentence).
      expect(routes).toContain(
        "const EVENT_CATALOGUE_ROLES = new Set(['admin', 'superadmin', 'screenhost_agent'])",
      );
      expect(routes).toContain("message: 'Accès administrateur requis.'");
      expect(routes).toContain("app.get('/api/admin/events', eventReadGuard");
      // …and every mutation keeps adminGuard.
      for (const write of [
        "app.post('/api/admin/events', adminGuard",
        "app.patch('/api/admin/events/:id', adminGuard",
        "app.post('/api/admin/events/:id/annuler', adminGuard",
        "app.post('/api/admin/events/:id/reporter', adminGuard",
        "app.post('/api/admin/events/:id/image', adminGuard",
      ]) {
        expect(routes, `${write} lost its admin guard`).toContain(write);
      }
    });
  });

  describe('the campaign side is byte-untouched', () => {
    it('the event booster never imports the campaign boost, and vice versa', () => {
      const eventBoost = readFileSync(
        fileURLToPath(new URL('../src/lib/event-dispatch/boost.ts', import.meta.url)),
        'utf8',
      );
      const campaignBoost = readFileSync(
        fileURLToPath(new URL('../src/lib/boost.ts', import.meta.url)),
        'utf8',
      );
      expect(eventBoost).not.toMatch(/from '\.\.\/boost\.js'|runBoost/);
      expect(campaignBoost).not.toMatch(/eventAllocations|event-dispatch/);
    });
  });
});
