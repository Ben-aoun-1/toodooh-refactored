import type { FastifyBaseLogger } from 'fastify';

import { eventBlackouts } from '../event-blackout.js';
import { pushPlaylistToAllConnected, pushPlaylistToVenue } from '../playout/push.js';

import { venuesAtBlocEdge } from './spots.js';

// EV5 — THE BLOC PUSHER. An event spot lives inside 20-minute blocs, so the venue's playlist must
// change AT the bloc edges — not on the next reconnect. This tick scans for ACCEPTE allocations
// whose bloc START or END fell in the last minute and re-pushes those venues' playlists (CF-HF4's
// pushPlaylistToVenue, unchanged): at a start edge computeScreenPlaylist now includes the event
// entry, at an end edge it no longer does.
//
// Design notes:
//   • ONE minute of granularity is enough — every edge (match window, bloc, pod announce/close)
//     sits on a whole minute and the tick fires on the minute (EVT-PLAY1 R2).
//   • IDEMPOTENT by construction: the push recomputes the playlist whole, so a double firing
//     sends the same message twice (the player replaces its list).
//   • Never throws: a dead socket or an unreachable venue warns; the tick keeps going.
//   • Logs ONE summary line per firing that actually pushed (the lifecycle-job posture: silence
//     when there is nothing to do).

export const BLOC_PUSH_TICK_MS = 60 * 1000;

export interface BlocPushResult {
  venues: number;
  pushed: number;
  /** EVT-PLAY1 — a match window edge fell in the tick: every connected venue re-pushed. */
  network: boolean;
}

/**
 * One pass: every venue at a bloc edge inside (now − windowMs, now] gets a re-push.
 * `now` and `windowMs` are injected so tests drive the clock.
 */
export const runBlocPushTick = async (
  log: FastifyBaseLogger,
  now: Date = new Date(),
  windowMs: number = BLOC_PUSH_TICK_MS,
): Promise<BlocPushResult> => {
  const since = new Date(now.getTime() - windowMs);
  // EVT-PLAY1 — a confirmed match's window edge is a NETWORK edge: classic stops (start) or
  // resumes (end) on every venue that shows events, so every connected venue re-pushes — the
  // per-venue scan below is then redundant. Edges are those of the MERGED windows.
  const { windows } = await eventBlackouts(
    new Date(since.getTime() - 1),
    new Date(now.getTime() + 1),
  );
  const sinceMs = since.getTime();
  const nowMs = now.getTime();
  const networkEdge = windows.some((w) =>
    [w.start.getTime(), w.end.getTime()].some((edge) => edge > sinceMs && edge <= nowMs),
  );
  if (networkEdge) {
    const pushed = await pushPlaylistToAllConnected(log);
    log.info(
      { pushed, since: since.toISOString(), until: now.toISOString() },
      'event blackout edge: network playlist push applied',
    );
    return { venues: 0, pushed, network: true };
  }
  const venues = await venuesAtBlocEdge(since, now);
  let pushed = 0;
  for (const screenhostId of venues) {
    try {
      pushed += await pushPlaylistToVenue(screenhostId, log);
    } catch (err) {
      log.warn({ err, screenhostId }, 'event bloc playlist push failed');
    }
  }
  if (venues.length > 0) {
    log.info(
      { venues: venues.length, pushed, since: since.toISOString(), until: now.toISOString() },
      'event bloc edge push applied',
    );
  }
  return { venues: venues.length, pushed, network: false };
};

/** EVT-PLAY1 (R2) — ms from `nowMs` to the next whole minute (every edge sits on one). */
export const msToNextMinute = (nowMs: number): number =>
  BLOC_PUSH_TICK_MS - (nowMs % BLOC_PUSH_TICK_MS);

/**
 * Boot tick, then one tick per minute ON the minute — not phased on the boot instant: a tick
 * phased at :25 pushed every edge up to 59 s late and the pod's first slots were lost (R2). Each
 * tick re-aims at the next minute, so drift never accumulates. Unref'd, like every job.
 */
export function startBlocPushJob(log: FastifyBaseLogger): void {
  void runBlocPushTick(log).catch((err: unknown) =>
    log.warn({ err }, 'event bloc push boot tick failed'),
  );
  const schedule = (): void => {
    const timer = setTimeout(() => {
      // The window ends ON the minute even when the timer fires a few ms late.
      const now = new Date(Date.now() - (Date.now() % BLOC_PUSH_TICK_MS));
      void runBlocPushTick(log, now)
        .catch((err: unknown) => log.warn({ err }, 'event bloc push tick failed'))
        .finally(schedule);
    }, msToNextMinute(Date.now()));
    timer.unref();
  };
  schedule();
}
