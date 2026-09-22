import { db } from '../../src/db/client.js';
import { type NewScreen, screens } from '../../src/db/schema.js';

// MAP-TV1 (operator ruling 2026-09-21, M1 A · M2 A) — a venue is SELLABLE only with at least one
// INSTALLED screen: a `screens` row whose paired_at or last_seen_at is set
// (lib/installed-screen.ts). Every surface that sells or places a venue reads it: the dispatch
// pool (and through it C_max, the refusal cascade, redispatch, the booster and « Hosts
// éligibles »), the event ceiling and the event pool, and the advertiser coverage map.
//
// THE fixture for it. A test about something else seeds its venue, then
//
//   await seedInstalledScreen(venueId);
//
// The default row is PAIRED ONLY (paired_at at a fixed past instant, last_seen_at NULL): installed,
// yet never seen, so every LIVENESS reader (redispatch's dead-screen rule, the owner's device
// status, the admin « en ligne » count) sees exactly what it saw when the venue had no row at all.
// A test that needs another shape passes overrides (pairedAt, lastSeenAt, name, isActive…).

/** The fixed pairing stamp of a fixture screen — a date, not the wall clock. */
export const FIXTURE_PAIRED_AT = new Date('2024-01-01T00:00:00.000Z');

export const seedInstalledScreen = async (
  screenhostId: string,
  values: Partial<NewScreen> = {},
): Promise<string> => {
  const [row] = await db
    .insert(screens)
    .values({ screenhostId, name: 'Écran installé', pairedAt: FIXTURE_PAIRED_AT, ...values })
    .returning({ id: screens.id });
  if (!row) throw new Error('seedInstalledScreen: the insert returned no row');
  return row.id;
};
