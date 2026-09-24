import { sql } from 'drizzle-orm';

import { proofOfPlay } from '../../db/schema.js';

// PROOF-R1 (operator rulings 2026-09-24: R1 A, K2 A) — THE PLAY INSTANT of a proof, one home.
//
// The TV player now keeps an outbox and replays proofs it could not send while offline, so a proof
// can arrive hours after the play. It is credited to the hour it was PLAYED: the player's own
// timestamp, trusted only inside a bound —
//   • at most LATE_PROOF_MAX_MS (24 h) before the server received it — older is lost (K2 A; the
//     settlement waits 24 h after a campaign's end, so the two bounds align);
//   • at most CLOCK_AHEAD_TOLERANCE_MS (2 min) after it — a player clock slightly ahead is capped at
//     the receipt instant, so a proof never lands in a future hour.
// Outside the bound (a wrong clock, a replay older than 24 h, no timestamp) the receipt instant is
// used — the pre-R1 rule. Anti-fraud stays with the counting readers: one proof per play (play_id),
// never more than the plan's plays per hour.

export const LATE_PROOF_MAX_MS = 24 * 60 * 60 * 1000;
export const CLOCK_AHEAD_TOLERANCE_MS = 2 * 60 * 1000;

/** The instant a proof is credited to, from the player's timestamp and the server's receipt. */
export const proofPlayedAt = (eventTsMs: number | null, receivedAt: Date): Date => {
  if (eventTsMs === null || !Number.isFinite(eventTsMs)) return receivedAt;
  const received = receivedAt.getTime();
  if (eventTsMs < received - LATE_PROOF_MAX_MS) return receivedAt;
  if (eventTsMs > received + CLOCK_AHEAD_TOLERANCE_MS) return receivedAt;
  return new Date(Math.min(eventTsMs, received));
};

/**
 * Every reader that buckets proofs in TIME reads this, never a bare column: legacy rows (before
 * migration 0079) carry no played_at and keep their receipt instant — their meaning is unchanged.
 */
export const proofInstantSql =
  sql<Date>`coalesce(${proofOfPlay.playedAt}, ${proofOfPlay.receivedAt})`.mapWith(
    proofOfPlay.receivedAt,
  );
