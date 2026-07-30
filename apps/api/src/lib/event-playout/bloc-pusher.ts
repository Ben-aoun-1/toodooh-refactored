import type { FastifyBaseLogger } from 'fastify';

import { pushPlaylistToVenue } from '../playout/push.js';

import { venuesAtBlocEdge } from './spots.js';

// EV5 — THE BLOC PUSHER. An event spot lives inside 20-minute blocs, so the venue's playlist must
// change AT the bloc edges — not on the next reconnect. This tick scans for ACCEPTE allocations
// whose bloc START or END fell in the last minute and re-pushes those venues' playlists (CF-HF4's
// pushPlaylistToVenue, unchanged): at a start edge computeScreenPlaylist now includes the event
// entry, at an end edge it no longer does.
//
// Design notes:
//   • ONE minute of granularity is enough — blocs are 20 minutes and the player receives a whole
//     playlist with a cadence hint, so a sub-minute skew costs at most one rep.
//   • IDEMPOTENT by construction: the push recomputes the playlist whole, so a double firing
//     sends the same message twice (the player replaces its list).
//   • Never throws: a dead socket or an unreachable venue warns; the tick keeps going.
//   • Logs ONE summary line per firing that actually pushed (the lifecycle-job posture: silence
//     when there is nothing to do).

export const BLOC_PUSH_TICK_MS = 60 * 1000;

export interface BlocPushResult {
  venues: number;
  pushed: number;
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
  return { venues: venues.length, pushed };
};

/** Boot tick + per-minute unref'd interval — the campaign-lifecycle job posture. */
export function startBlocPushJob(log: FastifyBaseLogger): void {
  void runBlocPushTick(log).catch((err: unknown) =>
    log.warn({ err }, 'event bloc push boot tick failed'),
  );
  const timer = setInterval(() => {
    void runBlocPushTick(log).catch((err: unknown) =>
      log.warn({ err }, 'event bloc push tick failed'),
    );
  }, BLOC_PUSH_TICK_MS);
  timer.unref();
}
