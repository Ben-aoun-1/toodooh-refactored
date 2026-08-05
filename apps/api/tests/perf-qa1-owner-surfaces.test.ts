import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaigns,
  creatives,
  dispatchConfig,
  type NewUser,
  proofOfPlay,
  screenhostMonthlyReports,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import {
  PISTE_01_BODY,
  PISTE_01_TITLE,
  PISTE_02_GENERIC_BODY,
  PISTE_02_TITLE,
  PISTE_03_TITLE,
  PISTE_03_WAIT_BODY,
} from '../src/lib/report/template.js';
import { venueSlug } from '../src/lib/slug.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// PERF-QA1 commit 1 — the owner surfaces the Mejri GTM batch adds: the reports LISTING (R1), the
// owner SPS read (R6), the owner pistes read (R5, same generator+cache as the period report), the
// playout summary (R11) and the venue slug (R3). Real Postgres; the AI pistes seam is mocked at
// the module boundary exactly like report-endpoint.test.ts.
const pistesCachedSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/report/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/recommendations.js')>();
  return { ...actual, pistesForReportCached: pistesCachedSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
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
      email: `pq1-${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string, name = 'Café Période'): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return s?.id ?? '';
};

/** Minimal campaign + creative pair so proof_of_play rows can exist (FKs are RESTRICT). */
const seedProofChain = async (): Promise<{ campaignId: string; creativeId: string }> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/pq1/${seq}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `PQ1 campagne ${seq}`,
      campaignType: 'standard',
      status: 'active',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      requestedBudget: '300',
      creativeId: creative?.id ?? null,
    })
    .returning();
  return { campaignId: c?.id ?? '', creativeId: creative?.id ?? '' };
};

const seedProof = async (
  shId: string,
  chain: { campaignId: string; creativeId: string },
  playedDurationMs: number | null,
  eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED' = 'VIDEO_ENDED',
): Promise<void> => {
  const [screen] = await db
    .select({ id: screens.id })
    .from(screens)
    .where(eq(screens.screenhostId, shId))
    .limit(1);
  let screenId = screen?.id;
  if (!screenId) {
    const [s] = await db.insert(screens).values({ screenhostId: shId, name: 'PQ1 TV' }).returning();
    screenId = s?.id;
  }
  await db.insert(proofOfPlay).values({
    screenId: screenId ?? '',
    screenhostId: shId,
    campaignId: chain.campaignId,
    creativeId: chain.creativeId,
    videoIdAsSent: chain.creativeId,
    eventType,
    playedDurationMs,
  });
};

afterAll(async () => {
  await db.delete(dispatchConfig);
  await sql.end();
});

describe('venueSlug (R3)', () => {
  it('folds diacritics and collapses separators', () => {
    expect(venueSlug('Café Période N°3')).toBe('cafe-periode-n-3');
    expect(venueSlug('  ÉTÉ à Sousse!! ')).toBe('ete-a-sousse');
  });

  it('never returns an empty segment', () => {
    expect(venueSlug('مقهى')).toBe('etablissement');
    expect(venueSlug('---')).toBe('etablissement');
  });
});

describe('PERF-QA1 owner surfaces (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(dispatchConfig);
    pistesCachedSpy.mockReset();
    pistesCachedSpy.mockResolvedValue(null);
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  describe('GET /api/screenhosts/:id/reports (R1 — the month authority listing)', () => {
    it('requires authentication (401)', async () => {
      mockNoSession();
      expect(
        (await get('/api/screenhosts/11111111-1111-4111-8111-111111111111/reports')).statusCode,
      ).toBe(401);
    });

    it("404 on a FOREIGN screenhost (someone else's venue is indistinguishable from a missing one)", async () => {
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/reports`)).statusCode).toBe(404);
    });

    it('lists stored reports newest-first with the REAL generated_at (never a derived date)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      await db.insert(screenhostMonthlyReports).values([
        {
          screenhostId: sh,
          month: '2026-05',
          storageKey: `reports/${sh}/2026-05.pdf`,
          generatedAt: new Date('2026-06-01T05:00:00Z'),
        },
        {
          screenhostId: sh,
          month: '2026-07',
          storageKey: `reports/${sh}/2026-07.pdf`,
          generatedAt: new Date('2026-08-01T06:30:00Z'),
        },
        {
          screenhostId: sh,
          month: '2026-06',
          storageKey: `reports/${sh}/2026-06.pdf`,
          generatedAt: new Date('2026-07-02T09:15:00Z'),
        },
      ]);
      const res = await get(`/api/screenhosts/${sh}/reports`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ reports: { month: string; generated_at: string }[] }>()).toEqual({
        reports: [
          { month: '2026-07', generated_at: '2026-08-01T06:30:00.000Z' },
          { month: '2026-06', generated_at: '2026-07-02T09:15:00.000Z' },
          { month: '2026-05', generated_at: '2026-06-01T05:00:00.000Z' },
        ],
      });
    });

    it('a venue with no stored reports lists empty (the honest empty state)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/reports`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ reports: unknown[] }>().reports).toEqual([]);
    });
  });

  describe('GET /api/screenhosts/:id/sps (R6 — owner SPS, weights from config)', () => {
    interface SpsVariableWire {
      value: number;
      weight: number;
    }
    interface SpsBody {
      sps: number | null;
      variables: {
        acceptation: SpsVariableWire;
        respect_evenements: SpsVariableWire;
        activite: SpsVariableWire;
        remplissage: SpsVariableWire;
      } | null;
    }

    it('requires authentication (401) and owner scope (404 on foreign)', async () => {
      mockNoSession();
      expect(
        (await get('/api/screenhosts/11111111-1111-4111-8111-111111111111/sps')).statusCode,
      ).toBe(401);
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/sps`)).statusCode).toBe(404);
    });

    it('serves the live score with the DEFAULT config weights 40/30/20/10 when no config row exists', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/sps`);
      expect(res.statusCode).toBe(200);
      const body = res.json<SpsBody>();
      expect(typeof body.sps).toBe('number');
      expect(body.variables?.acceptation.weight).toBe(40);
      expect(body.variables?.respect_evenements.weight).toBe(30);
      expect(body.variables?.activite.weight).toBe(20);
      expect(body.variables?.remplissage.weight).toBe(10);
      expect(typeof body.variables?.acceptation.value).toBe('number');
      expect(typeof body.variables?.respect_evenements.value).toBe('number');
      expect(typeof body.variables?.activite.value).toBe('number');
      expect(typeof body.variables?.remplissage.value).toBe('number');
    });

    it('weights come from the CONFIG row when one exists — never hardcoded (pins R6)', async () => {
      await db.insert(dispatchConfig).values({
        seuilDiffusable: 1000,
        gMois: '100',
        joursActifs: 30,
        rMinEfficace: 2,
        spsWeightAcceptation: '35.00',
        spsWeightRespectEvenements: '25.00',
        spsWeightActivite: '25.00',
        spsWeightRemplissage: '15.00',
      });
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const body = (await get(`/api/screenhosts/${sh}/sps`)).json<SpsBody>();
      expect(body.variables?.acceptation.weight).toBe(35);
      expect(body.variables?.respect_evenements.weight).toBe(25);
      expect(body.variables?.activite.weight).toBe(25);
      expect(body.variables?.remplissage.weight).toBe(15);
    });
  });

  describe('GET /api/screenhosts/:id/pistes (R5 — the page mirrors the PDF)', () => {
    interface PistesBody {
      pistes: { num: string; title: string; body: string; pending: boolean }[];
    }
    const range = 'from=2026-06-01&to=2026-06-30';

    it('requires authentication (401) and owner scope (404 on foreign)', async () => {
      mockNoSession();
      expect(
        (await get(`/api/screenhosts/11111111-1111-4111-8111-111111111111/pistes?${range}`))
          .statusCode,
      ).toBe(401);
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/pistes?${range}`)).statusCode).toBe(404);
    });

    it('an over-400-day range is the same DISTINCT 400 RANGE_TOO_WIDE as the report route (R4)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/pistes?from=2020-01-01&to=2026-08-05`);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('RANGE_TOO_WIDE');
    });

    it('serves the template constants BYTE-EQUAL when the AI seam yields nothing (single home)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/pistes?${range}`);
      expect(res.statusCode).toBe(200);
      expect(res.json<PistesBody>()).toEqual({
        pistes: [
          { num: '01', title: PISTE_01_TITLE, body: PISTE_01_BODY, pending: false },
          { num: '02', title: PISTE_02_TITLE, body: PISTE_02_GENERIC_BODY, pending: false },
          { num: '03', title: PISTE_03_TITLE, body: PISTE_03_WAIT_BODY, pending: true },
        ],
      });
    });

    it('goes through the SAME cache-wrapped seam as the period report, keyed venue × period', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      pistesCachedSpy.mockResolvedValue('Corps IA du créneau faible.');
      const res = await get(`/api/screenhosts/${sh}/pistes?${range}`);
      expect(res.statusCode).toBe(200);
      const body = res.json<PistesBody>();
      expect(body.pistes[1]?.body).toBe('Corps IA du créneau faible.');
      expect(body.pistes[1]?.title).toBe(PISTE_02_TITLE); // the title stays FIXED either way
      expect(pistesCachedSpy).toHaveBeenCalledTimes(1);
      expect(pistesCachedSpy.mock.calls[0]?.[0]).toBe(sh);
      expect(pistesCachedSpy.mock.calls[0]?.[1]?.range).toEqual({
        from: '2026-06-01',
        to: '2026-06-30',
      });
    });

    it('a pistes-seam failure never fails the response — 200 with the generic body', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      pistesCachedSpy.mockRejectedValue(new Error('anthropic exploded'));
      const res = await get(`/api/screenhosts/${sh}/pistes?${range}`);
      expect(res.statusCode).toBe(200);
      expect(res.json<PistesBody>().pistes[1]?.body).toBe(PISTE_02_GENERIC_BODY);
    });
  });

  describe('GET /api/screenhosts/playout-summary (R11 — Durée totale, all-time)', () => {
    it('requires authentication (401)', async () => {
      mockNoSession();
      expect((await get('/api/screenhosts/playout-summary')).statusCode).toBe(401);
    });

    it('an owner with no proofs reads 0 (the honest empty state)', async () => {
      const me = await seedUser();
      await seedScreenhost(me);
      mockSession(me);
      const res = await get('/api/screenhosts/playout-summary');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ total_played_ms: number }>().total_played_ms).toBe(0);
    });

    it('sums played_duration_ms over VIDEO_ENDED across MY venues only', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me, 'Mon Café');
      const other = await seedUser();
      const foreign = await seedScreenhost(other, 'Autre Café');
      const chain = await seedProofChain();
      await seedProof(mine, chain, 1500);
      await seedProof(mine, chain, 2500);
      await seedProof(mine, chain, null, 'VIDEO_STARTED'); // no duration — never counted
      await seedProof(foreign, chain, 9999); // someone else's venue — never bleeds in
      mockSession(me);
      const res = await get('/api/screenhosts/playout-summary');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ total_played_ms: number }>().total_played_ms).toBe(4000);
    });
  });
});
