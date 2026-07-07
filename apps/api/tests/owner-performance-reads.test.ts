import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaigns,
  creatives,
  proofOfPlay,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. The Lane F owner performance reads: /:id/profile (venue
// identity card + hub-synced ratios), /:id/monthly-stats (the JSON read of the hub's actual
// monthly audience), /:id/impressions-daily (proof_of_play VIDEO_ENDED counts, Tunis-bucketed in
// SQL). All owner-scoped in the WHERE like the WiFi/affluence reads — a foreign id is a 404.
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
      email: `perf${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (
  ownerId: string | null,
  values: Partial<typeof screenhosts.$inferInsert> = {},
): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name: 'Café Perf', ...(ownerId ? { ownerId } : {}), ...values })
    .returning();
  return s?.id ?? '';
};

const anOwnerSector = async (): Promise<{ id: string; name: string }> => {
  const [sector] = await db
    .select({ id: businessSectors.id, name: businessSectors.name })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return sector!;
};

afterAll(async () => {
  await sql.end();
});

describe('owner performance reads (owner-scoped, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  describe('GET /api/screenhosts/:id/profile', () => {
    it('requires authentication (401)', async () => {
      mockNoSession();
      const res = await get('/api/screenhosts/11111111-1111-4111-8111-111111111111/profile');
      expect(res.statusCode).toBe(401);
    });

    it("404 on a FOREIGN screenhost (someone else's venue is indistinguishable from a missing one)", async () => {
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/profile`)).statusCode).toBe(404);
    });

    it('returns the venue identity card — sector NAME, class, hours, sps and ratios as NUMBERS', async () => {
      const me = await seedUser();
      const sector = await anOwnerSector();
      const mine = await seedScreenhost(me, {
        businessSectorId: sector.id,
        class: 'premium',
        openingHour: 8,
        closingHour: 21,
        sps: '62.50',
        genderMalePct: '55.50',
        genderFemalePct: '44.50',
        age17To30Pct: '30.00',
        age31To45Pct: '40.00',
        age46To60Pct: '20.25',
        age60PlusPct: '9.75',
      });
      mockSession(me);

      const res = await get(`/api/screenhosts/${mine}/profile`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        name: 'Café Perf',
        business_sector: sector.name,
        class: 'premium',
        opening_hour: 8,
        closing_hour: 21,
        sps: 62.5, // number, not the drizzle numeric-string
        ratios: {
          gender_male_pct: 55.5,
          gender_female_pct: 44.5,
          age_17_30_pct: 30,
          age_31_45_pct: 40,
          age_46_60_pct: 20.25,
          age_60_plus_pct: 9.75,
        },
      });
    });

    it('ratios is NULL (never partial) when any ratio column is unset; nullable fields explicit', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me, {
        genderMalePct: '60.00', // one column set, the rest null → ratios must be null
      });
      mockSession(me);

      const res = await get(`/api/screenhosts/${mine}/profile`);
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        business_sector: string | null;
        class: string | null;
        ratios: unknown;
      }>();
      expect(body.ratios).toBeNull();
      expect(body.business_sector).toBeNull();
      expect(body.class).toBeNull();
    });
  });

  describe('GET /api/screenhosts/:id/monthly-stats', () => {
    it('requires authentication (401)', async () => {
      mockNoSession();
      const res = await get('/api/screenhosts/11111111-1111-4111-8111-111111111111/monthly-stats');
      expect(res.statusCode).toBe(401);
    });

    it('404 on a FOREIGN screenhost', async () => {
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/monthly-stats`)).statusCode).toBe(404);
    });

    it('returns the months NEWEST-FIRST with the snake_case shape; empty months = honest empty', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me);
      // Inserted out of order — the read must sort desc.
      await db.insert(screenhostMonthlyStats).values([
        {
          screenhostId: mine,
          month: '2026-04',
          totalAudience: 900,
          daily: [{ date: '2026-04-01', audience: 30 }],
          peakDayOfWeek: 5,
          peakHour: 18,
        },
        {
          screenhostId: mine,
          month: '2026-06',
          totalAudience: 1200,
          daily: [
            { date: '2026-06-01', audience: 40 },
            { date: '2026-06-02', audience: 44 },
          ],
          peakDayOfWeek: 6,
          peakHour: 20,
        },
      ]);
      mockSession(me);

      const res = await get(`/api/screenhosts/${mine}/monthly-stats`);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ months: { month: string; total_audience: number }[] }>();
      expect(body.months.map((m) => m.month)).toEqual(['2026-06', '2026-04']);
      expect(body.months[0]).toEqual({
        month: '2026-06',
        total_audience: 1200,
        daily: [
          { date: '2026-06-01', audience: 40 },
          { date: '2026-06-02', audience: 44 },
        ],
        peak_day_of_week: 6,
        peak_hour: 20,
      });

      // A venue with no stats → empty list, not an error.
      const bare = await seedScreenhost(me, { name: 'Sans Stats' });
      const empty = await get(`/api/screenhosts/${bare}/monthly-stats`);
      expect(empty.statusCode).toBe(200);
      expect(empty.json<{ months: unknown[] }>().months).toEqual([]);
    });
  });

  describe('GET /api/screenhosts/:id/impressions-daily', () => {
    // proof_of_play rows need the full FK chain (screen, campaign, creative — billing evidence).
    const seedProofChain = async (ownerId: string) => {
      const advertiser = await seedUser({ role: 'advertiser' });
      const screenhostId = await seedScreenhost(ownerId);
      const [screen] = await db
        .insert(screens)
        .values({ screenhostId, name: 'Screen 1' })
        .returning();
      const [creative] = await db
        .insert(creatives)
        .values({
          advertiserId: advertiser,
          creativeType: 'video',
          storageKey: `creatives/${advertiser}/perf`,
          durationSeconds: 20,
          validationStatus: 'approved',
        })
        .returning();
      const [campaign] = await db
        .insert(campaigns)
        .values({
          advertiserId: advertiser,
          name: 'Perf Campaign',
          campaignType: 'standard',
          status: 'active',
          creativeId: creative?.id,
        })
        .returning();
      return {
        screenhostId,
        screenId: screen?.id ?? '',
        campaignId: campaign?.id ?? '',
        creativeId: creative?.id ?? '',
      };
    };

    const seedProofs = async (
      chain: Awaited<ReturnType<typeof seedProofChain>>,
      receivedAt: Date,
      eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED',
      countRows: number,
    ) => {
      await db.insert(proofOfPlay).values(
        Array.from({ length: countRows }, () => ({
          screenId: chain.screenId,
          screenhostId: chain.screenhostId,
          campaignId: chain.campaignId,
          creativeId: chain.creativeId,
          videoIdAsSent: chain.campaignId,
          eventType,
          receivedAt,
        })),
      );
    };

    it('requires authentication (401)', async () => {
      mockNoSession();
      const res = await get(
        '/api/screenhosts/11111111-1111-4111-8111-111111111111/impressions-daily?from=2026-06-01&to=2026-06-30',
      );
      expect(res.statusCode).toBe(401);
    });

    it('404 on a FOREIGN screenhost', async () => {
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      const res = await get(
        `/api/screenhosts/${foreign}/impressions-daily?from=2026-06-01&to=2026-06-30`,
      );
      expect(res.statusCode).toBe(404);
    });

    it('counts VIDEO_ENDED per Tunis-local day (SQL aggregate); STARTED + out-of-range excluded; zero-days omitted', async () => {
      const me = await seedUser();
      const chain = await seedProofChain(me);
      // 3 ENDED on June 10 (12:00 UTC = 13:00 Tunis, same day) …
      await seedProofs(chain, new Date('2026-06-10T12:00:00Z'), 'VIDEO_ENDED', 3);
      // … 1 ENDED late June 30 UTC that lands on JULY 1 in Tunis (UTC+1) — the bucketing proof …
      await seedProofs(chain, new Date('2026-06-30T23:30:00Z'), 'VIDEO_ENDED', 1);
      // … a STARTED (not an impression) and an ENDED far outside the range (both excluded).
      await seedProofs(chain, new Date('2026-06-10T12:00:00Z'), 'VIDEO_STARTED', 1);
      await seedProofs(chain, new Date('2026-01-05T12:00:00Z'), 'VIDEO_ENDED', 1);
      mockSession(me);

      const res = await get(
        `/api/screenhosts/${chain.screenhostId}/impressions-daily?from=2026-06-01&to=2026-07-02`,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        days: [
          { date: '2026-06-10', impressions: 3 },
          { date: '2026-07-01', impressions: 1 }, // 23:30Z = 00:30 Tunis next day
        ],
      });
    });

    it('400 on a reversed or over-400-day range (and regex-passing non-dates)', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me);
      mockSession(me);
      const reversed = await get(
        `/api/screenhosts/${mine}/impressions-daily?from=2026-06-30&to=2026-06-01`,
      );
      expect(reversed.statusCode).toBe(400);
      const tooLong = await get(
        `/api/screenhosts/${mine}/impressions-daily?from=2025-01-01&to=2026-06-30`,
      );
      expect(tooLong.statusCode).toBe(400);
      const nonDate = await get(
        `/api/screenhosts/${mine}/impressions-daily?from=2026-13-45&to=2026-06-30`,
      );
      expect(nonDate.statusCode).toBe(400);
      const missing = await get(`/api/screenhosts/${mine}/impressions-daily?from=2026-06-01`);
      expect(missing.statusCode).toBe(400);
    });
  });
});
