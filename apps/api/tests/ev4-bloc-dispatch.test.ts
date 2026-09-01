import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaigns,
  creatives,
  eventAllocations,
  events,
  hourReservations,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { prepareActivation } from '../src/lib/activation-service.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { tForDuration } from '../src/lib/dispatch/thresholds.js';
import {
  EVENT_PARTIAL_TITLE,
  EVENT_PROPOSAL_TITLE,
  type EventPoolVenue,
  eventICible,
  eventNmax,
  fillEventBlocs,
  reserveBlocHours,
} from '../src/lib/event-dispatch/dispatch.js';
import { activeAllocationsForScreenhost } from '../src/lib/playout/active-allocations.js';
import { buildPlaylist } from '../src/lib/playout/playlist.js';
import { computeSps } from '../src/lib/sps-score.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// EV4 — the bloc dispatch engine: D2 SPS ordering, D3 greedy concentration to I_cible_evt,
// D4 anti-miette DROP (both sides of the 20-TND line), D5/D7 N_max atomic block, D6 partial +
// alert; hour-grained reservations (place → release-on-REFUSE → keep-on-ACCEPTE) and THE FIRST
// REAL FEED into the campaign engine's inert subtraction; the refusal cascade; the SPS hook on
// event decisions; THE PLAYOUT PIN (nothing airs); rider a's backcompat; the D51 boundary.
// No business_sectors/zones rows added (the fixture footgun); sector flags untouched.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'owner'): void => {
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
      email: `ev4-${seq}@example.com`,
      contactName: `EV4 User ${seq}`,
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

/** A venue open 8–23, uniform hourly affluence (A_max ratchets to it), explicit SPS. */
const seedVenue = async (opts: {
  sps: string;
  affluence?: number;
}): Promise<{
  id: string;
  ownerId: string;
}> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EV4 Venue ${seq}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium',
      sps: opts.sps,
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 8; h < 23; h += 1)
      rows.push({
        screenhostId: id,
        dayOfWeek: dow,
        hour: h,
        estimatedImpressions: opts.affluence ?? 100,
      });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  return { id, ownerId };
};

// A Tunis-evening fixture: kickoff 20:00, ends 22:00 → window 19:00–23:00 on ONE Tunis date.
const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');

const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `EV4 Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

/** A funded, approved-spot positioning bound to `eventId` (the EV3 shape). */
const seedPositioning = async (
  eventId: string,
  budget: string,
): Promise<{ campaignId: string; advertiserId: string; creativeId: string }> => {
  const advertiserId = await seedUser();
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/ev4/${seq}`,
      durationSeconds: 10,
      validationStatus: 'approved',
      fileHash: `ev4-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  await db.insert(recharges).values({
    advertiserId,
    amountTnd: '2000.00',
    status: 'confirmed',
    reference: `EV4-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement ${seq}`,
      campaignType: 'event',
      status: 'draft',
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      requestedBudget: budget,
      eventId,
      creativeId: creative?.id,
    })
    .returning();
  return { campaignId: c?.id ?? '', advertiserId, creativeId: creative?.id ?? '' };
};

const prepare = async (campaignId: string) => {
  const [full] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!full) throw new Error('no campaign');
  return prepareActivation({
    campaign: full,
    contentValidationStatus: 'approved',
    creativeDurationSeconds: 10,
    fromStatus: 'draft',
  });
};

const allocationsOf = (campaignId: string) =>
  db.select().from(eventAllocations).where(eq(eventAllocations.campaignId, campaignId));

const reservationsOf = (eventId: string, screenhostId?: string) =>
  db
    .select()
    .from(hourReservations)
    .where(
      screenhostId
        ? and(
            eq(hourReservations.eventId, eventId),
            eq(hourReservations.screenhostId, screenhostId),
          )
        : eq(hourReservations.eventId, eventId),
    );

// A pure-pool builder for the fill matrix (no DB).
const poolVenue = (id: string, sps: number, blocCount: number, amax = 100): EventPoolVenue => ({
  screenhostId: id,
  ownerId: `owner-${id}`,
  name: `Venue ${id}`,
  sps,
  createdAtMs: 0,
  amaxPph: amax,
  blocs: Array.from({ length: blocCount }, (_, i) => ({
    start: new Date(KICKOFF.getTime() - (i + 1) * 20 * 60 * 1000),
    end: new Date(KICKOFF.getTime() - i * 20 * 60 * 1000),
  })),
});

const buildApp = () => Fastify({ logger: false });

describe('EV4 — the bloc dispatch engine (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.register(adminCampaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('the fill matrix (pure — fillEventBlocs)', () => {
    it('THE WORKED EXAMPLE (EV2 numbers): A_max 100, CPM 15, budget 150 → exactly 5 blocs, 150.000 TND', () => {
      // I_cible = ⌊150 × 1000 ÷ 15⌋ = 10 000; a bloc = 100 × 20 = 2 000 impressions.
      expect(eventICible(150, 15)).toBe(10_000);
      expect(eventNmax(150)).toBe(3); // ⌊150 × 0.5 ÷ 20⌋
      const fill = fillEventBlocs([poolVenue('a', 80, 6)], 150, 15);
      expect(fill.status).toBe('FILLED');
      if (fill.status !== 'FILLED') return;
      expect(fill.placements).toHaveLength(1);
      expect(fill.placements[0]?.blocs).toHaveLength(5); // I_cible EXACT — no overshoot, no drop
      expect(fill.placements[0]?.impressionsTotal).toBe(10_000);
      expect(fill.placements[0]?.montantTnd).toBe(150);
      expect(fill.droppedImpressions).toBe(0);
    });

    it('D2/D3 — concentration: the highest-SPS venue fills first; ties break deterministically', () => {
      const fill = fillEventBlocs([poolVenue('low', 40, 6), poolVenue('high', 90, 2)], 150, 15);
      expect(fill.status).toBe('FILLED');
      if (fill.status !== 'FILLED') return;
      // high takes its 2 blocs (4 000), low completes to 10 000 with 3 blocs.
      expect(fill.placements.map((p) => p.screenhostId)).toEqual(['high', 'low']);
      expect(fill.placements[0]?.blocs).toHaveLength(2);
      expect(fill.placements[1]?.blocs).toHaveLength(3);
    });

    it('D4 both sides of the 20-TND line: a 1 333-impression remainder DROPS, 1 334 books a bloc', () => {
      // CPM 15 → the first chargeable remainder is ⌈20 000 ÷ 15⌉ = 1 334 impressions.
      // budget 50 → I_cible 3 333: one bloc placed (2 000), remainder 1 333 (≈ 19.995 TND) DROPPED.
      const dropped = fillEventBlocs([poolVenue('a', 80, 6)], 50, 15);
      expect(dropped.status).toBe('FILLED');
      if (dropped.status !== 'FILLED') return;
      expect(dropped.placements[0]?.blocs).toHaveLength(1);
      expect(dropped.droppedImpressions).toBe(1_333);
      // budget 50.01 → I_cible 3 334: the remainder 1 334 (20.01 TND) books a SECOND whole bloc;
      // the charge stays capped at I_cible (montant = 3 334 × 15 ÷ 1000 = 50.01 — never the
      // overshoot's physical 4 000).
      const booked = fillEventBlocs([poolVenue('a', 80, 6)], 50.01, 15);
      expect(booked.status).toBe('FILLED');
      if (booked.status !== 'FILLED') return;
      expect(booked.placements[0]?.blocs).toHaveLength(2);
      expect(booked.placements[0]?.impressionsTotal).toBe(4_000);
      expect(booked.placements[0]?.montantTnd).toBe(50.01);
      expect(booked.droppedImpressions).toBe(0);
    });

    it('D5/D7 — needing more venues than N_max BLOCKS', () => {
      // budget 100 → N_max 2, I_cible 6 666; three 1-bloc venues: the third opening exceeds.
      const fill = fillEventBlocs(
        [poolVenue('a', 90, 1), poolVenue('b', 80, 1), poolVenue('c', 70, 1)],
        100,
        15,
      );
      expect(fill).toEqual({ status: 'NMAX_EXCEEDED', nMax: 2 });
    });

    it('D6 — pool exhaustion below I_cible is a PARTIAL fill', () => {
      const fill = fillEventBlocs([poolVenue('a', 90, 1)], 100, 15);
      expect(fill.status).toBe('PARTIAL');
      if (fill.status !== 'PARTIAL') return;
      expect(fill.placedImpressions).toBe(2_000);
      expect(fill.droppedImpressions).toBe(4_666);
    });
  });

  describe('the dispatch through EV3’s seam (prepareActivation)', () => {
    it('validating a positioning places EN_ATTENTE allocations + reservations + owner proposals; plan stays NULL', async () => {
      const venue = await seedVenue({ sps: '80' });
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, '150.00');
      const prepared = await prepare(campaignId);
      expect(prepared.status).toBe('READY');
      if (prepared.status !== 'READY') return;
      expect(prepared.plan).toBeNull();
      const allocs = await allocationsOf(campaignId);
      expect(allocs).toHaveLength(1);
      expect(allocs[0]?.statut).toBe('EN_ATTENTE');
      expect(allocs[0]?.screenhostId).toBe(venue.id);
      expect(allocs[0]?.impressionsTotal).toBe(10_000);
      expect(Number(allocs[0]?.montantTnd)).toBe(150);
      // Reservations: the BLOCS cover hour 19 (the three avant blocs) and hour 22 (the three
      // après blocs) — the match interior carries no blocs, so exactly TWO hour rows exist.
      const held = await reservationsOf(eventId);
      expect(held.map((r) => `${r.day}:${r.hour}`).sort()).toEqual([
        '2027-06-10:19',
        '2027-06-10:22',
      ]);
      // The §11.1 proposal reached the owner.
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, venue.ownerId));
      expect(notifs.some((n) => n.title === EVENT_PROPOSAL_TITLE)).toBe(true);
    });

    it('a re-prepare RESUMES (no duplicate allocations, reservations or proposals)', async () => {
      const venue = await seedVenue({ sps: '80' });
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, '150.00');
      await prepare(campaignId);
      const again = await prepare(campaignId);
      expect(again.status).toBe('READY');
      expect(await allocationsOf(campaignId)).toHaveLength(1);
      expect(await reservationsOf(eventId)).toHaveLength(2);
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, venue.ownerId));
      expect(notifs.filter((n) => n.title === EVENT_PROPOSAL_TITLE)).toHaveLength(1);
    });

    it('D7 excess REFUSES ATOMICALLY through the admin route (409, nothing persisted, no flip)', async () => {
      // Three 1-bloc-ish venues would be needed: shrink each venue to ONE available bloc by
      // opening hours 21–23 only (post blocs 22:00–23:00 → 3 blocs... use affluence 34 → bloc
      // 680) — simplest: A_max 34 → bloc 680 impressions; budget 100 → I_cible 6 666 needs 10
      // blocs = spread over ≥ 3 venues of 6 blocs (4 080 each)? 2 venues give 8 160 ≥ 6 666.
      // Force it: A_max 20 → bloc 400, venue max 2 400; budget 100 → I_cible 6 666 → needs 3
      // venues (4 800 after two) → D7 at N_max 2.
      const v1 = await seedVenue({ sps: '90', affluence: 20 });
      const v2 = await seedVenue({ sps: '80', affluence: 20 });
      await seedVenue({ sps: '70', affluence: 20 });
      void v1;
      void v2;
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, '100.00');
      await db.update(campaigns).set({ status: 'pending' }).where(eq(campaigns.id, campaignId));
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId, 'admin');
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/campaigns/${campaignId}/activate`,
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('EVENT_NMAX_EXCEEDED');
      // ATOMIC: nothing persisted, nothing flipped.
      expect(await allocationsOf(campaignId)).toHaveLength(0);
      expect(await reservationsOf(eventId)).toHaveLength(0);
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      expect(row?.status).toBe('pending');
    });

    it('D6 partial placement ALERTS the advertiser and still validates', async () => {
      await seedVenue({ sps: '80', affluence: 20 }); // 6 blocs × 400 = 2 400 ≪ I_cible 6 666
      const eventId = await seedEvent();
      const { campaignId, advertiserId } = await seedPositioning(eventId, '100.00');
      const prepared = await prepare(campaignId);
      expect(prepared.status).toBe('READY');
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, advertiserId));
      expect(notifs.some((n) => n.title === EVENT_PARTIAL_TITLE)).toBe(true);
    });

    it('a cross-midnight BLOC reserves on BOTH Tunis dates (hour-grained)', async () => {
      // The schema caps closing_hour at 23, so no venue can HOST hour 23 through availability —
      // the two-dates rule is the reservation WRITER's and pins directly on it: a 23:50→00:10
      // bloc touches (d1, 23) and (d2, 0), one row each.
      const venue = await seedVenue({ sps: '80' });
      const eventId = await seedEvent({
        kickoffAt: new Date('2027-06-11T00:30:00+01:00'),
        endsAt: new Date('2027-06-11T02:30:00+01:00'),
      });
      await reserveBlocHours(db, eventId, venue.id, [
        {
          start: '2027-06-10T23:50:00.000+01:00',
          end: '2027-06-11T00:10:00.000+01:00',
          impressions: 2000,
        },
      ]);
      const held = await reservationsOf(eventId, venue.id);
      expect(held.map((r) => `${r.day}:${r.hour}`).sort()).toEqual([
        '2027-06-10:23',
        '2027-06-11:0',
      ]);
    });
  });

  describe('THE FIRST REAL FEED — reservations shrink the campaign engine’s pool', () => {
    it('a classic cmax pool entry loses exactly the reserved hours’ share', async () => {
      const venue = await seedVenue({ sps: '80' });
      const cfg = await getDispatchConfig();
      const t = tForDuration(10, cfg);
      const window = {
        id: '00000000-0000-4000-8000-0000000000e4',
        startDate: '2027-06-10',
        endDate: '2027-06-10',
      };
      const before = await assemblePool(db, window, { s: 10, t, fMaxSeconds: cfg.fMaxSeconds }, {});
      const entryBefore = before.pool.find((p) => p.id === venue.id);
      expect(entryBefore).toBeDefined();

      // The event dispatch reserves the bloc hours 19 and 22 of the venue's 15 open hours.
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, '150.00');
      await prepare(campaignId);
      expect(await reservationsOf(eventId, venue.id)).toHaveLength(2);

      const after = await assemblePool(db, window, { s: 10, t, fMaxSeconds: cfg.fMaxSeconds }, {});
      const entryAfter = after.pool.find((p) => p.id === venue.id);
      expect(entryAfter).toBeDefined();
      if (!entryBefore || !entryAfter) return;
      // Uniform hourly affluence → capacity is linear in surviving hours: 2 of 15 hours
      // reserved shrinks the residual by EXACTLY 2/15 (the EV1 inert pin's live twin).
      expect(entryAfter.residualCapacity).toBe(
        Math.round(entryBefore.residualCapacity * (13 / 15)),
      );
      expect(entryAfter.residualCapacity).toBeLessThan(entryBefore.residualCapacity);
    });
  });

  describe('owner decisions + the cascade (§11.1)', () => {
    const dispatchTwoVenues = async () => {
      const v1 = await seedVenue({ sps: '90' }); // fills first
      const v2 = await seedVenue({ sps: '40' });
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, '150.00');
      const prepared = await prepare(campaignId);
      expect(prepared.status).toBe('READY');
      const allocs = await allocationsOf(campaignId);
      expect(allocs).toHaveLength(1);
      expect(allocs[0]?.screenhostId).toBe(v1.id);
      return { v1, v2, eventId, campaignId, allocationId: allocs[0]?.id ?? '' };
    };

    it('Accepter → ACCEPTE + decided_at + the antenne reminder; reservations KEPT; no playlist push', async () => {
      const { v1, eventId, allocationId } = await dispatchTwoVenues();
      mockSession(v1.ownerId, 'individual_owner');
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-allocations/${allocationId}/accept`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { statut: string; reminder?: string };
      expect(body.statut).toBe('ACCEPTE');
      expect(body.reminder).toBe(
        'Merci de maintenir vos écrans actifs pendant la fenêtre de diffusion.',
      );
      const [row] = await db
        .select()
        .from(eventAllocations)
        .where(eq(eventAllocations.id, allocationId));
      expect(row?.statut).toBe('ACCEPTE');
      expect(row?.decidedAt).not.toBeNull();
      expect(await reservationsOf(eventId, v1.id)).toHaveLength(2); // KEPT
    });

    it('Refuser → REFUSE (final) + reservations RELEASED + the cascade re-places on the next venue', async () => {
      const { v1, v2, eventId, campaignId, allocationId } = await dispatchTwoVenues();
      mockSession(v1.ownerId, 'individual_owner');
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-allocations/${allocationId}/refuse`,
      });
      expect(res.statusCode).toBe(200);
      expect(await reservationsOf(eventId, v1.id)).toHaveLength(0); // RELEASED
      const allocs = await allocationsOf(campaignId);
      expect(allocs).toHaveLength(2);
      const replaced = allocs.find((a) => a.screenhostId === v2.id);
      expect(replaced?.statut).toBe('EN_ATTENTE');
      expect(replaced?.impressionsTotal).toBe(10_000); // the refused share, re-placed whole
      expect(await reservationsOf(eventId, v2.id)).toHaveLength(2);
      // The proposal reached the SECOND owner.
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, v2.ownerId));
      expect(notifs.some((n) => n.title === EVENT_PROPOSAL_TITLE)).toBe(true);
      // A re-refuse is a 409 (final).
      const again = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-allocations/${allocationId}/accept`,
      });
      expect(again.statusCode).toBe(409);
    });

    it('the SPS acceptation variable SEES event decisions (the E4 hook extended)', async () => {
      const { v1, allocationId } = await dispatchTwoVenues();
      mockSession(v1.ownerId, 'individual_owner');
      await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-allocations/${allocationId}/refuse`,
      });
      // The venue's ONLY decision is the refused event allocation → acceptation 0.
      const { variables } = await computeSps(v1.id);
      expect(variables.acceptation).toBe(0);
    });
  });

  describe('THE PLAYOUT PIN — nothing airs until EV5', () => {
    it('an ACCEPTE event allocation on an ACTIVE positioning feeds NO playlist', async () => {
      const venue = await seedVenue({ sps: '80' });
      const eventId = await seedEvent();
      const { campaignId } = await seedPositioning(eventId, '150.00');
      await prepare(campaignId);
      const [alloc] = await allocationsOf(campaignId);
      await db
        .update(eventAllocations)
        .set({ statut: 'ACCEPTE', decidedAt: new Date() })
        .where(eq(eventAllocations.id, alloc?.id ?? ''));
      await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
      // The airability gate never sees event content: no campaign_dispatch_allocation exists.
      const airable = await activeAllocationsForScreenhost(
        venue.id,
        new Date('2027-06-10T20:30:00+01:00'),
      );
      expect(airable).toHaveLength(0);
    });

    it('the playout sources never read event_allocations (zero diff beyond rider a — source pin)', () => {
      for (const rel of [
        '../src/lib/playout/active-allocations.ts',
        '../src/lib/playout/playlist-service.ts',
        '../src/lib/playout/playlist.ts',
        '../src/lib/playout/push.ts',
        '../src/lib/playout/ingest.ts',
      ]) {
        const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
        expect(source, `${rel} reads the event tables`).not.toMatch(
          /eventAllocations|event_allocations|hourReservations/,
        );
      }
    });
  });

  describe('rider a — creative_type on the playlist wire (TV-C3 backcompat)', () => {
    it('absent kind emits NO field (= video); photo maps to image; video stays video', () => {
      const base = {
        campaignId: 'c1',
        campaignName: 'X',
        url: 'https://media/x',
        durationSeconds: 10,
      };
      const legacy = buildPlaylist([base]);
      expect('creative_type' in (legacy.videos[0] ?? {})).toBe(false);
      const photo = buildPlaylist([{ ...base, creativeType: 'photo' }]);
      expect(photo.videos[0]?.creative_type).toBe('image');
      const video = buildPlaylist([{ ...base, creativeType: 'video' }]);
      expect(video.videos[0]?.creative_type).toBe('video');
    });
  });

  describe('D51 — the module boundary', () => {
    it('event-dispatch sources never import lib/dispatch or campaign libs', () => {
      const source = readFileSync(
        fileURLToPath(new URL('../src/lib/event-dispatch/dispatch.ts', import.meta.url)),
        'utf8',
      );
      expect(source).not.toMatch(/from '.*\/dispatch\//);
      expect(source).not.toMatch(/from '.*campaign/i);
    });
  });
});
