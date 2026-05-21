import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { authPlugin } from '../src/auth/plugin.js';
import { db, sql } from '../src/db/client.js';
import { accounts, users } from '../src/db/schema.js';
import { logger } from '../src/logger.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL env). The only
// DB-writing test file; beforeEach truncates for isolation.

const buildApp = () => Fastify({ logger: false });

const validPayload = {
  email: 'owner@example.com',
  password: 'a-strong-passw0rd',
  name: 'Test Owner',
  business_name: 'Test Biz',
  contact_phone: '+21612345678',
  tax_number: '1234567ABC',
};

interface StubArg {
  verificationUrl: string;
  token: string;
}
const isStubArg = (v: unknown): v is StubArg =>
  typeof v === 'object' && v !== null && 'verificationUrl' in v && 'token' in v;

describe('POST /api/signup', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(authPlugin);
    await app.register(apiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('valid payload → 201 with the expected body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      userId: string;
      email: string;
      verificationRequired: boolean;
      message: string;
    }>();
    expect(body.email).toBe('owner@example.com');
    expect(body.verificationRequired).toBe(true);
    expect(typeof body.userId).toBe('string');
    expect(body.message).toContain('verify');
  });

  it('valid payload → writes user (+business fields, defaults) + account + verification', async () => {
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    const u = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u).toHaveLength(1);
    const created = u[0];
    expect(created?.businessName).toBe('Test Biz');
    expect(created?.taxNumber).toBe('1234567ABC');
    expect(created?.contactPhone).toBe('+21612345678');
    expect(created?.role).toBe('advertiser'); // input:false default
    expect(created?.status).toBe('pending'); // input:false default
    const a = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, created?.id ?? ''));
    expect(a).toHaveLength(1);
    expect(a[0]?.providerId).toBe('credential');
    // NOTE: better-auth 1.6.11 email-verification uses a stateless signed JWT,
    // NOT a verifications-table row — the token is asserted in the stub test
    // below. The verifications table remains in the schema for other flows
    // (e.g. password reset) and adapter completeness.
  });

  it('(Q8) fires the verification stub with a well-formed URL', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    await vi.waitFor(() => {
      expect(infoSpy.mock.calls.some((c) => isStubArg(c[0]))).toBe(true);
    });
    const arg = infoSpy.mock.calls.map((c) => c[0]).find(isStubArg);
    if (!isStubArg(arg)) throw new Error('verification stub was not called');
    expect(arg.verificationUrl).toMatch(/^http:\/\/localhost:4000\/auth\/verify-email\?token=/);
    expect(arg.token.length).toBeGreaterThan(0);
  });

  it('duplicate email → 201 generic, no second user row (anti-enumeration)', async () => {
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, tax_number: '7654321XYZ' },
    });
    expect(res2.statusCode).toBe(201); // generic, NOT 409
    const u = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u).toHaveLength(1); // still exactly one
  });

  it('duplicate tax_number (new email) → 409 TAX_NUMBER_TAKEN', async () => {
    await app.inject({ method: 'POST', url: '/api/signup', payload: validPayload });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'other@example.com' },
    });
    expect(res2.statusCode).toBe(409);
    const body = res2.json<{ error: string; fields: { field: string }[] }>();
    expect(body.error).toBe('TAX_NUMBER_TAKEN');
    expect(body.fields[0]?.field).toBe('tax_number');
  });

  it('password < 12 → 400 with field detail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; fields: { field: string }[] }>();
    expect(body.error).toBe('INVALID_INPUT');
    expect(body.fields.some((f) => f.field === 'password')).toBe(true);
  });

  it('invalid email format → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ fields: { field: string }[] }>();
    expect(body.fields.some((f) => f.field === 'email')).toBe(true);
  });

  it('invalid phone (no +) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, contact_phone: '12345678' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ fields: { field: string }[] }>();
    expect(body.fields.some((f) => f.field === 'contact_phone')).toBe(true);
  });

  it('invalid tax_number (too short) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, tax_number: 'ab' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ fields: { field: string }[] }>();
    expect(body.fields.some((f) => f.field === 'tax_number')).toBe(true);
  });

  it('role/status in payload are ignored — created user stays advertiser/pending', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, role: 'superadmin', status: 'approved' },
    });
    const u = await db.select().from(users).where(eq(users.email, 'owner@example.com'));
    expect(u[0]?.role).toBe('advertiser');
    expect(u[0]?.status).toBe('pending');
  });

  it('unexpected (non-APIError) failure → 500 generic', async () => {
    vi.spyOn(auth.api, 'signUpEmail').mockRejectedValueOnce(new Error('boom'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup',
      payload: { ...validPayload, email: 'fresh@example.com', tax_number: '9999999ZZ' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>().error).toBe('INTERNAL_ERROR');
  });
});
