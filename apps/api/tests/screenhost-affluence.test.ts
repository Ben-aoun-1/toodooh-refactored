import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhostAffluence, screenhosts, users } from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the owner identity. Affluence is
// the venue audience pattern (weekday × hour); this exercises the first READER of the write-only
// screenhost_affluence table, owner-scoped like the WiFi routes.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type AffluenceResponse = { grid: number[][]; has_data: boolean };

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
      email: `aff${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string, name = 'Café Test'): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return s?.id ?? '';
};

const seedAffluence = async (
  screenhostId: string,
  slots: { day: number; hour: number; value: number }[],
): Promise<void> => {
  if (slots.length === 0) return;
  await db.insert(screenhostAffluence).values(
    slots.map((s) => ({
      screenhostId,
      dayOfWeek: s.day,
      hour: s.hour,
      estimatedImpressions: s.value,
    })),
  );
};

describe('screenhost affluence read (owner-scoped, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
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

  const get = (id: string) =>
    app.inject({ method: 'GET', url: `/api/screenhosts/${id}/affluence` });

  it('returns a 7×24 grid with the owner’s slots placed (Monday-first)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100 }, // Monday 09h
      { day: 3, hour: 18, value: 250 }, // Wednesday 18h
      { day: 7, hour: 23, value: 40 }, // Sunday 23h
    ]);
    mockSession(me);

    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.has_data).toBe(true);
    expect(body.grid).toHaveLength(7);
    expect(body.grid.every((row) => row.length === 24)).toBe(true);
    expect(body.grid[0]?.[9]).toBe(100); // Monday=row 0
    expect(body.grid[2]?.[18]).toBe(250); // Wednesday=row 2
    expect(body.grid[6]?.[23]).toBe(40); // Sunday=row 6
    expect(body.grid[1]?.[0]).toBe(0); // untouched slot
  });

  it('returns an all-zero grid + has_data=false for a venue with no affluence', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);

    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.has_data).toBe(false);
    expect(body.grid).toHaveLength(7);
    expect(body.grid.flat().every((v) => v === 0)).toBe(true);
  });

  it('returns 404 for another owner’s screenhost (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedScreenhost(other);
    await seedAffluence(foreign, [{ day: 1, hour: 12, value: 999 }]);
    mockSession(me);

    expect((await get(foreign)).statusCode).toBe(404);
  });

  it('returns 404 for an unowned (ownerless) screenhost', async () => {
    const me = await seedUser();
    const [orphan] = await db.insert(screenhosts).values({ name: 'Orphan' }).returning();
    mockSession(me);
    expect((await get(orphan?.id ?? '')).statusCode).toBe(404);
  });

  it('rejects a non-uuid id (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    expect(
      (await app.inject({ method: 'GET', url: '/api/screenhosts/not-a-uuid/affluence' }))
        .statusCode,
    ).toBe(400);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    expect((await get('00000000-0000-0000-0000-000000000000')).statusCode).toBe(401);
  });

  it('forbids a rejected owner (403, requireActiveAccount)', async () => {
    const me = await seedUser({ status: 'rejected' });
    const sh = await seedScreenhost(me);
    mockSession(me, 'individual_owner', 'rejected');
    expect((await get(sh)).statusCode).toBe(403);
  });
});
