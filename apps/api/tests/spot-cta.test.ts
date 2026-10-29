import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignTargeting,
  campaignDispatchAllocation,
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
import { screenhostsRoutes } from '../src/routes/screenhosts.js';
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
    await app.register(screenhostsRoutes);
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

  // QR-CTA2 (ruling 2026-10-27) — a PHOTO spot's QR copy is a video: the burner gets the photo's
  // diffusion length, the playlist announces the copy as a video, and the owner's preview (whose
  // web and phone viewers render by the creative's type) gets the photo itself.
  it('a photo spot airs its QR copy as a VIDEO; the owner preview keeps the photo', async () => {
    const w = await world();
    const id = await seedDraft(w.demo, w.sector);
    const [row] = await db
      .select({ creativeId: campaigns.creativeId })
      .from(campaigns)
      .where(eq(campaigns.id, id));
    await db
      .update(creatives)
      .set({ creativeType: 'photo', mimeType: 'image/jpeg', durationSeconds: 20 })
      .where(eq(creatives.id, row?.creativeId ?? ''));
    mockSession(w.demo);
    await putCta(id, { url: 'https://boutique.example.tn' });
    expect((await launch(id)).statusCode).toBe(200);
    const burn = vi.fn(okBurner);
    expect(await runCtaBurnTick(burn)).toBe(1);
    expect(burn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'photo', durationSeconds: 20 }),
    );

    const later = new Date(Date.now() + 60_000);
    const [onAir] = await activeAllocationsForScreenhost(w.venue, later);
    expect(onAir?.storageKey).toMatch(/-qr-.*\.mp4$/);
    expect(onAir?.creativeType).toBe('video');

    const [alloc] = await db
      .select({ id: campaignDispatchAllocation.id })
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.screenhostId, w.venue));
    const presign = vi
      .spyOn(storage, 'getPresignedUrl')
      .mockImplementation(async ({ key }) => ({ url: `https://s3/${key}` }));
    mockSession(w.owner, 'individual_owner');
    const preview = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/allocations/${alloc?.id ?? ''}/creative-url`,
    });
    expect(preview.statusCode).toBe(200);
    expect(presign).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: expect.stringMatching(/\/orig-\d+$/) }),
    );

    // A copy made before QR-CTA2 (an image) still airs as an image.
    await db
      .update(campaigns)
      .set({ ctaStorageKey: 'creatives/x/old-qr.png' })
      .where(eq(campaigns.id, id));
    const [old] = await activeAllocationsForScreenhost(w.venue, later);
    expect(old?.creativeType).toBe('photo');
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

  it('QR-ALL — every screencaster may set a link (not only demo accounts); bad input refused', async () => {
    const w = await world();
    const real = await seedUser();
    const id = await seedDraft(real, w.sector);
    mockSession(real);
    const view = await app.inject({ method: 'GET', url: `/api/campaigns/${id}/cta` });
    expect(view.json()).toMatchObject({ enabled: true });
    expect((await putCta(id, { url: 'http://example.tn' })).statusCode).toBe(400);
    expect(
      (await putCta(id, { url: 'https://example.tn', label: 'a'.repeat(21) })).statusCode,
    ).toBe(400);
    expect((await putCta(id, { url: 'https://example.tn' })).statusCode).toBe(200);
  });
});
