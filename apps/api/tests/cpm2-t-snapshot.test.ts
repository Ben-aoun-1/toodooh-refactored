import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchPlan,
  campaignTargeting,
  creatives,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';
import { campaignDispatchRoutes } from '../src/routes/campaign-dispatch.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';

import {
  type CpmConfigSnapshot,
  type TConfigSnapshot,
  pinCpmConfig,
  pinTConfig,
  restoreCpmConfig,
  restoreTConfig,
  setTConfig,
} from './helpers/cpm-config.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';

// CPM-2 (ruling 4A, 2026-09-17) — the attention index T is frozen per campaign at CREATION, like
// CPM-1 froze the CPM. An admin T change (PATCH /api/admin/dispatch-config, t_10s/t_20s/t_30s)
// prices only campaigns created after it; an existing campaign keeps its own tiers wherever it is
// priced before its plan freezes (C_max, the submit and cart gates, « Hosts éligibles », the
// activation and the synthetic dispatch trigger). The capture is the column DEFAULT (migration
// 0075), so these tests drive the real insert paths and the real readers.
//
// The fixture, hand-computed: one premium venue open 8–18 every day (Hi = 10 h × 2 days = 20),
// affluence 100, a 20 s spot → R = min(3600/20, ⌊300/20⌋) = 15 → 30 000 physical impressions.
// At T = 0.70 → 21 000 facturable → C_max = ⌊15 × 21 000 / 1000⌋ = 315 TND.
// At T = 0.65 → 19 500 facturable → C_max = ⌊15 × 19 500 / 1000⌋ = 292 TND.
// A 300 TND budget therefore fits the creation T and would NOT fit the live one. Each campaign
// gets its own 2-day window so no campaign's allocations engage another's pool.

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
    .values({ email: `cpm2-${seq}@example.com`, contactName: `CPM2 ${seq}`, ...values })
    .returning({ id: users.id });
  return u?.id ?? '';
};

interface Tiers {
  t10: string;
  t20: string;
  t30: string;
}
/** Read with SQL on purpose: the row's tiers, whatever the ORM schema says. */
const rowTiers = async (id: string): Promise<Tiers | undefined> => {
  const [row] = await sql<Tiers[]>`
    select t_10s::text as t10, t_20s::text as t20, t_30s::text as t30
    from campaigns where id = ${id}`;
  return row;
};

const planOf = async (campaignId: string) => {
  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId))
    .limit(1);
  return plan;
};

const buildApp = () => Fastify({ logger: false });

describe('CPM-2 — a campaign keeps the attention index T in effect when it was created', () => {
  let app: ReturnType<typeof buildApp>;
  let pinnedCpm: CpmConfigSnapshot;
  let pinnedT: TConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinnedCpm = await pinCpmConfig('15.000', '15.000');
    pinnedT = await pinTConfig('0.60', '0.70', '0.80');
    app = buildApp();
    await app.register(campaignsRoutes);
    await app.register(cartRoutes);
    await app.register(adminCampaignsRoutes);
    await app.register(adminDispatchConfigRoutes);
    await app.register(campaignDispatchRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await restoreTConfig(pinnedT);
    await restoreCpmConfig(pinnedCpm);
  });

  afterAll(async () => {
    await sql.end();
  });

  const createDraft = async (advertiser: string, name: string): Promise<string> => {
    mockSession(advertiser, 'advertiser');
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name, campaign_type: 'standard' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  };

  const edit = async (advertiser: string, id: string, payload: Record<string, unknown>) => {
    mockSession(advertiser, 'advertiser');
    return app.inject({ method: 'PATCH', url: `/api/campaigns/${id}`, payload });
  };

  describe('the capture — the column default reads the config at INSERT time', () => {
    it('a new row captures the config T; a T change leaves it alone and prices the next row', async () => {
      const advertiser = await seedUser();
      const first = await createDraft(advertiser, 'Avant');
      expect(await rowTiers(first)).toEqual({ t10: '0.600', t20: '0.700', t30: '0.800' });

      await setTConfig('0.50', '0.65', '0.90');
      expect(await rowTiers(first)).toEqual({ t10: '0.600', t20: '0.700', t30: '0.800' });

      const second = await createDraft(advertiser, 'Après');
      expect(await rowTiers(second)).toEqual({ t10: '0.500', t20: '0.650', t30: '0.900' });
    });

    it('with no dispatch_config row a new campaign captures the V1 defaults 0.60 / 0.70 / 0.80', async () => {
      const advertiser = await seedUser();
      await setTConfig('0.50', '0.65', '0.90');
      const rollback = new Error('rollback');
      await expect(
        sql.begin(async (tx) => {
          await tx`delete from dispatch_config`;
          const [row] = await tx<Tiers[]>`
            insert into campaigns (advertiser_id, name, campaign_type)
            values (${advertiser}, 'Sans config', 'standard')
            returning t_10s::text as t10, t_20s::text as t20, t_30s::text as t30`;
          expect(row).toEqual({ t10: '0.600', t20: '0.700', t30: '0.800' });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });

    it('a draft edit never re-prices — the T fields are not part of the edit contract', async () => {
      const advertiser = await seedUser();
      const id = await createDraft(advertiser, 'Brouillon');
      const only = await edit(advertiser, id, { t_10s: 0.1, t_20s: 0.1, t_30s: 0.1 });
      expect(only.statusCode).toBe(400); // stripped → an empty edit
      const mixed = await edit(advertiser, id, {
        name: 'Renommé',
        t_10s: 0.1,
        t_20s: 0.1,
        t_30s: 0.1,
      });
      expect(mixed.statusCode).toBe(200);
      expect(await rowTiers(id)).toEqual({ t10: '0.600', t20: '0.700', t30: '0.800' });
    });
  });

  describe('the rule end to end — every reader of an existing campaign prices at its own T', () => {
    it('created at 0.60/0.70/0.80 → admin moves T to 0.50/0.65/0.90 → edited → priced at 0.70 everywhere', async () => {
      const admin = await seedUser({ role: 'admin', status: 'approved' });
      const advertiser = await seedUser({ role: 'advertiser', status: 'approved' });
      const [sector] = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(eq(businessSectors.audience, 'owner'))
        .limit(1);
      const sectorId = sector?.id ?? '';
      const ownerId = await seedUser({ role: 'individual_owner', status: 'approved' });
      const [venue] = await db
        .insert(screenhosts)
        .values({
          name: `CPM2 Venue ${seq}`,
          ownerId,
          businessSectorId: sectorId,
          class: 'premium',
          openingHour: 8,
          closingHour: 18,
          broadcastCapacity: 4,
        })
        .returning({ id: screenhosts.id });
      const cells = [];
      for (let dow = 1; dow <= 7; dow += 1)
        for (let h = 8; h < 18; h += 1)
          cells.push({
            screenhostId: venue?.id ?? '',
            dayOfWeek: dow,
            hour: h,
            estimatedImpressions: 100,
          });
      await db.insert(screenhostAffluence).values(bothHalves(cells));
      await db.insert(recharges).values({
        advertiserId: advertiser,
        amountTnd: '1000',
        status: 'confirmed',
        reference: `CPM2-${seq}-${advertiser.slice(0, 8)}`,
      });
      const [creative] = await db
        .insert(creatives)
        .values({
          advertiserId: advertiser,
          creativeType: 'video',
          storageKey: `creatives/cpm2/${seq}`,
          durationSeconds: 20,
          validationStatus: 'approved',
        })
        .returning({ id: creatives.id });
      const s0 = premiereDateDisponible(
        new Date(),
        (await getDispatchConfig()).campaignLeadWorkingDays,
      );

      /** A dated, targeted draft with the 20 s creative (no budget yet). */
      const prepared = async (name: string, offset: number): Promise<string> => {
        const id = await createDraft(advertiser, name);
        await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sectorId });
        const start = plusCalendarDays(s0, offset);
        const res = await edit(advertiser, id, {
          start_date: start,
          end_date: plusCalendarDays(start, 1),
          creative_id: creative?.id,
        });
        expect(res.statusCode).toBe(200);
        return id;
      };
      const cmaxOf = async (id: string) => {
        mockSession(advertiser, 'advertiser');
        const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}/cmax` });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { c_max_tnd: number; i_max_facturable: number };
        return { c_max_tnd: body.c_max_tnd, i_max_facturable: body.i_max_facturable };
      };

      // Three campaigns exist BEFORE the admin change: A (submit → admin activation), C (the
      // cart, whose approved spot activates at confirm) and D (the synthetic dispatch trigger).
      const a = await prepared('A — soumise', 0);
      const c = await prepared('C — panier', 3);
      const d = await prepared('D — déclencheur', 6);
      const before = await cmaxOf(a);
      expect(before).toEqual({ c_max_tnd: 315, i_max_facturable: 21_000 });

      mockSession(admin, 'admin');
      const saved = await app.inject({
        method: 'PATCH',
        url: '/api/admin/dispatch-config',
        payload: { t_10s: 0.5, t_20s: 0.65, t_30s: 0.9 },
      });
      expect(saved.statusCode).toBe(200);

      // A is edited AFTER the change: its ceiling does not move, so 300 TND still fits.
      expect(
        (await edit(advertiser, a, { name: 'A — éditée', requested_budget: 300 })).statusCode,
      ).toBe(200);
      expect(await cmaxOf(a)).toEqual(before);
      mockSession(advertiser, 'advertiser');
      const submitted = await app.inject({ method: 'POST', url: `/api/campaigns/${a}/submit` });
      expect(submitted.statusCode).toBe(200);

      // « Hosts éligibles » prices A with its creation T.
      mockSession(admin, 'admin');
      const hosts = await app.inject({
        method: 'GET',
        url: `/api/admin/campaigns/${a}/eligible-hosts`,
      });
      expect(hosts.statusCode).toBe(200);
      const report = hosts.json() as { totals: { capacity: number; c_max_tnd: number } };
      expect(report.totals).toMatchObject({ capacity: 21_000, c_max_tnd: 315 });

      // The admin activation freezes the plan at A's creation T for S = 20.
      const activated = await app.inject({
        method: 'POST',
        url: `/api/admin/campaigns/${a}/activate`,
      });
      expect(activated.statusCode).toBe(200);
      const planA = await planOf(a);
      expect(planA?.sSpotSeconds).toBe(20);
      expect(planA?.tTierCoef).toBe('0.700');
      expect(planA?.iCible).toBe(20_000);

      // C: the cart gate and the confirm-time activation read C's own T as well.
      expect((await edit(advertiser, c, { requested_budget: 300 })).statusCode).toBe(200);
      mockSession(advertiser, 'advertiser');
      const carted = await app.inject({
        method: 'POST',
        url: '/api/cart/items',
        payload: { campaign_id: c },
      });
      expect(carted.statusCode).toBe(200);
      const confirmed = await app.inject({ method: 'POST', url: '/api/cart/confirm' });
      expect(confirmed.statusCode).toBe(200);
      expect(
        (confirmed.json() as { launched: { id: string }[] }).launched.map((x) => x.id),
      ).toEqual([c]);
      expect((await planOf(c))?.tTierCoef).toBe('0.700');

      // D: the synthetic trigger's explicit S = 10 reads D's own t_10s (0.60), not the new 0.50.
      mockSession(admin, 'admin');
      const dispatched = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${d}/dispatch`,
        payload: { i_cible: 10_000, cpm: 15, s: 10 },
      });
      expect(dispatched.statusCode).toBe(201);
      expect((dispatched.json() as { plan: { t: number } }).plan.t).toBe(0.6);
      expect((await planOf(d))?.tTierCoef).toBe('0.600');

      for (const id of [a, c, d]) {
        expect(await rowTiers(id)).toEqual({ t10: '0.600', t20: '0.700', t30: '0.800' });
      }

      // B, created AFTER the change, takes the new T end to end.
      const b = await prepared('B — nouvelle', 9);
      expect(await rowTiers(b)).toEqual({ t10: '0.500', t20: '0.650', t30: '0.900' });
      expect(await cmaxOf(b)).toEqual({ c_max_tnd: 292, i_max_facturable: 19_500 });
      expect((await edit(advertiser, b, { requested_budget: 150 })).statusCode).toBe(200);
      mockSession(advertiser, 'advertiser');
      expect(
        (await app.inject({ method: 'POST', url: `/api/campaigns/${b}/submit` })).statusCode,
      ).toBe(200);
      mockSession(admin, 'admin');
      expect(
        (await app.inject({ method: 'POST', url: `/api/admin/campaigns/${b}/activate` }))
          .statusCode,
      ).toBe(200);
      expect((await planOf(b))?.tTierCoef).toBe('0.650');
    });
  });
});
