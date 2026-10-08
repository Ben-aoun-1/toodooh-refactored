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

/** How many times a spot airs in ONE bought minute: 60 ÷ its slot. null when it cannot air. */
export const eventPlaysPerMinute = (
  creativeType: string,
  durationSeconds: number | null,
): number | null => {
  const slot = eventSlotSeconds(creativeType, durationSeconds);
  return slot === null ? null : Math.floor(60 / slot);
};

/**
 * EVT-PLAY1 (operator ruling Q5) — how many times the ad airs IN TOTAL: the minutes bought (already
 * a network total — one minute = one seat in one bloc at one venue) × the plays per minute.
 * 30 minutes of an 11 s video (12 s slot, 5 plays a minute) = 150. null when the spot cannot air
 * or no minute is chosen yet.
 */
export const eventTotalPlays = (
  creativeType: string,
  durationSeconds: number | null,
  minutes: number | null,
): number | null => {
  const perMinute = eventPlaysPerMinute(creativeType, durationSeconds);
  if (perMinute === null || minutes === null || minutes < EVENT_MIN_MINUTES) return null;
  return Math.round(minutes) * perMinute;
};

/**
 * The multi-match parcours shares ONE spot across its positionings: the minutes behind the total
 * are their sum. null until at least one match has minutes chosen.
 */
export const groupMinutesTotal = (
  campaignIds: readonly string[],
  minutes: Readonly<Record<string, number | null>>,
): number | null => {
  const chosen = campaignIds.flatMap((id) => {
    const m = minutes[id];
    return m != null && m >= EVENT_MIN_MINUTES ? [m] : [];
  });
  return chosen.length === 0 ? null : chosen.reduce((s, m) => s + m, 0);
};

const playsFmt = new Intl.NumberFormat('fr-FR');

/**
 * The media step's repeat line: the TOTAL once the minutes are known, else the per-minute rate
 * (the minutes are chosen on the next step). null when the spot cannot air.
 */
export const eventRepeatsLabel = (
  creativeType: string,
  durationSeconds: number | null,
  minutes: number | null,
): string | null => {
  const perMinute = eventPlaysPerMinute(creativeType, durationSeconds);
  if (perMinute === null) return null;
  const rate = `${perMinute} fois par minute achetée`;
  const total = eventTotalPlays(creativeType, durationSeconds, minutes);
  if (total === null || minutes === null) {
    return `Votre annonce sera diffusée ${rate} — le total s’affiche dès que vous choisissez vos minutes.`;
  }
  return `Votre annonce sera diffusée ${playsFmt.format(total)} fois au total (${minutesLabel(Math.round(minutes))} × ${rate}).`;
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

// ─── The multi-match recap (EVT-CAT2, ruling A1) ─────────────────────────────────────────────

/** The big slider's bounds: one minute per match that still has one, up to all their minutes. */
export function groupMinutesBounds(maxes: readonly number[]): { min: number; max: number } {
  const open = maxes.filter((m) => m >= EVENT_MIN_MINUTES);
  return { min: open.length, max: open.reduce((s, m) => s + m, 0) };
}

/**
 * Ruling A1 — spread the big slider's `total` over the matches IN PROPORTION to their free
 * minutes: every match with a free minute gets ≥ 1 and ≤ its max, the parts sum to `total`
 * (clamped into the bounds). Largest remainder, ties to the earlier match. A match with no free
 * minute gets 0.
 */
export function distributeEventMinutes(total: number, maxes: readonly number[]): number[] {
  const { min, max } = groupMinutesBounds(maxes);
  if (max === 0) return maxes.map(() => 0);
  const target = Math.min(Math.max(Math.round(total), min), max);
  const ideal = maxes.map((m) => (m >= EVENT_MIN_MINUTES ? (target * m) / max : 0));
  const parts = maxes.map((m, i) =>
    m >= EVENT_MIN_MINUTES
      ? Math.min(m, Math.max(EVENT_MIN_MINUTES, Math.floor(ideal[i] ?? 0)))
      : 0,
  );
  let diff = target - parts.reduce((s, p) => s + p, 0);
  const order = (key: (i: number) => number) =>
    maxes.map((_, i) => i).sort((a, b) => key(b) - key(a) || a - b);
  while (diff > 0) {
    const grow = order((i) => (ideal[i] ?? 0) - (parts[i] ?? 0)).filter(
      (i) => (parts[i] ?? 0) < (maxes[i] ?? 0),
    );
    if (grow.length === 0) break;
    for (const i of grow) {
      if (diff === 0) break;
      parts[i] = (parts[i] ?? 0) + 1;
      diff -= 1;
    }
  }
  while (diff < 0) {
    const shrink = order((i) => (parts[i] ?? 0) - (ideal[i] ?? 0)).filter(
      (i) => (parts[i] ?? 0) > EVENT_MIN_MINUTES,
    );
    if (shrink.length === 0) break;
    for (const i of shrink) {
      if (diff === 0) break;
      parts[i] = (parts[i] ?? 0) - 1;
      diff += 1;
    }
  }
  return parts;
}
