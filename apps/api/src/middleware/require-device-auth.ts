import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../db/client.js';
import { deviceSessions, users } from '../db/schema.js';
import { hashDeviceToken } from '../lib/device-tokens.js';

// Device-session bearer guards (MAP M1) — the device counterparts of requireAuth. Validate
// `Authorization: Bearer <token>` against device_sessions (sha-256 lookup → expiry +
// revocation), load the user row, and attach the SAME request.user shape requireAuth
// does. Touch last_used_at (telemetry, not authorization state).
// The screenhost phone app (toodooh-mobile) signs in on the same /api/device/auth/* surface with
// device_type 'mobile'. The two token kinds are kept apart: a TV token (stored on a box in a
// venue) never reaches the owner app surface, and a phone token never acts as a TV.
export const MOBILE_DEVICE_TYPE = 'mobile';

export interface DeviceAuthContext {
  sessionId: string;
  deviceType: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    deviceSession?: DeviceAuthContext;
  }
}

/** The bearer token of `Authorization: Bearer <token>`, or null when the header is absent/empty. */
export const bearerToken = (request: FastifyRequest): string | null => {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token === '' ? null : token;
};

/**
 * Resolves a bearer access token to its live device session + user (sha-256 lookup → expiry +
 * revocation), touching last_used_at. null for an unknown/expired/revoked token or a gone user.
 * Attaches request.user (the SAME shape requireAuth does, so role gates and handlers stay
 * guard-agnostic) and request.deviceSession.
 */
export const authenticateDeviceToken = async (
  request: FastifyRequest,
  token: string,
): Promise<DeviceAuthContext | null> => {
  const [session] = await db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.accessTokenHash, hashDeviceToken(token)))
    .limit(1);
  if (!session || session.revokedAt !== null || session.accessExpiresAt.getTime() <= Date.now()) {
    return null;
  }

  const [user] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) return null;

  await db
    .update(deviceSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(deviceSessions.id, session.id));

  const context = { sessionId: session.id, deviceType: session.deviceType };
  request.user = { id: user.id, role: user.role, status: user.status };
  request.deviceSession = context;
  return context;
};

const send401 = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  await reply.status(401).send({
    error: 'UNAUTHENTICATED',
    message: 'Authentication required.',
    statusCode: 401,
    requestId: request.id,
  });
};

// The TV guard: any non-mobile device session.
export const requireDeviceAuth = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const token = bearerToken(request);
  const context = token === null ? null : await authenticateDeviceToken(request, token);
  if (!context || context.deviceType === MOBILE_DEVICE_TYPE) {
    request.user = undefined;
    request.deviceSession = undefined;
    return send401(request, reply);
  }
};

// The phone guard for the /api/device/* routes that act on the phone's own session (logout,
// push token): a mobile device session only.
export const requireMobileDeviceAuth = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const token = bearerToken(request);
  const context = token === null ? null : await authenticateDeviceToken(request, token);
  if (!context || context.deviceType !== MOBILE_DEVICE_TYPE) {
    request.user = undefined;
    request.deviceSession = undefined;
    return send401(request, reply);
  }
};
