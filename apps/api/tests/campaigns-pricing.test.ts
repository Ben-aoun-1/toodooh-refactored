import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, dispatchConfig, users } from '../src/db/schema.js';
import { isJourOuvre, premiereDateDisponible, tunisDateOf } from '../src/lib/campaign-dates.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';
import { campaignsPricingRoutes } from '../src/routes/campaigns-pricing.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. The advertiser-readable CPM surface: GET /api/campaigns/pricing-config
// projects the SAME resolved dispatch_config singleton the admin route reads (V1-default fallback via
// getDispatchConfig). Any authenticated user may read it (the CPMs price the advertiser's own
// estimate); an unauthenticated caller 401s. dispatch_config is a SEEDED singleton (migration 0026),
// NOT an auth table — resetAuthTables doesn't touch it, so the PATCH test restores 15/15 in afterEach.
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
  // CF-D1 — the lead joins the restore (its test edits the same singleton).
  await db
    .update(dispatchConfig)
    .set({ standardCpmTnd: '15.000', eventCpmTnd: '15.000', campaignLeadWorkingDays: 2 });
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
    expect(body).toEqual({
      standard_cpm_tnd: 15,
      event_cpm_tnd: 15,
      first_available_start_date: premiereDateDisponible(),
    });
  });

  it('E1 — the advertiser estimate is INDEPENDENT of the attention index T', async () => {
    // The demand-side target I_cible = ⌊budget × 1000 / CPM⌋ does not change with T — only the
    // SUPPLY-side facturable capacity does. The pricing-config response carries NO t field (the
    // exact-shape toEqual above already pins it; this makes the E1 invariant explicit) and the
    // estimate math is a pure function of budget and CPM.
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    const body = (await getPricing()).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'event_cpm_tnd',
      'first_available_start_date',
      'standard_cpm_tnd',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/t_10s|t_20s|t_30s|attention/);
    expect(Math.floor((300 * 1000) / (body['standard_cpm_tnd'] as number))).toBe(20000);
  });

  it('carries the CF-Q2 start floor: an ISO working day ≥2 calendar days out', async () => {
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    const body = (await getPricing()).json() as { first_available_start_date: string };
    expect(body.first_available_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isJourOuvre(body.first_available_start_date)).toBe(true);
    expect(body.first_available_start_date > new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('CF-D1 — first_available_start_date follows the configured lead (2 → floor; 1 → next working day)', async () => {
    // Default lead 2: the wire floor equals the lib's default computation (pinned exactly above).
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    let body = (await getPricing()).json() as { first_available_start_date: string };
    expect(body.first_available_start_date).toBe(premiereDateDisponible(new Date(), 2));

    // Admin drops the lead to its floor, 1 (LEAD-1: 0 is refused)…
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/admin/dispatch-config',
      payload: { campaign_lead_working_days: 1 },
    });
    expect(patched.statusCode).toBe(200);

    // …and the advertiser floor is the next working day — never TODAY (the wizard consumes this).
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    body = (await getPricing()).json() as { first_available_start_date: string };
    expect(body.first_available_start_date).toBe(premiereDateDisponible(new Date(), 1));
    expect(body.first_available_start_date > tunisDateOf(new Date())).toBe(true);
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
    expect(body.event_cpm_tnd).toBe(15);
  });
});
