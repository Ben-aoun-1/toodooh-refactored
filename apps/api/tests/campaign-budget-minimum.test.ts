import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, creatives, users } from '../src/db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../src/lib/campaign-budget.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-U3 (Mejri) — the 100 TND budget floor at submit: 400 BUDGET_BELOW_MINIMUM carrying
// {minimum_tnd}, refused AFTER MISSING_BUDGET (null still maps there) and BEFORE the E5
// ceiling gate. Real Postgres; session mocked. Campaigns here carry NO creative, so the E5
// cmax gate is skipped and the floor is isolated.

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

  it('99.99 TND → 400 BUDGET_BELOW_MINIMUM carrying the floor', async () => {
    const me = await seedUser();
    const id = await seedDraft(me, '99.99');
    mockSession(me);
    const res = await submit(id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'BUDGET_BELOW_MINIMUM',
      minimum_tnd: MIN_CAMPAIGN_BUDGET_TND,
    });
    const [row] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, id));
    expect(row?.status).toBe('draft'); // the refusal never flips the status
  });

  it('exactly 100 TND passes the floor (boundary inclusive) and submits', async () => {
    const me = await seedUser();
    const id = await seedDraft(me, '100.00');
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

  it('precedence: sub-floor beats the E5 ceiling gate (empty pool would also refuse — the floor speaks first)', async () => {
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
    // A creative + zero venues: the E5 gate would 400 BUDGET_EXCEEDS_CMAX (cmax 0) — but the
    // sub-floor refusal must fire FIRST.
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
    expect(res.json()).toMatchObject({ error: 'BUDGET_BELOW_MINIMUM' });
  });

  it('the floor is the named one-home constant', () => {
    expect(MIN_CAMPAIGN_BUDGET_TND).toBe(100);
  });
});
