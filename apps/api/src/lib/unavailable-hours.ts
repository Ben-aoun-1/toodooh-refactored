import { and, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../db/client.js';
import { screenhostUnavailability, screenhostUnavailableHours } from '../db/schema.js';

import { addIsoDays, openingHours } from './opening-hours.js';

// HOUR-UNAV1 (Mariem 26/10, operator rulings 2026-10-27) — THE one home of « when is this venue
// unavailable? ». An owner (or an admin) declares either a WHOLE opening day
// (screenhost_unavailability, unchanged since E2) or some of its HOURS
// (screenhost_unavailable_hours). Every reader — the dispatch pool, the coverage map, event
// pricing, SPS, the agent follow-up, the admin Tests page, the AI report — asks THIS module for
// one merged set of clock cells, so they can never disagree.
//
// A cell is a clock (date, hour) — the SAME dating the créneaux use: an overnight venue open
// 20:00 → 02:00 whose opening day is the 10th has its 00:00 and 01:00 cells dated the 11th. A
// whole declared day therefore means EVERY cell of that opening day, post-midnight ones included
// (which also settles E2's old split, where the pool dropped the opening day but the writer
// removed créneaux by calendar date). A venue without hours yet: the day's 24 clock hours.

export interface Cell {
  date: string;
  hour: number;
}

export const cellKey = (date: string, hour: number): string => `${date}:${hour}`;

type Executor = Pick<typeof db, 'select'>;

export interface VenueHours {
  id: string;
  openingHour: number | null;
  closingHour: number | null;
}

/** Every clock cell of opening day `day` (no hours yet → the day's 24 hours). */
export const openingDayCells = (
  day: string,
  openingHour: number | null,
  closingHour: number | null,
): Cell[] => {
  const hours = openingHours(openingHour, closingHour);
  if (hours.length === 0) return Array.from({ length: 24 }, (_, hour) => ({ date: day, hour }));
  return hours.map(({ hour, dayOffset }) => ({
    date: dayOffset ? addIsoDays(day, dayOffset) : day,
    hour,
  }));
};

/**
 * The cells of the chosen HOURS of opening day `day` — only hours inside the venue's window are
 * kept (a venue without hours accepts any hour of the day). Returns null when nothing valid is
 * left, so a caller can refuse the request.
 */
export const cellsForHours = (
  day: string,
  hours: readonly number[],
  openingHour: number | null,
  closingHour: number | null,
): Cell[] | null => {
  const wanted = new Set(hours);
  const cells = openingDayCells(day, openingHour, closingHour).filter((c) => wanted.has(c.hour));
  return cells.length === 0 ? null : cells;
};

/**
 * The merged unavailable cells of `venues` whose DATE falls in [fromDate, toDate] (inclusive),
 * keyed by venue → Set of cellKey. Whole days are read one day early so an overnight opening day
 * that started the day before still contributes its post-midnight cells.
 */
export const loadUnavailableCells = async (
  executor: Executor,
  venues: readonly VenueHours[],
  fromDate: string,
  toDate: string,
): Promise<Map<string, Set<string>>> => {
  const out = new Map<string, Set<string>>();
  if (venues.length === 0) return out;
  const ids = venues.map((v) => v.id);
  const byId = new Map(venues.map((v) => [v.id, v]));
  const [dayRows, hourRows] = await Promise.all([
    executor
      .select({
        screenhostId: screenhostUnavailability.screenhostId,
        day: screenhostUnavailability.day,
      })
      .from(screenhostUnavailability)
      .where(
        and(
          inArray(screenhostUnavailability.screenhostId, ids),
          gte(screenhostUnavailability.day, addIsoDays(fromDate, -1)),
          lte(screenhostUnavailability.day, toDate),
        ),
      ),
    executor
      .select({
        screenhostId: screenhostUnavailableHours.screenhostId,
        day: screenhostUnavailableHours.day,
        hour: screenhostUnavailableHours.hour,
      })
      .from(screenhostUnavailableHours)
      .where(
        and(
          inArray(screenhostUnavailableHours.screenhostId, ids),
          gte(screenhostUnavailableHours.day, fromDate),
          lte(screenhostUnavailableHours.day, toDate),
        ),
      ),
  ]);
  const add = (id: string, c: Cell) => {
    if (c.date < fromDate || c.date > toDate) return;
    const set = out.get(id) ?? new Set<string>();
    set.add(cellKey(c.date, c.hour));
    out.set(id, set);
  };
  for (const r of dayRows) {
    const v = byId.get(r.screenhostId);
    for (const c of openingDayCells(r.day, v?.openingHour ?? null, v?.closingHour ?? null)) {
      add(r.screenhostId, c);
    }
  }
  for (const r of hourRows) add(r.screenhostId, { date: r.day, hour: r.hour });
  return out;
};

/** True when every cell of opening day `day` is unavailable (the « whole day » display). */
export const isWholeDayUnavailable = (
  day: string,
  cells: ReadonlySet<string> | undefined,
  openingHour: number | null,
  closingHour: number | null,
): boolean =>
  cells !== undefined &&
  openingDayCells(day, openingHour, closingHour).every((c) => cells.has(cellKey(c.date, c.hour)));

/** The unavailable cells of opening day `day` (for « 2 h indisponibles », partial days). */
export const unavailableCellsOfDay = (
  day: string,
  cells: ReadonlySet<string> | undefined,
  openingHour: number | null,
  closingHour: number | null,
): Cell[] =>
  cells === undefined
    ? []
    : openingDayCells(day, openingHour, closingHour).filter((c) =>
        cells.has(cellKey(c.date, c.hour)),
      );

/**
 * The calendar's read, shared by the owner and admin routes: the opening days of [from, to]
 * that are WHOLLY unavailable (`days` — the field every client, the mobile app included, already
 * reads) and every unavailable clock cell (`hours`), plus the venue's window the clients map the
 * cells back onto.
 */
export const unavailabilityView = async (
  venue: VenueHours,
  from: string,
  to: string,
): Promise<{
  days: string[];
  hours: { day: string; hour: number }[];
  opening_hour: number | null;
  closing_hour: number | null;
}> => {
  const cells =
    (await loadUnavailableCells(db, [venue], from, addIsoDays(to, 1))).get(venue.id) ??
    new Set<string>();
  const days: string[] = [];
  for (let d = from; d <= to; d = addIsoDays(d, 1)) {
    if (isWholeDayUnavailable(d, cells, venue.openingHour, venue.closingHour)) days.push(d);
  }
  const hours = [...cells]
    .map((k) => ({ day: k.slice(0, 10), hour: Number(k.slice(11)) }))
    .sort((a, b) => (a.day === b.day ? a.hour - b.hour : a.day < b.day ? -1 : 1));
  return { days, hours, opening_hour: venue.openingHour, closing_hour: venue.closingHour };
};

/**
 * « Disponible » / « Indisponible toute la journée » / « Indisponible 14 h–16 h, 20 h–21 h » —
 * one opening day's state in words (the admin edit trail). Ranges follow the venue's window
 * order, so an overnight 23 h–1 h reads as one range.
 */
export const describeDay = (
  day: string,
  cells: ReadonlySet<string>,
  openingHour: number | null,
  closingHour: number | null,
): string => {
  const window = openingDayCells(day, openingHour, closingHour);
  const off = window.map((c) => cells.has(cellKey(c.date, c.hour)));
  if (off.every((x) => !x)) return 'Disponible';
  if (off.every((x) => x)) return 'Indisponible toute la journée';
  const ranges: string[] = [];
  for (let i = 0; i < window.length; i += 1) {
    if (!off[i]) continue;
    let j = i;
    while (j + 1 < window.length && off[j + 1]) j += 1;
    const start = window[i]?.hour ?? 0;
    const end = ((window[j]?.hour ?? 0) + 1) % 24;
    ranges.push(`${start} h–${end} h`);
    i = j;
  }
  return `Indisponible ${ranges.join(', ')}`;
};
