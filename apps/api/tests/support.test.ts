import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, notifications, supportMessages, users } from '../src/db/schema.js';
import { adminSupportRoutes } from '../src/routes/admin-support.js';
import { supportRoutes } from '../src/routes/support.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// SUP-1 (Mejri 11/09 point 8) — the support forms finally land: a row, an admin notice, a queue.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role: string, status = 'approved'): void => {
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
      email: `sup${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('SUP-1 — POST /api/support + the admin queue', () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(supportRoutes);
    await app.register(adminSupportRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const send = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/support', payload });

  it('401 without a session', async () => {
    mockNoSession();
    expect((await send({ kind: 'support', objective: 'Budget' })).statusCode).toBe(401);
  });

  it.each(['advertiser', 'individual_owner', 'fleet_owner', 'screenhost_agent'])(
    'any role can write to the support (%s) → 201, row persisted, every admin notified',
    async (role) => {
      const admin = await seedUser({ role: 'admin' });
      const me = await seedUser({ role: role as NewUser['role'], businessName: 'Société Test' });
      mockSession(me, role);
      const res = await send({ kind: 'support', objective: 'Facturation', message: 'Bonjour' });
      expect(res.statusCode).toBe(201);
      const rows = await db.select().from(supportMessages).where(eq(supportMessages.userId, me));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'support', objective: 'Facturation', status: 'new' });
      const notes = await db.select().from(notifications).where(eq(notifications.userId, admin));
      expect(notes.map((n) => n.type)).toEqual(['admin_support_message']);
      expect(notes[0]?.body).toContain('Société Test');
    },
  );

  it('an appointment carries its date; « Autre » needs a detail; a support message must not carry a date', async () => {
    const me = await seedUser({ role: 'advertiser' });
    mockSession(me, 'advertiser');
    expect(
      (await send({ kind: 'appointment', objective: 'Ciblage', appointment_date: '2026-10-05' }))
        .statusCode,
    ).toBe(201);
    expect((await send({ kind: 'appointment', objective: 'Ciblage' })).statusCode).toBe(400);
    expect((await send({ kind: 'support', objective: 'Autre' })).statusCode).toBe(400);
    expect(
      (await send({ kind: 'support', objective: 'Autre', other_detail: 'x' })).statusCode,
    ).toBe(201);
    expect(
      (await send({ kind: 'support', objective: 'Budget', appointment_date: '2026-10-05' }))
        .statusCode,
    ).toBe(400);
  });

  it('admin queue: list (filtered), handle once, 409 the second time, 404 unknown, 403 non-admin', async () => {
    const admin = await seedUser({ role: 'admin' });
    const me = await seedUser({ role: 'advertiser', contactName: 'Mariem' });
    mockSession(me, 'advertiser');
    const created = await send({ kind: 'support', objective: 'Diffusion', message: 'Hello' });
    const { id } = created.json<{ id: string }>();

    mockSession(admin, 'admin');
    const list = await app.inject({ method: 'GET', url: '/api/admin/support?status=new' });
    expect(list.statusCode).toBe(200);
    const rows = list.json<{ id: string; account_label: string; status: string }[]>();
    expect(rows.map((r) => r.id)).toContain(id);
    expect(rows.find((r) => r.id === id)?.account_label).toBe('Mariem');

    const first = await app.inject({ method: 'POST', url: `/api/admin/support/${id}/handled` });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/api/admin/support/${id}/handled` });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ currentStatus: string }>().currentStatus).toBe('handled');
    const handled = await app.inject({ method: 'GET', url: '/api/admin/support?status=handled' });
    expect(handled.json<{ id: string }[]>().map((r) => r.id)).toEqual([id]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/support/00000000-0000-0000-0000-000000000000/handled',
        })
      ).statusCode,
    ).toBe(404);

    mockSession(me, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/admin/support' })).statusCode).toBe(403);
  });
});
