import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaigns,
  events,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostUnavailability,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import type { EngineTrace } from '../src/lib/engine-journal/trace.js';
import { assembleEventPool } from '../src/lib/event-dispatch/dispatch.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// ELIG-2 (operator ruling 2026-09-16) — ONLY APPROVED OWNERS COUNT, everywhere a venue is put to
// work: the standard pool (journaled 'owner_not_approved' before any other reason), the event
// ceiling and the event pool, the advertiser coverage map and the admin « Hosts éligibles » view.
// MAP-4 (same day) — the coverage map also needs ONE available day in the campaign window and ONE
// affluence value (manual in effect, or live).
//
// Every date is FIXED and named: the standard window is Monday 2024-01-01 → Wednesday 2024-01-03,
// the match is Thursday 2027-06-10 at 20:00 Tunis. Nothing depends on the day the suite runs.

const MONDAY = '2024-01-01';
const TUESDAY = '2024-01-02';
const WEDNESDAY = '2024-01-03';
const MATCH_KICKOFF = new Date('2027-06-10T20:00:00+01:00'); // Thursday, Tunis
const MATCH_ENDS = new Date('2027-06-10T22:00:00+01:00');

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
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
      email: `elig2-${seq}@example.com`,
      contactName: `ELIG2 ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

/** An owner-audience sector that is event-eligible (the seeded owner sectors are). */
const eventSector = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(and(eq(businessSectors.audience, 'owner'), eq(businessSectors.eventEligible, true)))
    .limit(1);
  if (!s) throw new Error('no event-eligible owner sector seeded');
  return s.id;
};

type Affluence = 'grid' | 'none';

/** A venue that passes every OTHER gate: active, 8–23, capacity, located, 100 pers/h all week. */
const seedVenue = async (opts: {
  name: string;
  ownerId: string | null;
  sectorId: string;
  affluence?: Affluence;
  hours?: [number, number] | null;
  active?: boolean;
}): Promise<string> => {
  const hours = opts.hours === undefined ? ([8, 23] as [number, number]) : opts.hours;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: opts.name,
      ownerId: opts.ownerId,
      businessSectorId: opts.sectorId,
      class: 'premium',
      openingHour: hours ? hours[0] : null,
      closingHour: hours ? hours[1] : null,
      broadcastCapacity: 4,
      isActive: opts.active ?? true,
      latitude: '36.80000000',
      longitude: '10.18000000',
      sps: '70',
    })
    .returning();
  const id = sh?.id ?? '';
  if ((opts.affluence ?? 'grid') === 'grid') {
    const rows = [];
    for (const dow of [1, 2, 3, 4, 5, 6, 7])
      for (let h = 8; h < 23; h += 1)
        rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
    await db.insert(screenhostAffluence).values(bothHalves(rows));
  }
  await seedInstalledScreen(id);
  return id;
};

const seedCampaign = async (
  advertiserId: string,
  window: { start: string | null; end: string | null } = { start: MONDAY, end: WEDNESDAY },
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'ELIG-2',
      campaignType: 'standard',
      status: 'draft',
      startDate: window.start,
      endDate: window.end,
    })
    .returning();
  return c?.id ?? '';
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

/** The four owner shapes that must NOT count, plus the one that does. */
const seedOwnerMatrix = async (sectorId: string) => {
  const approved = await seedVenue({
    name: 'A — propriétaire validé',
    ownerId: await seedApprovedOwner(),
    sectorId,
  });
  const pending = await seedVenue({
    name: 'B — propriétaire en attente',
    ownerId: await seedApprovedOwner({ status: 'pending' }),
    sectorId,
  });
  const rejected = await seedVenue({
    name: 'C — propriétaire refusé',
    ownerId: await seedApprovedOwner({ status: 'rejected' }),
    sectorId,
  });
  const banned = await seedVenue({
    name: 'D — propriétaire banni',
    ownerId: await seedApprovedOwner({ role: 'fleet_owner', status: 'banned' }),
    sectorId,
  });
  const ownerless = await seedVenue({ name: 'E — sans propriétaire', ownerId: null, sectorId });
  return { approved, pending, rejected, banned, ownerless };
};

const buildApp = () => Fastify({ logger: false });

describe('ELIG-2 — only approved owners count (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  describe('assemblePool — the standard engine (dispatch, C_max, cascade, redispatch, booster)', () => {
    it('keeps the approved owner’s venue and journals every other one as owner_not_approved', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const campaignId = await seedCampaign(advertiser);
      const v = await seedOwnerMatrix(sector);

      const { trace, reasons } = collectingTrace();
      const { pool, candidateCount } = await assemblePool(
        db,
        { id: campaignId, startDate: MONDAY, endDate: WEDNESDAY },
        { s: 10, t: 1, fMaxSeconds: 300 },
        { trace },
      );

      expect(pool.map((p) => p.id)).toEqual([v.approved]);
      expect(candidateCount).toBe(1);
      for (const out of [v.pending, v.rejected, v.banned, v.ownerless]) {
        expect(reasons.get(out)).toBe('owner_not_approved');
      }
      expect(reasons.has(v.approved)).toBe(false);
    });

    it('owner_not_approved is evaluated BEFORE the other reasons (and before « inactif »)', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const campaignId = await seedCampaign(advertiser);
      const pending = await seedApprovedOwner({ status: 'pending' });
      const noHours = await seedVenue({
        name: 'Sans horaires, en attente',
        ownerId: pending,
        sectorId: sector,
        hours: null,
      });
      const inactive = await seedVenue({
        name: 'Inactif, en attente',
        ownerId: pending,
        sectorId: sector,
        active: false,
      });
      const approvedInactive = await seedVenue({
        name: 'Inactif, validé',
        ownerId: await seedApprovedOwner(),
        sectorId: sector,
        active: false,
      });

      const { trace, reasons } = collectingTrace();
      await assemblePool(
        db,
        { id: campaignId, startDate: MONDAY, endDate: WEDNESDAY },
        { s: 10, t: 1, fMaxSeconds: 300 },
        { trace, excludeScreenhostIds: [noHours] },
      );
      expect(reasons.get(noHours)).toBe('owner_not_approved');
      expect(reasons.get(inactive)).toBe('owner_not_approved');
      expect(reasons.get(approvedInactive)).toBe('inactive');
    });

    it('a pending owner approved later is back in the pool (the rule reads the live status)', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const campaignId = await seedCampaign(advertiser);
      const owner = await seedApprovedOwner({ status: 'pending' });
      const venue = await seedVenue({ name: 'Bientôt validé', ownerId: owner, sectorId: sector });
      const window = { id: campaignId, startDate: MONDAY, endDate: WEDNESDAY };
      const inputs = { s: 10, t: 1, fMaxSeconds: 300 };

      expect((await assemblePool(db, window, inputs)).pool).toHaveLength(0);
      await db.update(users).set({ status: 'approved' }).where(eq(users.id, owner));
      expect((await assemblePool(db, window, inputs)).pool.map((p) => p.id)).toEqual([venue]);
    });
  });

  describe('the event engine — C_max_evt and the bloc pool', () => {
    it('computeEventCmax prices ONLY the approved owner’s venue', async () => {
      const sector = await eventSector();
      const v = await seedOwnerMatrix(sector);
      const [event] = await db
        .insert(events)
        .values({
          name: 'ELIG-2 Match',
          type: 'sport',
          source: 'official',
          kickoffAt: MATCH_KICKOFF,
          endsAt: MATCH_ENDS,
        })
        .returning();
      const ref = { id: event?.id ?? '', kickoffAt: MATCH_KICKOFF, endsAt: MATCH_ENDS };

      const cmax = await computeEventCmax(ref, 15);
      expect(cmax.venues.map((x) => x.screenhostId)).toEqual([v.approved]);
      expect(cmax.eligibleCount).toBe(1);
      // one venue, six blocs × 100 pers/h × 20 = 12 000 impressions → ⌊15 × 12 000 ÷ 1000⌋
      expect(cmax.iMax).toBe(12_000);
      expect(cmax.cMaxEvtTnd).toBe(180);

      const pool = await assembleEventPool(ref);
      expect(pool.map((x) => x.screenhostId)).toEqual([v.approved]);
    });
  });

  describe('« Hosts éligibles » — both branches name the reason', () => {
    it('standard: every non-approved venue is excluded as owner_not_approved', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const campaignId = await seedCampaign(advertiser);
      const v = await seedOwnerMatrix(sector);

      const result = await campaignEligibleHosts(campaignId);
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.eligible.map((e) => e.id)).toEqual([v.approved]);
      const reasonOf = new Map(result.report.excluded.map((e) => [e.id, e.reason]));
      for (const out of [v.pending, v.rejected, v.banned, v.ownerless]) {
        expect(reasonOf.get(out)).toBe('owner_not_approved');
      }
    });

    it('event: every non-approved venue is excluded as owner_not_approved', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const v = await seedOwnerMatrix(sector);
      const [event] = await db
        .insert(events)
        .values({
          name: 'ELIG-2 Positionnement',
          type: 'sport',
          source: 'official',
          kickoffAt: MATCH_KICKOFF,
          endsAt: MATCH_ENDS,
        })
        .returning();
      const [positioning] = await db
        .insert(campaigns)
        .values({
          advertiserId: advertiser,
          name: 'Positionnement ELIG-2',
          campaignType: 'event',
          status: 'draft',
          startDate: '2027-06-10',
          endDate: '2027-06-10',
          eventId: event?.id ?? null,
        })
        .returning();

      const result = await campaignEligibleHosts(positioning?.id ?? '');
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.kind).toBe('event');
      expect(result.report.eligible.map((e) => e.id)).toEqual([v.approved]);
      const reasonOf = new Map(result.report.excluded.map((e) => [e.id, e.reason]));
      for (const out of [v.pending, v.rejected, v.banned, v.ownerless]) {
        expect(reasonOf.get(out)).toBe('owner_not_approved');
      }
    });
  });

  describe('GET /api/campaigns/:id/coverage — MAP-4', () => {
    let app: ReturnType<typeof buildApp>;
    beforeEach(async () => {
      app = buildApp();
      await app.register(campaignTargetingRoutes);
      await app.ready();
    });
    afterEach(async () => {
      await app.close();
    });

    interface Coverage {
      screenhosts: { id: string }[];
      covered_count: number;
      without_coordinates: number;
    }
    const coverage = async (advertiser: string, campaignId: string): Promise<Coverage> => {
      mockSession(advertiser, 'advertiser');
      const res = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${campaignId}/coverage`,
      });
      expect(res.statusCode).toBe(200);
      return res.json<Coverage>();
    };
    const idsOf = (c: Coverage): string[] => c.screenhosts.map((s) => s.id).sort();

    it('shows only the approved owner’s venue (and counts only it)', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const campaignId = await seedCampaign(advertiser);
      const v = await seedOwnerMatrix(sector);

      const body = await coverage(advertiser, campaignId);
      expect(idsOf(body)).toEqual([v.approved]);
      expect(body.covered_count).toBe(1);
      expect(body.without_coordinates).toBe(0);
    });

    it('hides a venue unavailable on EVERY window day; one free day is enough to show it', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const campaignId = await seedCampaign(advertiser); // Monday → Wednesday
      const owner = await seedApprovedOwner();
      const allBlocked = await seedVenue({
        name: 'Fermé 3 jours',
        ownerId: owner,
        sectorId: sector,
      });
      const oneFree = await seedVenue({ name: 'Libre mercredi', ownerId: owner, sectorId: sector });
      await db.insert(screenhostUnavailability).values([
        { screenhostId: allBlocked, day: MONDAY },
        { screenhostId: allBlocked, day: TUESDAY },
        { screenhostId: allBlocked, day: WEDNESDAY },
        { screenhostId: oneFree, day: MONDAY },
        { screenhostId: oneFree, day: TUESDAY },
        // a declaration OUTSIDE the window changes nothing
        { screenhostId: oneFree, day: '2024-01-04' }, // Thursday
      ]);

      const body = await coverage(advertiser, campaignId);
      expect(idsOf(body)).toEqual([oneFree]);
      expect(body.covered_count).toBe(1);
    });

    it('a draft without dates is NOT filtered by availability (no window to test yet)', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      const undated = await seedCampaign(advertiser, { start: null, end: null });
      const halfDated = await seedCampaign(advertiser, { start: MONDAY, end: null });
      const venue = await seedVenue({
        name: 'Déclaré indisponible',
        ownerId: await seedApprovedOwner(),
        sectorId: sector,
      });
      await db.insert(screenhostUnavailability).values([
        { screenhostId: venue, day: MONDAY },
        { screenhostId: venue, day: TUESDAY },
        { screenhostId: venue, day: WEDNESDAY },
      ]);

      expect(idsOf(await coverage(advertiser, undated))).toEqual([venue]);
      expect(idsOf(await coverage(advertiser, halfDated))).toEqual([venue]);
    });

    it('hides a venue with no affluence: none, all zero, or only a suspended cell', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      // CAP-F1 — WITH a window the map is « Hosts éligibles » (the pool prices capacity, and a venue
      // with no typical-week audience inside the window has none). This pins the STATIC affluence
      // gate, which is what a draft WITHOUT dates shows — so the draft has no window.
      const campaignId = await seedCampaign(advertiser, { start: null, end: null });
      const owner = await seedApprovedOwner();

      const none = await seedVenue({
        name: 'Aucune affluence',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      const allZero = await seedVenue({
        name: 'Affluence nulle',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      await db.insert(screenhostAffluence).values(
        bothHalves([
          { screenhostId: allZero, dayOfWeek: 1, hour: 10, estimatedImpressions: 0 },
          { screenhostId: allZero, dayOfWeek: 2, hour: 11, estimatedImpressions: 0 },
        ]),
      );
      await db.insert(screenhostAffluenceHourly).values([
        { screenhostId: allZero, date: MONDAY, hour: 10, slot: 20, value: 0 },
        { screenhostId: allZero, date: MONDAY, hour: 10, slot: 21, value: null },
      ]);
      const suspendedOnly = await seedVenue({
        name: 'Cellule suspendue',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      await db.insert(screenhostAffluence).values(
        bothHalves({
          screenhostId: suspendedOnly,
          dayOfWeek: 1,
          hour: 10,
          estimatedImpressions: 80,
          inEffect: false,
        }),
      );

      // Controls in the SAME request: a venue with the full grid and a venue with only one live
      // value. Both must show, so the probe is proven to look at EACH venue's own rows (a
      // subquery that lost its venue correlation would show or hide all five together).
      const withGrid = await seedVenue({
        name: 'Grille complète',
        ownerId: owner,
        sectorId: sector,
      });
      const liveOnly = await seedVenue({
        name: 'Mesure seule',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      await db.insert(screenhostAffluenceHourly).values({
        screenhostId: liveOnly,
        date: TUESDAY,
        hour: 15,
        slot: 30,
        value: 5,
      });

      const body = await coverage(advertiser, campaignId);
      expect(idsOf(body)).toEqual([withGrid, liveOnly].sort());
      for (const hidden of [none, allZero, suspendedOnly]) {
        expect(idsOf(body)).not.toContain(hidden);
      }
      expect(body.covered_count).toBe(2);
    });

    it('shows a venue with a SINGLE manual value, or a SINGLE live value', async () => {
      const sector = await eventSector();
      const advertiser = await seedUser({ role: 'advertiser' });
      // CAP-F1 — WITH a window the map is « Hosts éligibles » (the pool prices capacity, and a venue
      // with no typical-week audience inside the window has none). This pins the STATIC affluence
      // gate, which is what a draft WITHOUT dates shows — so the draft has no window.
      const campaignId = await seedCampaign(advertiser, { start: null, end: null });
      const owner = await seedApprovedOwner();

      const oneManual = await seedVenue({
        name: 'Une valeur manuelle',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      // one half-hour cell, flag unknown (NULL) = in effect
      await db.insert(screenhostAffluence).values({
        screenhostId: oneManual,
        dayOfWeek: 6, // Saturday — outside the Monday→Wednesday window: presence is enough
        hour: 12,
        slot: 24,
        estimatedImpressions: 7,
      });
      const oneRestored = await seedVenue({
        name: 'Cellule rétablie',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      await db.insert(screenhostAffluence).values({
        screenhostId: oneRestored,
        dayOfWeek: 1,
        hour: 9,
        slot: 18,
        estimatedImpressions: 3,
        inEffect: true,
      });
      const oneLive = await seedVenue({
        name: 'Une valeur mesurée',
        ownerId: owner,
        sectorId: sector,
        affluence: 'none',
      });
      await db.insert(screenhostAffluenceHourly).values({
        screenhostId: oneLive,
        date: '2023-12-29', // a Friday before the window: any live value counts
        hour: 18,
        slot: 37,
        value: 12,
      });

      const body = await coverage(advertiser, campaignId);
      expect(idsOf(body)).toEqual([oneManual, oneRestored, oneLive].sort());
      expect(body.covered_count).toBe(3);
    });
  });
});
