import type { FastifyBaseLogger } from 'fastify';

import { pushPlaylistToAllConnected, pushPlaylistToVenue } from './playout/push.js';
import { recomputeVenueSps } from './sps-score.js';

// The post-commit side effects of « a Host answers a proposal » — ONE home, shared by the owner's
// routes and the admin's « au nom du Host » twin (Mariem 13/11), so both answers move the same
// things. Every effect is failure-warn: a dead socket or a failed recompute never undoes the
// decision, which is already committed.

/** Classic allocation: SPS recompute on any change; an ACCEPTE re-pushes the venue (CF-HF4). */
export const afterClassicDecision = async (
  screenhostId: string,
  statut: 'ACCEPTE' | 'REFUSE',
  changed: boolean,
  log: FastifyBaseLogger,
): Promise<void> => {
  if (!changed) return;
  try {
    await recomputeVenueSps(screenhostId);
  } catch (err) {
    log.warn({ err, screenhostId }, 'SPS on-decision recompute failed');
  }
  if (statut === 'ACCEPTE') {
    try {
      await pushPlaylistToVenue(screenhostId, log);
    } catch (err) {
      log.warn({ err, screenhostId }, 'playlist re-push on accept failed');
    }
  }
};

/**
 * Event share(s): an ACCEPTE re-pushes the venue (FRESH-1: a bloc may be airing now); a REFUSE
 * released blocs, so every connected venue re-pushes (EVT-STOP: the blackout set moved).
 */
export const afterEventDecision = async (
  screenhostId: string,
  statut: 'ACCEPTE' | 'REFUSE',
  changed: boolean,
  log: FastifyBaseLogger,
): Promise<void> => {
  if (!changed) return;
  if (statut === 'ACCEPTE') {
    await pushPlaylistToVenue(screenhostId, log).catch((err: unknown) =>
      log.warn({ err, screenhostId }, 'playlist re-push on event accept failed'),
    );
    return;
  }
  await pushPlaylistToAllConnected(log).catch((err: unknown) =>
    log.warn({ err }, 'network playlist re-push failed'),
  );
};
