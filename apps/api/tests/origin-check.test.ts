import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { authPlugin } from '../src/auth/plugin.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// D3 / CF-23 EXECUTION LAYER — executable regression-documentation of the ACTUAL CSRF boundary.
// better-auth's originCheck is a ROUTER-level middleware (routerMiddleware on /** of createRouter),
// so it fires only on the /auth/* handler path (auth.handler), NOT on our custom routes that call
// auth.api.* directly. The check defaults OFF when isTest() (create-context.mjs), so auth.ts pins
// `advanced.disableOriginCheck:false` — these tests therefore exercise prod's REAL behavior, not a
// test-env skip (that skip earlier produced three contaminated observations; pinning it kills the
// test-vs-prod divergence). With the check genuinely ON: (a) proves the custom-route bypass, (b)
// proves the handler path enforces it.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const buildApp = () => Fastify({ logger: false });

const PASSWORD = 'a-strong-passw0rd';
const WEB_ORIGIN = 'http://localhost:5173';
const BOGUS_ORIGIN = 'https://evil.com';

const createVerifiedUser = async (email: string): Promise<string> => {
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'Origin User',
      businessName: 'Origin Biz',
      contactPhone: '+21612345678',
      taxNumber: `TX${Date.now() % 100000000}`,
    },
  });
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, res.user.id));
  return res.user.id;
};

// Browser-shaped fetch headers: a cross-origin or same-origin fetch carries Origin + Sec-Fetch-*.
// These are what make better-auth's formCsrf → validateOrigin fire (a plain inject sends neither).
const browserHeaders = (origin: string): Record<string, string> => ({
  origin,
  'sec-fetch-site': origin === WEB_ORIGIN ? 'same-origin' : 'cross-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
});

describe('origin-check boundary: custom /api/* vs better-auth /auth/* (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    // Register both surfaces: authPlugin mounts the /auth/* catch-all (auth.handler → router,
    // where originCheck lives); apiRoutes mounts the custom /api/* routes (auth.api.* direct).
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

  it('(a) custom /api/signin ignores Origin → bogus origin + valid creds → 200 (EXPECTED)', async () => {
    // EXPECTED 200 even with origin-check forced ON (disableOriginCheck:false) — NOT a missed
    // vulnerability. This is the clean proof of the bypass: custom routes call auth.api.signInEmail
    // directly, not via auth.handler, so the router-level originCheck never runs for them. CSRF for
    // the authenticated mutating custom routes rests on the SameSite=Lax session cookie (a forged
    // cross-site POST carries no cookie → requireAuth 401). Login-CSRF on /api/signin is the
    // accepted low-severity residual — revisited at the money-slice hardening gate (assertOrigin
    // preHandler ships with the first wallet/recharge route; see audit Phase-1e CSRF model).
    await createVerifiedUser('origin-custom@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/signin',
      headers: browserHeaders(BOGUS_ORIGIN),
      payload: { email: 'origin-custom@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });

  it('(b) better-auth /auth/* enforces Origin on cookie-bearing requests → bogus origin → 403', async () => {
    // The /auth/* handler path runs the router-level originCheck. validateOrigin only proceeds for
    // cookie-bearing non-GET requests (it skips cookieless ones), so a cookie + a bogus Origin is
    // rejected with 403 before the endpoint runs — proving the check is active on the /auth/*
    // surface and that trustedOrigins:[WEB_ORIGIN] does real work there. (Our custom /api/* routes
    // bypass this router middleware entirely — test (a).) A fake cookie suffices: originCheck runs
    // before session lookup.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: { ...browserHeaders(BOGUS_ORIGIN), cookie: 'better-auth.session_token=fake' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});
