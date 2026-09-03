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
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

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

  // PERF-R1 (operator 2026-08-30, supersedes US-P.5) — the merged période read: PAX day first,
  // the venue's affluence grid otherwise. Never a zero because the sensor was silent.
  describe('GET /api/screenhosts/:id/audience', () => {
    interface AudienceBody {
      days: { date: string; audience: number; source: 'measured' | 'estimated' }[];
      total_audience: number;
      measured_days: number;
      estimated_days: number;
      estimated_pct: number | null;
    }

    // MEJ-R1 — the backup grid stands in only from the venue's ONBOARDING day (created_at)
    // onward, so every fixture below states one. 2026-07-01 is well before the ranges under
    // test: these cases assert the merge, not the floor (which has its own block at the end).
    const ONBOARDED_BEFORE_ALL = { createdAt: new Date('2026-07-01T00:00:00Z') };

    const seedBackupWeek = async (sh: string, value: number): Promise<void> => {
      await db.insert(screenhostAffluence).values(
        bothHalves(
          Array.from({ length: 7 }, (_, i) => ({
            screenhostId: sh,
            dayOfWeek: i + 1,
            hour: 10,
            estimatedImpressions: value,
            source: 'backup' as const,
          })),
        ),
      );
    };

    it('PAX day wins, backup grid otherwise — with per-day provenance on the wire', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me, ONBOARDED_BEFORE_ALL);
      // 2026-08-03 is a Monday. The sensor measured Monday (500); Tuesday it was silent.
      await db.insert(screenhostMonthlyStats).values({
        screenhostId: sh,
        month: '2026-08',
        totalAudience: 500,
        daily: [{ date: '2026-08-03', audience: 500, source: 'measured' }],
        peakDayOfWeek: 1,
        peakHour: 10,
      });
      await seedBackupWeek(sh, 80); // Monday grid estimate 80 must NOT override the 500 measure
      mockSession(me);

      const res = await get(`/api/screenhosts/${sh}/audience?from=2026-08-03&to=2026-08-04`);
      expect(res.statusCode).toBe(200);
      const body = res.json() as AudienceBody;
      // MEJ-R2 — `has_measured` rides the wire: the measured day is eligible for the peak, the
      // grid-filled one is not.
      expect(body.days).toEqual([
        { date: '2026-08-03', audience: 500, source: 'measured', has_measured: true },
        { date: '2026-08-04', audience: 80, source: 'estimated', has_measured: false },
      ]);
      expect(body.total_audience).toBe(580);
      expect(body.measured_days).toBe(1);
      expect(body.estimated_days).toBe(1);
      // Slice C — VALUE-WEIGHTED: the silent Tuesday is 80 people of 580, not « one day of two ».
      // The old share of DATA POINTS said 50 %, which a reader would have taken to mean half the
      // audience was guessed on a période that measured 500 of its 580.
      expect(body.estimated_pct).toBe(14); // 80 / 580
    });

    it('a venue with ZERO readings serves the full backup estimate — never silent-zeros', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me, ONBOARDED_BEFORE_ALL);
      await seedBackupWeek(sh, 80); // no monthly-stats row at all
      mockSession(me);

      const body = (
        await get(`/api/screenhosts/${sh}/audience?from=2026-08-01&to=2026-08-07`)
      ).json() as AudienceBody;
      expect(body.days).toHaveLength(7);
      expect(body.days.every((d) => d.audience === 80 && d.source === 'estimated')).toBe(true);
      expect(body.total_audience).toBe(560);
      expect(body.measured_days).toBe(0);
      expect(body.estimated_pct).toBe(100);
    });

    // MEJ-2 / ruling MEJ-R1 — the reproduction, end to end: a venue onboarded on 26/08 whose
    // backup grid an admin typed on 31/08 must NOT be credited with the three Mondays that
    // preceded its existence (« Pic 1 398 le 10/08 », 4 197 over 28 days).
    it('the backup grid never answers for days BEFORE the venue was onboarded', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me, { createdAt: new Date('2026-08-26T09:00:00Z') });
      await db.insert(screenhostAffluence).values(
        bothHalves({
          screenhostId: sh,
          dayOfWeek: 1, // Monday only — the phantom-peak shape
          hour: 13,
          estimatedImpressions: 1396,
          source: 'backup',
        }),
      );
      mockSession(me);

      // 03, 10, 17 and 24/08 are Mondays before onboarding; 31/08 is the Monday after it.
      const body = (
        await get(`/api/screenhosts/${sh}/audience?from=2026-08-03&to=2026-08-31`)
      ).json() as AudienceBody;
      expect(body.days).toEqual([
        { date: '2026-08-31', audience: 1396, source: 'estimated', has_measured: false },
      ]);
      expect(body.total_audience).toBe(1396); // not 4 × 1 396
      expect(body.days.every((d) => d.date >= '2026-08-26')).toBe(true);
    });

    it('a MEASURED day before onboarding is still served — only the estimate is floored', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me, { createdAt: new Date('2026-08-26T09:00:00Z') });
      await db.insert(screenhostMonthlyStats).values({
        screenhostId: sh,
        month: '2026-08',
        totalAudience: 700,
        daily: [{ date: '2026-08-10', audience: 700, source: 'measured' }],
        peakDayOfWeek: 1,
        peakHour: 13,
      });
      await db.insert(screenhostAffluence).values(
        bothHalves({
          screenhostId: sh,
          dayOfWeek: 1,
          hour: 13,
          estimatedImpressions: 1396,
          source: 'backup',
        }),
      );
      mockSession(me);

      const body = (
        await get(`/api/screenhosts/${sh}/audience?from=2026-08-03&to=2026-08-31`)
      ).json() as AudienceBody;
      expect(body.days).toEqual([
        { date: '2026-08-10', audience: 700, source: 'measured', has_measured: true }, // a fact
        { date: '2026-08-31', audience: 1396, source: 'estimated', has_measured: false },
      ]);
      expect(body.measured_days).toBe(1);
      expect(body.estimated_days).toBe(1);
    });

    // PERF-1b — the HERO's own call: « depuis le début » (2020-01-01 → today). The MEJ-2 floor
    // must hold over the all-time range too, or the curve would run back to 2020 on a grid the
    // venue never had, and the hero would contradict S01 for the same days.
    it('the all-time range the hero uses is floored at onboarding too', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me, { createdAt: new Date('2026-08-26T09:00:00Z') });
      await seedBackupWeek(sh, 80);
      mockSession(me);

      const body = (
        await get(`/api/screenhosts/${sh}/audience?from=2020-01-01&to=2026-08-31`)
      ).json() as AudienceBody;
      expect(body.days.length).toBeGreaterThan(0);
      // Not one day of the six years before the venue existed.
      expect(body.days[0]?.date).toBe('2026-08-26');
      expect(body.days.every((d) => d.date >= '2026-08-26')).toBe(true);
      // …and the total is the floored window, not 2 435 days × 80.
      expect(body.total_audience).toBe(body.days.length * 80);
    });

    it('respects the période bounds and clamps to Tunis today (no future day)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me, ONBOARDED_BEFORE_ALL);
      await seedBackupWeek(sh, 80);
      mockSession(me);

      const tunisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(
        new Date(),
      );
      const from = '2026-08-01';
      const body = (
        await get(`/api/screenhosts/${sh}/audience?from=${from}&to=2030-01-01`)
      ).json() as AudienceBody;
      expect(body.days[0]?.date).toBe(from);
      // S02-FUT1 made this assertion TIME-OF-DAY DEPENDENT, and it took a 02h39 run to notice.
      // The rule the test is named for is « no FUTURE day », and that still holds exactly. But
      // « the last day IS today » is stronger than the product now guarantees: a slot only becomes
      // a data point once it has ELAPSED, so before this venue's opening hour today holds nothing
      // and the series legitimately ends yesterday. Asserting the invariant instead of the
      // wall-clock coincidence — the last day never EXCEEDS Tunis today, and no future day appears.
      expect(body.days.at(-1)?.date).not.toBeUndefined();
      expect(body.days.at(-1)!.date <= tunisToday).toBe(true);
      expect(body.days.every((d) => d.date <= tunisToday)).toBe(true);
    });

    it('rejects malformed, reversed and too-wide ranges (400)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);

      expect(
        (await get(`/api/screenhosts/${sh}/audience?from=03/08/2026&to=2026-08-04`)).statusCode,
      ).toBe(400);
      expect(
        (await get(`/api/screenhosts/${sh}/audience?from=2026-08-04&to=2026-08-03`)).statusCode,
      ).toBe(400);
      const tooWide = await get(`/api/screenhosts/${sh}/audience?from=2010-01-01&to=2026-08-04`);
      expect(tooWide.statusCode).toBe(400);
      expect((tooWide.json() as { error: string }).error).toBe('RANGE_TOO_WIDE');
    });

    it('requires authentication (401) and owner scope (404 on a foreign venue)', async () => {
      mockNoSession();
      expect(
        (
          await get(
            '/api/screenhosts/11111111-1111-4111-8111-111111111111/audience?from=2026-08-01&to=2026-08-02',
          )
        ).statusCode,
      ).toBe(401);
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect(
        (await get(`/api/screenhosts/${foreign}/audience?from=2026-08-01&to=2026-08-02`))
          .statusCode,
      ).toBe(404);
    });
  });

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
        age46PlusPct: '30.00',
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
          age_46_plus_pct: 30,
        },
      });
    });

    // CLS-AGE1 — THE regression this lane exists to kill. Before it, the every-non-null gate
    // spanned the two retired columns, so a class the hub pushed in the new shape (46+ only)
    // failed the gate: /profile answered `ratios: null`, S04 rendered « en attente du premier
    // deal » forever, and the venue was indistinguishable from one the hub had never measured.
    // Both retired columns are left NULL here ON PURPOSE — that IS the new shape.
    it('a class pushed in the NEW shape (46+ set, both retired columns NULL) is NOT starved', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me, {
        genderMalePct: '48.00',
        genderFemalePct: '52.00',
        age17To30Pct: '34.00',
        age31To45Pct: '29.00',
        age46PlusPct: '37.00',
        // age46To60Pct / age60PlusPct deliberately absent.
      });
      mockSession(me);

      const res = await get(`/api/screenhosts/${mine}/profile`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ ratios: unknown }>().ratios).toEqual({
        gender_male_pct: 48,
        gender_female_pct: 52,
        age_17_30_pct: 34,
        age_31_45_pct: 29,
        age_46_plus_pct: 37,
      });
    });

    // The mirror: the retired columns can no longer CARRY a class on their own. A row holding only
    // the old pair is a pre-migration leftover the backfill missed — it starves, and that is right,
    // because nothing may read those two columns any more.
    it('the two RETIRED columns alone do not satisfy the gate', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me, {
        genderMalePct: '48.00',
        genderFemalePct: '52.00',
        age17To30Pct: '34.00',
        age31To45Pct: '29.00',
        age46To60Pct: '20.00',
        age60PlusPct: '17.00',
      });
      mockSession(me);

      const res = await get(`/api/screenhosts/${mine}/profile`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ ratios: unknown }>().ratios).toBeNull();
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
      // AMENDMENT (US-P.0): the served total is Σ of the MEASURED days, not the stored column —
      // the owner reads what the sensor counted. (The stored column is untouched, so the banked
      // DATA1 summarize-mismatch stays observable in the row itself.)
      expect(body.months[0]).toEqual({
        month: '2026-06',
        total_audience: 84,
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

    // AMENDMENT 2026-08-20 (US-P.0 + « Donnée mesurée (capteur) ») — an ESTIMATED day never
    // reaches an owner audience figure. The stored row keeps both kinds; the wire carries only
    // what the sensor measured, so a fully unmeasured month serves 0 and no days.
    it('serves MEASURED days only — estimates are enrichment, never audience', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me);
      await db.insert(screenhostMonthlyStats).values([
        {
          screenhostId: mine,
          month: '2026-06',
          totalAudience: 1000, // as written by the merge: measured + estimated
          daily: [
            { date: '2026-06-01', audience: 40, source: 'measured' },
            { date: '2026-06-02', audience: 300, source: 'estimated' },
            { date: '2026-06-03', audience: 0, source: 'estimated' },
          ],
          peakDayOfWeek: 6,
          peakHour: 20,
        },
        {
          screenhostId: mine,
          month: '2026-05',
          totalAudience: 900, // estimate-only month
          daily: [{ date: '2026-05-01', audience: 300, source: 'estimated' }],
          peakDayOfWeek: 1,
          peakHour: 12,
        },
      ]);
      mockSession(me);

      const body = (await get(`/api/screenhosts/${mine}/monthly-stats`)).json<{
        months: { month: string; total_audience: number; daily: unknown[] }[];
      }>();
      expect(body.months[0]).toMatchObject({
        month: '2026-06',
        total_audience: 40,
        daily: [{ date: '2026-06-01', audience: 40, source: 'measured' }],
      });
      // A month the sensor never measured is an honest 0 with no days — the spec rules this is
      // NOT an incoherence beside non-zero impressions (two independent sensors).
      expect(body.months[1]).toMatchObject({ month: '2026-05', total_audience: 0, daily: [] });
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
