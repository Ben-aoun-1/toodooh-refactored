import { hourLabel } from '@/features/events/lib/event-catalogue';
import type { EventItemView } from '@/features/events/services/events.api';

// The Screencaster dashboard's « Événements à venir » row (Mariem's Figma capture): which cards
// stand in the row. ONE home for the rule; the components only render the list.

/** The row never holds more than three cards. */
export const DASHBOARD_EVENT_CARDS = 3;

export type DashboardEventCard =
  | { kind: 'match'; event: EventItemView }
  | { kind: 'ramadan' }
  | { kind: 'catalogue' };

/** A match the Screencaster can position on now: official, not started, date and hour known. */
const isOpenMatch = (e: EventItemView): boolean =>
  e.source === 'official' && e.statut === 'a_venir' && e.positionable !== false;

/**
 * The row's cards: the next matches (soonest kick-off first), then the Ramadan offer, three cards
 * at most. With no upcoming match, the Ramadan offer stands next to one card that opens the events
 * catalogue. The input order is not trusted.
 */
export function dashboardEventCards(catalogue: readonly EventItemView[]): DashboardEventCard[] {
  const matches = catalogue
    .filter(isOpenMatch)
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))
    .slice(0, DASHBOARD_EVENT_CARDS - 1);
  if (matches.length === 0) return [{ kind: 'ramadan' }, { kind: 'catalogue' }];
  return [
    ...matches.map((event): DashboardEventCard => ({ kind: 'match', event })),
    { kind: 'ramadan' },
  ];
}

/** « 20h00 – 0h00 » — the diffusion window of a match, as the capture prints its hours. */
export function windowHours(e: EventItemView): string {
  const end = hourLabel(e.fenetre.window_end).replace(/^00h/, '0h');
  return `${hourLabel(e.fenetre.window_start)} – ${end}`;
}
