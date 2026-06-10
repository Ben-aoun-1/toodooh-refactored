import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { emailAvailabilityRoute } from '../src/routes/email-availability.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL). The endpoint is public
// (signup wizard, pre-auth), so no session mock; the rate limiter is per-app-instance
// in-memory, and beforeEach builds a fresh app, so counters never bleed across tests.

const buildApp = () => Fastify({ logger: false });

describe('POST /api/signup/email-availability', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.insert(users).values({ email: 'taken@example.com', contactName: 'Taken User' });
    app = buildApp();
    await app.register(emailAvailabilityRoute);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await sql.end();
  });

  const check = (email: unknown) =>
    app.inject({ method: 'POST', url: '/api/signup/email-availability', payload: { email } });

  it('unknown email → available: true', async () => {
    const res = await check('new@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: true });
  });

  it('registered email → available: false', async () => {
    const res = await check('taken@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: false });
  });

  it('case-insensitive: matches the better-auth lowercase normalization', async () => {
    const res = await check('TAKEN@Example.COM');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>()).toEqual({ available: false });
  });

  it('invalid email → 400 INVALID_INPUT', async () => {
    const res = await check('not-an-email');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  it('missing email → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup/email-availability',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('requests over the per-IP cap → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await check(`probe${i}@example.com`)).statusCode).toBe(200);
    }
    const blocked = await check('probe-overflow@example.com');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: string }>().error).toBe('RATE_LIMITED');
  });
});
