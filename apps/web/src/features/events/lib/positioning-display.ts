import { eventSlotSeconds } from './event-minutes';

// The « Je me positionne » Foot parcours as Mariem drew it (04/11, Toodooh_Je_me_positionne_Foot
// .html): the display rules its components render, ONE home, pinned by tests (the web has no
// render harness). The figures themselves stay the api's (cmax, coverage, the dry-run).

const TUNIS = 'Africa/Tunis';

/** « 21:00 » — the kickoff on the ticket's stub, Tunis wall-clock. */
export const kickoffClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TUNIS,
  });

/** The récap's zones line: « Tout le réseau », « 1 zone · Grand Tunis », « 2 zones · A, B ». */
export const zonesSummary = (names: readonly string[]): string =>
  names.length === 0
    ? 'Tout le réseau'
    : `${names.length} zone${names.length > 1 ? 's' : ''} · ${names.join(', ')}`;

/**
 * The map's caption: the SERVER's covered count (MAP-2 — the dots are only its plottable subset,
 * the remainder said out loud), worded for the whole network or for the zones picked.
 */
export const coverageCaption = (opts: {
  wholeNetwork: boolean;
  count: number;
  withoutCoordinates: number;
}): string => {
  const plural = opts.count > 1 ? 's' : '';
  const unplotted =
    opts.withoutCoordinates > 0 ? `, dont ${opts.withoutCoordinates} sans coordonnées` : '';
  return opts.wholeNetwork
    ? `Tout le réseau · ${opts.count} établissement${plural}${unplotted}`
    : `${opts.count} établissement${plural} couvert${plural}${unplotted}`;
};

export type StepState = 'done' | 'current' | 'todo';

/** A stepper dot: ✓ behind, the ball on the current step, its number ahead. */
export const stepState = (stepId: number, current: number): StepState =>
  stepId < current ? 'done' : stepId === current ? 'current' : 'todo';

/** Where a slider's value sits on its track, 0–100 (the width of the filled part). */
export const sliderPercent = (value: number, min: number, max: number): number => {
  if (max <= min) return value >= max ? 100 : 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
};

/** A spot's length line in « Vos créations »: « 11s → créneau de 12 s » (or « 11s »). */
export const spotLengthLine = (creativeType: string, durationSeconds: number | null): string => {
  const slot = eventSlotSeconds(creativeType, durationSeconds);
  const length = `${durationSeconds ?? '—'}s`;
  return slot === null ? length : `${length} → créneau de ${slot} s`;
};
