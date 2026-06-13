import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { taxAvailabilityRoute } from '../src/routes/tax-availability.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL). The endpoint is public (signup
// wizard, pre-auth), so no session mock; the rate limiter is per-app-instance in-memory, and
// beforeEach builds a fresh app, so counters never bleed across tests. The taken matricule
// 'MATRIC123' is a valid format (^[A-Za-z0-9/]{7,20}$) so it reaches the existence lookup.

const buildApp = () => Fastify({ logger: false });

describe('POST /api/signup/tax-availability', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.insert(users).values({
      email: 'taxholder@example.com',
      contactName: 'Tax Holder',
      taxNumber: 'MATRIC123',
    });
    app = buildApp();
    await app.register(taxAvailabilityRoute);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await sql.end();
  });

  const check = (tax_number: unknown) =>
    app.inject({ method: 'POST', url: '/api/signup/tax-availability', payload: { tax_number } });

  it('unknown matricule → available: true', async () => {
    const res = await check('FREE456');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: true });
  });

  it('registered matricule → available: false', async () => {
    const res = await check('MATRIC123');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: false });
  });

  it('exact-match (case-sensitive): a different case is a different matricule → available', async () => {
    const res = await check('matric123');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: true });
  });

  it('invalid format → 400 INVALID_INPUT', async () => {
    const res = await check('bad spaces!');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  it('missing tax_number → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup/tax-availability',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('requests over the per-IP cap → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 10; i++) {
      // ≥7 chars to clear the format gate (^[A-Za-z0-9/]{7,20}$) and reach the limiter.
      expect((await check(`PROBE0${i}`)).statusCode).toBe(200);
    }
    const blocked = await check('PROBEOVERFLOW');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: string }>().error).toBe('RATE_LIMITED');
  });
});
