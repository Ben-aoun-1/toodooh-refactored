import { verifyPassword } from 'better-auth/crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { accounts, deviceSessions, users } from '../db/schema.js';
import { hashDeviceToken, newTokenPair } from '../lib/device-tokens.js';
import { requireMobileDeviceAuth } from '../middleware/require-device-auth.js';

// Device token auth (MAP M1) — the Android TV app's install → sign in path. NAMESPACE:
// /api/device/auth/* (NEVER /api/auth/* — better-auth owns that). Credentials are verified
// with better-auth's own scrypt verifier (better-auth/crypto verifyPassword) against the
// credential-provider accounts row — the exact hash signInEmail checks — so the two paths
// can never disagree on what a valid password is. No better-auth session/cookie is minted:
// the device gets an opaque rotating token pair (device_sessions) instead.
const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  device_type: z.string().trim().min(1).max(100),
});
const refreshBodySchema = z.object({ refresh_token: z.string().min(1) });
// Expo push tokens: « ExponentPushToken[…] » (or the legacy « ExpoPushToken[…] »). null deregisters.
const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;
const pushTokenBodySchema = z.object({
  expo_push_token: z.string().regex(EXPO_PUSH_TOKEN_RE).nullable(),
});

// Only screen owners sign in from a TV. Wrong email and wrong password are identical 401s
// (no enumeration — parity with /api/signin); role/status failures are 403 (the credentials
// were right, the account just may not use this surface).
const DEVICE_ROLES = new Set(['individual_owner', 'fleet_owner']);

export const deviceAuthRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/device/auth/login — response shape is the TV app's ApiAuth.kt contract:
  // {access_token, refresh_token, user:{id,email,role}}.
  app.post('/api/device/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const email = parsed.data.email.trim().toLowerCase();

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const [credential] = user
      ? await db
          .select({ password: accounts.password })
          .from(accounts)
          .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
          .limit(1)
      : [];
    const valid =
      user && credential?.password
        ? await verifyPassword({ hash: credential.password, password: parsed.data.password })
        : false;
    if (!user || !valid) {
      return reply.status(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Email ou mot de passe incorrect.',
      });
    }

    // Verified-email gate (ruling 2026-06-10): the web signin blocks unverified accounts
    // (better-auth's requireEmailVerification path) — the device surface must not bypass it.
    if (!user.emailVerified) {
      return reply.status(403).send({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Veuillez vérifier votre adresse email avant de vous connecter.',
      });
    }
    if (!DEVICE_ROLES.has(user.role)) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Seuls les comptes propriétaires peuvent se connecter depuis un écran.',
      });
    }
    if (user.status !== 'approved') {
      return reply.status(403).send({
        error: 'ACCOUNT_NOT_APPROVED',
        message: "Votre compte n'a pas encore été validé.",
      });
    }

    const pair = newTokenPair(new Date());
    await db.insert(deviceSessions).values({
      userId: user.id,
      accessTokenHash: pair.accessTokenHash,
      refreshTokenHash: pair.refreshTokenHash,
      accessExpiresAt: pair.accessExpiresAt,
      refreshExpiresAt: pair.refreshExpiresAt,
      deviceType: parsed.data.device_type,
    });

    return reply.status(200).send({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  // POST /api/device/auth/refresh — rotation: BOTH tokens are reissued and the old pair dies
  // with the same UPDATE (the hashes are overwritten). A replayed old refresh token finds no
  // row → 401. Expired/revoked refresh → the same generic 401 (nothing to enumerate).
  app.post('/api/device/auth/refresh', async (request, reply) => {
    const parsed = refreshBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const [session] = await db
      .select()
      .from(deviceSessions)
      .where(eq(deviceSessions.refreshTokenHash, hashDeviceToken(parsed.data.refresh_token)))
      .limit(1);
    if (
      !session ||
      session.revokedAt !== null ||
      session.refreshExpiresAt.getTime() <= Date.now()
    ) {
      return reply.status(401).send({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Session expirée. Reconnectez-vous.',
      });
    }

    const pair = newTokenPair(new Date());
    await db
      .update(deviceSessions)
      .set({
        accessTokenHash: pair.accessTokenHash,
        refreshTokenHash: pair.refreshTokenHash,
        accessExpiresAt: pair.accessExpiresAt,
        refreshExpiresAt: pair.refreshExpiresAt,
        lastUsedAt: new Date(),
      })
      .where(eq(deviceSessions.id, session.id));

    return reply.status(200).send({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
    });
  });

  // MOBILE-1 — POST /api/device/auth/logout: the phone revokes its OWN session (and drops its push
  // token with it). Idempotent from the phone's point of view: a dead token is already a 401.
  app.post(
    '/api/device/auth/logout',
    { preHandler: requireMobileDeviceAuth },
    async (request, reply) => {
      const sessionId = request.deviceSession?.sessionId;
      if (!sessionId) {
        return reply
          .status(401)
          .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
      }
      await db
        .update(deviceSessions)
        .set({ revokedAt: new Date(), pushToken: null })
        .where(eq(deviceSessions.id, sessionId));
      return reply.status(204).send();
    },
  );

  // MOBILE-1 — POST /api/device/push-token {expo_push_token: string | null}: binds the phone's Expo
  // push token to its session (null = the user signed out or turned notifications off). A token is
  // owned by ONE session: registering it here takes it off any other session first (the same phone
  // signed in to another account, or a stale session of a reinstalled app), so a phone never
  // receives pushes for an account that is no longer signed in on it.
  app.post(
    '/api/device/push-token',
    { preHandler: requireMobileDeviceAuth },
    async (request, reply) => {
      const parsed = pushTokenBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
        });
      }
      const sessionId = request.deviceSession?.sessionId;
      if (!sessionId) {
        return reply
          .status(401)
          .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
      }
      const token = parsed.data.expo_push_token;
      await db.transaction(async (tx) => {
        if (token !== null) {
          await tx
            .update(deviceSessions)
            .set({ pushToken: null })
            .where(and(eq(deviceSessions.pushToken, token), ne(deviceSessions.id, sessionId)));
        }
        await tx
          .update(deviceSessions)
          .set({ pushToken: token })
          .where(eq(deviceSessions.id, sessionId));
      });
      return reply.status(204).send();
    },
  );
};
