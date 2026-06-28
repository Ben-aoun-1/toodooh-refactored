import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, dispatchConfig, users } from '../src/db/schema.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. The CPM-config surface: GET reads the seeded singleton; PATCH edits
// the admin-editable CPMs (standard/event). dispatch_config is a SEEDED singleton (migration 0026),
// NOT an auth table — resetAuthTables doesn't touch it, so each test restores 15/30 in afterEach so
// the derived-activation tests (which read standard_cpm_tnd) never see a polluted value.
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
      email: `cfg${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const restoreCpmDefaults = async (): Promise<void> => {
  await db.update(dispatchConfig).set({ standardCpmTnd: '15.000', eventCpmTnd: '30.000' });
};

describe('admin dispatch-config — CPM read/edit (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminDispatchConfigRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await restoreCpmDefaults();
  });
  afterAll(async () => {
    await sql.end();
  });

  const get = () => app.inject({ method: 'GET', url: '/api/admin/dispatch-config' });
  const patch = (body: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/admin/dispatch-config', payload: body });

  it('GET returns the seeded singleton with the CPM defaults (numbers, snake_case)', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      standard_cpm_tnd: number;
      event_cpm_tnd: number;
      f_max_seconds: number;
    };
    expect(body.standard_cpm_tnd).toBe(15);
    expect(body.event_cpm_tnd).toBe(30);
    expect(body.f_max_seconds).toBe(300);
  });

  it('PATCH edits both CPMs and the next GET reflects them', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const res = await patch({ standard_cpm_tnd: 18.5, event_cpm_tnd: 42 });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { standard_cpm_tnd: number }).standard_cpm_tnd).toBe(18.5);

    const after = await get();
    const body = after.json() as { standard_cpm_tnd: number; event_cpm_tnd: number };
    expect(body.standard_cpm_tnd).toBe(18.5);
    expect(body.event_cpm_tnd).toBe(42);
  });

  it('PATCH is partial — editing only standard leaves event untouched', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const res = await patch({ standard_cpm_tnd: 20 });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { standard_cpm_tnd: number; event_cpm_tnd: number };
    expect(body.standard_cpm_tnd).toBe(20);
    expect(body.event_cpm_tnd).toBe(30);
  });

  it('PATCH rejects an empty body (400 — at least one CPM required)', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    expect((await patch({})).statusCode).toBe(400);
  });

  it('PATCH rejects a non-positive CPM (400)', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    expect((await patch({ standard_cpm_tnd: 0 })).statusCode).toBe(400);
    expect((await patch({ event_cpm_tnd: -5 })).statusCode).toBe(400);
  });

  it('403 for a non-admin on both GET and PATCH', async () => {
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    expect((await get()).statusCode).toBe(403);
    expect((await patch({ standard_cpm_tnd: 99 })).statusCode).toBe(403);
  });
});
