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
  campaigns,
  creatives,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import {
  type CpmConfigSnapshot,
  pinCpmConfig,
  restoreCpmConfig,
  setCpmConfig,
} from './helpers/cpm-config.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';

// CPM-1 (user rule, 2026-09-17) — an admin CPM change applies ONLY to campaigns created from that
// moment on. Every existing campaign keeps the CPM in effect when it was created, whatever its
// state and however its draft is edited afterwards; a replay is a NEW campaign. The capture is the
// column DEFAULT (migration 0074), so these tests drive the real insert paths and the real readers.
// Venue affluence covers all seven days: nothing here depends on the weekday the suite runs.

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
    .values({ email: `cpm1-${seq}@example.com`, contactName: `CPM1 ${seq}`, ...values })
    .returning({ id: users.id });
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

/** One premium venue (approved owner, 8–18 every day, affluence 100) the targeting reaches. */
const seedVenue = async (sectorId: string): Promise<void> => {
  const ownerId = await seedUser({ role: 'individual_owner', status: 'approved' });
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `CPM1 Venue ${seq}`,
      ownerId,
      businessSectorId: sectorId,
      class: 'premium',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning({ id: screenhosts.id });
  const rows = [];
  for (let dow = 1; dow <= 7; dow += 1)
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: sh?.id ?? '', dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
};

const rowRates = async (id: string) => {
  const [row] = await db
    .select({ standard: campaigns.standardCpmTnd, event: campaigns.eventCpmTnd })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  return { standard: Number(row?.standard), event: Number(row?.event) };
};

interface Rates {
  standard_cpm_tnd: number;
  event_cpm_tnd: number;
}
const ratesOf = (body: unknown): Rates => {
  const b = body as Partial<Rates>;
  return { standard_cpm_tnd: Number(b.standard_cpm_tnd), event_cpm_tnd: Number(b.event_cpm_tnd) };
};

const buildApp = () => Fastify({ logger: false });

describe('CPM-1 — a campaign keeps the CPM in effect when it was created (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let pinned: CpmConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('15.000', '15.000');
    app = buildApp();
    await app.register(campaignsRoutes);
    await app.register(adminCampaignsRoutes);
    await app.register(adminDispatchConfigRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await restoreCpmConfig(pinned);
  });

  afterAll(async () => {
    await sql.end();
  });

  const adminSetsCpm = async (adminId: string, standard: number, event: number) => {
    mockSession(adminId, 'admin');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/dispatch-config',
      payload: { standard_cpm_tnd: standard, event_cpm_tnd: event },
    });
    expect(res.statusCode).toBe(200);
  };

  describe('the capture — the trigger copies the screencaster’s CPM at INSERT time', () => {
    it('CPM-3 — a new row captures its SCREENCASTER’s CPM; a default change touches neither', async () => {
      const advertiser = await seedUser(); // created at the pinned default 15 / 15
      const [first] = await db
        .insert(campaigns)
        .values({ advertiserId: advertiser, name: 'Avant', campaignType: 'standard' })
        .returning();
      expect(first?.standardCpmTnd).toBe('15.000');
      expect(first?.eventCpmTnd).toBe('15.000');

      await setCpmConfig('20.000', '30.000');
      expect(await rowRates(first?.id ?? '')).toEqual({ standard: 15, event: 15 });
      const [second] = await db
        .insert(campaigns)
        .values({ advertiserId: advertiser, name: 'Après', campaignType: 'standard' })
        .returning();
      expect(second?.standardCpmTnd).toBe('15.000'); // the default is only for NEW screencasters
      expect(second?.eventCpmTnd).toBe('15.000');

      const newcomer = await seedUser(); // created after the default moved
      const [third] = await db
        .insert(campaigns)
        .values({ advertiserId: newcomer, name: 'Nouveau', campaignType: 'standard' })
        .returning();
      expect(third?.standardCpmTnd).toBe('20.000');
      expect(third?.eventCpmTnd).toBe('30.000');
    });

    it('with no dispatch_config row a new screencaster — and its campaign — start at 15 / 15', async () => {
      await setCpmConfig('20.000', '30.000');
      const rollback = new Error('rollback');
      await expect(
        sql.begin(async (tx) => {
          await tx`delete from dispatch_config`;
          const [u] = await tx<{ id: string }[]>`
            insert into users (email, contact_name) values ('cpm3-noconfig@example.com', 'Sans config')
            returning id`;
          const [row] = await tx<{ standard: string; event: string }[]>`
            insert into campaigns (advertiser_id, name, campaign_type)
            values (${u?.id ?? ''}, 'Sans config', 'standard')
            returning standard_cpm_tnd::text as standard, event_cpm_tnd::text as event`;
          expect(row).toEqual({ standard: '15.000', event: '15.000' });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });

    it('a draft edit never re-prices — the CPM fields are not part of the edit contract', async () => {
      const advertiser = await seedUser();
      mockSession(advertiser, 'advertiser');
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        payload: { name: 'Brouillon', campaign_type: 'standard' },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as { id: string }).id;
      const only = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        payload: { standard_cpm_tnd: 1, event_cpm_tnd: 1 },
      });
      expect(only.statusCode).toBe(400); // stripped → an empty edit
      const mixed = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        payload: { name: 'Renommé', standard_cpm_tnd: 1, event_cpm_tnd: 1 },
      });
      expect(mixed.statusCode).toBe(200);
      expect(ratesOf(mixed.json())).toEqual({ standard_cpm_tnd: 15, event_cpm_tnd: 15 });
      expect(await rowRates(id)).toEqual({ standard: 15, event: 15 });
    });
  });

  describe('the rule end to end — every reader of an existing campaign prices at its own CPM', () => {
    it('draft at 15 → admin moves the CPMs to 20 / 30 → the draft is edited → 15 everywhere, activation included', async () => {
      const admin = await seedUser({ role: 'admin', status: 'approved' });
      const advertiser = await seedUser({ role: 'advertiser', status: 'approved' });
      const sectorId = await ownerSectorId();
      await seedVenue(sectorId);
      await db.insert(recharges).values({
        advertiserId: advertiser,
        amountTnd: '500',
        status: 'confirmed',
        reference: `CPM1-${seq}-${advertiser.slice(0, 8)}`,
      });
      const [creative] = await db
        .insert(creatives)
        .values({
          advertiserId: advertiser,
          creativeType: 'video',
          storageKey: `creatives/cpm1/${seq}`,
          durationSeconds: 20,
          validationStatus: 'approved',
        })
        .returning({ id: creatives.id });

      mockSession(advertiser, 'advertiser');
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        payload: { name: 'Été', campaign_type: 'standard' },
      });
      expect(created.statusCode).toBe(201);
      expect(ratesOf(created.json())).toEqual({ standard_cpm_tnd: 15, event_cpm_tnd: 15 });
      const id = (created.json() as { id: string }).id;
      await db
        .insert(campaignTargeting)
        .values({ campaignId: id, categoryId: sectorId, class: 'premium' });

      await adminSetsCpm(admin, 20, 30);

      // The draft is edited AFTER the change — budget, dates, creative and even its type.
      const start = premiereDateDisponible(
        new Date(),
        (await getDispatchConfig()).campaignLeadWorkingDays,
      );
      mockSession(advertiser, 'advertiser');
      const edited = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        payload: {
          campaign_type: 'event',
          requested_budget: 300,
          start_date: start,
          end_date: plusCalendarDays(start, 1),
          creative_id: creative?.id,
        },
      });
      expect(edited.statusCode).toBe(200);
      expect(ratesOf(edited.json())).toEqual({ standard_cpm_tnd: 15, event_cpm_tnd: 15 });

      // A legacy event-TYPED classic row prices at its OWN event rate (15), never the new 30.
      const [asEvent] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
      if (!asEvent?.startDate || !asEvent.endDate) throw new Error('dates missing');
      const eventTyped = await computeCampaignCmax(
        { ...asEvent, startDate: asEvent.startDate, endDate: asEvent.endDate },
        20,
      );
      expect(eventTyped.cpmTnd).toBe(15);

      const back = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        payload: { campaign_type: 'standard' },
      });
      expect(back.statusCode).toBe(200);

      // The advertiser reads.
      const one = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
      expect(ratesOf(one.json())).toEqual({ standard_cpm_tnd: 15, event_cpm_tnd: 15 });
      const mine = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
      const listed = (mine.json() as ({ id: string } & Rates)[]).find((c) => c.id === id);
      expect(ratesOf(listed)).toEqual({ standard_cpm_tnd: 15, event_cpm_tnd: 15 });

      // C_max (the cursor + the submit gate) at 15.
      const cmax = await app.inject({ method: 'GET', url: `/api/campaigns/${id}/cmax` });
      expect(cmax.statusCode).toBe(200);
      const ceiling = cmax.json() as { c_max_tnd: number; i_max_facturable: number };
      expect(ceiling.i_max_facturable).toBeGreaterThan(0);
      expect(ceiling.c_max_tnd).toBe(Math.floor((15 * ceiling.i_max_facturable) / 1000));
      const submitted = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
      expect(submitted.statusCode).toBe(200);

      // The admin reads: the review queue and « Hosts éligibles ».
      mockSession(admin, 'admin');
      const queue = await app.inject({ method: 'GET', url: '/api/admin/campaigns?status=pending' });
      const queued = (
        queue.json() as { id: string; cpm_tnd: number; derived_i_cible: number | null }[]
      ).find((c) => c.id === id);
      expect(queued?.cpm_tnd).toBe(15);
      expect(queued?.derived_i_cible).toBe(20_000); // ⌊300 × 1000 / 15⌋ — not ⌊300 × 1000 / 20⌋
      const hosts = await app.inject({
        method: 'GET',
        url: `/api/admin/campaigns/${id}/eligible-hosts`,
      });
      const report = hosts.json() as {
        cpm_tnd: number;
        totals: { capacity: number; c_max_tnd: number };
      };
      expect(report.cpm_tnd).toBe(15);
      expect(report.totals.c_max_tnd).toBe(Math.floor((15 * report.totals.capacity) / 1000));

      // The activation freezes the plan at 15.
      const activated = await app.inject({
        method: 'POST',
        url: `/api/admin/campaigns/${id}/activate`,
      });
      expect(activated.statusCode).toBe(200);
      const [plan] = await db
        .select()
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, id))
        .limit(1);
      expect(Number(plan?.cpm)).toBe(15);
      expect(plan?.iCible).toBe(20_000);
      expect(await rowRates(id)).toEqual({ standard: 15, event: 15 });
    });

    it('a draft created after the change and a replay take the NEW CPMs; the replayed source keeps its own', async () => {
      const admin = await seedUser({ role: 'admin', status: 'approved' });
      const advertiser = await seedUser({ role: 'advertiser', status: 'approved' });
      const [done] = await db
        .insert(campaigns)
        .values({
          advertiserId: advertiser,
          name: 'Passée',
          campaignType: 'standard',
          status: 'completed',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          requestedBudget: '300',
        })
        .returning({ id: campaigns.id });
      const sourceId = done?.id ?? '';

      await adminSetsCpm(admin, 20, 30);
      // CPM-3 — the global default only seeds FUTURE accounts now; a campaign captures its own
      // advertiser's CPM at insert, so pin the advertiser's own CPM to get the new rate.
      await db
        .update(users)
        .set({ cpmStandardTnd: '20.000', cpmEventTnd: '30.000' })
        .where(eq(users.id, advertiser));

      mockSession(advertiser, 'advertiser');
      const fresh = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        payload: { name: 'Nouvelle', campaign_type: 'standard' },
      });
      expect(fresh.statusCode).toBe(201);
      expect(ratesOf(fresh.json())).toEqual({ standard_cpm_tnd: 20, event_cpm_tnd: 30 });

      const replay = await app.inject({ method: 'POST', url: `/api/campaigns/${sourceId}/replay` });
      expect(replay.statusCode).toBe(201);
      expect(ratesOf(replay.json())).toEqual({ standard_cpm_tnd: 20, event_cpm_tnd: 30 });
      expect(await rowRates(sourceId)).toEqual({ standard: 15, event: 15 });
    });
  });
});
