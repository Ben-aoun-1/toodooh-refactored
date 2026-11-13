import { formatInTimeZone } from 'date-fns-tz';

import { BLOC_MINUTES } from './fenetre-diffusion.js';

// DEMO-3 (operator 2026-11-04, ruling 1B) — a demo screencaster may position on a match. Its
// figures are the match's, computed on the demo venues (lib/demo.ts); at « Lancer » its blocs
// leave the match night: they are laid back to back from the demo's on-air instant — the confirm
// plus the admin's demo delay, on the next whole minute (the bloc pusher fires on the minute) —
// so the prospect watches the match break on the demo TV right away. Each distinct bloc keeps its
// rank (blocs shared between venues stay shared), every bloc keeps its 20 minutes, and nothing
// else moves: the seats, the price, the pod rules (a moved bloc ends before the real kickoff, so
// its pod opens it — the « avant » phase). Pure.

const MINUTE_MS = 60_000;
const BLOC_MS = BLOC_MINUTES * MINUTE_MS;
const TUNIS = 'Africa/Tunis';

interface PlacedBloc {
  start: string;
  end: string;
  impressions: number;
}

/** The demo's first bloc: `delayMinutes` after `now`, on the next whole minute. */
export const demoEventStart = (now: Date, delayMinutes: number): Date =>
  new Date(Math.ceil((now.getTime() + delayMinutes * MINUTE_MS) / MINUTE_MS) * MINUTE_MS);

/** The placements with their blocs moved onto the demo timeline that opens at `start`. */
export const demoEventPlacements = <P extends { blocs: PlacedBloc[] }>(
  placements: readonly P[],
  start: Date,
): P[] => {
  // toISOString is fixed-width UTC, so the strings sort chronologically.
  const ranks = [...new Set(placements.flatMap((p) => p.blocs.map((b) => b.start)))].sort();
  const rankOf = new Map(ranks.map((iso, i) => [iso, i]));
  return placements.map((p) => ({
    ...p,
    blocs: p.blocs.map((b) => {
      const at = start.getTime() + (rankOf.get(b.start) ?? 0) * BLOC_MS;
      return { ...b, start: new Date(at).toISOString(), end: new Date(at + BLOC_MS).toISOString() };
    }),
  }));
};

/**
 * The positioning's new start date: the demo's first day (Tunis), so the launch flips it active
 * and the bloc pusher announces its first pod. Its end date stays the match's: the event
 * settlement closes it when the match window closes, like every positioning of the match.
 */
export const demoEventStartDate = (start: Date): string =>
  formatInTimeZone(start, TUNIS, 'yyyy-MM-dd');
