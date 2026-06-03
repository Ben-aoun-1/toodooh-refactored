import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth, emailSender } from '../src/auth/auth.js';
import { authPlugin } from '../src/auth/plugin.js';
import { db, sql } from '../src/db/client.js';
import { sessions, users } from '../src/db/schema.js';
import { env } from '../src/env.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. Auto-login-on-verify (slice-1 auth-bug-2):
//   G1 (one-shot) — a session is minted ONLY on the unverified→verified transition; re-clicking an
//     already-consumed link redirects to the success page with NO session (better-auth's
//     `if (user.emailVerified) { redirect; return }` short-circuits before the auto-signin block).
//   G3 (session-before-redirect) — the Set-Cookie and the 302 to the callbackURL ride one response.
// The real verification JWT is captured by spying emailSender.send during the sendOnSignUp flow.

const buildApp = () => Fastify({ logger: false });
const PASSWORD = 'a-strong-passw0rd';
const CALLBACK = `${env.WEB_ORIGIN}/verify-email`; // matches trustedOrigins → passes originCheck

// Sign up an UNVERIFIED user via the real flow and pull the verification token out of the email the
// sendOnSignUp hook generates (emailSender.send is the seam better-auth's hook ultimately calls).
const signUpAndCaptureToken = async (email: string): Promise<{ userId: string; token: string }> => {
  const sendSpy = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'test-msg-id' });
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'Verify User',
      businessName: 'Verify Biz',
      contactPhone: '+21612345678',
    },
  });
  const html = sendSpy.mock.calls.map((c) => c[0].html).join('\n');
  const token = html.match(/verify-email\?token=([A-Za-z0-9._-]+)/)?.[1];
  if (!token) throw new Error('verification token not found in the sent email');
  sendSpy.mockRestore();
  return { userId: res.user.id, token };
};

const verify = (app: ReturnType<typeof buildApp>, token: string) =>
  app.inject({
    method: 'GET',
    url: `/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(CALLBACK)}`,
  });

describe('GET /auth/verify-email auto-login (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(authPlugin);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('first verify (unverified→verified) → 302 to callbackURL, session cookie + row created (G1/G3)', async () => {
    const { userId, token } = await signUpAndCaptureToken('verify-first@example.com');

    const res = await verify(app, token);

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(CALLBACK); // callbackURL honored, no ?error → success
    expect(res.headers['set-cookie']).toBeDefined(); // G3: cookie set on the same response as the 302

    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows.length).toBe(1); // G1: a session is created on the transition

    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u?.emailVerified).toBe(true);
  });

  it('re-click of an already-verified link → 302 to callbackURL, NO new session, NO cookie (G1 one-shot)', async () => {
    const { userId, token } = await signUpAndCaptureToken('verify-reclick@example.com');

    await verify(app, token); // first click verifies + mints the session
    const before = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(before.length).toBe(1);

    const res = await verify(app, token); // second click — account already verified

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(CALLBACK);
    expect(res.headers['set-cookie']).toBeUndefined(); // G1: no session on an already-verified link

    const after = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(after.length).toBe(1); // session count unchanged — not a reusable magic link
  });

  it('invalid token → 302 to callbackURL?error=, NO session (no auto-login on failure)', async () => {
    const res = await verify(app, 'not-a-valid-jwt');

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${CALLBACK}?error=INVALID_TOKEN`);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
