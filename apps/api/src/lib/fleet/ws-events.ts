import { and, eq, lt } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { type ScreenWsEvent, screenWsEvents } from '../../db/schema.js';

// FLEET-2 — a TV's connection history (screen_ws_events): written by the /ws/screen handler and
// the admin's remote actions, read by « Santé de la TV ». Kept 14 days per screen.

export const WS_EVENTS_RETENTION_MS = 14 * 24 * 3_600_000;

export const recordWsEvent = async (
  screenId: string,
  kind: ScreenWsEvent['kind'],
  detail: string | null = null,
  at: Date = new Date(),
): Promise<void> => {
  await db.insert(screenWsEvents).values({ screenId, kind, detail, at });
};

/** A connection: recorded, and the screen's events older than the retention pruned. */
export const recordConnect = async (screenId: string, at: Date = new Date()): Promise<void> => {
  await recordWsEvent(screenId, 'connect', null, at);
  await db
    .delete(screenWsEvents)
    .where(
      and(
        eq(screenWsEvents.screenId, screenId),
        lt(screenWsEvents.at, new Date(at.getTime() - WS_EVENTS_RETENTION_MS)),
      ),
    );
};
