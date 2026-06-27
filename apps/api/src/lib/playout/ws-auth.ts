import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { deviceSessions, screenhosts, screens } from '../../db/schema.js';
import { hashDeviceToken } from '../device-tokens.js';

// Custom WS close codes (4000–4999 are app-defined): 4401 = bad/expired/missing token,
// 4403 = the screen is unknown or not owned by the authenticated device's owner.
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;

export type ScreenWsAuth =
  | { ok: true; screenId: string; screenhostId: string; ownerId: string }
  | { ok: false; closeCode: number; reason: string };

// Authenticate a /ws/screen handshake: reuse the device-session token model (sha-256 → device_sessions
// → expiry/revocation), then confirm screen_id is a real screen owned by that device's user
// (screens.screenhostId → screenhosts.ownerId === session.userId). Mirrors requireDeviceAuth, but
// reads the token from the query string (raw ws clients can't set Authorization on the handshake).
export const authenticateScreenWs = async (
  token: string | undefined,
  screenId: string | undefined,
): Promise<ScreenWsAuth> => {
  if (!token) return { ok: false, closeCode: WS_CLOSE_UNAUTHORIZED, reason: 'missing token' };
  if (!screenId || !z.uuid().safeParse(screenId).success) {
    return { ok: false, closeCode: WS_CLOSE_UNAUTHORIZED, reason: 'missing or invalid screen_id' };
  }

  const [session] = await db
    .select({
      userId: deviceSessions.userId,
      revokedAt: deviceSessions.revokedAt,
      accessExpiresAt: deviceSessions.accessExpiresAt,
    })
    .from(deviceSessions)
    .where(eq(deviceSessions.accessTokenHash, hashDeviceToken(token)))
    .limit(1);
  if (!session || session.revokedAt !== null || session.accessExpiresAt.getTime() <= Date.now()) {
    return { ok: false, closeCode: WS_CLOSE_UNAUTHORIZED, reason: 'invalid or expired token' };
  }

  const [row] = await db
    .select({
      screenId: screens.id,
      screenhostId: screens.screenhostId,
      ownerId: screenhosts.ownerId,
    })
    .from(screens)
    .innerJoin(screenhosts, eq(screens.screenhostId, screenhosts.id))
    .where(eq(screens.id, screenId))
    .limit(1);
  if (!row || row.ownerId === null || row.ownerId !== session.userId) {
    return { ok: false, closeCode: WS_CLOSE_FORBIDDEN, reason: 'screen not found or not owned' };
  }

  return { ok: true, screenId: row.screenId, screenhostId: row.screenhostId, ownerId: row.ownerId };
};
