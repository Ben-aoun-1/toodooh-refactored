// EV2 — the event-spot length seam. Billing is S_ref-fixed (a spot's real length never changes
// the price — pricing.ts), but the ANTENNE grid is 15-second slots: an event VIDEO longer than
// 15 s cannot air. Photos always pass (their configured duration is a display cadence, not a
// media length). Exported and unit-tested here; EV3's positioning parcours wires it — NOTHING
// calls it yet.

export const EVENT_SPOT_MAX_SECONDS = 15;

export interface EventSpotCheck {
  creativeType: string;
  durationSeconds: number | null;
}

export type EventSpotVerdict = { ok: true } | { ok: false; reason: string };

export function validateEventSpot(creative: EventSpotCheck): EventSpotVerdict {
  if (creative.creativeType === 'video') {
    if (creative.durationSeconds === null || creative.durationSeconds <= 0) {
      return { ok: false, reason: 'La durée du spot vidéo est inconnue.' };
    }
    if (creative.durationSeconds > EVENT_SPOT_MAX_SECONDS) {
      return {
        ok: false,
        reason: `Un spot vidéo événementiel ne peut pas dépasser ${EVENT_SPOT_MAX_SECONDS} secondes.`,
      };
    }
  }
  return { ok: true };
}
