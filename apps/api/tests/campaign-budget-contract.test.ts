import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, users } from '../src/db/schema.js';
import { premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-U1 — the budget-null contract (Mejri item 6, the phantom « 5 000 TND » on drafts): a
// campaign's requested_budget is NULL until the advertiser EXPLICITLY sets it at Validation.
// Create persists no budget; a PATCH that omits the key leaves it untouched; an explicit set (or
// re-set to any value) persists; the projections pass null through as null; and submit now
// enforces the positive-budget requirement SERVER-side (it was web-only before this lane).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `budget${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// Dates derive from the shared floor lib — never hardcoded (they must stay past the J+2 floor).
const plusDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const floorDate = (): string => premiereDateDisponible();

const readBudget = async (id: string): Promise<string | null> => {
  const [row] = await db
    .select({ requestedBudget: campaigns.requestedBudget })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  return row?.requestedBudget ?? null;
};

describe('campaign budget-null contract (CF-U1, real Postgres)', () => {
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

  const createDraft = async (withDates = true): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: {
        name: 'Budget Contract',
        campaign_type: 'standard',
        ...(withDates ? { start_date: floorDate(), end_date: plusDays(floorDate(), 20) } : {}),
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  };

  it('create-early persists NO budget: the column is NULL and the projection returns null', async () => {
    const me = await seedUser();
    mockSession(me);
    const id = await createDraft();
    expect(await readBudget(id)).toBeNull();

    const one = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect((one.json() as { requested_budget: number | null }).requested_budget).toBeNull();
    const mine = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const row = (mine.json() as { id: string; requested_budget: number | null }[]).find(
      (r) => r.id === id,
    );
    expect(row?.requested_budget).toBeNull();
  });

  it('a PATCH that OMITS the budget key leaves it untouched (save-without-touching stays null)', async () => {
    const me = await seedUser();
    mockSession(me);
    const id = await createDraft();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'Renamed, budget untouched' },
    });
    expect(res.statusCode).toBe(200);
    expect(await readBudget(id)).toBeNull();
  });

  it('an EXPLICIT set persists, a re-set to any value overwrites, an explicit null clears', async () => {
    const me = await seedUser();
    mockSession(me);
    const id = await createDraft();

    const set = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { requested_budget: 1500 },
    });
    expect(set.statusCode).toBe(200);
    expect((set.json() as { requested_budget: number }).requested_budget).toBe(1500);
    expect(await readBudget(id)).toBe('1500.00');

    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { requested_budget: 250 },
    });
    expect((reset.json() as { requested_budget: number }).requested_budget).toBe(250);
    expect(await readBudget(id)).toBe('250.00');

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { requested_budget: null },
    });
    expect((cleared.json() as { requested_budget: number | null }).requested_budget).toBeNull();
    expect(await readBudget(id)).toBeNull();
  });

  it('SUBMIT is blocked on a null budget (400 MISSING_BUDGET, stays draft) — the gate is server-side', async () => {
    const me = await seedUser();
    mockSession(me);
    const id = await createDraft(); // dates valid, budget null
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('MISSING_BUDGET');
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(row?.status).toBe('draft');
    expect(row?.submittedAt).toBeNull();
  });

  it('SUBMIT passes once the budget is explicitly set (the wizard flow end-to-end)', async () => {
    const me = await seedUser();
    mockSession(me);
    const id = await createDraft();
    await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { requested_budget: 1000 },
    });
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('pending');
  });
});
