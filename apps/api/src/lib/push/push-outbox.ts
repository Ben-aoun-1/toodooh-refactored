import { and, eq, gt, inArray, isNotNull, isNull, sql as dsql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { deviceSessions } from '../../db/schema.js';
import { env } from '../../env.js';
import { MOBILE_DEVICE_TYPE } from '../../middleware/require-device-auth.js';

// MOBILE-1 — the push outbox. Every notification row the platform inserts (36 call sites: dispatch,
// events, billing, reports…) reaches the screenhost's phone WITHOUT touching those sites: a short
// tick claims the un-pushed rows (pushed_at stamped in the same UPDATE, SKIP LOCKED so two api
// processes never send twice), and sends the fresh ones to every live mobile session of the user
// that registered an Expo push token. Rows older than the window are claimed but never sent (an api
// that was down for an hour does not wake a phone with stale news). Expo Push relays to FCM/APNs.

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const PUSH_OUTBOX_WINDOW_MS = 15 * 60 * 1000;
const TICK_MS = 15 * 1000;
const CLAIM_LIMIT = 500;
const EXPO_BATCH = 100; // Expo's per-request message cap
// The Android channel the app creates (toodooh-mobile src/lib/push.ts ANDROID_CHANNEL_ID).
const ANDROID_CHANNEL_ID = 'allocations';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: { type: string; notification_id: string; campaign_id: string | null };
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  campaign_id: string | null;
  created_at: Date | string;
}

type ExpoTicket = { status: 'ok' } | { status: 'error'; details?: { error?: string } };

const isTicketArray = (value: unknown): value is ExpoTicket[] =>
  Array.isArray(value) &&
  value.every(
    (t) => typeof t === 'object' && t !== null && 'status' in t && typeof t.status === 'string',
  );

/** Claims every un-pushed notification (stamping pushed_at) and returns the claimed rows. */
const claimUnpushed = async (): Promise<ClaimedRow[]> => {
  const rows = await db.execute<ClaimedRow>(dsql`
    UPDATE notifications SET pushed_at = now()
    WHERE id IN (
      SELECT id FROM notifications
      WHERE pushed_at IS NULL
      ORDER BY created_at
      LIMIT ${CLAIM_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id, type, title, body, campaign_id, created_at`);
  return [...rows];
};

/** The Expo messages for the claimed rows: fresh rows × the user's live, push-enabled phones. */
export const buildMessages = (
  rows: readonly ClaimedRow[],
  tokensByUser: ReadonlyMap<string, readonly string[]>,
  now: Date,
): ExpoPushMessage[] =>
  rows
    .filter((r) => now.getTime() - new Date(r.created_at).getTime() <= PUSH_OUTBOX_WINDOW_MS)
    .flatMap((r) =>
      (tokensByUser.get(r.user_id) ?? []).map((to) => ({
        to,
        title: r.title,
        body: r.body,
        sound: 'default' as const,
        priority: 'high' as const,
        channelId: ANDROID_CHANNEL_ID,
        data: { type: r.type, notification_id: r.id, campaign_id: r.campaign_id },
      })),
    );

const liveTokensByUser = async (userIds: string[], now: Date): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const sessions = await db
    .select({ userId: deviceSessions.userId, pushToken: deviceSessions.pushToken })
    .from(deviceSessions)
    .where(
      and(
        inArray(deviceSessions.userId, userIds),
        eq(deviceSessions.deviceType, MOBILE_DEVICE_TYPE),
        isNotNull(deviceSessions.pushToken),
        isNull(deviceSessions.revokedAt),
        gt(deviceSessions.refreshExpiresAt, now),
      ),
    );
  for (const s of sessions) {
    if (s.pushToken === null) continue;
    map.set(s.userId, [...(map.get(s.userId) ?? []), s.pushToken]);
  }
  return map;
};

/** Sends one batch; returns the tokens Expo reports as no longer registered. */
export const sendExpoBatch = async (
  messages: readonly ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> => {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (env.EXPO_ACCESS_TOKEN) headers['authorization'] = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  const res = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
  const payload: unknown = await res.json();
  const data =
    typeof payload === 'object' && payload !== null && 'data' in payload ? payload.data : null;
  if (!isTicketArray(data)) return [];
  return data
    .flatMap((ticket, i) =>
      ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
        ? [messages[i]?.to ?? '']
        : [],
    )
    .filter((t) => t !== '');
};

/** One outbox tick: claim → build → send → drop the tokens Expo says are dead. */
export const runPushOutboxTick = async (
  log: FastifyBaseLogger,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ claimed: number; sent: number }> => {
  const rows = await claimUnpushed();
  if (rows.length === 0) return { claimed: 0, sent: 0 };
  const tokens = await liveTokensByUser([...new Set(rows.map((r) => r.user_id))], now);
  const messages = buildMessages(rows, tokens, now);
  let sent = 0;
  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    try {
      const dead = await sendExpoBatch(batch, fetchImpl);
      sent += batch.length;
      if (dead.length > 0) {
        await db
          .update(deviceSessions)
          .set({ pushToken: null })
          .where(inArray(deviceSessions.pushToken, dead));
      }
    } catch (err) {
      // Best effort: a push is a nudge, the in-app feed stays the record. No retry loop.
      log.warn({ err, count: batch.length }, 'push outbox: expo send failed');
    }
  }
  return { claimed: rows.length, sent };
};

/** Boot tick + a 15 s unref'd interval (the job pattern of server.ts). */
export function startPushOutboxJob(log: FastifyBaseLogger): void {
  const tick = (): void => {
    void runPushOutboxTick(log).catch((err: unknown) =>
      log.warn({ err }, 'push outbox tick failed'),
    );
  };
  tick();
  setInterval(tick, TICK_MS).unref();
}
