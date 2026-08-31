import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { taxAvailabilityRoute } from '../src/routes/tax-availability.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL). The endpoint is public (signup
// wizard, pre-auth), so no session mock; the rate limiter is per-app-instance in-memory, and
// beforeEach builds a fresh app, so counters never bleed across tests.
//
// SIGN-3 (operator ruling 2026-08-31) — the lookup compares the NORMALISED matricule. Separators
// and case are spellings, not identities: `1234567/A/M/M/000` and `1234567amm000` are the SAME
// matricule as the stored `1234567AMM000`, and each must come back TAKEN. Comparing raw strings
// (what this route did before) let a duplicate slip past the check under a different spelling.

const buildApp = () => Fastify({ logger: false });

describe('POST /api/signup/tax-availability', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.insert(users).values({
      email: 'taxholder@example.com',
      contactName: 'Tax Holder',
      taxNumber: '1234567AMM000', // the canonical stored form
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
    const res = await check('7654321XYZ000');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: true });
  });

  it('registered matricule → available: false', async () => {
    const res = await check('1234567AMM000');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: false });
  });

  // SIGN-3 — THE collision the ruling names: two spellings must not slip past each other.
  it('a different SPELLING of the registered matricule is still taken', async () => {
    for (const spelling of ['1234567/A/M/M/000', '1234567 A M M 000', '1234567amm000']) {
      const res = await check(spelling);
      expect(res.statusCode, spelling).toBe(200);
      expect(res.json<{ available: boolean }>(), spelling).toEqual({ available: false });
    }
  });

  it('invalid format → 400 INVALID_INPUT', async () => {
    expect((await check('bad spaces!')).statusCode).toBe(400);
    // The legacy lenient shapes no longer validate.
    expect((await check('MATRIC123')).statusCode).toBe(400);
    const res = await check('1234567AM000'); // two letters
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
      // Well-formed matricules so they clear the format gate and reach the limiter.
      expect((await check(`900000${i}ABC000`)).statusCode).toBe(200);
    }
    const blocked = await check('9999999ZZZ000');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: string }>().error).toBe('RATE_LIMITED');
  });
});
