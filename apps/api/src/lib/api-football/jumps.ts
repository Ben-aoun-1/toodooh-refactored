import type { ExtensionReason } from '../event-playout/extend.js';

// EVT-ET1 (ruling 7.2 — FIXED JUMPS) — what a live status means for the « après » ads. When the
// match reaches extra time, its end moves +35 min (30 min of play + the break); when it reaches
// penalties, +15 min more. Each jump is applied ONCE (the event's *_applied_at stamps). A status
// seen late still counts: a match already « AET » or « PEN » when we first look went through extra
// time — and « PEN » through penalties too.

export const EXTRA_TIME_MINUTES = 35;
export const PENALTIES_MINUTES = 15;

const EXTRA_TIME_OR_LATER = new Set(['ET', 'BT', 'P', 'AET', 'PEN']);
const PENALTIES_OR_LATER = new Set(['P', 'PEN']);
/** Statuses after which the match will not change any more. */
export const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO', 'PST']);

export interface Jump {
  reason: Extract<ExtensionReason, 'extra_time' | 'penalties'>;
  minutes: number;
}

export const jumpsFor = (
  status: string,
  applied: { extraTime: boolean; penalties: boolean },
): Jump[] => {
  const jumps: Jump[] = [];
  if (EXTRA_TIME_OR_LATER.has(status) && !applied.extraTime) {
    jumps.push({ reason: 'extra_time', minutes: EXTRA_TIME_MINUTES });
  }
  if (PENALTIES_OR_LATER.has(status) && !applied.penalties) {
    jumps.push({ reason: 'penalties', minutes: PENALTIES_MINUTES });
  }
  return jumps;
};
