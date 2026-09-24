import { describe, expect, it } from 'vitest';

import {
  CLOCK_AHEAD_TOLERANCE_MS,
  LATE_PROOF_MAX_MS,
  proofPlayedAt,
} from '../src/lib/playout/proof-instant.js';

// PROOF-R1 — the play instant (pure). Fixed instants only: the rule is about the DISTANCE between the
// player's timestamp and the receipt, never about the wall clock of the run.
const RECEIVED = new Date('2026-09-24T12:00:00.000Z');
const r = RECEIVED.getTime();

describe('proofPlayedAt — the instant a proof is credited to', () => {
  it('a live proof (timestamp ≈ receipt) is credited to the player timestamp', () => {
    expect(proofPlayedAt(r - 1_500, RECEIVED)).toEqual(new Date(r - 1_500));
  });

  it('a proof replayed 6 h late is credited to the hour it was PLAYED', () => {
    const played = r - 6 * 60 * 60 * 1000;
    expect(proofPlayedAt(played, RECEIVED)).toEqual(new Date(played));
  });

  it('exactly 24 h late is still credited; one ms older falls back to the receipt', () => {
    expect(proofPlayedAt(r - LATE_PROOF_MAX_MS, RECEIVED)).toEqual(new Date(r - LATE_PROOF_MAX_MS));
    expect(proofPlayedAt(r - LATE_PROOF_MAX_MS - 1, RECEIVED)).toEqual(RECEIVED);
  });

  it('a player clock slightly AHEAD is capped at the receipt — never a future hour', () => {
    expect(proofPlayedAt(r + 90_000, RECEIVED)).toEqual(RECEIVED);
  });

  it('a clock far ahead, no timestamp, or garbage → the receipt instant (the pre-R1 rule)', () => {
    expect(proofPlayedAt(r + CLOCK_AHEAD_TOLERANCE_MS + 1, RECEIVED)).toEqual(RECEIVED);
    expect(proofPlayedAt(null, RECEIVED)).toEqual(RECEIVED);
    expect(proofPlayedAt(Number.NaN, RECEIVED)).toEqual(RECEIVED);
  });
});
