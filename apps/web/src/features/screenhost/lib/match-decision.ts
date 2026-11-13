/**
 * Mariem 05/11/2026 — the « Soir de match » popup (mockup Toodooh_Notif_Match_Host): the pure
 * display rules, ONE home (the popup, the bell and the tests read these). The owner answers for
 * every spot of a match at one venue; the api's notice is `event_match_pending_acceptance`, naming
 * its match and venue (lib/event-host-notice on the api side).
 */
export const MATCH_NOTIFICATION_TYPE = 'event_match_pending_acceptance';

const TUNIS = 'Africa/Tunis';

/** The key of one match decision: a match at a venue. */
export const matchKey = (eventId: string, screenhostId: string): string =>
  `${eventId}:${screenhostId}`;

/** A « Soir de match » notice, with the match and venue it opens. */
export const matchOfNotification = (n: {
  kind: string;
  eventId?: string | null;
  screenhostId?: string | null;
}): { eventId: string; screenhostId: string } | null =>
  n.kind === MATCH_NOTIFICATION_TYPE && n.eventId && n.screenhostId
    ? { eventId: n.eventId, screenhostId: n.screenhostId }
    : null;

/** « Équipe A - Équipe B » → the two teams, for the « A VS B » line; null for a soirée name. */
export const matchTeams = (name: string): [string, string] | null => {
  const parts = name.split(/\s+(?:-|–|—|vs\.?|VS)\s+/);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim());
  return a && b ? [a, b] : null;
};

/** « Mercredi 4 novembre 2026 » — the kick-off day in Tunis. */
export const matchDateLabel = (kickoffIso: string): string => {
  const day = new Date(kickoffIso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TUNIS,
  });
  return day.charAt(0).toUpperCase() + day.slice(1);
};

/** « 21:00 » — the kick-off time in Tunis. */
export const matchKickoffLabel = (kickoffIso: string): string =>
  new Date(kickoffIso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TUNIS,
  });

/** « 64,800 TND » — the match total in millimes, as the mockup and the match's notice write it. */
export const matchAmountLabel = (tnd: number): string =>
  `${tnd.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;

/** The gain badge: « Total · 3 spots ». */
export const matchSpotsBadge = (count: number): string =>
  `Total · ${count} spot${count > 1 ? 's' : ''}`;

/** The list heading: « Spots à diffuser (3) » / « Spot à diffuser (1) ». */
export const matchSpotsHeading = (count: number): string =>
  `${count > 1 ? 'Spots' : 'Spot'} à diffuser (${count})`;

/** « 00:20 » — a spot's length; « — » when unknown. */
export const spotDurationLabel = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** A spot's name: its title, else its file name, else « Spot n ». */
export const spotName = (
  creative: { title: string | null; filename: string | null } | null,
  index: number,
): string => creative?.title?.trim() || creative?.filename?.trim() || `Spot ${index + 1}`;

export const MATCH_FOOTNOTE = 'Votre réponse s’applique à tous les spots de ce match.';
