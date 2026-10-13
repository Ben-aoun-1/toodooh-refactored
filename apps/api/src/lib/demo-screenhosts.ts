import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { businessSectors, screenhostAffluence, screenhosts } from '../db/schema.js';

import { broadcastableHours } from './opening-hours.js';

// DEMO-2 (operator 2026-10-13, rulings A A) — DEMO SCREENHOSTS: venues the admin creates for
// demos only. A point on the map with a random audience, nothing more — no owner, no screen, no
// event switch (broadcast_capacity stays NULL, so the event engine never sees one).
//   Q1 A — only demo screencasters see and buy them (lib/demo.ts demoVenueIds / realVenueSql);
//   Q2 A — their planned créneaux count as aired at settlement (reconcile/delivered-slots.ts).
// Removing one deactivates it (is_active = false): campaigns already dispatched there keep their
// rows, and every pool, map and demo set reads active venues only.

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

export interface AffluenceCell {
  dayOfWeek: number;
  hour: number;
  slot: number;
  estimatedImpressions: number;
}

/**
 * The random typical week: every half-hour slot of every open hour, days 1–7, a whole value
 * drawn uniformly in [min, max]. `random` is injectable so the grid is testable.
 */
export const randomAffluenceGrid = (
  openingHour: number,
  closingHour: number,
  min: number,
  max: number,
  random: () => number = Math.random,
): AffluenceCell[] => {
  const cells: AffluenceCell[] = [];
  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
    for (const hour of broadcastableHours(openingHour, closingHour)) {
      for (const half of [0, 1]) {
        cells.push({
          dayOfWeek,
          hour,
          slot: hour * 2 + half,
          estimatedImpressions: min + Math.floor(random() * (max - min + 1)),
        });
      }
    }
  }
  return cells;
};

export interface DemoScreenhostInput {
  name: string;
  latitude: number;
  longitude: number;
  city: string | null;
  businessSectorId: string | null;
  class: 'populaire' | 'moyen' | 'premium' | null;
  openingHour: number;
  closingHour: number;
  audienceMin: number;
  audienceMax: number;
}

export interface DemoScreenhostView {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  sector_name: string | null;
  class: string | null;
  opening_hour: number | null;
  closing_hour: number | null;
  created_at: string;
}

/** The active demo screenhosts, by name. */
export const listDemoScreenhosts = async (
  executor: Executor = db,
): Promise<DemoScreenhostView[]> => {
  const rows = await executor
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      latitude: screenhosts.latitude,
      longitude: screenhosts.longitude,
      city: screenhosts.city,
      sectorName: businessSectors.name,
      class: screenhosts.class,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      createdAt: screenhosts.createdAt,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId))
    .where(and(eq(screenhosts.demoOnly, true), eq(screenhosts.isActive, true)))
    .orderBy(asc(screenhosts.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    city: r.city,
    sector_name: r.sectorName,
    class: r.class,
    opening_hour: r.openingHour,
    closing_hour: r.closingHour,
    created_at: r.createdAt.toISOString(),
  }));
};

/** Creates the venue and its random typical week in one transaction; returns its id. */
export const createDemoScreenhost = async (
  input: DemoScreenhostInput,
  random: () => number = Math.random,
): Promise<string> =>
  db.transaction(async (tx) => {
    const [venue] = await tx
      .insert(screenhosts)
      .values({
        name: input.name,
        latitude: input.latitude.toFixed(8),
        longitude: input.longitude.toFixed(8),
        city: input.city,
        businessSectorId: input.businessSectorId,
        class: input.class,
        openingHour: input.openingHour,
        closingHour: input.closingHour,
        demoOnly: true,
        // Never sent to the hub: the wedooh sync only pushes venues with an approved owner.
        exportStatus: 'pending',
      })
      .returning({ id: screenhosts.id });
    if (!venue) throw new Error('demo screenhost insert returned no row');
    const cells = randomAffluenceGrid(
      input.openingHour,
      input.closingHour,
      input.audienceMin,
      input.audienceMax,
      random,
    );
    if (cells.length > 0) {
      await tx.insert(screenhostAffluence).values(
        cells.map((c) => ({
          screenhostId: venue.id,
          ...c,
          source: 'backup' as const,
          inEffect: true,
        })),
      );
    }
    return venue.id;
  });

/** Deactivates a demo screenhost; false when the id is not an active demo screenhost. */
export const removeDemoScreenhost = async (id: string): Promise<boolean> => {
  const rows = await db
    .update(screenhosts)
    .set({ isActive: false })
    .where(
      and(eq(screenhosts.id, id), eq(screenhosts.demoOnly, true), eq(screenhosts.isActive, true)),
    )
    .returning({ id: screenhosts.id });
  return rows.length > 0;
};
