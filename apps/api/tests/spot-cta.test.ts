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
  ctaScans,
  demoScreenhosts,
  dispatchConfig,
  screenhostAffluence,
  screenhosts,
  users,
  walletAdjustments,
} from '../src/db/schema.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import { activeAllocationsForScreenhost } from '../src/lib/playout/active-allocations.js';
import { CtaBurnError, type CtaBurner } from '../src/lib/spot-cta-burn.js';
import { runCtaBurnTick } from '../src/lib/spot-cta-job.js';
import { adminDemoRoutes } from '../src/routes/admin-demo.js';
import { campaignCtaRoutes } from '../src/routes/campaign-cta.js';
import { cartRoutes } from '../src/routes/cart.js';
import { ctaRedirectRoutes } from '../src/routes/cta-redirect.js';
import { storage } from '../src/storage/s3-storage.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// QR-CTA1 (Youssef 2026-10-18) — a spot's call to action end to end on a real Postgres: the link
// is set at the spot step, a QR copy is made in the background, the campaign airs only once the
// copy is ready and then airs THE COPY, and the QR's redirect counts scans of a campaign on air.
// Storage and ffmpeg are stubbed (the burn itself is pinned by lib/spot-cta-burn's own run).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const mockSession = (userId: string, role = 'advertiser'): void => {
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
      email: `cta${seq}@example.com`,
      contactName: `User ${seq}`,
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

const seedVenue = async (ownerId: string, sector: string): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `CTA Venue ${seq}`,
      ownerId,
      businessSectorId: sector,
      openingHour: 0,
      closingHour: 23,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 0; h < 23; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

const seedDraft = async (advertiserId: string, sector: string): Promise<string> => {
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/${advertiserId}/orig-${seq}`,
      durationSeconds: 10,
      mimeType: 'video/mp4',
      validationStatus: 'approved',
      fileHash: `hash-cta-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  const today = tunisDateOf(new Date());
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Campagne QR ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: today,
      endDate: plusCalendarDays(today, 3),
      requestedBudget: '100.00',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  return id;
};

const okBurner: CtaBurner = async () => ({
  bytes: Buffer.from('burned'),
  contentType: 'video/mp4',
  extension: 'mp4',
});

const buildApp = () => Fastify({ logger: false });

describe('QR-CTA1 — a spot’s call to action (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(demoScreenhosts);
    await db.update(dispatchConfig).set({ demoDelayMinutes: 0 });
    vi.spyOn(storage, 'download').mockResolvedValue({
      body: Buffer.from('orig'),
      contentType: 'video/mp4',
    });
    vi.spyOn(storage, 'upload').mockImplementation(async ({ key }) => ({ key }));
    vi.spyOn(storage, 'delete').mockResolvedValue({ deleted: true });
    app = buildApp();
    await app.register(adminDemoRoutes);
    await app.register(cartRoutes);
    await app.register(campaignCtaRoutes);
    await app.register(ctaRedirectRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A demo screencaster (demo accounts always have the feature) on one open demo venue. */
  const world = async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    const venue = await seedVenue(owner, sector);
    await db.insert(demoScreenhosts).values({ screenhostId: venue });
    const demo = await seedUser({ isDemo: true });
    await db.insert(walletAdjustments).values({
      advertiserId: demo,
      adminId: owner,
      amountTnd: '2000.00',
      reason: 'Crédit démo',
    });
    return { owner, sector, venue, demo };
  };

  const putCta = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/api/campaigns/${id}/cta`, payload });

  const launch = async (campaignId: string) => {
    const add = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: campaignId },
    });
    if (add.statusCode !== 200) return add;
    return app.inject({ method: 'POST', url: '/api/cart/confirm' });
  };

  it('set the link → copy made in the background → the campaign airs THE COPY, scans counted', async () => {
    const w = await world();
    const id = await seedDraft(w.demo, w.sector);
    mockSession(w.demo);
    const set = await putCta(id, {
      url: 'https://boutique.example.tn/promo',
      label: 'Commandez vite',
    });
    expect(set.statusCode).toBe(200);
    const view = set.json<{ status: string; scan_url: string; label: string }>();
    expect(view).toMatchObject({ status: 'pending', label: 'Commandez vite' });
    expect(view.scan_url).toMatch(/^https:\/\/too-dooh\.com\/q\/[a-z2-9]{8}$/);

    // A copy still being made does not block the cart; the playout gate holds the campaign.
    expect((await launch(id)).statusCode).toBe(200);
    const later = new Date(Date.now() + 60_000);
    expect(await activeAllocationsForScreenhost(w.venue, later)).toEqual([]);

    expect(await runCtaBurnTick(okBurner)).toBe(1);
    const onAir = await activeAllocationsForScreenhost(w.venue, later);
    expect(onAir).toHaveLength(1);
    expect(onAir[0]?.storageKey).toMatch(/-qr-.*\.mp4$/);
    expect(await runCtaBurnTick(okBurner)).toBe(0);

    // The QR's redirect: counted (the campaign is on air), then sent on to the link.
    const code = view.scan_url.split('/q/')[1] ?? '';
    const scan = await app.inject({ method: 'GET', url: `/q/${code}` });
    expect(scan.statusCode).toBe(302);
    expect(scan.headers.location).toBe('https://boutique.example.tn/promo');
    const got = (await app.inject({ method: 'GET', url: `/api/campaigns/${id}/cta` })).json<{
      scans: number;
      status: string;
    }>();
    expect(got).toMatchObject({ scans: 1, status: 'ready' });
  });

  it('a draft’s QR redirects without counting; an unknown code goes home', async () => {
    const w = await world();
    const id = await seedDraft(w.demo, w.sector);
    mockSession(w.demo);
    const code = (await putCta(id, { url: 'https://example.tn' }))
      .json<{ scan_url: string }>()
      .scan_url.split('/q/')[1];
    const scan = await app.inject({ method: 'GET', url: `/q/${code}` });
    expect(scan.headers.location).toBe('https://example.tn/');
    expect(await db.select().from(ctaScans)).toEqual([]);
    const unknown = await app.inject({ method: 'GET', url: '/q/zzzzzzzz' });
    expect(unknown.headers.location).toBe('/');
  });

  it('a copy that could not be made blocks the cart until the link is saved again', async () => {
    const w = await world();
    const id = await seedDraft(w.demo, w.sector);
    mockSession(w.demo);
    await putCta(id, { url: 'https://example.tn' });
    const failing: CtaBurner = async () => {
      throw new CtaBurnError('SPOT_TOO_SMALL');
    };
    await runCtaBurnTick(failing);
    const add = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: id },
    });
    expect(add.statusCode).toBe(400);
    expect(JSON.stringify(add.json())).toContain('SPOT_QR_FAILED');
    // Saving again re-queues the copy.
    expect(
      (await putCta(id, { url: 'https://example.tn' })).json<{ status: string }>().status,
    ).toBe('pending');
    await runCtaBurnTick(okBurner);
    expect(
      (await app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: id } }))
        .statusCode,
    ).toBe(200);
  });

  it('changing the spot re-makes the copy; removing the link airs the plain spot', async () => {
    const w = await world();
    const id = await seedDraft(w.demo, w.sector);
    mockSession(w.demo);
    await putCta(id, { url: 'https://example.tn' });
    await runCtaBurnTick(okBurner);
    const [other] = await db
      .insert(creatives)
      .values({
        advertiserId: w.demo,
        storageKey: 'creatives/x/other',
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    await db
      .update(campaigns)
      .set({ creativeId: other?.id ?? null })
      .where(eq(campaigns.id, id));
    expect(
      (await app.inject({ method: 'GET', url: `/api/campaigns/${id}/cta` })).json<{
        status: string;
      }>().status,
    ).toBe('pending');
    expect(await runCtaBurnTick(okBurner)).toBe(1);
    const removed = await app.inject({ method: 'DELETE', url: `/api/campaigns/${id}/cta` });
    expect(removed.json()).toMatchObject({ url: null, status: null });
  });

  it('only enabled (or demo) accounts may set a link; the admin switches it on; bad input refused', async () => {
    const w = await world();
    const admin = await seedUser({ role: 'admin' });
    const real = await seedUser();
    const id = await seedDraft(real, w.sector);
    mockSession(real);
    expect((await putCta(id, { url: 'https://example.tn' })).statusCode).toBe(403);
    vi.restoreAllMocks();
    mockSession(admin, 'admin');
    const sw = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${real}/cta`,
      payload: { enabled: true },
    });
    expect(sw.json()).toEqual({ id: real, cta_enabled: true });
    vi.restoreAllMocks();
    mockSession(real);
    expect((await putCta(id, { url: 'http://example.tn' })).statusCode).toBe(400);
    expect(
      (await putCta(id, { url: 'https://example.tn', label: 'a'.repeat(21) })).statusCode,
    ).toBe(400);
    expect((await putCta(id, { url: 'https://example.tn' })).statusCode).toBe(200);
  });
});
