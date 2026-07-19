import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, screens, users } from '../src/db/schema.js';
import { REDISPATCH_HEARTBEAT_TOLERANCE_MS } from '../src/lib/dispatch/redispatch.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-D1 — GET /api/screenhosts/screens: the owner's devices with REAL liveness. `connected` uses
// the ONE liveness truth (E6's tolerance constant) — fresh within it → true, staler → false,
// never-seen → false. Owner-scoped: a foreign owner's devices never bleed in.

const pushSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: pushSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
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
      email: `dev${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (ownerId: string, name: string): Promise<string> => {
  const [sh] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return sh?.id ?? '';
};

const seedScreen = async (
  screenhostId: string,
  name: string,
  lastSeenAt: Date | null,
): Promise<string> => {
  const [row] = await db.insert(screens).values({ screenhostId, name, lastSeenAt }).returning();
  return row?.id ?? '';
};

interface DeviceRow {
  id: string;
  name: string;
  venue_id: string;
  venue_name: string;
  last_seen_at: string | null;
  connected: boolean;
  paired_at: string | null;
  created_at: string;
}

describe('GET /api/screenhosts/screens (CF-D1, real Postgres)', () => {
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

  const list = () => app.inject({ method: 'GET', url: '/api/screenhosts/screens' });

  it('FLEET: the owner sees all their devices across venues, grouped-orderable, no secrets', async () => {
    const me = await seedUser();
    const cafe = await seedVenue(me, 'Café Aouina');
    const gym = await seedVenue(me, 'Salle Bardo');
    await seedScreen(cafe, 'Écran 1', new Date());
    await seedScreen(gym, 'Écran 1', null);
    await seedScreen(gym, 'Écran 2', new Date());
    mockSession(me);

    const res = await list();
    expect(res.statusCode).toBe(200);
    const rows = res.json() as DeviceRow[];
    expect(rows).toHaveLength(3);
    // Ordered venue name asc, then screen name asc — stable fleet grouping.
    expect(rows.map((r) => `${r.venue_name}/${r.name}`)).toEqual([
      'Café Aouina/Écran 1',
      'Salle Bardo/Écran 1',
      'Salle Bardo/Écran 2',
    ]);
    // The payload carries liveness + identity fields ONLY — never pairing codes/tokens.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'connected',
        'created_at',
        'id',
        'last_seen_at',
        'name',
        'paired_at',
        'venue_id',
        'venue_name',
      ]);
    }
  });

  it('CONNECTED at the E6 tolerance boundary: fresh → true, stale → false, never-seen → false', async () => {
    const me = await seedUser();
    const venue = await seedVenue(me, 'Café Boundary');
    const now = Date.now();
    // 1 minute INSIDE the tolerance vs 1 minute BEYOND it.
    await seedScreen(venue, 'Fresh', new Date(now - (REDISPATCH_HEARTBEAT_TOLERANCE_MS - 60_000)));
    await seedScreen(venue, 'Stale', new Date(now - (REDISPATCH_HEARTBEAT_TOLERANCE_MS + 60_000)));
    await seedScreen(venue, 'Never', null);
    mockSession(me);

    const rows = (await list()).json() as DeviceRow[];
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('Fresh')?.connected).toBe(true);
    expect(byName.get('Stale')?.connected).toBe(false);
    expect(byName.get('Never')?.connected).toBe(false);
    expect(byName.get('Never')?.last_seen_at).toBeNull();
  });

  it('OWNER-SCOPED: a foreign owner sees none of my devices', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const mine = await seedVenue(me, 'Mon Café');
    await seedScreen(mine, 'Écran 1', new Date());
    mockSession(other);

    const rows = (await list()).json() as DeviceRow[];
    expect(rows).toEqual([]);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    expect((await list()).statusCode).toBe(401);
  });
});
