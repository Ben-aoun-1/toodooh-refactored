// EVT-MIN1 (operator rulings 2026-10-05) — the event MINUTES model, web side: ONE home for the
// rules the positioning parcours renders (the api's lib/event-pricing/minutes.ts is the truth;
// these mirror it for display and client pre-checks).
//
//   • a bloc's 5-minute pod holds five one-minute seats; a screencaster buys MINUTES, one per
//     (venue, bloc) with a free seat — the slider runs 1 → max_minutes;
//   • the api sends the ORDERED minute prices/impressions: N minutes cost the sum of the first N
//     (lowering the slider gives up the last venue's latest bloc first);
//   • an event video lasts 10–30 s and airs in the smallest slot dividing the minute
//     (10/12/15/20/30 s); an image shows 10, 20 or 30 s.

export const EVENT_MIN_MINUTES = 1;
export const EVENT_VIDEO_MIN_SECONDS = 10;
export const EVENT_VIDEO_MAX_SECONDS = 30;
export const EVENT_SLOT_CLASSES = [10, 12, 15, 20, 30] as const;
export const EVENT_IMAGE_SECONDS = [10, 20, 30] as const;

/** The French refusal for a video outside the range — mirrors the api's message. */
export const EVENT_SPOT_RANGE_MESSAGE = `Un spot vidéo événementiel dure entre ${EVENT_VIDEO_MIN_SECONDS} et ${EVENT_VIDEO_MAX_SECONDS} secondes.`;

/** The slot a spot airs in, or null when it cannot air in an event pod (api eventSlotSeconds). */
export const eventSlotSeconds = (
  creativeType: string,
  durationSeconds: number | null,
): number | null => {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) return null;
  if (creativeType === 'video') {
    if (durationSeconds < EVENT_VIDEO_MIN_SECONDS || durationSeconds > EVENT_VIDEO_MAX_SECONDS) {
      return null;
    }
    return EVENT_SLOT_CLASSES.find((c) => c >= durationSeconds) ?? null;
  }
  return (EVENT_IMAGE_SECONDS as readonly number[]).includes(durationSeconds)
    ? durationSeconds
    : null;
};

/**
 * The slot line shown under a spot: « Créneau de 30 s — 23 s de spot + 7 s d’écran Toodooh,
 * 2 fois par minute ». null when the spot cannot air.
 */
export const eventSlotLabel = (
  creativeType: string,
  durationSeconds: number | null,
): string | null => {
  const slot = eventSlotSeconds(creativeType, durationSeconds);
  if (slot === null || durationSeconds === null) return null;
  const plays = Math.floor(60 / slot);
  const filler = slot - durationSeconds;
  const content =
    creativeType === 'video' && filler > 0
      ? `${durationSeconds} s de spot + ${filler} s d’écran Toodooh`
      : `${slot} s`;
  return `Créneau de ${slot} s — ${content}, ${plays} fois par minute`;
};

const centimes = (tnd: number): number => Math.round(tnd * 100) / 100;

/** The price of the first `minutes` minutes (what the slider shows). */
export const eventMinutesPrice = (pricesTnd: readonly number[], minutes: number): number =>
  centimes(pricesTnd.slice(0, Math.max(0, minutes)).reduce((sum, p) => sum + p, 0));

/** The impressions of the first `minutes` minutes. */
export const eventMinutesImpressions = (impressions: readonly number[], minutes: number): number =>
  impressions.slice(0, Math.max(0, minutes)).reduce((sum, n) => sum + n, 0);

/**
 * Keep a chosen count inside [1, max]: null stays null (nothing chosen yet), and a max of 0 (no
 * free seat left) leaves nothing to choose.
 */
export const clampEventMinutes = (minutes: number | null, maxMinutes: number): number | null => {
  if (minutes === null) return null;
  if (maxMinutes < EVENT_MIN_MINUTES) return null;
  return Math.min(Math.max(EVENT_MIN_MINUTES, Math.round(minutes)), maxMinutes);
};

/** « 1 minute » / « 12 minutes ». */
export const minutesLabel = (minutes: number): string =>
  `${minutes} minute${minutes > 1 ? 's' : ''}`;
