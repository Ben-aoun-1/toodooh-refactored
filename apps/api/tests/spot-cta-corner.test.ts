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
  demoScreenhosts,
  dispatchConfig,
  eventAllocations,
  events,
  screenhostAffluence,
  screenhosts,
  users,
  walletAdjustments,
} from '../src/db/schema.js';
import { activeEventSpots } from '../src/lib/event-playout/spots.js';
import type { BurnInput, CtaBurner } from '../src/lib/spot-cta-burn.js';
import { runCtaBurnTick } from '../src/lib/spot-cta-job.js';
import { ctaFilterGraph, ctaLayout } from '../src/lib/spot-cta-layout.js';
import { adminCampaignCtaRoutes } from '../src/routes/admin-campaign-cta.js';
import { campaignCtaRoutes } from '../src/routes/campaign-cta.js';
import { cartRoutes } from '../src/routes/cart.js';
import { storage } from '../src/storage/s3-storage.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// Mariem 04/11/2026 (Foot point 1, ruling 2A) — the QR card on a Foot spot, in the corner the
// advertiser picks (the logo's place varies), movable by the admin at the spot's validation and
// only while the campaign was never on air (a TV keeps the file it got under the campaign's id).
// The event pod airs THE COPY, and only once it is ready. Storage and ffmpeg are stubbed (the
// burn itself is pinned by tests/spot-cta-burn.test.ts).

describe('the QR card’s corner (pure)', () => {
  it('bottom-left stays the historical place; the other corners mirror its margins', () => {
    const bl = ctaLayout(1080, 1920, 'bottom_left');
    expect(bl).toEqual(ctaLayout(1080));
    expect(bl.panel).toMatchObject({ x: 72, width: 300 });
    expect(bl.panel.y + bl.panel.height).toBe(1080 - 76);

    const br = ctaLayout(1080, 1920, 'bottom_right');
    expect(br.panel.x + br.panel.width).toBe(1920 - 72);
    expect(br.panel.y).toBe(bl.panel.y);

    const tl = ctaLayout(1080, 1920, 'top_left');
    expect(tl.tile.y).toBe(76); // the tile hangs 76 px under the top edge
    expect(tl.panel.x).toBe(72);
    expect(tl.layer.y).toBe(tl.tile.y);

    const tr = ctaLayout(1080, 1920, 'top_right');
    expect(tr.panel.x).toBe(br.panel.x);
    expect(tr.tile.y).toBe(76);
    // The ffmpeg graph draws the card where the layout puts it.
    expect(ctaFilterGraph(tr, 10)).toContain(`overlay=${tr.panel.x}:${tr.panel.y}`);
  });

  it('a vertical spot keeps a right-hand card inside its narrower frame', () => {
    const v = ctaLayout(1280, 720, 'top_right');
    expect(v.panel.x).toBeGreaterThan(0);
    expect(v.panel.x + v.panel.width).toBeLessThanOrEqual(720);
  });
});

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
      email: `cta-corner${seq}@example.com`,
      contactName: `Corner ${seq}`,
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

const seedVenue = async (ownerId: string): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Corner Venue ${seq}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      openingHour: 8,
      closingHour: 23,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: id, dayOfWeek: 1, hour: 8, estimatedImpressions: 100 }));
  await seedInstalledScreen(id);
  return id;
};

/** A capturing burner: records what it was asked to burn. */
const burnsSeen: BurnInput[] = [];
const captureBurner: CtaBurner = async (input) => {
  burnsSeen.push(input);
  return { bytes: Buffer.from('burned'), contentType: 'video/mp4', extension: 'mp4' };
};

describe('the QR card on a Foot spot, in its corner (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(demoScreenhosts);
    await db.update(dispatchConfig).set({ demoDelayMinutes: 5 });
    burnsSeen.length = 0;
    vi.spyOn(storage, 'download').mockResolvedValue({
      body: Buffer.from('orig'),
      contentType: 'video/mp4',
    });
    vi.spyOn(storage, 'upload').mockImplementation(async ({ key }) => ({ key }));
    vi.spyOn(storage, 'delete').mockResolvedValue({ deleted: true });
    vi.spyOn(storage, 'getPresignedUrl').mockImplementation(async ({ key }) => ({
      url: `https://storage.test/${key}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }));
    app = Fastify({ logger: false });
    await app.register(campaignCtaRoutes);
    await app.register(adminCampaignCtaRoutes);
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

  /** A demo account's Foot positioning (2 minutes, an approved 10 s spot) on a demo venue. */
  const world = async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const venue = await seedVenue(owner);
    await db.insert(demoScreenhosts).values({ screenhostId: venue });
    const demo = await seedUser({ isDemo: true });
    await db.insert(walletAdjustments).values({
      advertiserId: demo,
      adminId: owner,
      amountTnd: '2000.00',
      reason: 'Crédit démo',
    });
    const [ev] = await db
      .insert(events)
      .values({
        name: 'Soirée Foot',
        type: 'sport',
        source: 'official',
        kickoffAt: new Date('2027-06-10T20:00:00+01:00'),
        endsAt: new Date('2027-06-10T22:00:00+01:00'),
      })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: demo,
        creativeType: 'video',
        storageKey: `creatives/${demo}/foot-${seq}`,
        durationSeconds: 10,
        mimeType: 'video/mp4',
        validationStatus: 'approved',
        fileHash: `hash-corner-${seq}-${Math.random().toString(16).slice(2)}`,
      })
      .returning();
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: demo,
        name: 'Foot avec QR',
        campaignType: 'event',
        status: 'draft',
        startDate: '2027-06-10',
        endDate: '2027-06-10',
        eventId: ev?.id ?? null,
        creativeId: creative?.id ?? null,
        eventMinutes: 2,
        requestedBudget: '15.00',
      })
      .returning();
    return { owner, venue, demo, campaignId: c?.id ?? '' };
  };

  const putCta = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/api/campaigns/${id}/cta`, payload });

  it('a Foot positioning takes a QR code in the chosen corner; its pod airs the copy once ready', async () => {
    const w = await world();
    mockSession(w.demo);
    const set = await putCta(w.campaignId, {
      url: 'https://boutique.example.tn/foot',
      label: 'Offre du match',
      position: 'top_right',
    });
    expect(set.statusCode).toBe(200); // was 400 CTA_EVENT_UNSUPPORTED
    expect(set.json()).toMatchObject({ status: 'pending', position: 'top_right' });

    // Launched while the copy is still being made: the pod holds the positioning back.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cart/items',
          payload: { campaign_id: w.campaignId },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/cart/confirm' })).statusCode).toBe(200);
    const [allocation] = await db
      .select({ blocs: eventAllocations.blocs })
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, w.campaignId));
    const first = new Date((allocation?.blocs as { start: string }[])[0]?.start ?? '');
    const inPod = new Date(first.getTime() + 10_000);
    expect(await activeEventSpots(w.venue, inPod)).toEqual([]);

    // The copy is burned in the chosen corner; the pod now airs it.
    expect(await runCtaBurnTick(captureBurner)).toBe(1);
    expect(burnsSeen.map((b) => b.position)).toEqual(['top_right']);
    const spots = await activeEventSpots(w.venue, inPod);
    expect(spots.map((s) => s.campaignId)).toEqual([w.campaignId]);
    expect(spots[0]?.storageKey).toMatch(/-qr-.*\.mp4$/);
    expect(spots[0]?.slots?.length).toBe(12); // a 10 s spot, 2 minutes: 12 plays
  });

  it('the admin sees the corner and moves it until the campaign is on air', async () => {
    const w = await world();
    mockSession(w.demo);
    await putCta(w.campaignId, { url: 'https://boutique.example.tn/foot', label: null });
    expect(await runCtaBurnTick(captureBurner)).toBe(1);

    const admin = await seedUser({ role: 'admin' });
    mockSession(admin, 'admin');
    const seen = await app.inject({
      method: 'GET',
      url: `/api/admin/campaigns/${w.campaignId}/cta`,
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({
      position: 'bottom_left',
      status: 'ready',
      position_editable: true,
    });
    expect((seen.json() as { preview_url: string }).preview_url).toMatch(/-qr-.*\.mp4$/);

    // At the review (pending): moved → a new copy in that corner, the campaign waits for it.
    await db.update(campaigns).set({ status: 'pending' }).where(eq(campaigns.id, w.campaignId));
    const moved = await app.inject({
      method: 'PUT',
      url: `/api/admin/campaigns/${w.campaignId}/cta-position`,
      payload: { position: 'bottom_right' },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ position: 'bottom_right', status: 'pending' });
    expect(await runCtaBurnTick(captureBurner)).toBe(1);
    expect(burnsSeen.map((b) => b.position)).toEqual(['bottom_left', 'bottom_right']);

    // Once on air, it no longer moves.
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, w.campaignId));
    const locked = await app.inject({
      method: 'PUT',
      url: `/api/admin/campaigns/${w.campaignId}/cta-position`,
      payload: { position: 'top_left' },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ error: 'CTA_POSITION_LOCKED' });
    expect(
      (await app.inject({ method: 'GET', url: `/api/admin/campaigns/${w.campaignId}/cta` })).json(),
    ).toMatchObject({ position: 'bottom_right', position_editable: false });
  });

  it('no QR code: nothing to move; a non-admin cannot reach the admin routes', async () => {
    const w = await world();
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin, 'admin');
    const none = await app.inject({
      method: 'PUT',
      url: `/api/admin/campaigns/${w.campaignId}/cta-position`,
      payload: { position: 'top_left' },
    });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ error: 'CTA_NONE' });
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/admin/campaigns/${w.campaignId}/cta-position`,
      payload: { position: 'middle' },
    });
    expect(bad.statusCode).toBe(400);
    mockSession(w.demo);
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/admin/campaigns/${w.campaignId}/cta`,
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
