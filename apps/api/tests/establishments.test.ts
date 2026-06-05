import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { establishments, governorates, type NewUser, users } from '../src/db/schema.js';
import { establishmentsRoutes } from '../src/routes/establishments.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). requireAuth's getSession is mocked (its behavior
// lives in require-auth.test.ts); the route + requireRole('screenhost_agent') gate run against real
// rows. resetAuthTables TRUNCATE ... CASCADE on users also clears establishments (created_by FK), so
// each test starts clean.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role: string, status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `e${seq}@example.com`, contactName: `User ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

const VALID = {
  name: 'Café Central',
  latitude: 36.8065,
  longitude: 10.1815,
  screen_count: 3,
};

describe('establishments endpoints (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let agentId: string;

  beforeEach(async () => {
    await resetAuthTables();
    agentId = await seedUser({ role: 'screenhost_agent', status: 'approved' });
    app = buildApp();
    await app.register(establishmentsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/establishments', payload: body });
  const list = () => app.inject({ method: 'GET', url: '/api/establishments' });

  it('screenhost_agent creates an establishment → 201', async () => {
    mockSession(agentId, 'screenhost_agent');
    const res = await create(VALID);
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      establishment: { name: string; latitude: number; longitude: number; screen_count: number };
    }>();
    expect(body.establishment.name).toBe('Café Central');
    expect(body.establishment.latitude).toBeCloseTo(36.8065);
    expect(body.establishment.longitude).toBeCloseTo(10.1815);
    expect(body.establishment.screen_count).toBe(3);
  });

  it('created row: created_by=agent, screenhost_id null, is_active true', async () => {
    mockSession(agentId, 'screenhost_agent');
    const { establishment } = (await create(VALID)).json<{
      establishment: {
        id: string;
        created_by: string;
        screenhost_id: string | null;
        is_active: boolean;
      };
    }>();
    expect(establishment.created_by).toBe(agentId);
    expect(establishment.screenhost_id).toBeNull();
    expect(establishment.is_active).toBe(true);
    const [row] = await db
      .select()
      .from(establishments)
      .where(eq(establishments.id, establishment.id));
    expect(row?.createdBy).toBe(agentId);
    expect(row?.screenhostId).toBeNull();
    expect(row?.isActive).toBe(true);
  });

  it('GET returns only the acting agent rows, newest first', async () => {
    mockSession(agentId, 'screenhost_agent');
    await create({ ...VALID, name: 'First' });
    await create({ ...VALID, name: 'Second' });
    const body = (await list()).json<{ establishments: { name: string; created_by: string }[] }>();
    expect(body.establishments).toHaveLength(2);
    expect(body.establishments.every((e) => e.created_by === agentId)).toBe(true);
    expect(body.establishments[0]?.name).toBe('Second'); // newest first
  });

  it('a second agent does not see the first agent rows', async () => {
    mockSession(agentId, 'screenhost_agent');
    await create({ ...VALID, name: 'Agent1 Establishment' });
    const agent2 = await seedUser({ role: 'screenhost_agent', status: 'approved' });
    mockSession(agent2, 'screenhost_agent');
    const body = (await list()).json<{ establishments: unknown[] }>();
    expect(body.establishments).toHaveLength(0);
  });

  it.each([
    'advertiser',
    'individual_owner',
    'fleet_owner',
    'admin',
    'superadmin',
    'screencast_agent',
  ])('role %s → 403 on create', async (role) => {
    const id = await seedUser({ role: role as NewUser['role'], status: 'approved' });
    mockSession(id, role);
    expect((await create(VALID)).statusCode).toBe(403);
  });

  it('no session → 401 (create + list)', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await create(VALID)).statusCode).toBe(401);
    expect((await list()).statusCode).toBe(401);
  });

  it('out-of-range latitude → 400', async () => {
    mockSession(agentId, 'screenhost_agent');
    const res = await create({ ...VALID, latitude: 91 });
    expect(res.statusCode).toBe(400);
    expect(
      res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'latitude'),
    ).toBe(true);
  });

  it('out-of-range longitude → 400', async () => {
    mockSession(agentId, 'screenhost_agent');
    expect((await create({ ...VALID, longitude: -181 })).statusCode).toBe(400);
  });

  it('screen_count 0 and negative → 400', async () => {
    mockSession(agentId, 'screenhost_agent');
    expect((await create({ ...VALID, screen_count: 0 })).statusCode).toBe(400);
    expect((await create({ ...VALID, screen_count: -2 })).statusCode).toBe(400);
  });

  it('unknown governorate_id → 400', async () => {
    mockSession(agentId, 'screenhost_agent');
    const res = await create({ ...VALID, governorate_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(400);
    expect(
      res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'governorate_id'),
    ).toBe(true);
  });

  it('valid (seeded) governorate_id → 201', async () => {
    mockSession(agentId, 'screenhost_agent');
    const [gov] = await db.select({ id: governorates.id }).from(governorates).limit(1);
    const res = await create({ ...VALID, governorate_id: gov?.id });
    expect(res.statusCode).toBe(201);
    expect(
      res.json<{ establishment: { governorate_id: string } }>().establishment.governorate_id,
    ).toBe(gov?.id);
  });
});
