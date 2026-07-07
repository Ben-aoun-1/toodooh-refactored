import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sql } from '../src/db/client.js';
import { apiRoutes } from '../src/routes/index.js';

// Integration suite — real Postgres with the Phase-1c reference seeds (governorates 24,
// business_sectors 30 = 25 advertiser + 5 owner after the 0036 canonical owner taxonomy).
// These tables are seeded, not truncated by
// resetAuthTables, so no per-test setup is needed. No auth: the routes are public (the wizard
// fetches them pre-session) — every inject below omits a cookie, which IS the public-access proof.
const buildApp = () => Fastify({ logger: false });

describe('reference-data GETs (public, real Postgres seeds)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.register(apiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('GET /api/governorates → 200, 24 rows, {id,name}, public (no cookie)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/governorates' });
    expect(res.statusCode).toBe(200);
    const rows = res.json<{ id: string; name: string }[]>();
    expect(rows).toHaveLength(24);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['id', 'name']);
    expect(typeof rows[0]?.id).toBe('string');
    expect(typeof rows[0]?.name).toBe('string');
  });

  it('GET /api/business-sectors (no param) → 200, 30 rows, {id,name,audience,display_order}', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-sectors' });
    expect(res.statusCode).toBe(200);
    const rows =
      res.json<{ id: string; name: string; audience: string; display_order: number | null }[]>();
    expect(rows).toHaveLength(30);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['audience', 'display_order', 'id', 'name']);
  });

  it('GET /api/business-sectors?audience=advertiser → 200, 25, all advertiser', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-sectors?audience=advertiser',
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json<{ audience: string }[]>();
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => r.audience === 'advertiser')).toBe(true);
  });

  it('GET /api/business-sectors?audience=owner → 200, the canonical 5 in display_order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-sectors?audience=owner' });
    expect(res.statusCode).toBe(200);
    const rows = res.json<{ name: string; audience: string }[]>();
    // Pinned by name: the 0036 canonical owner taxonomy, in display_order.
    expect(rows.map((r) => r.name)).toEqual([
      'Café',
      'Resto/Bar',
      'Resto',
      'Salle de sport',
      'Espace de loisir',
    ]);
    expect(rows.every((r) => r.audience === 'owner')).toBe(true);
  });

  it('GET /api/business-sectors?audience=bogus → 400 INVALID_INPUT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-sectors?audience=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  it('public access: both GETs succeed with NO session cookie (pre-auth signup requirement)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/governorates' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/business-sectors' })).statusCode).toBe(
      200,
    );
  });
});
