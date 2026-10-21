import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, creatives, users } from '../src/db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND, isBelowCampaignMinimum } from '../src/lib/campaign-budget.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-U3 → FLOOR-0 (Mejri 21/10 point 5) — the 100 TND budget floor is GONE: any budget above
// 0 submits, a NULL budget is still MISSING_BUDGET, and the E5 ceiling gate speaks for itself.
// Real Postgres; session mocked. Campaigns here carry NO creative, so the E5 cmax gate is
// skipped and the floor is isolated.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
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
    .values({
      email: `budgetmin${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedDraft = async (advertiserId: string, requestedBudget: string | null) => {
  const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
  const start = premiereDateDisponible(new Date(), lead);
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Budget floor fixture',
      campaignType: 'standard',
      status: 'draft',
      startDate: start,
      endDate: plusCalendarDays(start, 1),
      requestedBudget,
    })
    .returning();
  return c?.id ?? '';
};

describe('CF-U3 — the submit budget floor (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(campaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const submit = (id: string) => app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });

  it('a budget under the old 100 TND floor submits (0.50 TND)', async () => {
    const me = await seedUser();
    const id = await seedDraft(me, '0.50');
    mockSession(me);
    const res = await submit(id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'pending' });
  });

  it('precedence: a NULL budget is still MISSING_BUDGET, never BELOW_MINIMUM', async () => {
    const me = await seedUser();
    const id = await seedDraft(me, null);
    mockSession(me);
    const res = await submit(id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MISSING_BUDGET' });
  });

  it('no floor speaks before the E5 ceiling gate: a small budget with an empty pool is BUDGET_EXCEEDS_CMAX', async () => {
    const me = await seedUser();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: me,
        creativeType: 'video',
        storageKey: `creatives/budgetmin/${seq}`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    // A creative + zero venues: C_max is 0, so even 50 TND exceeds it.
    const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
    const start = premiereDateDisponible(new Date(), lead);
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: me,
        name: 'Floor precedence',
        campaignType: 'standard',
        status: 'draft',
        startDate: start,
        endDate: plusCalendarDays(start, 1),
        requestedBudget: '50.00',
        creativeId: creative?.id ?? null,
      })
      .returning();
    mockSession(me);
    const res = await submit(c?.id ?? '');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BUDGET_EXCEEDS_CMAX' });
  });

  it('the floor is the named one-home rule: strictly above 0', () => {
    expect(MIN_CAMPAIGN_BUDGET_TND).toBe(0);
    expect(isBelowCampaignMinimum(0)).toBe(true);
    expect(isBelowCampaignMinimum(-5)).toBe(true);
    expect(isBelowCampaignMinimum(0.01)).toBe(false);
    expect(isBelowCampaignMinimum(99)).toBe(false);
  });
});
