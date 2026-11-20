// 20/11 (operator) — « all sliders should have an initial position as max ». Replaces the CF-U1
// null start (« — » until the first drag): as soon as a slider's maximum is known, an UNCHOSEN
// value starts there. One home for the rule; every budget / minutes slider reads it.

/**
 * The value an unchosen slider takes once its maximum is known, or null to leave it alone:
 * a value already chosen is never overwritten, and a maximum below the minimum (zero
 * inventory) leaves the slider empty so the empty-state keeps owning the step.
 */
export const sliderStartAtMax = (
  value: number | null,
  max: number | undefined,
  min: number,
): number | null => {
  if (value !== null || max === undefined) return null;
  if (!(max > min)) return null;
  return max;
};

/** Minutes move by whole seats: the start is the largest whole number of seats under the max. */
export const minutesStartAtMax = (
  value: number | null,
  maxMinutes: number | undefined,
  seat: number,
): number | null => {
  if (maxMinutes === undefined) return null;
  const s = Math.max(1, seat);
  const top = Math.floor(maxMinutes / s) * s;
  return sliderStartAtMax(value, top, s - 1);
};
