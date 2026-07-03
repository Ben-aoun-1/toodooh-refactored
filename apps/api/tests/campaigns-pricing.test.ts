import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, dispatchConfig, users } from '../src/db/schema.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';
import { campaignsPricingRoutes } from '../src/routes/campaigns-pricing.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. The advertiser-readable CPM surface: GET /api/campaigns/pricing-config
// projects the SAME resolved dispatch_config singleton the admin route reads (V1-default fallback via
// getDispatchConfig). Any authenticated user may read it (the CPMs price the advertiser's own
// estimate); an unauthenticated caller 401s. dispatch_config is a SEEDED singleton (migration 0026),
// NOT an auth table — resetAuthTables doesn't touch it, so the PATCH test restores 15/30 in afterEach.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
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
      email: `pricing${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const restoreCpmDefaults = async (): Promise<void> => {
  await db.update(dispatchConfig).set({ standardCpmTnd: '15.000', eventCpmTnd: '30.000' });
};

describe('advertiser pricing-config — GET /api/campaigns/pricing-config (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    // Both routes on one app so the admin PATCH → advertiser GET round-trip can be exercised.
    await app.register(campaignsPricingRoutes);
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

  const getPricing = () => app.inject({ method: 'GET', url: '/api/campaigns/pricing-config' });

  it('401 for an unauthenticated caller', async () => {
    mockNoSession();
    expect((await getPricing()).statusCode).toBe(401);
  });

  it('200 with the V1-default CPMs (numbers, snake_case) for an advertiser', async () => {
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    const res = await getPricing();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { standard_cpm_tnd: number; event_cpm_tnd: number };
    expect(body).toEqual({ standard_cpm_tnd: 15, event_cpm_tnd: 30 });
  });

  it('reflects an admin CPM edit — admin PATCH then advertiser GET sees the new value', async () => {
    // Admin re-prices via the existing admin surface…
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/admin/dispatch-config',
      payload: { standard_cpm_tnd: 22 },
    });
    expect(patched.statusCode).toBe(200);

    // …and a plain advertiser reads the SAME resolved singleton.
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    const res = await getPricing();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { standard_cpm_tnd: number; event_cpm_tnd: number };
    expect(body.standard_cpm_tnd).toBe(22);
    expect(body.event_cpm_tnd).toBe(30);
  });
});
