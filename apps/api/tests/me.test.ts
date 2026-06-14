import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { userDocuments, users } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// nodemailer mocked → createVerifiedUser's signUpEmail "sends" without a real SMTP connection.
// Integration suite — real Postgres. No getSession mock: sign-in mints a REAL cookie, replayed
// through the real require-auth guard into GET /api/me (the cookie→identity round-trip).
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const buildApp = () => Fastify({ logger: false });

const PASSWORD = 'a-strong-passw0rd';

const createVerifiedUser = async (
  email: string,
  opts: { role?: string; businessType?: string | null; verified?: boolean } = {},
): Promise<string> => {
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'Me User',
      businessName: 'Me Biz',
      contactPhone: '+21612345678',
      taxNumber: `TX${Date.now() % 100000000}`,
    },
  });
  await db
    .update(users)
    .set({
      emailVerified: opts.verified ?? true,
      ...(opts.role ? { role: opts.role as 'advertiser' } : {}),
      ...(opts.businessType !== undefined ? { businessType: opts.businessType } : {}),
    })
    .where(eq(users.id, res.user.id));
  return res.user.id;
};

const cookieHeader = (setCookie: string | string[] | undefined): string => {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
};

interface MeUser {
  id: string;
  email: string;
  email_verified: boolean;
  role: string;
  status: string;
  onboarding_completed: boolean;
  profile_type: string | null;
  contact_name: string | null;
  business_name: string | null;
  tax_number: string | null;
  contact_phone: string | null;
  bank_account_holder: string | null;
  bank_rib: string | null;
  bank_iban: string | null;
  documents: { registration: boolean; cin: boolean; bank: boolean };
  notifications: {
    news_updates: boolean;
    reminders_events: boolean;
    promotions_offers: boolean;
  };
}

describe('GET /api/me (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
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

  const signin = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/signin', payload: { email, password } });

  const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });

  it('authenticated → 200 with the full self-view', async () => {
    await createVerifiedUser('me@example.com');
    const cookie = cookieHeader((await signin('me@example.com', PASSWORD)).headers['set-cookie']);

    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    const { user } = res.json<{ user: MeUser }>();
    // routing fields (signin parity)
    expect(user.email).toBe('me@example.com');
    expect(user.role).toBe('advertiser');
    expect(user.status).toBe('pending');
    expect(user.email_verified).toBe(true);
    expect(user.onboarding_completed).toBe(false);
    expect(user.profile_type).toBe('advertiser');
    expect(user.contact_name).toBe('Me User');
    // business profile
    expect(user.business_name).toBe('Me Biz');
    expect(user.contact_phone).toBe('+21612345678');
    expect(typeof user.tax_number).toBe('string');
    // bank details (none at signup)
    expect(user.bank_account_holder).toBeNull();
    expect(user.bank_rib).toBeNull();
    expect(user.bank_iban).toBeNull();
    // document presence (none uploaded at signup) + notification defaults
    expect(user.documents).toEqual({ registration: false, cin: false, bank: false });
    expect(user.notifications).toEqual({
      news_updates: false,
      reminders_events: true,
      promotions_offers: false,
    });
  });

  it('bank details + bank document presence round-trip', async () => {
    const userId = await createVerifiedUser('me-bank@example.com');
    await db
      .update(users)
      .set({
        bankAccountHolder: 'Foulen Ben Foulen',
        bankRib: '12345678901234567890',
        bankIban: 'TN5912345678901234567890',
      })
      .where(eq(users.id, userId));
    // Document presence reads user_documents (F-docs Commit 1), not the frozen users column.
    await db
      .insert(userDocuments)
      .values({ userId, category: 'bank', position: 1, storageKey: `bank/${userId}` });
    const cookie = cookieHeader(
      (await signin('me-bank@example.com', PASSWORD)).headers['set-cookie'],
    );
    const { user } = (await me(cookie)).json<{ user: MeUser }>();
    expect(user.bank_account_holder).toBe('Foulen Ben Foulen');
    expect(user.bank_rib).toBe('12345678901234567890');
    expect(user.bank_iban).toBe('TN5912345678901234567890');
    expect(user.documents.bank).toBe(true);
  });

  it('no cookie → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('UNAUTHENTICATED');
  });

  it('profile_type parity: agency (advertiser + business_type=agency)', async () => {
    await createVerifiedUser('me-agency@example.com', { businessType: 'agency' });
    const cookie = cookieHeader(
      (await signin('me-agency@example.com', PASSWORD)).headers['set-cookie'],
    );
    expect((await me(cookie)).json<{ user: MeUser }>().user.profile_type).toBe('agency');
  });

  it('profile_type parity: individual_owner', async () => {
    await createVerifiedUser('me-indiv@example.com', { role: 'individual_owner' });
    const cookie = cookieHeader(
      (await signin('me-indiv@example.com', PASSWORD)).headers['set-cookie'],
    );
    expect((await me(cookie)).json<{ user: MeUser }>().user.profile_type).toBe('individual_owner');
  });

  it('profile_type parity: fleet_owner', async () => {
    await createVerifiedUser('me-fleet@example.com', { role: 'fleet_owner' });
    const cookie = cookieHeader(
      (await signin('me-fleet@example.com', PASSWORD)).headers['set-cookie'],
    );
    expect((await me(cookie)).json<{ user: MeUser }>().user.profile_type).toBe('fleet_owner');
  });

  it('signed-out cookie no longer authenticates → 401', async () => {
    await createVerifiedUser('me-out@example.com');
    const cookie = cookieHeader(
      (await signin('me-out@example.com', PASSWORD)).headers['set-cookie'],
    );
    await app.inject({ method: 'POST', url: '/api/signout', headers: { cookie } });
    expect((await me(cookie)).statusCode).toBe(401);
  });
});
