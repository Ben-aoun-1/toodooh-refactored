import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, dispatchConfig, users } from '../src/db/schema.js';
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. The CPM-config surface: GET reads the seeded singleton; PATCH edits
// the admin-editable CPMs (standard/event). dispatch_config is a SEEDED singleton (migration 0026),
// NOT an auth table — resetAuthTables doesn’t touch it, so each test restores 15/15 in afterEach so
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
  // E1 — the T buckets join the per-test restore (their tests edit the same singleton).
  // CF-D1 — so does the campaign lead.
  await db.update(dispatchConfig).set({
    standardCpmTnd: '15.000',
    eventCpmTnd: '15.000',
    t10s: '0.60',
    t20s: '0.70',
    t30s: '0.80',
    campaignLeadWorkingDays: 2,
  });
};

describe('admin dispatch-config — CPM read/edit (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    // E4 fixture repair: pin the entry state too — the first test used to inherit whatever the
    // previous FILE left on the shared singleton (the restore only ran in afterEach).
    await restoreCpmDefaults();
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
    expect(body.event_cpm_tnd).toBe(15);
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
    expect(body.event_cpm_tnd).toBe(15);
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

  // ── E1 — the attention T knobs (t_10s/t_20s/t_30s) ─────────────────────────────
  it('GET exposes the T buckets at their VF defaults; PATCH edits them (persisted)', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const before = (await get()).json() as { t_10s: number; t_20s: number; t_30s: number };
    expect(before).toMatchObject({ t_10s: 0.6, t_20s: 0.7, t_30s: 0.8 });

    const res = await patch({ t_10s: 0.5, t_20s: 0.65, t_30s: 0.9 });
    expect(res.statusCode).toBe(200);
    const after = (await get()).json() as { t_10s: number; t_20s: number; t_30s: number };
    expect(after).toMatchObject({ t_10s: 0.5, t_20s: 0.65, t_30s: 0.9 });
  });

  it('rejects T out of (0, 1] — zero, negative, above one (400)', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    expect((await patch({ t_10s: 0 })).statusCode).toBe(400);
    expect((await patch({ t_20s: -0.5 })).statusCode).toBe(400);
    expect((await patch({ t_30s: 1.01 })).statusCode).toBe(400);
    expect((await patch({ t_30s: 1 })).statusCode).toBe(200); // 1 is the inclusive ceiling
  });

  it('rejects nonsense ORDERINGS — including a partial patch judged on the MERGED config', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    // Full-body nonsense: t_10s > t_20s.
    expect((await patch({ t_10s: 0.9, t_20s: 0.7, t_30s: 0.8 })).statusCode).toBe(400);
    // Partial nonsense: t_10s alone above the CURRENT t_20s (0.7) — merged validation catches it.
    expect((await patch({ t_10s: 0.75 })).statusCode).toBe(400);
    // Partial sense: t_10s alone below the current t_20s passes.
    expect((await patch({ t_10s: 0.55 })).statusCode).toBe(200);
    // Nothing written on a rejected ordering: the failed 0.75 never landed.
    const cfg = (await get()).json() as { t_10s: number };
    expect(cfg.t_10s).toBe(0.55);
  });

  // ── GREEN1 item 4 — the E7 reversement split on the admin surface (Σ = 100) ─────
  it('GET exposes the four reversement percentages at their canonical 50/44/3/3', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    expect((await get()).json()).toMatchObject({
      pct_sh: 50,
      pct_toodooh: 44,
      pct_agent_sh: 3,
      pct_agent_sc: 3,
    });
  });

  it('PATCH edits the split when it still totals 100, and the next GET reflects it', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    // 55 + 39 + 3 + 3 = 100
    expect((await patch({ pct_sh: 55, pct_toodooh: 39 })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ pct_sh: 55, pct_toodooh: 39 });
  });

  it('refuses a split that does not total 100 — in FRENCH, judged on the MERGED config', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    // Pin a known baseline first: this file's tests share the singleton, so the merged sum must
    // not depend on what an earlier test left behind.
    expect(
      (await patch({ pct_sh: 50, pct_toodooh: 44, pct_agent_sh: 3, pct_agent_sc: 3 })).statusCode,
    ).toBe(200);

    // A partial patch cannot be judged alone: 60 merged over the stored 44/3/3 sums to 110.
    const res = await patch({ pct_sh: 60 });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { fields: { field: string; reason: string }[] };
    expect(body.fields[0]?.reason).toContain(
      'les pourcentages de reversement doivent totaliser 100',
    );
    expect(body.fields[0]?.reason).toContain('110');

    // The refusal is not a write: the stored split is untouched.
    expect((await get()).json()).toMatchObject({ pct_sh: 50, pct_toodooh: 44 });
  });

  // ── CF-D1 — the campaign start-date lead (campaign_lead_working_days) ───────────
  it('GET exposes the lead at its migration default (2); PATCH edits it — 0 included', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const before = (await get()).json() as { campaign_lead_working_days: number };
    expect(before.campaign_lead_working_days).toBe(2);

    expect((await patch({ campaign_lead_working_days: 5 })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ campaign_lead_working_days: 5 });

    // 0 is a LEGAL value (floor = today, field tests) — the min bound is inclusive.
    expect((await patch({ campaign_lead_working_days: 0 })).statusCode).toBe(200);
    expect((await get()).json()).toMatchObject({ campaign_lead_working_days: 0 });
  });

  it('rejects a lead out of [0, 30] or non-integer (400); 30 is the inclusive ceiling', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    expect((await patch({ campaign_lead_working_days: -1 })).statusCode).toBe(400);
    expect((await patch({ campaign_lead_working_days: 31 })).statusCode).toBe(400);
    expect((await patch({ campaign_lead_working_days: 2.5 })).statusCode).toBe(400);
    expect((await patch({ campaign_lead_working_days: 30 })).statusCode).toBe(200);
  });

  it('CPM regression — CPM edits are unchanged and never touch the T buckets', async () => {
    mockSession(await seedUser({ role: 'admin' }));
    const res = await patch({ standard_cpm_tnd: 17 });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { standard_cpm_tnd: number; t_10s: number; t_30s: number };
    expect(body.standard_cpm_tnd).toBe(17);
    expect(body.t_10s).toBe(0.6);
    expect(body.t_30s).toBe(0.8);
  });
});
