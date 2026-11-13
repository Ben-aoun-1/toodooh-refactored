import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignTargeting,
  campaigns,
  creatives,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DISP-TOURS §3.1 — the advertiser's own saves move the expiry clock (lib/campaign-expiry.ts):
// creating, editing, putting in the cart, « conserver en brouillon ». And a campaign in the cart
// is flagged on GET /api/campaigns/mine (« Mes campagnes » drops it — it shows in the cart only).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `expiry${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const LONG_AGO = new Date('2026-01-05T09:00:00Z');

const savedAt = async (id: string): Promise<Date | undefined> =>
  (
    await db
      .select({ at: campaigns.lastSavedAt })
      .from(campaigns)
      .where(eq(campaigns.id, id))
  )[0]?.at;

describe('DISP-TOURS — saves stamp the expiry clock; the cart flag on « Mes campagnes »', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(campaignsRoutes);
    await app.register(cartRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // A launchable draft over one venue open 8 h → 18 h (affluence 100), a 10 s spot.
  const seedLaunchable = async (): Promise<{ advertiser: string; id: string }> => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    const [sh] = await db
      .insert(screenhosts)
      .values({
        name: `Expiry Venue ${seq}`,
        ownerId: owner,
        businessSectorId: sector?.id ?? '',
        class: 'premium',
        openingHour: 8,
        closingHour: 18,
        broadcastCapacity: 4,
      })
      .returning();
    const rows = [];
    for (const dow of [1, 2, 3, 4, 5, 6, 7])
      for (let h = 8; h < 18; h += 1)
        rows.push({ screenhostId: sh?.id ?? '', dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
    await db.insert(screenhostAffluence).values(bothHalves(rows));
    await seedInstalledScreen(sh?.id ?? '');
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/expiry/${seq}`,
        durationSeconds: 10,
        validationStatus: 'pending',
      })
      .returning();
    const start = premiereDateDisponible(
      new Date(),
      (await getDispatchConfig()).campaignLeadWorkingDays,
    );
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: `Expiry ${seq}`,
        campaignType: 'standard',
        status: 'draft',
        startDate: start,
        endDate: plusCalendarDays(start, 6),
        requestedBudget: '200.00',
        creativeId: creative?.id ?? null,
        lastSavedAt: LONG_AGO,
      })
      .returning();
    await db
      .insert(campaignTargeting)
      .values({ campaignId: c?.id ?? '', categoryId: sector?.id ?? null, class: null });
    return { advertiser, id: c?.id ?? '' };
  };

  it('creating and editing a draft are saves', async () => {
    const advertiser = await seedUser();
    mockSession(advertiser);
    const before = Date.now();
    const created = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Brouillon', campaign_type: 'standard' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect((await savedAt(id))?.getTime()).toBeGreaterThanOrEqual(before - 1000);

    await db.update(campaigns).set({ lastSavedAt: LONG_AGO }).where(eq(campaigns.id, id));
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'Brouillon renommé' },
    });
    expect(patched.statusCode).toBe(200);
    expect((await savedAt(id))?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('a zone-only edit is a save too', async () => {
    const advertiser = await seedUser();
    mockSession(advertiser);
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Zones',
        campaignType: 'standard',
        status: 'draft',
        lastSavedAt: LONG_AGO,
      })
      .returning();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${c?.id ?? ''}`,
      payload: { zone_ids: [] },
    });
    expect(res.statusCode).toBe(200);
    expect((await savedAt(c?.id ?? ''))?.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it('the cart: adding and « conserver en brouillon » are saves; /mine flags what is in the cart', async () => {
    const { advertiser, id } = await seedLaunchable();
    mockSession(advertiser);
    const mine = async () =>
      (
        (await app.inject({ method: 'GET', url: '/api/campaigns/mine' })).json() as {
          id: string;
          in_cart: boolean;
        }[]
      ).find((c) => c.id === id);
    expect((await mine())?.in_cart).toBe(false);

    const added = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: id },
    });
    expect(added.statusCode).toBe(200);
    expect((await mine())?.in_cart).toBe(true);
    expect((await savedAt(id))?.getTime()).toBeGreaterThan(LONG_AGO.getTime());

    await db.update(campaigns).set({ lastSavedAt: LONG_AGO }).where(eq(campaigns.id, id));
    const removed = await app.inject({ method: 'DELETE', url: `/api/cart/items/${id}` });
    expect(removed.statusCode).toBe(200);
    expect((await mine())?.in_cart).toBe(false);
    expect((await savedAt(id))?.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });
});
