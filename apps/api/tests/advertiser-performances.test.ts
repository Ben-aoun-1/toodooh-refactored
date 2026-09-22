import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  eventAllocations,
  events,
  notifications,
  proofOfPlay,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
  zones,
} from '../src/db/schema.js';
import { CAMPAIGN_REPORT_READY_TYPE } from '../src/lib/campaign-report-notification.js';
import { settleEventPositioning } from '../src/lib/event-playout/settlement.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { sectorDisplayName } from '../src/lib/report/sector-display-name.js';
import { advertiserPerformancesRoutes } from '../src/routes/advertiser-performances.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { resetZonesToSeed } from './helpers/zones.js';

// SC-P — « Mes performances » (Screencaster), real Postgres. The data contract under test:
// clôture = campaign_reconciliation.reconciled_at; impressions générées = delivered_imp (NET-IMP1
// settled form); hours = credited (venue, Tunis date, hour) slots (plan-intersected for classic
// campaigns); plays = VIDEO_ENDED count; venues = payouts with delivered_imp > 0; budget HT =
// spend + refund; TTC = the facture rate. Africa/Tunis = UTC+1: a proof received at 07:30Z sits in
// the hour-8 créneau. RG-PERF-01/31 pinned: scoping + the confidentiality sweep on the wire and
// inside the PDF.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};
const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `scp${seq}@example.com`,
      contactName: `SC-P User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

/** Two distinct OWNER sectors from the seeded catalogue (names vary by migration — read them). */
const ownerSectors = async (): Promise<{ id: string; name: string }[]> =>
  db
    .select({ id: businessSectors.id, name: businessSectors.name })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .orderBy(businessSectors.displayOrder, businessSectors.name)
    .limit(2);

const grandTunisId = async (): Promise<string> => {
  const [z] = await db.select({ id: zones.id }).from(zones).where(eq(zones.name, 'Grand Tunis'));
  return z?.id ?? '';
};

interface VenueOpts {
  sectorId?: string | null;
  venueClass?: 'populaire' | 'moyen' | 'premium' | null;
  ratios?: boolean;
  affluence?: { dayOfWeek: number; hour: number; level: number }[];
}

const seedVenue = async (opts: VenueOpts = {}): Promise<{ id: string; screenId: string }> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const sectorId =
    opts.sectorId === undefined ? ((await ownerSectors())[0]?.id ?? null) : opts.sectorId;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `SC-P Venue ${seq}`,
      ownerId,
      businessSectorId: sectorId,
      class: opts.venueClass === undefined ? 'moyen' : opts.venueClass,
      ...(opts.ratios
        ? {
            genderFemalePct: '60',
            genderMalePct: '40',
            age17To30Pct: '50',
            age31To45Pct: '30',
            age46PlusPct: '20',
          }
        : {}),
    })
    .returning();
  const id = sh?.id ?? '';
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: id, name: `SC-P Screen ${seq}` })
    .returning();
  for (const a of opts.affluence ?? []) {
    await db.insert(screenhostAffluence).values(
      bothHalves({
        screenhostId: id,
        dayOfWeek: a.dayOfWeek,
        hour: a.hour,
        estimatedImpressions: a.level,
      }),
    );
  }
  return { id, screenId: screen?.id ?? '' };
};

const seedCreative = async (advertiserId: string): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/scp/${seq}`,
      durationSeconds: 20,
      validationStatus: 'approved',
      fileHash: `scp-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  return c?.id ?? '';
};

const DEFAULT_CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
];

interface CampaignSeed {
  name?: string;
  status?: 'active' | 'completed';
  startDate?: string;
  endDate?: string;
  eventId?: string;
  creneaux?: DispatchCreneau[];
  /** Skip the plan/allocation (a positioning, or a never-dispatched row). */
  noPlan?: boolean;
}

const seedCampaign = async (
  advertiserId: string,
  venueIds: string[],
  opts: CampaignSeed = {},
): Promise<{ id: string; creativeId: string }> => {
  const creativeId = await seedCreative(advertiserId);
  seq += 1;
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: opts.name ?? `Campagne ${seq}`,
      campaignType: opts.eventId ? 'event' : 'standard',
      status: opts.status ?? 'completed',
      startDate: opts.startDate ?? '2024-01-01',
      endDate: opts.endDate ?? '2024-01-02',
      eventId: opts.eventId ?? null,
      creativeId,
    })
    .returning();
  const id = campaign?.id ?? '';
  if (!opts.noPlan && !opts.eventId) {
    const creneaux = opts.creneaux ?? DEFAULT_CRENEAUX;
    const iiPotentiel = creneaux.reduce((s, c) => s + c.impressions, 0);
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: id,
        iCible: iiPotentiel * venueIds.length,
        cpm: '10',
        sSpotSeconds: 20,
        tTierCoef: '1.0',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: iiPotentiel * venueIds.length,
        nMin: 1,
        nMax: 20,
        nRetenus: venueIds.length,
      })
      .returning();
    for (const venueId of venueIds) {
      await db.insert(campaignDispatchAllocation).values({
        planId: plan?.id ?? '',
        screenhostId: venueId,
        iiPotentiel,
        rI: 100,
        revenuPrevisionnel: String((iiPotentiel * 10) / 1000),
        creneaux,
      });
    }
  }
  return { id, creativeId };
};

/** Close a campaign by hand: the reconciliation row + one payout per venue. */
const closeCampaign = async (
  campaignId: string,
  opts: {
    reconciledAt: Date;
    spend?: number;
    refund?: number;
    payouts: { venueId: string; delivered: number; expected?: number }[];
  },
): Promise<void> => {
  const deliveredImp = opts.payouts.reduce((s, p) => s + p.delivered, 0);
  const expectedImp = opts.payouts.reduce((s, p) => s + (p.expected ?? p.delivered), 0);
  const [recon] = await db
    .insert(campaignReconciliation)
    .values({
      campaignId,
      expectedImp,
      deliveredImp,
      manquementImp: expectedImp - deliveredImp,
      pPerteTnd: '0',
      refundTnd: String(opts.refund ?? 0),
      spendTnd: String(opts.spend ?? 100),
      status: 'reussie',
      reconciledBy: null,
      reconciledAt: opts.reconciledAt,
    })
    .returning();
  if (opts.payouts.length > 0) {
    await db.insert(campaignScreenhostPayout).values(
      opts.payouts.map((p) => ({
        reconciliationId: recon?.id ?? '',
        campaignId,
        screenhostId: p.venueId,
        expectedImp: p.expected ?? p.delivered,
        deliveredImp: p.delivered,
        earningsTnd: '0',
      })),
    );
  }
};

const seedProof = async (
  campaignId: string,
  creativeId: string,
  venue: { id: string; screenId: string },
  receivedAt: Date,
): Promise<void> => {
  await db.insert(proofOfPlay).values({
    screenId: venue.screenId,
    screenhostId: venue.id,
    campaignId,
    creativeId,
    videoIdAsSent: campaignId,
    eventType: 'VIDEO_ENDED',
    receivedAt,
  });
};

// pdfkit (compress:false) writes text as hex TJ runs — decode them to assert the rendered text.
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    if (hex.length % 2 === 0) out += Buffer.from(hex, 'hex').toString('latin1');
  }
  return out;
};

const BASE = '/api/advertiser/performances';

describe('SC-P — advertiser « Mes performances » reads (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    // Proofs / payouts / reconciliations hang off campaigns (cascade from users); affluence and
    // screenhosts hang off owners. The zone catalogue does NOT (zones is global) and section 04
    // lists EVERY active zone, so pin it to the mig-0040 seed rather than trust earlier files.
    await resetZonesToSeed();
    app = buildApp();
    await app.register(advertiserPerformancesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  describe('guards', () => {
    it('401 without a session, 403 for a non-advertiser', async () => {
      mockNoSession();
      expect((await get(`${BASE}/campaigns`)).statusCode).toBe(401);
      const owner = await seedUser({ role: 'individual_owner' });
      mockSession(owner, 'individual_owner');
      expect((await get(`${BASE}/campaigns`)).statusCode).toBe(403);
    });
  });

  describe('GET /campaigns — the history (epics 3/4)', () => {
    it('RG-PERF-01 — lists only the caller’s CLOSED campaigns, newest clôture first', async () => {
      const me = await seedUser();
      const other = await seedUser();
      const venue = await seedVenue();
      const older = await seedCampaign(me, [venue.id], { name: 'Ancienne' });
      const newer = await seedCampaign(me, [venue.id], { name: 'Récente' });
      const inFlight = await seedCampaign(me, [venue.id], { name: 'En cours', status: 'active' });
      const foreign = await seedCampaign(other, [venue.id], { name: 'Étrangère' });
      await closeCampaign(older.id, {
        reconciledAt: new Date('2026-01-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 5000 }],
      });
      await closeCampaign(newer.id, {
        reconciledAt: new Date('2026-03-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 7000 }],
      });
      await closeCampaign(foreign.id, {
        reconciledAt: new Date('2026-04-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 9000 }],
      });
      void inFlight;
      mockSession(me);

      const res = await get(`${BASE}/campaigns`);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ campaigns: { name: string; closed_on: string }[] }>();
      expect(body.campaigns.map((c) => c.name)).toEqual(['Récente', 'Ancienne']);
      expect(body.campaigns[0]?.closed_on).toBe('2026-03-10');
    });

    it('carries the settled figures: impressions = delivered_imp, budget = spend + refund (HT, TTC)', async () => {
      const me = await seedUser();
      const v1 = await seedVenue();
      const v2 = await seedVenue();
      const c = await seedCampaign(me, [v1.id, v2.id], { name: 'Figures' });
      // Two créneaux planned per venue (Jan 1 & 2, hour 8 Tunis). Proofs: v1 airs both hours
      // (twice in the first), v2 airs one; one stray proof at hour 10 (unplanned) counts as a
      // play but never as an hour.
      await seedProof(c.id, c.creativeId, v1, new Date('2024-01-01T07:10:00Z'));
      await seedProof(c.id, c.creativeId, v1, new Date('2024-01-01T07:40:00Z'));
      await seedProof(c.id, c.creativeId, v1, new Date('2024-01-02T07:10:00Z'));
      await seedProof(c.id, c.creativeId, v2, new Date('2024-01-02T07:15:00Z'));
      await seedProof(c.id, c.creativeId, v2, new Date('2024-01-02T09:15:00Z'));
      await closeCampaign(c.id, {
        reconciledAt: new Date('2024-01-03T02:00:00Z'),
        spend: 150,
        refund: 50,
        payouts: [
          { venueId: v1.id, delivered: 20000, expected: 20000 },
          { venueId: v2.id, delivered: 10000, expected: 20000 },
        ],
      });
      mockSession(me);

      const res = await get(`${BASE}/campaigns`);
      const [row] = res.json<{ campaigns: Record<string, unknown>[] }>().campaigns;
      expect(row).toMatchObject({
        name: 'Figures',
        nature: 'normal',
        start_date: '2024-01-01',
        end_date: '2024-01-02',
        closed_on: '2024-01-03',
        impressions: 30000,
        hours: 3,
        plays: 5,
        venues: 2,
        budget_ht: 200,
        budget_ttc: 238,
      });
      // RG-PERF-31 — no CPM / SPS / attention / split key on the wire.
      const keys = Object.keys(row ?? {}).join(',');
      expect(keys).not.toMatch(/cpm|sps|attention|split|earnings|reversement/i);
    });

    it('a venue whose payout delivered nothing is not an établissement diffuseur', async () => {
      const me = await seedUser();
      const v1 = await seedVenue();
      const v2 = await seedVenue();
      const c = await seedCampaign(me, [v1.id, v2.id]);
      await closeCampaign(c.id, {
        reconciledAt: new Date('2024-01-03T02:00:00Z'),
        payouts: [
          { venueId: v1.id, delivered: 20000 },
          { venueId: v2.id, delivered: 0, expected: 20000 },
        ],
      });
      mockSession(me);
      const [row] = (await get(`${BASE}/campaigns`)).json<{ campaigns: { venues: number }[] }>()
        .campaigns;
      expect(row?.venues).toBe(1);
    });

    it('US-4.3 — no clôture yet → an empty list (never zeros as results)', async () => {
      const me = await seedUser();
      const venue = await seedVenue();
      await seedCampaign(me, [venue.id], { status: 'active' });
      mockSession(me);
      expect((await get(`${BASE}/campaigns`)).json()).toEqual({ campaigns: [] });
      expect((await get(`${BASE}/footprint`)).json()).toEqual({
        points: [],
        totals: { impressions: 0, hours: 0 },
      });
    });
  });

  describe('GET /live — campaigns en diffusion (epic 1)', () => {
    it('lists active-not-closed campaigns with live counters; audience from the affluence grid', async () => {
      const me = await seedUser();
      // 2024-01-01 is a Monday (ISO 1); the grid holds hour 8 at 100 people.
      const venue = await seedVenue({ affluence: [{ dayOfWeek: 1, hour: 8, level: 100 }] });
      const noGrid = await seedVenue();
      const live = await seedCampaign(me, [venue.id, noGrid.id], {
        name: 'Live',
        status: 'active',
        startDate: '2024-01-01',
      });
      const closed = await seedCampaign(me, [venue.id], { name: 'Closed' });
      await closeCampaign(closed.id, {
        reconciledAt: new Date('2024-01-03T02:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 1 }],
      });
      const notStarted = await seedCampaign(me, [venue.id], { name: 'Upcoming' });
      await db.update(campaigns).set({ status: 'upcoming' }).where(eq(campaigns.id, notStarted.id));
      // Credited hour at venue (Mon 8h → 100), twice; one at noGrid (Mon 8h, no grid → not matched).
      await seedProof(live.id, live.creativeId, venue, new Date('2024-01-01T07:10:00Z'));
      await seedProof(live.id, live.creativeId, venue, new Date('2024-01-01T07:50:00Z'));
      await seedProof(live.id, live.creativeId, noGrid, new Date('2024-01-01T07:20:00Z'));
      mockSession(me);

      const res = await get(`${BASE}/live`);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ campaigns: Record<string, unknown>[] }>();
      expect(body.campaigns).toHaveLength(1);
      expect(body.campaigns[0]).toMatchObject({
        name: 'Live',
        nature: 'normal',
        launched_on: '2024-01-01',
        audience: 100,
        plays: 3,
        venues: 2,
      });
    });

    it('a live campaign with proofs but no affluence grid reports audience null — not zero', async () => {
      const me = await seedUser();
      const venue = await seedVenue();
      const aired = await seedCampaign(me, [venue.id], { status: 'active', name: 'NoGrid' });
      await seedProof(aired.id, aired.creativeId, venue, new Date('2024-01-01T07:10:00Z'));
      await seedCampaign(me, [venue.id], { status: 'active', name: 'Fresh' });
      mockSession(me);
      const body = (await get(`${BASE}/live`)).json<{
        campaigns: { name: string; audience: number | null; plays: number }[];
      }>();
      const byName = new Map(body.campaigns.map((c) => [c.name, c]));
      expect(byName.get('NoGrid')).toMatchObject({ audience: null, plays: 1 });
      expect(byName.get('Fresh')).toMatchObject({ audience: 0, plays: 0 });
    });

    it('US-1.1 — nothing en diffusion → an empty list', async () => {
      const me = await seedUser();
      mockSession(me);
      expect((await get(`${BASE}/live`)).json()).toEqual({ campaigns: [] });
    });
  });

  describe('GET /analysis — sections 01–04 (epics 6/7)', () => {
    const seedTwoClosed = async (me: string) => {
      const [s1, s2] = await ownerSectors();
      const cafe = await seedVenue({ sectorId: s1?.id, venueClass: 'populaire', ratios: true });
      const resto = await seedVenue({ sectorId: s2?.id, venueClass: 'premium' });
      const a = await seedCampaign(me, [cafe.id, resto.id], { name: 'Alpha' });
      await closeCampaign(a.id, {
        reconciledAt: new Date('2026-02-10T10:00:00Z'),
        spend: 100,
        payouts: [
          { venueId: cafe.id, delivered: 8000 },
          { venueId: resto.id, delivered: 2000 },
        ],
      });
      const b = await seedCampaign(me, [cafe.id], { name: 'Beta' });
      await closeCampaign(b.id, {
        reconciledAt: new Date('2026-03-15T10:00:00Z'),
        spend: 50,
        payouts: [{ venueId: cafe.id, delivered: 5000 }],
      });
      return { cafe, resto, a, b };
    };

    it('Period mode — RG-PERF-16 membership by clôture date; sums; venues summed without dedup', async () => {
      const me = await seedUser();
      const { a, b } = await seedTwoClosed(me);
      mockSession(me);

      const all = (await get(`${BASE}/analysis`)).json<Record<string, unknown>>();
      expect(all).toMatchObject({
        mode: 'period',
        period: { from: null, to: null },
        nature: 'all',
        overview: {
          campaign_count: 2,
          impressions: 15000,
          venues: 3, // 2 + 1, the same café counted twice — normative
          budget_ht: 150,
          budget_ttc: 178.5,
        },
      });
      const camps = (all['campaigns'] as { id: string; categories: string[] }[]).map((c) => c.id);
      expect(camps).toEqual([b.id, a.id]);

      const feb = (await get(`${BASE}/analysis?from=2026-02-01&to=2026-02-28`)).json<{
        overview: { campaign_count: number; impressions: number };
        campaigns: { id: string }[];
      }>();
      expect(feb.overview).toMatchObject({ campaign_count: 1, impressions: 10000 });
      expect(feb.campaigns.map((c) => c.id)).toEqual([a.id]);

      // The boundary is inclusive on the Tunis calendar date.
      const edge = (await get(`${BASE}/analysis?from=2026-03-15&to=2026-03-15`)).json<{
        overview: { campaign_count: number };
      }>();
      expect(edge.overview.campaign_count).toBe(1);

      const none = (await get(`${BASE}/analysis?from=2025-01-01&to=2025-12-31`)).json<{
        overview: Record<string, number>;
        campaigns: unknown[];
        audience: unknown;
      }>();
      expect(none.overview['campaign_count']).toBe(0);
      expect(none.campaigns).toEqual([]);
      expect(none.audience).toBeNull();
    });

    it('sections 02/03/04 — category %, CSP %, sex/age from ratios (unprofiled kept apart), every zone', async () => {
      const me = await seedUser();
      const { a } = await seedTwoClosed(me);
      const [s1, s2] = await ownerSectors();
      const label1 = sectorDisplayName(s1?.name ?? '');
      const label2 = sectorDisplayName(s2?.name ?? '');
      const gt = await grandTunisId();
      mockSession(me);

      const res = (await get(`${BASE}/analysis?campaign_id=${a.id}`)).json<{
        mode: string;
        nature: string;
        categories: { label: string; value: number; pct: number }[];
        csp: { key: string; value: number; pct: number }[];
        audience: {
          profiled_impressions: number;
          unprofiled_impressions: number;
          unprofiled_venues: number;
          sex: { key: string; value: number; pct: number }[];
          age: { key: string; value: number }[];
        };
        zones: { zone_id: string | null; label: string; value: number; pct: number }[];
        campaigns: { categories: string[]; csp_shares: { key: string; pct: number }[] }[];
      }>();
      expect(res.mode).toBe('campaign');
      expect(res.nature).toBe('normal');
      expect(res.categories).toEqual([
        { key: label1, label: label1, value: 8000, pct: 80 },
        { key: label2, label: label2, value: 2000, pct: 20 },
      ]);
      expect(res.csp.map((r) => [r.key, r.value, r.pct])).toEqual([
        ['populaire', 8000, 80],
        ['moyen', 0, 0],
        ['premium', 2000, 20],
      ]);
      // Only the café carries hub ratios: 8 000 profiled, 2 000 kept apart (1 venue).
      expect(res.audience).toMatchObject({
        profiled_impressions: 8000,
        unprofiled_impressions: 2000,
        unprofiled_venues: 1,
      });
      expect(res.audience.sex).toEqual([
        { key: 'femmes', label: 'Femmes', value: 4800, pct: 60 },
        { key: 'hommes', label: 'Hommes', value: 3200, pct: 40 },
      ]);
      expect(res.audience.age.map((r) => [r.key, r.value])).toEqual([
        ['age_17_30', 4000],
        ['age_31_45', 2400],
        ['age_46_plus', 1600],
      ]);
      // Both venues default to Grand Tunis (the catalogue's one V1 row) → 100 %.
      expect(res.zones).toEqual([
        { key: gt, zone_id: gt, label: 'Grand Tunis', value: 10000, pct: 100 },
      ]);
      expect(res.campaigns[0]?.categories).toEqual([label1, label2]);
      expect(res.campaigns[0]?.csp_shares.find((s) => s.key === 'populaire')?.pct).toBe(80);
    });

    it('Period mode — the nature filter restricts; Campaign mode ignores it', async () => {
      const me = await seedUser();
      const venue = await seedVenue();
      const normal = await seedCampaign(me, [venue.id], { name: 'Normale' });
      await closeCampaign(normal.id, {
        reconciledAt: new Date('2026-02-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 100 }],
      });
      const [ev] = await db
        .insert(events)
        .values({
          name: 'Match',
          type: 'sport',
          kickoffAt: new Date('2026-02-20T20:00:00+01:00'),
          endsAt: new Date('2026-02-20T22:00:00+01:00'),
          source: 'official',
        })
        .returning();
      const positioning = await seedCampaign(me, [venue.id], {
        name: 'Événement',
        eventId: ev?.id ?? '',
      });
      await closeCampaign(positioning.id, {
        reconciledAt: new Date('2026-02-21T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 300 }],
      });
      mockSession(me);

      const events_ = (await get(`${BASE}/analysis?nature=event`)).json<{
        campaigns: { name: string; nature: string }[];
        overview: { impressions: number };
      }>();
      expect(events_.campaigns.map((c) => c.name)).toEqual(['Événement']);
      expect(events_.campaigns[0]?.nature).toBe('event');
      expect(events_.overview.impressions).toBe(300);
      const normals = (await get(`${BASE}/analysis?nature=normal`)).json<{
        campaigns: { name: string }[];
      }>();
      expect(normals.campaigns.map((c) => c.name)).toEqual(['Normale']);
      const single = (
        await get(`${BASE}/analysis?campaign_id=${positioning.id}&nature=normal`)
      ).json<{
        mode: string;
        nature: string;
        overview: { impressions: number };
      }>();
      expect(single).toMatchObject({ mode: 'campaign', nature: 'event' });
      expect(single.overview.impressions).toBe(300);
    });

    it('a foreign or unknown campaign_id is a 404; bad dates are 400', async () => {
      const me = await seedUser();
      const other = await seedUser();
      const venue = await seedVenue();
      const foreign = await seedCampaign(other, [venue.id]);
      await closeCampaign(foreign.id, {
        reconciledAt: new Date('2026-02-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 100 }],
      });
      mockSession(me);
      expect((await get(`${BASE}/analysis?campaign_id=${foreign.id}`)).statusCode).toBe(404);
      expect((await get(`${BASE}/analysis?from=2026-13-01`)).statusCode).toBe(400);
      expect((await get(`${BASE}/analysis?from=2026-03-01&to=2026-02-01`)).statusCode).toBe(400);
      expect((await get(`${BASE}/campaigns/${foreign.id}/report.pdf`)).statusCode).toBe(404);
    });
  });

  describe('GET /footprint — empreinte cumulée (epic 5)', () => {
    it('cumulates impressions + hours over the clôtures, oldest first, closed only', async () => {
      const me = await seedUser();
      const venue = await seedVenue();
      const first = await seedCampaign(me, [venue.id], { name: 'First' });
      await seedProof(first.id, first.creativeId, venue, new Date('2024-01-01T07:10:00Z'));
      await closeCampaign(first.id, {
        reconciledAt: new Date('2026-01-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 1000 }],
      });
      const second = await seedCampaign(me, [venue.id], { name: 'Second' });
      await seedProof(second.id, second.creativeId, venue, new Date('2024-01-01T07:10:00Z'));
      await seedProof(second.id, second.creativeId, venue, new Date('2024-01-02T07:10:00Z'));
      await closeCampaign(second.id, {
        reconciledAt: new Date('2026-02-10T10:00:00Z'),
        payouts: [{ venueId: venue.id, delivered: 2500 }],
      });
      const live = await seedCampaign(me, [venue.id], { status: 'active' });
      await seedProof(live.id, live.creativeId, venue, new Date('2024-01-01T07:10:00Z'));
      mockSession(me);

      const body = (await get(`${BASE}/footprint`)).json<{
        points: Record<string, unknown>[];
        totals: { impressions: number; hours: number };
      }>();
      expect(body.points.map((p) => p['name'])).toEqual(['First', 'Second']);
      expect(body.points[1]).toMatchObject({
        closed_on: '2026-02-10',
        impressions: 2500,
        hours: 2,
        impressions_cumulative: 3500,
        hours_cumulative: 3,
      });
      expect(body.totals).toEqual({ impressions: 3500, hours: 3 });
    });
  });

  describe('GET /campaigns/:id/report.pdf — the rapport de clôture (Q4 hypothesis)', () => {
    it('renders sections 01–04 for the caller’s campaign; RG-PERF-31 sweep inside the file', async () => {
      const me = await seedUser({ businessName: 'Marque Test' });
      const venue = await seedVenue({ venueClass: 'populaire', ratios: true });
      const c = await seedCampaign(me, [venue.id], { name: 'Soldes Été' });
      await seedProof(c.id, c.creativeId, venue, new Date('2024-01-01T07:10:00Z'));
      await closeCampaign(c.id, {
        reconciledAt: new Date('2026-02-10T10:00:00Z'),
        spend: 200,
        payouts: [{ venueId: venue.id, delivered: 12345 }],
      });
      mockSession(me);

      const res = await get(`${BASE}/campaigns/${c.id}/report.pdf`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('rapport-soldes-ete-2026-02-10.pdf');
      expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const text = pdfText(res.rawPayload);
      expect(text).toContain('Rapport de cl');
      expect(text).toContain('Sold');
      expect(text).toContain('Marque Test');
      expect(text).toContain('SECTION 01');
      expect(text).toContain('SECTION 04');
      expect(text).toContain('TND HT');
      expect(text).toContain('TND TTC');
      expect(text).toContain('12');
      // RG-PERF-04 / RG-PERF-31 — the forbidden vocabulary never reaches the file.
      expect(text).not.toMatch(/CPM/);
      expect(text).not.toMatch(/SPS/);
      expect(text).not.toMatch(/attention/i);
      expect(text).not.toMatch(/personnes touch/i);
      expect(text).not.toMatch(/partition des revenus|reversement/i);
      expect(text).not.toMatch(/SECTION 05|recommandation/i);
    });
  });

  describe('epic 2 — the clôture notification', () => {
    it('reconcileCampaignById inserts campaign_report_ready for the advertiser (campaign-bound)', async () => {
      const me = await seedUser();
      const venue = await seedVenue();
      const c = await seedCampaign(me, [venue.id], { name: 'Notifiée' });
      await seedProof(c.id, c.creativeId, venue, new Date('2024-01-01T07:10:00Z'));

      const result = await reconcileCampaignById(c.id, null);
      expect(result.status).toBe('OK');
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.userId, me), eq(notifications.type, CAMPAIGN_REPORT_READY_TYPE)),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        campaignId: c.id,
        title: 'Votre rapport de clôture de la campagne « Notifiée » est prêt',
      });
      // Idempotent with the settlement: a re-reconcile is ALREADY_RECONCILED and adds nothing.
      expect((await reconcileCampaignById(c.id, null)).status).toBe('ALREADY_RECONCILED');
      const again = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.type, CAMPAIGN_REPORT_READY_TYPE));
      expect(again).toHaveLength(1);

      // And the campaign now shows up in the history with the notification's id as its deep link.
      mockSession(me);
      const hist = (await get(`${BASE}/campaigns`)).json<{ campaigns: { id: string }[] }>();
      expect(hist.campaigns.map((x) => x.id)).toEqual([c.id]);
    });

    it('settleEventPositioning inserts campaign_report_ready next to event_settled', async () => {
      const me = await seedUser();
      const venue = await seedVenue();
      const kickoff = new Date('2027-06-10T20:00:00+01:00');
      const ends = new Date('2027-06-10T22:00:00+01:00');
      const grid = fenetreDiffusion(kickoff, ends);
      const [ev] = await db
        .insert(events)
        .values({
          name: 'Finale',
          type: 'sport',
          kickoffAt: kickoff,
          endsAt: ends,
          source: 'official',
        })
        .returning();
      const p = await seedCampaign(me, [venue.id], {
        name: 'Positionnement Finale',
        status: 'active',
        eventId: ev?.id ?? '',
        startDate: '2027-06-10',
        endDate: '2027-06-10',
      });
      await db.insert(eventAllocations).values({
        campaignId: p.id,
        screenhostId: venue.id,
        blocs: grid.blocs.map((b) => ({
          start: b.start.toISOString(),
          end: b.end.toISOString(),
          impressions: 2000,
        })),
        impressionsTotal: 12000,
        montantTnd: '300.000',
        statut: 'ACCEPTE',
        decidedAt: new Date(),
      });
      const firstBloc = grid.blocs[0];
      if (firstBloc)
        await seedProof(p.id, p.creativeId, venue, new Date(firstBloc.start.getTime() + 5_000));

      const settled = await settleEventPositioning(
        p.id,
        new Date(grid.windowEnd.getTime() + 60_000),
      );
      expect(settled.status).toBe('SETTLED');
      const types = (
        await db
          .select({ type: notifications.type, campaignId: notifications.campaignId })
          .from(notifications)
          .where(eq(notifications.userId, me))
      ).map((n) => n.type);
      expect(types.sort()).toEqual(['campaign_report_ready', 'event_settled']);

      mockSession(me);
      const hist = (await get(`${BASE}/campaigns`)).json<{
        campaigns: {
          id: string;
          nature: string;
          impressions: number;
          venues: number;
          budget_ht: number;
        }[];
      }>();
      expect(hist.campaigns[0]).toMatchObject({
        id: p.id,
        nature: 'event',
        impressions: 2000, // 1 of 6 blocs delivered
        venues: 1,
        budget_ht: 300, // spend (50) + refund (250) = the engaged montant
      });
    });
  });
});
