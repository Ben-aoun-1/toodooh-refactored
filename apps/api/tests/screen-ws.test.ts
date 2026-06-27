import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { db, sql } from '../src/db/client.js';
import { type NewUser, deviceSessions, screenhosts, screens, users } from '../src/db/schema.js';
import { hashDeviceToken } from '../src/lib/device-tokens.js';
import { screenWsRoutes } from '../src/routes/screen-ws.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — a REAL listening server (raw WS can't use inject) + real Postgres. Exercises the
// authenticated handshake, CONNECTED, close codes, and HEARTBEAT liveness.
const buildWsApp = async (): Promise<{ app: FastifyInstance; port: number }> => {
  const app = Fastify({ logger: false });
  await app.register(screenWsRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, port };
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `pw${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedDeviceToken = async (
  userId: string,
  opts: { expired?: boolean; revoked?: boolean } = {},
): Promise<string> => {
  const token = randomBytes(24).toString('base64url');
  await db.insert(deviceSessions).values({
    userId,
    accessTokenHash: hashDeviceToken(token),
    refreshTokenHash: hashDeviceToken(`refresh-${token}`),
    accessExpiresAt: new Date(Date.now() + (opts.expired ? -1000 : 3_600_000)),
    refreshExpiresAt: new Date(Date.now() + 90 * 86_400_000),
    revokedAt: opts.revoked ? new Date() : null,
  });
  return token;
};

const seedOwnerWithScreen = async (): Promise<{ ownerId: string; screenId: string }> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sh] = await db.insert(screenhosts).values({ name: 'Venue', ownerId }).returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
    .returning();
  return { ownerId, screenId: screen?.id ?? '' };
};

const nextMessage = (ws: WebSocket): Promise<{ cmd: string; data: unknown }> =>
  new Promise((resolve, reject) => {
    ws.once('message', (d: Buffer) => resolve(JSON.parse(d.toString())));
    ws.once('error', reject);
    ws.once('close', (code) => reject(new Error(`closed ${String(code)}`)));
  });
const nextCloseCode = (ws: WebSocket): Promise<number> =>
  new Promise((resolve) => ws.once('close', (code) => resolve(code)));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('screen WebSocket (/ws/screen) — auth + lifecycle', () => {
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

  it('valid device token + owned screen → CONNECTED', async () => {
    const { ownerId, screenId } = await seedOwnerWithScreen();
    const token = await seedDeviceToken(ownerId);
    const ws = connect(`screen_id=${screenId}&token=${token}`);
    const msg = await nextMessage(ws);
    expect(msg).toEqual({ cmd: 'CONNECTED', data: null });
  }, 10_000);

  it('missing/bad token → closed 4401', async () => {
    const { screenId } = await seedOwnerWithScreen();
    const ws = connect(`screen_id=${screenId}&token=not-a-real-token`);
    expect(await nextCloseCode(ws)).toBe(4401);
  }, 10_000);

  it('expired token → closed 4401', async () => {
    const { ownerId, screenId } = await seedOwnerWithScreen();
    const token = await seedDeviceToken(ownerId, { expired: true });
    const ws = connect(`screen_id=${screenId}&token=${token}`);
    expect(await nextCloseCode(ws)).toBe(4401);
  }, 10_000);

  it('a screen NOT owned by the token holder → closed 4403', async () => {
    const { screenId } = await seedOwnerWithScreen(); // owned by owner A
    const otherOwner = await seedUser({ role: 'individual_owner' });
    const token = await seedDeviceToken(otherOwner); // token for owner B
    const ws = connect(`screen_id=${screenId}&token=${token}`);
    expect(await nextCloseCode(ws)).toBe(4403);
  }, 10_000);

  it('a nonexistent screen → closed 4403', async () => {
    const ownerId = await seedUser({ role: 'individual_owner' });
    const token = await seedDeviceToken(ownerId);
    const ws = connect(`screen_id=00000000-0000-0000-0000-000000000000&token=${token}`);
    expect(await nextCloseCode(ws)).toBe(4403);
  }, 10_000);

  it('HEARTBEAT updates the screen last-seen', async () => {
    const { ownerId, screenId } = await seedOwnerWithScreen();
    const token = await seedDeviceToken(ownerId);
    const ws = connect(`screen_id=${screenId}&token=${token}`);
    await nextMessage(ws); // CONNECTED
    ws.send(
      JSON.stringify({ event: 'HEARTBEAT', data: { screen_id: screenId, status: 'playing' } }),
    );

    let lastSeen: Date | null = null;
    for (let i = 0; i < 20 && lastSeen === null; i += 1) {
      await sleep(50);
      const [row] = await db
        .select({ lastSeenAt: screens.lastSeenAt })
        .from(screens)
        .where(eq(screens.id, screenId))
        .limit(1);
      lastSeen = row?.lastSeenAt ?? null;
    }
    expect(lastSeen).not.toBeNull();
  }, 10_000);

  it('a malformed message is ignored — the socket stays open', async () => {
    const { ownerId, screenId } = await seedOwnerWithScreen();
    const token = await seedDeviceToken(ownerId);
    const ws = connect(`screen_id=${screenId}&token=${token}`);
    await nextMessage(ws); // CONNECTED
    ws.send('this is not json');
    await sleep(200);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  }, 10_000);
});
