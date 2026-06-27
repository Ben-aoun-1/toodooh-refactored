import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  deviceSessions,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { hashDeviceToken } from '../src/lib/device-tokens.js';
import { screenWsRoutes } from '../src/routes/screen-ws.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — a real listening server + real Postgres. A connected screen receives an
// UPDATE_PLAYLIST built from its screenhost's active dispatch allocations (approved creatives,
// presigned urls). Presign signs OFFLINE (no MinIO object needed).
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
      email: `pl${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedToken = async (userId: string): Promise<string> => {
  const token = randomBytes(24).toString('base64url');
  await db.insert(deviceSessions).values({
    userId,
    accessTokenHash: hashDeviceToken(token),
    refreshTokenHash: hashDeviceToken(`r-${token}`),
    accessExpiresAt: new Date(Date.now() + 3_600_000),
    refreshExpiresAt: new Date(Date.now() + 90 * 86_400_000),
  });
  return token;
};

const nextMessage = (ws: WebSocket): Promise<{ cmd: string; data: unknown }> =>
  new Promise((resolve, reject) => {
    ws.once('message', (d: Buffer) => resolve(JSON.parse(d.toString())));
    ws.once('error', reject);
    ws.once('close', (code) => reject(new Error(`closed ${String(code)}`)));
  });

interface PlaylistData {
  videos: { id: string; url: string; campaign_name: string; duration_seconds: number | null }[];
  loop: boolean;
}

describe('screen WebSocket — UPDATE_PLAYLIST from dispatch allocations', () => {
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

  const connect = (qs: string): WebSocket => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/screen?${qs}`);
    clients.push(ws);
    return ws;
  };

  it('pushes a playlist of the screenhost’s active, approved, allocated creatives', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db.insert(screenhosts).values({ name: 'Venue', ownerId: owner }).returning();
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
      .returning();
    const token = await seedToken(owner);

    const advertiser = await seedUser({ role: 'advertiser' });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/${advertiser}/c1`,
        durationSeconds: 30,
        validationStatus: 'approved',
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Ramadan Promo',
        campaignType: 'standard',
        status: 'active',
        startDate: '2020-01-01',
        endDate: '2999-12-31',
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

    const ws = connect(`screen_id=${screen?.id}&token=${token}`);
    const connected = await nextMessage(ws);
    expect(connected.cmd).toBe('CONNECTED');
    const playlistMsg = await nextMessage(ws);
    expect(playlistMsg.cmd).toBe('UPDATE_PLAYLIST');
    const data = playlistMsg.data as PlaylistData;
    expect(data.loop).toBe(true);
    expect(data.videos).toHaveLength(1);
    expect(data.videos[0]?.id).toBe(campaign?.id); // id = campaign id
    expect(data.videos[0]?.campaign_name).toBe('Ramadan Promo');
    expect(data.videos[0]?.duration_seconds).toBe(30);
    expect(data.videos[0]?.url).toContain('http'); // presigned MinIO url
  }, 10_000);

  it('pushes an empty playlist when the screenhost has no active allocation', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db.insert(screenhosts).values({ name: 'Venue', ownerId: owner }).returning();
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
      .returning();
    const token = await seedToken(owner);

    const ws = connect(`screen_id=${screen?.id}&token=${token}`);
    await nextMessage(ws); // CONNECTED
    const playlistMsg = await nextMessage(ws);
    expect(playlistMsg.cmd).toBe('UPDATE_PLAYLIST');
    expect((playlistMsg.data as PlaylistData).videos).toHaveLength(0);
  }, 10_000);
});
