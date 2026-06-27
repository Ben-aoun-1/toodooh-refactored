import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  type ProofOfPlay,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  deviceSessions,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { hashDeviceToken } from '../src/lib/device-tokens.js';
import { screenWsRoutes } from '../src/routes/screen-ws.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — proof-of-play ingest. A connected screen reports VIDEO_STARTED/VIDEO_ENDED; each is
// resolved to its (campaign, creative) for the screenhost and persisted to proof_of_play.
const buildWsApp = async (): Promise<{ app: FastifyInstance; port: number }> => {
  const app = Fastify({ logger: false });
  await app.register(screenWsRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, port: typeof addr === 'object' && addr ? addr.port : 0 };
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `pp${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface Chain {
  screenId: string;
  screenhostId: string;
  token: string;
  campaignId: string;
  creativeId: string;
}
// The chain is seeded fully airable by default (ACCEPTE allocation + active campaign + approved
// creative + open window). Overrides let a test flip ONE gate input to prove the proof-ingest gate
// is identical to the playout gate (a non-airable campaign records NO proof).
interface SeedOverrides {
  campaignStatus?: 'draft' | 'pending' | 'active' | 'rejected';
  validationStatus?: 'pending' | 'approved' | 'rejected';
  startDate?: string;
  endDate?: string;
}
const seedChain = async (overrides: SeedOverrides = {}): Promise<Chain> => {
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db.insert(screenhosts).values({ name: 'Venue', ownerId: owner }).returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(deviceSessions).values({
    userId: owner,
    accessTokenHash: hashDeviceToken(token),
    refreshTokenHash: hashDeviceToken(`r-${token}`),
    accessExpiresAt: new Date(Date.now() + 3_600_000),
    refreshExpiresAt: new Date(Date.now() + 90 * 86_400_000),
  });
  const advertiser = await seedUser({ role: 'advertiser' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/${advertiser}/c`,
      durationSeconds: 30,
      validationStatus: overrides.validationStatus ?? 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: 'Promo',
      campaignType: 'standard',
      status: overrides.campaignStatus ?? 'active',
      startDate: overrides.startDate ?? '2020-01-01',
      endDate: overrides.endDate ?? '2999-12-31',
      creativeId: creative?.id,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: 20000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.8',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel: 20000,
    rI: 5,
    revenuPrevisionnel: '200',
    creneaux: [],
  });
  return {
    screenId: screen?.id ?? '',
    screenhostId: sh?.id ?? '',
    token,
    campaignId: campaign?.id ?? '',
    creativeId: creative?.id ?? '',
  };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nextMessage = (ws: WebSocket): Promise<{ cmd: string }> =>
  new Promise((resolve, reject) => {
    ws.once('message', (d: Buffer) => resolve(JSON.parse(d.toString())));
    ws.once('error', reject);
  });

const waitProof = async (screenId: string): Promise<ProofOfPlay[]> => {
  for (let i = 0; i < 30; i += 1) {
    const rows = await db.select().from(proofOfPlay).where(eq(proofOfPlay.screenId, screenId));
    if (rows.length > 0) return rows;
    await sleep(50);
  }
  return [];
};

describe('screen WebSocket — proof-of-play ingest', () => {
  let app: FastifyInstance;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    ({ app, port } = await buildWsApp());
  });
  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    await app.close();
  });
  afterAll(async () => {
    await sql.end();
  });

  const connectAndDrain = async (chain: Chain): Promise<WebSocket> => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/screen?screen_id=${chain.screenId}&token=${chain.token}`,
    );
    clients.push(ws);
    await nextMessage(ws); // CONNECTED
    await nextMessage(ws); // UPDATE_PLAYLIST
    return ws;
  };

  it('VIDEO_ENDED → a proof_of_play row with the resolved campaign/creative + played_duration_ms', async () => {
    const chain = await seedChain();
    const ws = await connectAndDrain(chain);
    ws.send(
      JSON.stringify({
        event: 'VIDEO_ENDED',
        data: {
          screen_id: chain.screenId,
          video_id: chain.campaignId,
          played_duration_ms: 12345,
          timestamp: Date.now(),
        },
      }),
    );
    const rows = await waitProof(chain.screenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      screenhostId: chain.screenhostId,
      campaignId: chain.campaignId,
      creativeId: chain.creativeId,
      videoIdAsSent: chain.campaignId,
      eventType: 'VIDEO_ENDED',
      playedDurationMs: 12345,
    });
    expect(rows[0]?.eventTs).not.toBeNull();
  }, 10_000);

  it('VIDEO_STARTED → a proof row with null played_duration_ms', async () => {
    const chain = await seedChain();
    const ws = await connectAndDrain(chain);
    ws.send(
      JSON.stringify({
        event: 'VIDEO_STARTED',
        data: { screen_id: chain.screenId, video_id: chain.campaignId, timestamp: Date.now() },
      }),
    );
    const rows = await waitProof(chain.screenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('VIDEO_STARTED');
    expect(rows[0]?.playedDurationMs).toBeNull();
  }, 10_000);

  it('a VIDEO_ENDED for a campaign NOT allocated to the screenhost is ignored (no proof)', async () => {
    const chain = await seedChain();
    const ws = await connectAndDrain(chain);
    // A syntactically valid but unallocated campaign id.
    ws.send(
      JSON.stringify({
        event: 'VIDEO_ENDED',
        data: {
          screen_id: chain.screenId,
          video_id: '11111111-1111-1111-1111-111111111111',
          played_duration_ms: 999,
        },
      }),
    );
    await sleep(400);
    const rows = await db
      .select()
      .from(proofOfPlay)
      .where(and(eq(proofOfPlay.screenId, chain.screenId)));
    expect(rows).toHaveLength(0);
  }, 10_000);

  // The proof-ingest gate is IDENTICAL to the playout gate: a campaign the screen was never
  // authorized to air records NO proof, even though it is dispatch-allocated to the screenhost.
  const expectNoProof = async (overrides: SeedOverrides): Promise<void> => {
    const chain = await seedChain(overrides);
    const ws = await connectAndDrain(chain);
    ws.send(
      JSON.stringify({
        event: 'VIDEO_ENDED',
        data: { screen_id: chain.screenId, video_id: chain.campaignId, played_duration_ms: 5000 },
      }),
    );
    await sleep(400);
    const rows = await db
      .select()
      .from(proofOfPlay)
      .where(eq(proofOfPlay.screenId, chain.screenId));
    expect(rows).toHaveLength(0);
  };

  it('non-active campaign (allocated, approved, in-window) → no proof', async () => {
    await expectNoProof({ campaignStatus: 'pending' });
  }, 10_000);

  it('unapproved creative → no proof', async () => {
    await expectNoProof({ validationStatus: 'pending' });
  }, 10_000);

  it('out-of-window campaign → no proof', async () => {
    await expectNoProof({ startDate: '2020-01-01', endDate: '2020-12-31' });
  }, 10_000);

  it('an absurd played_duration_ms is clamped to the creative-duration ceiling', async () => {
    const chain = await seedChain(); // creative is 30s → ceiling 30 × 1000 × 2 = 60_000 ms
    const ws = await connectAndDrain(chain);
    ws.send(
      JSON.stringify({
        event: 'VIDEO_ENDED',
        data: {
          screen_id: chain.screenId,
          video_id: chain.campaignId,
          played_duration_ms: 999_999_999,
        },
      }),
    );
    const rows = await waitProof(chain.screenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.playedDurationMs).toBe(60_000);
  }, 10_000);
});
