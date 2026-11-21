// FLEET-1 (operator 18/11, phase 1) — « Parc d'écrans »: what state a TV is in, PURE. The admin
// reads one word and one colour per screen; the rule compares what the screen SHOULD air now (its
// venue's plan for the current hour, minus a match window) with what it REPORTS (heartbeat, live
// socket, proofs). Phase 1 needs no new APK: every TV already sends heartbeats and proofs.

export type FleetStatus =
  /** Connected, ads planned this hour (or a match's ad page on air), a proof recently. */
  | 'diffuse'
  /** Connected, nothing planned now (or a match between two of its ad pages). Normal. */
  | 'rien_prevu'
  /** Connected, ads planned, but no proof for longer than the planned rhythm allows. */
  | 'muet'
  /** No signal while the venue is open or ads are planned: needs attention. */
  | 'hors_ligne_ouverture'
  /** No signal outside the opening hours, nothing planned: probably switched off. */
  | 'hors_ligne'
  /** Never connected. */
  | 'jamais';

/** A heartbeat every 30 s: three missed ones and the TV is offline. */
export const ONLINE_WINDOW_MS = 90 * 1000;

/** A planned screen is « muet » after max(20 min, two planned intervals) without a proof. */
export const SILENT_FLOOR_MS = 20 * 60 * 1000;

export interface StatusInput {
  now: Date;
  connected: boolean;
  lastSeenAt: Date | null;
  pairedAt: Date | null;
  /** Σ planned passes this hour (0 when nothing is planned or a match blacks the hour out). */
  plannedRepsNow: number;
  /** When the current run of planned hours began (null when nothing is planned now). */
  plannedSince: Date | null;
  /** The last VIDEO_STARTED this screen sent. */
  lastProofAt: Date | null;
  /** Inside the venue's declared opening hours (false when undeclared). */
  openNow: boolean;
  /**
   * FLEET-3 — a confirmed match holds the venue: classic is paused and only the match's ad pages
   * air. `pod` is the page on air or just ended (null between pages, or when the venue has none).
   */
  match?: { pod: { start: Date; end: Date } | null } | null;
}

/** A page's first pass is due at its opening: this long without it and the TV missed the start. */
export const POD_GRACE_MS = 90 * 1000;

/**
 * FLEET-3 — an ONLINE screen during a match. While a page is on air a pass since its opening
 * means « diffuse »; none after {@link POD_GRACE_MS} means « muet ». Once the page has ended, a
 * screen that aired it has nothing planned until the next one; one that aired none of it stays
 * « muet » for as long as the page is remembered (lib/fleet/event-pods.ts).
 */
export const matchStatus = (
  now: Date,
  pod: { start: Date; end: Date } | null,
  lastProofAt: Date | null,
): FleetStatus => {
  if (pod === null) return 'rien_prevu';
  const aired = lastProofAt !== null && lastProofAt.getTime() >= pod.start.getTime();
  if (now.getTime() < pod.end.getTime()) {
    return aired || now.getTime() - pod.start.getTime() <= POD_GRACE_MS ? 'diffuse' : 'muet';
  }
  return aired ? 'rien_prevu' : 'muet';
};

/** How long a planned screen may stay without a proof before it reads « muet ». */
export const silentAfterMs = (plannedReps: number): number =>
  plannedReps > 0
    ? Math.max(SILENT_FLOOR_MS, 2 * (3_600_000 / plannedReps))
    : Number.POSITIVE_INFINITY;

export const isOnline = (i: Pick<StatusInput, 'now' | 'connected' | 'lastSeenAt'>): boolean =>
  i.connected ||
  (i.lastSeenAt !== null && i.now.getTime() - i.lastSeenAt.getTime() <= ONLINE_WINDOW_MS);

export const fleetStatus = (i: StatusInput): FleetStatus => {
  if (!isOnline(i)) {
    if (i.lastSeenAt === null && i.pairedAt === null) return 'jamais';
    return i.plannedRepsNow > 0 || i.openNow ? 'hors_ligne_ouverture' : 'hors_ligne';
  }
  if (i.match) return matchStatus(i.now, i.match.pod, i.lastProofAt);
  if (i.plannedRepsNow <= 0) return 'rien_prevu';
  const limit = silentAfterMs(i.plannedRepsNow);
  const now = i.now.getTime();
  // Too early to judge: the planned run started less than one « silence » ago.
  const runAge = i.plannedSince ? now - i.plannedSince.getTime() : 0;
  const sinceProof = i.lastProofAt ? now - i.lastProofAt.getTime() : Number.POSITIVE_INFINITY;
  if (sinceProof > limit && runAge > limit) return 'muet';
  return 'diffuse';
};

/** Most urgent first — the order of the counters and of the list. */
export const FLEET_STATUS_ORDER: readonly FleetStatus[] = [
  'hors_ligne_ouverture',
  'muet',
  'diffuse',
  'rien_prevu',
  'hors_ligne',
  'jamais',
];

/** Inside [opening, closing) of the day (closing ≤ opening = open past midnight). */
export const isOpenAt = (hour: number, opening: number | null, closing: number | null): boolean => {
  if (opening === null || closing === null) return false;
  if (opening === closing) return true;
  return opening < closing ? hour >= opening && hour < closing : hour >= opening || hour < closing;
};
