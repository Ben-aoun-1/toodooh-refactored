import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, screens, users } from '../src/db/schema.js';
import { REDISPATCH_HEARTBEAT_TOLERANCE_MS } from '../src/lib/dispatch/redispatch.js';
import { adminScreenhostsRoutes } from '../src/routes/admin-screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. resetAuthTables TRUNCATEs users … CASCADE, which reaches
// screenhosts (FK→users) and screens (FK→screenhosts), so every test starts from an empty parc.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `adm-scr${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (values: {
  name: string;
  ownerId: string;
  isActive?: boolean;
  address?: string;
  city?: string;
  createdAt?: Date;
}): Promise<string> => {
  const [row] = await db.insert(screenhosts).values(values).returning({ id: screenhosts.id });
  return row?.id ?? '';
};

interface ScreenView {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  connected: boolean;
  last_seen_at: string | null;
  paired_at: string | null;
}
interface LocationView {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  status: 'active' | 'inactive' | 'no_screens';
  owner_id: string | null;
  owner_business_name: string | null;
  screens_count: number;
  active_screens_count: number;
  online_screens_count: number;
  created_at: string;
  screens: ScreenView[];
}
interface ListBody {
  locations: LocationView[];
  total: number;
  page: number;
  per_page: number;
}
interface OwnersBody {
  owners: { id: string; business_name: string }[];
}

afterAll(async () => {
  await sql.end();
});

describe('GET /api/admin/screenhosts (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminScreenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const list = (qs = '') => app.inject({ method: 'GET', url: `/api/admin/screenhosts${qs}` });

  // Three venues, oldest → newest: Alpha (owner A; 1 active+online screen, 1 inactive screen),
  // Beta (owner B; venue toggled OFF, 1 active screen → 'inactive'), Gamma (owner A; no screens).
  const seedParc = async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId);
    const ownerA = await seedUser({ role: 'fleet_owner', businessName: 'Café Alpha SARL' });
    const ownerB = await seedUser({ role: 'individual_owner', businessName: null });
    const t0 = new Date('2026-01-01T00:00:00Z');
    const alpha = await seedVenue({
      name: 'Alpha',
      ownerId: ownerA,
      address: '12 rue de Marseille',
      city: 'Tunis',
      createdAt: t0,
    });
    const beta = await seedVenue({
      name: 'Beta',
      ownerId: ownerB,
      isActive: false,
      city: 'Sfax',
      createdAt: new Date(t0.getTime() + 1000),
    });
    const gamma = await seedVenue({
      name: 'Gamma',
      ownerId: ownerA,
      createdAt: new Date(t0.getTime() + 2000),
    });
    await db.insert(screens).values([
      { screenhostId: alpha, name: 'Écran 1', isActive: true, lastSeenAt: new Date() },
      {
        screenhostId: alpha,
        name: 'Écran 2',
        isActive: false,
        lastSeenAt: new Date(Date.now() - REDISPATCH_HEARTBEAT_TOLERANCE_MS - 60_000),
      },
      { screenhostId: beta, name: 'Écran B', isActive: true },
    ]);
    return { ownerA, ownerB, alpha, beta, gamma };
  };

  it('403 for a non-admin', async () => {
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    expect((await list()).statusCode).toBe(403);
  });

  it('400 on an invalid filter', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    expect((await list('?status=maintenance')).statusCode).toBe(400);
    expect((await list('?per_page=0')).statusCode).toBe(400);
  });

  it('derives status, counts and liveness per venue, newest first, screens folded in', async () => {
    const { ownerA, ownerB, alpha, beta, gamma } = await seedParc();
    const res = await list();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ListBody;
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(20);
    expect(body.locations.map((l) => l.id)).toEqual([gamma, beta, alpha]);

    const [g, b, a] = body.locations;
    expect(g).toMatchObject({
      name: 'Gamma',
      status: 'no_screens',
      owner_id: ownerA,
      owner_business_name: 'Café Alpha SARL',
      screens_count: 0,
      active_screens_count: 0,
      online_screens_count: 0,
      screens: [],
    });
    // No business_name → the owner's contact name stands in.
    expect(b).toMatchObject({
      name: 'Beta',
      status: 'inactive',
      owner_id: ownerB,
      city: 'Sfax',
      screens_count: 1,
      active_screens_count: 1,
      online_screens_count: 0,
    });
    expect(b?.owner_business_name).toMatch(/^User \d+$/);
    expect(a).toMatchObject({
      name: 'Alpha',
      status: 'active',
      address: '12 rue de Marseille',
      screens_count: 2,
      active_screens_count: 1,
      online_screens_count: 1,
    });
    expect(a?.screens.map((s) => [s.name, s.status, s.connected])).toEqual([
      ['Écran 1', 'active', true],
      ['Écran 2', 'inactive', false],
    ]);
  });

  it('filters by status BEFORE pagination — total honors the filter', async () => {
    await seedParc();
    const active = (await list('?status=active')).json() as ListBody;
    expect(active.total).toBe(1);
    expect(active.locations.map((l) => l.name)).toEqual(['Alpha']);
    const none = (await list('?status=no_screens')).json() as ListBody;
    expect(none.total).toBe(1);
    expect(none.locations.map((l) => l.name)).toEqual(['Gamma']);
    const inactive = (await list('?status=inactive')).json() as ListBody;
    expect(inactive.locations.map((l) => l.name)).toEqual(['Beta']);
  });

  it('filters by owner and by a literal search over name / address / city', async () => {
    const { ownerA } = await seedParc();
    const byOwner = (await list(`?owner_id=${ownerA}`)).json() as ListBody;
    expect(byOwner.total).toBe(2);
    expect(byOwner.locations.map((l) => l.name)).toEqual(['Gamma', 'Alpha']);

    expect(
      ((await list('?search=marseille')).json() as ListBody).locations.map((l) => l.name),
    ).toEqual(['Alpha']);
    expect(((await list('?search=sfax')).json() as ListBody).locations.map((l) => l.name)).toEqual([
      'Beta',
    ]);
    // A LIKE metacharacter in the term is literal, not a wildcard.
    expect(((await list('?search=%25')).json() as ListBody).total).toBe(0);
  });

  it('paginates with an exact total', async () => {
    await seedParc();
    const p1 = (await list('?per_page=2&page=1')).json() as ListBody;
    expect(p1.total).toBe(3);
    expect(p1.locations.map((l) => l.name)).toEqual(['Gamma', 'Beta']);
    const p2 = (await list('?per_page=2&page=2')).json() as ListBody;
    expect(p2.total).toBe(3);
    expect(p2.locations.map((l) => l.name)).toEqual(['Alpha']);
    expect(p2.per_page).toBe(2);
  });
});

describe('GET /api/admin/screenhosts/owners (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminScreenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const owners = () => app.inject({ method: 'GET', url: '/api/admin/screenhosts/owners' });

  it('403 for a non-admin', async () => {
    mockSession(await seedUser({ role: 'fleet_owner' }), 'fleet_owner');
    expect((await owners()).statusCode).toBe(403);
  });

  it('lists each venue-holding owner ONCE, sorted, contact name standing in for a missing business name', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const zed = await seedUser({ role: 'fleet_owner', businessName: 'Zed Fleet' });
    const anon = await seedUser({ role: 'individual_owner', contactName: 'Amine B.' });
    await seedUser({ role: 'fleet_owner', businessName: 'No Venue Co' }); // holds nothing → absent
    await seedVenue({ name: 'V1', ownerId: zed });
    await seedVenue({ name: 'V2', ownerId: zed });
    await seedVenue({ name: 'V3', ownerId: anon });

    const res = await owners();
    expect(res.statusCode).toBe(200);
    const body = res.json() as OwnersBody;
    expect(body.owners).toEqual([
      { id: anon, business_name: 'Amine B.' },
      { id: zed, business_name: 'Zed Fleet' },
    ]);
  });
});
