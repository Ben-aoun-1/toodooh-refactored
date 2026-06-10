import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../db/client.js';
import { deviceSessions, users } from '../db/schema.js';
import { hashDeviceToken } from '../lib/device-tokens.js';

// Device-session bearer guard (MAP M1) — the TV-app counterpart of requireAuth. Validates
// `Authorization: Bearer <token>` against device_sessions (sha-256 lookup → expiry +
// revocation), loads the user row, and attaches the SAME request.user shape requireAuth
// does, so role gates and route handlers stay guard-agnostic. Touches last_used_at
// (fire-and-forget ordering is fine — it is telemetry, not authorization state).
export const requireDeviceAuth = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const send401 = async (): Promise<void> => {
    await reply.status(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      statusCode: 401,
      requestId: request.id,
    });
  };

  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length <= 'Bearer '.length) {
    return send401();
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) return send401();

  const [session] = await db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.accessTokenHash, hashDeviceToken(token)))
    .limit(1);
  if (!session || session.revokedAt !== null || session.accessExpiresAt.getTime() <= Date.now()) {
    return send401();
  }

  const [user] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) return send401();

  await db
    .update(deviceSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(deviceSessions.id, session.id));

  request.user = { id: user.id, role: user.role, status: user.status };
};
