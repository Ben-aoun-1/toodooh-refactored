import { type Tranche } from './file.js';

// DISP-TOURS — REMPLIR, PURE (Mariem's spec R7, R8, R10).
//   R7 — walk the file, taking WHOLE tranches while they fit in what is left to deliver; stop as
//        soon as the target is met or the file is exhausted.
//   R8 — when the next tranche taken whole would overshoot, keep k passages per hour instead of
//        R_plein — the SAME k on every hour and every date of that tranche, the largest whole
//        number that does not exceed the rest: k = ⌊reste ÷ (V ÷ R_plein)⌋. k = 0 = not taken.
//   R10 — the cursor only calls REMPLIR again on the file already built (never the typical week):
//        lowering the budget undoes the fill in reverse order, which IS a fill to the new target.
// The cut is found by binary search on the running totals (CUM).

/** Floating-point slack, in impressions (values are sums of A × passages × T). */
export const EPS = 1e-6;

/** Tranches [0, cut) are taken whole; tranche `cut` keeps k passages per hour (0 = not taken). */
export interface Remplissage {
  cut: number;
  k: number;
}

export const remplir = (file: readonly Tranche[], iCible: number, rPlein: number): Remplissage => {
  if (file.length === 0 || rPlein <= 0 || iCible <= EPS) return { cut: 0, k: 0 };
  let lo = 0;
  let hi = file.length - 1;
  let p = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((file[mid]?.cum ?? 0) + EPS >= iCible) {
      p = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (p === -1) return { cut: file.length, k: 0 }; // the whole file fits: every tranche whole
  const cut = file[p];
  if (!cut) return { cut: file.length, k: 0 };
  const reste = iCible - (p > 0 ? (file[p - 1]?.cum ?? 0) : 0);
  const k = Math.min(rPlein, Math.max(0, Math.floor((reste * rPlein) / cut.v + EPS)));
  return k >= rPlein ? { cut: p + 1, k: 0 } : { cut: p, k };
};

/** One tranche taken: `passages` per hour on every hour and date of the tranche. */
export interface Prise {
  tranche: Tranche;
  passages: number;
}

/** The tranches a fill takes, in file order (the partial one last). */
export const prisesDe = (file: readonly Tranche[], fill: Remplissage, rPlein: number): Prise[] => {
  const prises: Prise[] = file.slice(0, fill.cut).map((tranche) => ({ tranche, passages: rPlein }));
  const partielle = file[fill.cut];
  if (fill.k > 0 && partielle) prises.push({ tranche: partielle, passages: fill.k });
  return prises;
};

/** IMPRESSIONS(tranche, passages) = V × passages ÷ R_plein (qualified impressions). */
export const impressionsDe = (prise: Prise, rPlein: number): number =>
  (prise.tranche.v * prise.passages) / rPlein;

/** Σ qualified impressions per venue over the taken tranches. */
export const impressionsParVenue = (
  prises: readonly Prise[],
  rPlein: number,
): Map<string, number> => {
  const byVenue = new Map<string, number>();
  for (const p of prises) {
    byVenue.set(
      p.tranche.venueId,
      (byVenue.get(p.tranche.venueId) ?? 0) + impressionsDe(p, rPlein),
    );
  }
  return byVenue;
};
