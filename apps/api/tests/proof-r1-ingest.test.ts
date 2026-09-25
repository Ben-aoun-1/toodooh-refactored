import { randomBytes, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
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
import { handleScreenEvent } from '../src/lib/playout/ingest.js';
import { screenWsRoutes } from '../src/routes/screen-ws.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// PROOF-R1 (operator rulings 2026-09-24: R1 A, K1 A, K2 A) — the player keeps an outbox and replays
// proofs it could not send while offline. The server: credits a replayed proof to the hour it was
// PLAYED (lib/playout/proof-instant.ts), judges airability AT that instant, counts a resent play ONCE
// (play_id), and ACKs every proof it has settled (PROOF_ACK) so the player can drop it from the outbox
// — recorded, duplicate, or rejected for good. A legacy player (no play_id) gets no ack, as before.

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: 'silent',
} as never;

const HOUR = 60 * 60 * 1000;

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
      email: `r1-${seq}@example.com`,
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
    // Allocations now default EN_ATTENTE; the airability gate requires ACCEPTE, so an aired/proof
    // scenario must seed an accepted allocation explicitly (the owner has accepted it).
    statutAcceptation: 'ACCEPTE',
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
describe('PROOF-R1 — late proofs, dedup and the ack', () => {
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

  const proofsOf = (screenId: string): Promise<ProofOfPlay[]> =>
    db.select().from(proofOfPlay).where(eq(proofOfPlay.screenId, screenId));

  const ended = (chain: Chain, over: Record<string, unknown> = {}) => ({
    event: 'VIDEO_ENDED',
    data: {
      screen_id: chain.screenId,
      video_id: chain.campaignId,
      played_duration_ms: 10_000,
      timestamp: Date.now(),
      ...over,
    },
  });

  describe("ingest (fixed receipt instant — never the run's wall clock)", () => {
    const RECEIVED = new Date('2026-09-24T12:00:00.000Z');

    it('a proof replayed 6 h late is recorded at the PLAY instant with its play_id', async () => {
      const chain = await seedChain({ startDate: '2026-09-24', endDate: '2026-09-24' });
      const playId = randomUUID();
      const playedMs = RECEIVED.getTime() - 6 * HOUR;
      const outcome = await handleScreenEvent(
        ended(chain, { play_id: playId, timestamp: playedMs }),
        { screenId: chain.screenId, screenhostId: chain.screenhostId },
        silentLog,
        RECEIVED,
      );
      expect(outcome).toEqual({ playId, status: 'recorded' });
      const [row] = await proofsOf(chain.screenId);
      expect(row?.playId).toBe(playId);
      expect(row?.playedAt?.getTime()).toBe(playedMs);
    });

    it("airability is judged at the PLAY instant: yesterday's window credits yesterday's play", async () => {
      // The campaign ended on 23/09; the play happened on 23/09 but arrives on 24/09 at 12:00 Z.
      const chain = await seedChain({ startDate: '2026-09-23', endDate: '2026-09-23' });
      const playedMs = new Date('2026-09-23T15:00:00.000Z').getTime(); // 16:00 Tunis, 21 h late
      const outcome = await handleScreenEvent(
        ended(chain, { play_id: randomUUID(), timestamp: playedMs }),
        { screenId: chain.screenId, screenhostId: chain.screenhostId },
        silentLog,
        RECEIVED,
      );
      expect(outcome?.status).toBe('recorded');
      // …while a live proof for the same campaign at the receipt instant is not airable any more.
      const late = await handleScreenEvent(
        ended(chain, { play_id: randomUUID(), timestamp: RECEIVED.getTime() }),
        { screenId: chain.screenId, screenhostId: chain.screenhostId },
        silentLog,
        RECEIVED,
      );
      expect(late?.status).toBe('rejected');
      expect(await proofsOf(chain.screenId)).toHaveLength(1);
    });

    it('a resent play (same play_id) is counted ONCE — the second is a duplicate', async () => {
      const chain = await seedChain({ startDate: '2026-09-24', endDate: '2026-09-24' });
      const msg = ended(chain, { play_id: randomUUID(), timestamp: RECEIVED.getTime() - HOUR });
      const ctx = { screenId: chain.screenId, screenhostId: chain.screenhostId };
      expect((await handleScreenEvent(msg, ctx, silentLog, RECEIVED))?.status).toBe('recorded');
      expect((await handleScreenEvent(msg, ctx, silentLog, RECEIVED))?.status).toBe('duplicate');
      expect(await proofsOf(chain.screenId)).toHaveLength(1);
    });

    it('older than 24 h: credited to the RECEIPT instant (K2 — the play is lost to its own hour)', async () => {
      const chain = await seedChain({ startDate: '2026-09-22', endDate: '2026-09-24' });
      await handleScreenEvent(
        ended(chain, { play_id: randomUUID(), timestamp: RECEIVED.getTime() - 30 * HOUR }),
        { screenId: chain.screenId, screenhostId: chain.screenhostId },
        silentLog,
        RECEIVED,
      );
      const [row] = await proofsOf(chain.screenId);
      expect(row?.playedAt?.getTime()).toBe(RECEIVED.getTime());
    });

    it('a legacy proof (no play_id) is recorded as before and gets no ack', async () => {
      const chain = await seedChain({ startDate: '2026-09-24', endDate: '2026-09-24' });
      const outcome = await handleScreenEvent(
        ended(chain, { timestamp: RECEIVED.getTime() }),
        { screenId: chain.screenId, screenhostId: chain.screenhostId },
        silentLog,
        RECEIVED,
      );
      expect(outcome).toEqual({ playId: null, status: 'recorded' });
      expect(await proofsOf(chain.screenId)).toHaveLength(1);
    });
  });

  describe('over the real socket — PROOF_ACK', () => {
    const connect = async (
      chain: Chain,
    ): Promise<{ ws: WebSocket; inbox: { cmd: string; data: unknown }[] }> => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/ws/screen?screen_id=${chain.screenId}&token=${chain.token}`,
      );
      clients.push(ws);
      const inbox: { cmd: string; data: unknown }[] = [];
      ws.on('message', (d: Buffer) => inbox.push(JSON.parse(d.toString())));
      for (let i = 0; i < 40 && inbox.length < 2; i += 1) await sleep(50);
      return { ws, inbox };
    };
    const acksIn = async (inbox: { cmd: string; data: unknown }[], n: number) => {
      for (let i = 0; i < 40 && inbox.filter((m) => m.cmd === 'PROOF_ACK').length < n; i += 1) {
        await sleep(50);
      }
      return inbox.filter((m) => m.cmd === 'PROOF_ACK').map((m) => m.data);
    };

    it('acks a recorded proof, then its resend as a duplicate', async () => {
      const chain = await seedChain();
      const { ws, inbox } = await connect(chain);
      const playId = randomUUID();
      ws.send(JSON.stringify(ended(chain, { play_id: playId })));
      ws.send(JSON.stringify(ended(chain, { play_id: playId })));
      expect(await acksIn(inbox, 2)).toEqual([
        { play_id: playId, event: 'VIDEO_ENDED', status: 'recorded' },
        { play_id: playId, event: 'VIDEO_ENDED', status: 'duplicate' },
      ]);
      expect(await proofsOf(chain.screenId)).toHaveLength(1);
    }, 10_000);

    it('a START and its END share a play_id: each is acked with its own event', async () => {
      const chain = await seedChain();
      const { ws, inbox } = await connect(chain);
      const playId = randomUUID();
      ws.send(JSON.stringify({ ...ended(chain, { play_id: playId }), event: 'VIDEO_STARTED' }));
      ws.send(JSON.stringify(ended(chain, { play_id: playId })));
      const acks = await acksIn(inbox, 2);
      expect(acks).toHaveLength(2);
      expect(acks).toEqual(
        expect.arrayContaining([
          { play_id: playId, event: 'VIDEO_STARTED', status: 'recorded' },
          { play_id: playId, event: 'VIDEO_ENDED', status: 'recorded' },
        ]),
      );
      expect(await proofsOf(chain.screenId)).toHaveLength(2);
    }, 10_000);

    it('acks a proof it will never record (not airable) as rejected — the player drops it', async () => {
      const chain = await seedChain({ campaignStatus: 'draft' });
      const { ws, inbox } = await connect(chain);
      const playId = randomUUID();
      ws.send(JSON.stringify(ended(chain, { play_id: playId })));
      expect(await acksIn(inbox, 1)).toEqual([
        { play_id: playId, event: 'VIDEO_ENDED', status: 'rejected' },
      ]);
      expect(await proofsOf(chain.screenId)).toHaveLength(0);
    }, 10_000);
  });
});
