import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  eventAllocations,
  screenhostAffluence,
  screenhostAmax,
  screenhosts,
} from '../src/db/schema.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { campaignTTiers } from '../src/lib/dispatch/config.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import type { EngineTrace } from '../src/lib/engine-journal/trace.js';
import {
  assembleEventPool,
  runEventDispatch,
  runEventRefusalCascade,
} from '../src/lib/event-dispatch/dispatch.js';
import { isEventSwitchOn } from '../src/lib/event-pricing/event-switch.js';
import { computeEventCmax, eventEligibleVenues } from '../src/lib/event-pricing/pricing.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import {
  MONDAY,
  WEDNESDAY,
  eventRef,
  eventSector,
  seedCampaign,
  seedPositioning,
  seedVenue,
} from './helpers/installed-screen-matrix.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// CAP-EVT1 (operator ruling 2026-09-22) — « Capacité de diffusion » (screenhosts.broadcast_capacity)
// is the venue's EVENT-ONLY eligibility switch. Its value is unused; set (not NULL) is what counts.
//
//   • STANDARD campaigns never read it: the coverage map, the dispatch pool (and through it C_max,
//     dispatch, the refusal cascade, redispatch and the booster) and « Hosts éligibles » keep a
//     venue whose capacity is NULL — every other rule stays, MAP-TV1's installed screen included.
//   • EVENTS require it: the event pool (eventEligibleVenues — the ceiling C_max_evt, event
//     dispatch, the event refusal cascade, the event booster) drops a venue whose capacity is
//     NULL, « Hosts éligibles » names it 'event_capacity_missing', and the event page's map (the
//     coverage endpoint on a positioning draft) is EXACTLY that pool.
//
// Every venue of the pair passes every OTHER gate (tests/helpers/installed-screen-matrix.ts:
// active, approved owner, 8–23, located, 100/h every day) and has an installed screen; the two
// differ ONLY by their capacity. Dates are FIXED and named: the standard window is Monday
// 2024-01-01 → Wednesday 2024-01-03, the match Thursday 2027-06-10 20:00–22:00 Tunis (blocs
// 19:00–20:00 and 22:00–23:00).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const collectingTrace = (): { trace: EngineTrace; reasons: Map<string, string> } => {
  const reasons = new Map<string, string>();
  return {
    reasons,
    trace: {
      enabled: true,
      event(type, payload = {}, screenhostId = null) {
        const reason = payload['reason'];
        if (type === 'venue_excluded' && screenhostId && typeof reason === 'string') {
          reasons.set(screenhostId, reason);
        }
      },
      finish: async () => undefined,
    },
  };
};

/** Two installed venues that differ only by their capacity: `on` = 4, `off` = NULL. */
const seedSwitchPair = async (): Promise<{ on: string; off: string; both: string[] }> => {
  const sector = await eventSector();
  const on = await seedVenue('Capacité 4', sector);
  await seedInstalledScreen(on);
  const off = await seedVenue('Capacité vide', sector);
  await seedInstalledScreen(off);
  await db.update(screenhosts).set({ broadcastCapacity: null }).where(eq(screenhosts.id, off));
  return { on, off, both: [on, off].sort() };
};

const EVENT_CPM = 15;

/** A venue shaped for the event-page map: every field a case can vary, installed by default. */
const seedMapVenue = async (
  name: string,
  opts: {
    capacity?: number | null;
    hours?: [number, number];
    affluence?: boolean;
    located?: boolean;
    cls?: 'populaire' | 'moyen' | 'premium';
    installed?: boolean;
    ownerStatus?: 'approved' | 'pending';
  } = {},
): Promise<string> => {
  const [opening, closing] = opts.hours ?? [8, 23];
  const located = opts.located ?? true;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name,
      ownerId: await seedApprovedOwner({ status: opts.ownerStatus ?? 'approved' }),
      businessSectorId: await eventSector(),
      class: opts.cls ?? 'premium',
      openingHour: opening,
      closingHour: closing,
      broadcastCapacity: opts.capacity === undefined ? 1 : opts.capacity,
      latitude: located ? '36.80000000' : null,
      longitude: located ? '10.18000000' : null,
      sps: '70',
    })
    .returning({ id: screenhosts.id });
  const id = sh?.id ?? '';
  if (opts.affluence ?? true) {
    const rows = [];
    for (const dow of [1, 2, 3, 4, 5, 6, 7])
      for (let h = 8; h < 23; h += 1)
        rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
    await db.insert(screenhostAffluence).values(bothHalves(rows));
  }
  if (opts.installed ?? true) await seedInstalledScreen(id);
  return id;
};

interface CoverageBody {
  screenhosts: { id: string }[];
  covered_count: number;
  without_coordinates: number;
}

const window = (id: string) => ({ id, startDate: MONDAY, endDate: WEDNESDAY });
const inputs = { s: 10, t: 1, fMaxSeconds: 300 };
const buildApp = () => Fastify({ logger: false });

describe('CAP-EVT1 — the capacity is the event switch (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  describe('a STANDARD campaign never reads the capacity', () => {
    it('assemblePool keeps the venue whose capacity is NULL and journals nothing for it', async () => {
      const v = await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const { trace, reasons } = collectingTrace();
      const { pool, candidateCount } = await assemblePool(db, window(campaign.id), inputs, {
        trace,
      });

      expect(pool.map((p) => p.id).sort()).toEqual(v.both);
      expect(candidateCount).toBe(2);
      expect(reasons.has(v.off)).toBe(false);
      // Same venue, same audience: the capacity changes nothing in what it is worth.
      const byId = new Map(pool.map((p) => [p.id, p.residualCapacity]));
      expect(byId.get(v.off)).toBe(byId.get(v.on));
    });

    it('C_max prices both venues', async () => {
      await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const cmax = await computeCampaignCmax(campaign, 10);
      expect(cmax.eligibleCount).toBe(2);
      expect(cmax.targetedCount).toBe(2);
    });

    it('dispatch places on the venue whose capacity is NULL when it needs both', async () => {
      const v = await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));
      const cmax = await computeCampaignCmax(campaign, 10);

      // 80 % of both venues' capacity: one venue cannot carry it.
      const result = await runDispatch(campaign, {
        iCible: Math.floor(cmax.iMaxFacturable * 0.8),
        cpm: cmax.cpmTnd,
        s: 10,
        tiers: campaignTTiers(campaign),
      });
      expect(result.status).toBe('OK');
      const placed = await db
        .select({ screenhostId: campaignDispatchAllocation.screenhostId })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId),
        )
        .where(eq(campaignDispatchPlan.campaignId, campaign.id));
      expect([...new Set(placed.map((p) => p.screenhostId))].sort()).toEqual(v.both);
    });

    it('« Hosts éligibles » (standard) lists both, with no capacity reason', async () => {
      const v = await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const result = await campaignEligibleHosts(campaign.id);
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.kind).toBe('standard');
      expect(result.report.eligible.map((e) => e.id).sort()).toEqual(v.both);
      expect(result.report.excluded).toEqual([]);
    });

    describe('GET /api/campaigns/:id/coverage (standard draft)', () => {
      let app: ReturnType<typeof buildApp>;
      beforeEach(async () => {
        app = buildApp();
        await app.register(campaignTargetingRoutes);
        await app.ready();
      });
      afterEach(async () => {
        await app.close();
      });

      it('plots and counts both venues', async () => {
        const v = await seedSwitchPair();
        const advertiser = await seedApprovedOwner({ role: 'advertiser' });
        const campaign = await seedCampaign(advertiser);

        mockSession(advertiser, 'advertiser');
        const res = await app.inject({
          method: 'GET',
          url: `/api/campaigns/${campaign.id}/coverage`,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{
          screenhosts: { id: string }[];
          covered_count: number;
          without_coordinates: number;
        }>();
        expect(body.screenhosts.map((s) => s.id).sort()).toEqual(v.both);
        expect(body.covered_count).toBe(2);
        expect(body.without_coordinates).toBe(0);
      });
    });
  });

  describe('an EVENT requires the capacity', () => {
    it('the JS twin: set (any value) = on, NULL = off', () => {
      expect(isEventSwitchOn(1)).toBe(true);
      expect(isEventSwitchOn(4)).toBe(true);
      expect(isEventSwitchOn(null)).toBe(false);
    });

    it('the event pool, C_max_evt and the bloc pool drop the venue whose capacity is NULL', async () => {
      const v = await seedSwitchPair();
      const ref = await eventRef();

      expect((await eventEligibleVenues(ref)).map((x) => x.id)).toEqual([v.on]);
      const cmax = await computeEventCmax(ref, EVENT_CPM);
      expect(cmax.venues.map((x) => x.screenhostId)).toEqual([v.on]);
      // one venue × six blocs × 100 pers/h × 20 = 12 000 impressions → ⌊15 × 12 000 ÷ 1000⌋
      expect(cmax.iMax).toBe(12_000);
      expect(cmax.cMaxEvtTnd).toBe(180);
      expect((await assembleEventPool(ref)).map((x) => x.screenhostId)).toEqual([v.on]);
    });

    it('setting a capacity (1) turns the switch on: the venue joins the event pool', async () => {
      const v = await seedSwitchPair();
      const ref = await eventRef();
      await db.update(screenhosts).set({ broadcastCapacity: 1 }).where(eq(screenhosts.id, v.off));

      expect((await eventEligibleVenues(ref)).map((x) => x.id).sort()).toEqual(v.both);
      expect((await computeEventCmax(ref, EVENT_CPM)).eligibleCount).toBe(2);
      expect((await assembleEventPool(ref)).map((x) => x.screenhostId).sort()).toEqual(v.both);
    });

    it('event dispatch and the event refusal cascade never open the venue whose capacity is NULL', async () => {
      const v = await seedSwitchPair();
      const advertiserId = await seedApprovedOwner({ role: 'advertiser' });
      const { positioningId, event } = await seedPositioning(advertiserId);

      // The switched-on venue is worth 6 blocs × 100 × 20 at CPM 15 = 180 TND: 400 TND needs a
      // second venue, and the event pool has none → a PARTIAL fill over the one venue.
      const dispatched = await runEventDispatch(
        { id: positioningId, name: 'CAP-EVT1', advertiserId, requestedBudget: 400 },
        event,
        EVENT_CPM,
      );
      expect(dispatched).toMatchObject({ status: 'OK', partial: true });
      const placed = await db
        .select()
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, positioningId));
      expect(placed.map((p) => p.screenhostId)).toEqual([v.on]);

      const [refused] = placed;
      if (!refused) throw new Error('event dispatch placed nothing');
      await db
        .update(eventAllocations)
        .set({ statut: 'REFUSE' })
        .where(eq(eventAllocations.id, refused.id));
      const cascade = await runEventRefusalCascade(
        db,
        { id: positioningId, name: 'CAP-EVT1' },
        event,
        { screenhostId: refused.screenhostId, impressionsTotal: refused.impressionsTotal },
        EVENT_CPM,
      );
      expect(cascade).toEqual({ status: 'NO_POOL', allocationIds: [] });
    });

    it('« Hosts éligibles » (event) names it event_capacity_missing, after the sector verdict', async () => {
      const v = await seedSwitchPair();
      const { positioningId } = await seedPositioning(
        await seedApprovedOwner({ role: 'advertiser' }),
      );

      const result = await campaignEligibleHosts(positioningId);
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.kind).toBe('event');
      expect(result.report.eligible.map((e) => e.id)).toEqual([v.on]);
      const reasonOf = new Map(result.report.excluded.map((e) => [e.id, e.reason]));
      expect(reasonOf.get(v.off)).toBe('event_capacity_missing');

      // No installed screen still comes first (MAP-TV1's order is untouched).
      const noTv = await seedMapVenue('Sans écran ni capacité', {
        capacity: null,
        installed: false,
      });
      const again = await campaignEligibleHosts(positioningId);
      if (again.status !== 'OK') throw new Error('eligible hosts failed');
      const reasonsAgain = new Map(again.report.excluded.map((e) => [e.id, e.reason]));
      expect(reasonsAgain.get(noTv)).toBe('no_installed_screen');
    });

    describe('GET /api/campaigns/:id/coverage (event positioning draft) = the event pool', () => {
      let app: ReturnType<typeof buildApp>;
      beforeEach(async () => {
        app = buildApp();
        await app.register(campaignTargetingRoutes);
        await app.ready();
      });
      afterEach(async () => {
        await app.close();
      });

      it('plots exactly the event pool — the event rules, none of the standard ones', async () => {
        const advertiser = await seedApprovedOwner({ role: 'advertiser' });
        const { positioningId, event } = await seedPositioning(advertiser);
        // A class line the standard map would honour; the event map must not.
        await db
          .insert(campaignTargeting)
          .values({ campaignId: positioningId, categoryId: null, class: 'premium' });

        const open = await seedMapVenue('Ouvert 8–23');
        const lateOnly = await seedMapVenue('Ouvert 22–23 (blocs d’après-match)', {
          hours: [22, 23],
        });
        const noAudience = await seedMapVenue('Sans affluence', { affluence: false });
        const otherClass = await seedMapVenue('Populaire', { cls: 'populaire' });
        const unlocated = await seedMapVenue('Sans coordonnées', { located: false });
        const noCapacity = await seedMapVenue('Capacité vide', { capacity: null });
        const closesEarly = await seedMapVenue('Fermé avant 19 h', { hours: [8, 19] });
        const noTv = await seedMapVenue('Sans écran', { installed: false });
        const pendingOwner = await seedMapVenue('Propriétaire en attente', {
          ownerStatus: 'pending',
        });

        mockSession(advertiser, 'advertiser');
        const res = await app.inject({
          method: 'GET',
          url: `/api/campaigns/${positioningId}/coverage`,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<CoverageBody>();

        // Opening the map writes nothing: no A_max was ratcheted.
        expect(await db.select().from(screenhostAmax)).toEqual([]);

        const expectedPool = [open, lateOnly, noAudience, otherClass, unlocated].sort();
        expect(body.covered_count).toBe(expectedPool.length);
        expect(body.without_coordinates).toBe(1);
        expect(body.screenhosts.map((s) => s.id).sort()).toEqual(
          expectedPool.filter((id) => id !== unlocated),
        );
        for (const out of [noCapacity, closesEarly, noTv, pendingOwner]) {
          expect(body.screenhosts.map((s) => s.id)).not.toContain(out);
        }

        // ONE home: the map's set IS the set event pricing and event dispatch read.
        const ref = { id: event.id, kickoffAt: event.kickoffAt, endsAt: event.endsAt };
        expect((await eventEligibleVenues(ref)).map((x) => x.id).sort()).toEqual(expectedPool);
        expect(
          (await computeEventCmax(ref, EVENT_CPM)).venues.map((x) => x.screenhostId).sort(),
        ).toEqual(expectedPool);
        expect((await assembleEventPool(ref)).map((x) => x.screenhostId).sort()).toEqual(
          expectedPool,
        );
      });

      it('a STANDARD draft over the same venues keeps the standard rules', async () => {
        const advertiser = await seedApprovedOwner({ role: 'advertiser' });
        const campaign = await seedCampaign(advertiser);
        const noCapacity = await seedMapVenue('Capacité vide', { capacity: null });
        const noAudience = await seedMapVenue('Sans affluence', { affluence: false });
        const closesEarly = await seedMapVenue('Fermé avant 19 h', { hours: [8, 19] });

        mockSession(advertiser, 'advertiser');
        const res = await app.inject({
          method: 'GET',
          url: `/api/campaigns/${campaign.id}/coverage`,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<CoverageBody>();
        // capacity ignored, audience required (MAP-4), any opening hours will do
        expect(body.screenhosts.map((s) => s.id).sort()).toEqual([noCapacity, closesEarly].sort());
        expect(body.screenhosts.map((s) => s.id)).not.toContain(noAudience);
      });
    });
  });
});
