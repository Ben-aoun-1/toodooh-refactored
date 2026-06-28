import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, notifications, users } from '../src/db/schema.js';
import { notificationsRoutes } from '../src/routes/notifications.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `notif${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedNotification = async (
  userId: string,
  opts: { type?: string; title?: string; body?: string; readAt?: Date | null } = {},
): Promise<string> => {
  const [n] = await db
    .insert(notifications)
    .values({
      userId,
      type: opts.type ?? 'dispatch_pending',
      title: opts.title ?? 'Campagne en attente de votre acceptation',
      body: opts.body ?? 'Une campagne attend votre acceptation.',
      readAt: opts.readAt ?? null,
    })
    .returning();
  return n?.id ?? '';
};

describe('notifications (session-user-scoped, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(notificationsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── GET /api/notifications ──────────────────────────────────────────────────
  it('lists the caller’s notifications newest-first with the snake_case wire shape', async () => {
    const userId = await seedUser();
    const older = await seedNotification(userId, { title: 'Ancienne' });
    // Ensure a distinct created_at ordering.
    await db
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(notifications.id, older));
    await seedNotification(userId, { title: 'Récente' });
    mockSession(userId);

    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]?.['title']).toBe('Récente');
    expect(body[1]?.['title']).toBe('Ancienne');
    expect(Object.keys(body[0] ?? {}).sort()).toEqual([
      'body',
      'campaign_id',
      'created_at',
      'id',
      'read_at',
      'title',
      'type',
    ]);
  });

  it('returns only the caller’s own notifications, not other users’', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedNotification(me, { title: 'Mienne' });
    await seedNotification(other, { title: 'Autre' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ title: string }>;
    expect(body.map((n) => n.title)).toEqual(['Mienne']);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
  });

  // ── POST /api/notifications/:id/read ────────────────────────────────────────
  it('marks the caller’s notification read (read_at set) and returns it', async () => {
    const userId = await seedUser();
    const id = await seedNotification(userId);
    mockSession(userId);

    const res = await app.inject({ method: 'POST', url: `/api/notifications/${id}/read` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { read_at: string | null }).read_at).not.toBeNull();

    const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    expect(row?.readAt).not.toBeNull();
  });

  it('does NOT mark another user’s notification read (404, cross-user scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedNotification(other);
    mockSession(me);

    const res = await app.inject({ method: 'POST', url: `/api/notifications/${foreign}/read` });
    expect(res.statusCode).toBe(404);
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, foreign))
      .limit(1);
    expect(row?.readAt).toBeNull();
  });

  it('rejects a non-uuid id (400)', async () => {
    const userId = await seedUser();
    mockSession(userId);
    const res = await app.inject({ method: 'POST', url: '/api/notifications/not-a-uuid/read' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a missing notification', async () => {
    const userId = await seedUser();
    mockSession(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/00000000-0000-0000-0000-000000000000/read',
    });
    expect(res.statusCode).toBe(404);
  });

  it('mark-read requires authentication (401)', async () => {
    const userId = await seedUser();
    const id = await seedNotification(userId);
    mockNoSession();
    const res = await app.inject({ method: 'POST', url: `/api/notifications/${id}/read` });
    expect(res.statusCode).toBe(401);
  });
});
