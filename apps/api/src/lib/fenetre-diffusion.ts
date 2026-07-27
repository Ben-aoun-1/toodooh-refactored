// EV1 — la fenêtre de diffusion événementielle. ONE backend home for the window math: the
// catalogue, the admin surface and (later, EV3) the positioning parcours all derive the window
// from the event's stored instants — NOTHING is persisted (deliberately no window/bloc columns on
// `events`, so a date edit can never leave a stale window behind).
//
// The contract (the two event documents):
//   - window  = kickoff − 1 h  →  end + 1 h;
//   - blocs   = exactly SIX 20-minute blocs — three PRE-match ending AT kickoff, three POST-match
//     starting AT the end, NONE during the match itself;
//   - all values are instants (timestamptz) — the math is timezone-free; Tunis enters only when
//     deriving the human-facing statut/date, via tunisDateOf-style formatting at the edges.

export const FENETRE_MARGE_MS = 60 * 60 * 1000; // 1 h before kickoff, 1 h after the end
export const BLOC_MINUTES = 20;
export const BLOCS_PRE_MATCH = 3;
export const BLOCS_POST_MATCH = 3;

/** Suggested matches carry no declared end — the product fixes their duration at kickoff + 2 h. */
export const SUGGESTED_MATCH_DURATION_HOURS = 2;

export interface BlocDiffusion {
  /** 'avant' = ends at (or before) kickoff; 'apres' = starts at (or after) the match end. */
  phase: 'avant' | 'apres';
  start: Date;
  end: Date;
}

export interface FenetreDiffusion {
  windowStart: Date;
  windowEnd: Date;
  blocs: BlocDiffusion[];
}

const BLOC_MS = BLOC_MINUTES * 60 * 1000;

/**
 * Derive the diffusion window for an event. Pure: same instants in, same window out.
 * Throws on an inverted event (ends ≤ kickoff) — the DB CHECK makes that unrepresentable, so a
 * throw here means a caller bypassed the schema.
 */
export function fenetreDiffusion(kickoffAt: Date, endsAt: Date): FenetreDiffusion {
  if (endsAt.getTime() <= kickoffAt.getTime()) {
    throw new Error('fenetreDiffusion: ends_at must be after kickoff_at');
  }
  const blocs: BlocDiffusion[] = [];
  // Three pre-match blocs, the LAST ending exactly AT kickoff: [k−60,k−40] [k−40,k−20] [k−20,k].
  for (let i = BLOCS_PRE_MATCH; i >= 1; i -= 1) {
    blocs.push({
      phase: 'avant',
      start: new Date(kickoffAt.getTime() - i * BLOC_MS),
      end: new Date(kickoffAt.getTime() - (i - 1) * BLOC_MS),
    });
  }
  // Three post-match blocs, the FIRST starting exactly AT the end: [e,e+20] [e+20,e+40] [e+40,e+60].
  for (let i = 0; i < BLOCS_POST_MATCH; i += 1) {
    blocs.push({
      phase: 'apres',
      start: new Date(endsAt.getTime() + i * BLOC_MS),
      end: new Date(endsAt.getTime() + (i + 1) * BLOC_MS),
    });
  }
  return {
    windowStart: new Date(kickoffAt.getTime() - FENETRE_MARGE_MS),
    windowEnd: new Date(endsAt.getTime() + FENETRE_MARGE_MS),
    blocs,
  };
}

export type StatutEvenement = 'a_venir' | 'en_cours' | 'termine';

/** The event's derived status at `now`: à venir before kickoff, en cours during, terminé after. */
export function statutEvenement(now: Date, kickoffAt: Date, endsAt: Date): StatutEvenement {
  if (now.getTime() < kickoffAt.getTime()) return 'a_venir';
  if (now.getTime() < endsAt.getTime()) return 'en_cours';
  return 'termine';
}
