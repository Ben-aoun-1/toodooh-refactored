import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { db, sql } from '../src/db/client.js';
import { deviceSessions, screenhosts, screens, users } from '../src/db/schema.js';
import { hashDeviceToken } from '../src/lib/device-tokens.js';
import { screenWsRoutes } from '../src/routes/screen-ws.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — per-socket inbound rate limit. The screen WS is a public, billing-adjacent surface;
// a sustained inbound flood must close the socket rather than be ingested unbounded.
const buildWsApp = async (): Promise<{ app: FastifyInstance; port: number }> => {
  const app = Fastify({ logger: false });
  await app.register(screenWsRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, port: typeof addr === 'object' && addr ? addr.port : 0 };
};

const nextMessage = (ws: WebSocket): Promise<{ cmd: string }> =>
  new Promise((resolve, reject) => {
    ws.once('message', (d: Buffer) => resolve(JSON.parse(d.toString())));
    ws.once('error', reject);
  });

// Minimal authed connection: owner → screenhost → screen → device session token. No campaign chain
// is needed (the flood is HEARTBEAT, which only needs a live connection).
const seedScreen = async (): Promise<{ screenId: string; token: string }> => {
  const [owner] = await db
    .insert(users)
    .values({
      email: `rl${randomBytes(4).toString('hex')}@example.com`,
      contactName: 'Owner',
      role: 'individual_owner',
      status: 'approved',
    })
    .returning();
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: 'Venue', ownerId: owner?.id ?? '' })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(deviceSessions).values({
    userId: owner?.id ?? '',
    accessTokenHash: hashDeviceToken(token),
    refreshTokenHash: hashDeviceToken(`r-${token}`),
    accessExpiresAt: new Date(Date.now() + 3_600_000),
    refreshExpiresAt: new Date(Date.now() + 90 * 86_400_000),
  });
  return { screenId: screen?.id ?? '', token };
};

describe('screen WebSocket — inbound rate limit', () => {
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

  it('a sustained inbound flood closes the socket (4429)', async () => {
    const { screenId, token } = await seedScreen();
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/screen?screen_id=${screenId}&token=${token}`,
    );
    clients.push(ws);
    await nextMessage(ws); // CONNECTED
    await nextMessage(ws); // UPDATE_PLAYLIST (empty)
    const closed = new Promise<number>((resolve) =>
      ws.once('close', (code: number) => resolve(code)),
    );
    for (let i = 0; i < 130; i += 1) ws.send(JSON.stringify({ event: 'HEARTBEAT', data: {} }));
    expect(await closed).toBe(4429);
  }, 10_000);
});
