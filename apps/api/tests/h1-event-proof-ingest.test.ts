import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  type ProofOfPlay,
  campaigns,
  creatives,
  deviceSessions,
  eventAllocations,
  events,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { hashDeviceToken } from '../src/lib/device-tokens.js';
import { settleEventPositioning } from '../src/lib/event-playout/settlement.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { screenWsRoutes } from '../src/routes/screen-ws.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// H1 — a REAL VIDEO_ENDED for an event positioning must land in proof_of_play. EV5's settlement
// reads those rows (campaign_id = the positioning), but ingest only resolved classic dispatch
// allocations, so every report was dropped and every positioning settled as a full refund. EV5's
// own tests inserted proof rows directly, which is how the gap survived — this suite goes through
// the socket, end to end into the settlement.
//
// Clock: ingest gates on the server's wall clock and received_at defaults to now(), so the event
// is placed RELATIVE to the real instant (never a fixed date that happens to cover it):
//   • IN_BLOC   — kickoff = now + 50 min → the first pre-match bloc is [now − 10 min, now + 10 min).
//   • IN_MATCH  — kickoff = now − 30 min, end = now + 60 min → now is inside the match, where
//                 fenetreDiffusion places no bloc.

const MIN = 60_000;

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
      email: `h1-${seq}@example.com`,
      contactName: `H1 User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

type Placement = 'IN_BLOC' | 'IN_MATCH';

interface Chain {
  screenId: string;
  screenhostId: string;
  token: string;
  positioningId: string;
  creativeId: string;
  windowEnd: Date;
}

interface SeedOverrides {
  placement?: Placement;
  statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
  status?: 'active' | 'upcoming' | 'completed';
  annule?: boolean;
}

const seedChain = async (overrides: SeedOverrides = {}): Promise<Chain> => {
  const now = Date.now();
  const placement = overrides.placement ?? 'IN_BLOC';
  const kickoff = new Date(placement === 'IN_BLOC' ? now + 50 * MIN : now - 30 * MIN);
  const ends = new Date(placement === 'IN_BLOC' ? kickoff.getTime() + 120 * MIN : now + 60 * MIN);
  const grid = fenetreDiffusion(kickoff, ends);

  const ownerId = await seedUser({ role: 'individual_owner' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: `H1 Venue ${seq}`, ownerId, openingHour: 8, closingHour: 23 })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: venue?.id ?? '', name: 'TV', pairedAt: new Date('2024-01-01') })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(deviceSessions).values({
    userId: ownerId,
    accessTokenHash: hashDeviceToken(token),
    refreshTokenHash: hashDeviceToken(`r-${token}`),
    accessExpiresAt: new Date(now + 60 * MIN),
    refreshExpiresAt: new Date(now + 90 * 24 * 60 * MIN),
  });

  const advertiserId = await seedUser();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/h1/${seq}`,
      durationSeconds: 15,
      validationStatus: 'approved',
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      name: `H1 Match ${seq}`,
      type: 'sport',
      kickoffAt: kickoff,
      endsAt: ends,
      source: 'official',
      annule: overrides.annule ?? false,
    })
    .returning();
  const day = kickoff.toISOString().slice(0, 10);
  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `H1 Positionnement ${seq}`,
      campaignType: 'event',
      status: overrides.status ?? 'active',
      startDate: day,
      endDate: day,
      requestedBudget: '300.00',
      eventId: event?.id,
      creativeId: creative?.id,
    })
    .returning();
  const statut = overrides.statut ?? 'ACCEPTE';
  await db.insert(eventAllocations).values({
    campaignId: positioning?.id ?? '',
    screenhostId: venue?.id ?? '',
    blocs: grid.blocs.map((b) => ({
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      impressions: 2000,
    })),
    impressionsTotal: grid.blocs.length * 2000,
    montantTnd: '300.000',
    statut,
    ...(statut !== 'EN_ATTENTE' ? { decidedAt: new Date() } : {}),
  });

  return {
    screenId: screen?.id ?? '',
    screenhostId: venue?.id ?? '',
    token,
    positioningId: positioning?.id ?? '',
    creativeId: creative?.id ?? '',
    windowEnd: grid.windowEnd,
  };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nextMessage = (ws: WebSocket): Promise<{ cmd: string }> =>
  new Promise((resolve, reject) => {
    ws.once('message', (d: Buffer) => resolve(JSON.parse(d.toString())));
    ws.once('error', reject);
  });

const proofsFor = (positioningId: string): Promise<ProofOfPlay[]> =>
  db.select().from(proofOfPlay).where(eq(proofOfPlay.campaignId, positioningId));

const waitProof = async (positioningId: string): Promise<ProofOfPlay[]> => {
  for (let i = 0; i < 30; i += 1) {
    const rows = await proofsFor(positioningId);
    if (rows.length > 0) return rows;
    await sleep(50);
  }
  return [];
};

describe('H1 — proof-of-play ingest for event positionings (real socket)', () => {
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

  const sendEnded = (ws: WebSocket, chain: Chain, playedMs: number): void => {
    ws.send(
      JSON.stringify({
        event: 'VIDEO_ENDED',
        data: {
          screen_id: chain.screenId,
          video_id: chain.positioningId,
          played_duration_ms: playedMs,
          timestamp: Date.now(),
        },
      }),
    );
  };

  it('a VIDEO_ENDED inside a bloc records ONE proof on the positioning and its spot', async () => {
    const chain = await seedChain();
    const ws = await connectAndDrain(chain);
    sendEnded(ws, chain, 15_000);
    const rows = await waitProof(chain.positioningId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      screenId: chain.screenId,
      screenhostId: chain.screenhostId,
      campaignId: chain.positioningId,
      creativeId: chain.creativeId,
      videoIdAsSent: chain.positioningId,
      eventType: 'VIDEO_ENDED',
      playedDurationMs: 15_000,
    });
  }, 10_000);

  it('the played duration is clamped to the SPOT length ceiling (15 s × 2)', async () => {
    const chain = await seedChain();
    const ws = await connectAndDrain(chain);
    sendEnded(ws, chain, 10_000_000);
    const rows = await waitProof(chain.positioningId);
    expect(rows[0]?.playedDurationMs).toBe(30_000);
  }, 10_000);

  it('outside every bloc (during the match) → no proof', async () => {
    const chain = await seedChain({ placement: 'IN_MATCH' });
    const ws = await connectAndDrain(chain);
    sendEnded(ws, chain, 15_000);
    await sleep(500);
    expect(await proofsFor(chain.positioningId)).toHaveLength(0);
  }, 10_000);

  it.each([
    ['a REFUSE allocation', { statut: 'REFUSE' as const }],
    ['an EN_ATTENTE allocation', { statut: 'EN_ATTENTE' as const }],
    ['an annulé event', { annule: true }],
    ['a non-active positioning', { status: 'upcoming' as const }],
  ])(
    '%s → no proof (the playlist gate, not a new rule)',
    async (_label, overrides) => {
      const chain = await seedChain(overrides);
      const ws = await connectAndDrain(chain);
      sendEnded(ws, chain, 15_000);
      await sleep(500);
      expect(await proofsFor(chain.positioningId)).toHaveLength(0);
    },
    10_000,
  );

  it('END TO END: a real report settles its bloc as DELIVERED (1 of 6 → 50 delivered, 250 refunded)', async () => {
    const chain = await seedChain();
    const ws = await connectAndDrain(chain);
    sendEnded(ws, chain, 15_000);
    expect(await waitProof(chain.positioningId)).toHaveLength(1);

    const settled = await settleEventPositioning(
      chain.positioningId,
      new Date(chain.windowEnd.getTime() + MIN),
    );
    expect(settled.status).toBe('SETTLED');
    expect(settled.engagedTnd).toBe(300);
    expect(settled.deliveredTnd).toBe(50);
    expect(settled.refundTnd).toBe(250);
    expect(settled.venues?.[0]?.blocsDelivered).toBe(1);
  }, 10_000);
});
