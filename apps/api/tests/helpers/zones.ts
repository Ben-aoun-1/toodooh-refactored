import { inArray, ne } from 'drizzle-orm';

import { db } from '../../src/db/client.js';
import { campaignZones, screenhosts, zones } from '../../src/db/schema.js';

// TEST-ISO1 — zones is a GLOBAL table. It has no FK chain to users, so resetAuthTables never
// empties it: a row one file inserts is still there for every later file on the same worker
// database. advertiser-performances pins the EXACT active-zone catalogue (« every zone » = Grand
// Tunis only), so a leaked row fails it or not depending on which files share a worker.
//
// Both ends are fixed here:
//   - a file that seeds zones tracks their ids and SWEEPS them in afterEach (sweepZones);
//   - a file that pins the whole catalogue puts it back to the seed first (resetZonesToSeed).
//
// screenhosts.zone_id and campaign_zones.zone_id are NO ACTION foreign keys, and in afterEach the
// referencing rows are still alive (the users truncate only runs in the NEXT beforeEach), so the
// dependents go first: venues drop the zone (NULL = « no zone », which the V1 schema allows) and
// the campaign-zone links are deleted.

/** The mig-0040 seed: V1's one zone, with its fixed id. */
export const GRAND_TUNIS_ZONE_ID = '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f';

/** Delete the given zones and everything that points at them. No ids → no query. */
export const sweepZones = async (ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) return;
  const list = [...ids];
  await db.update(screenhosts).set({ zoneId: null }).where(inArray(screenhosts.zoneId, list));
  await db.delete(campaignZones).where(inArray(campaignZones.zoneId, list));
  await db.delete(zones).where(inArray(zones.id, list));
};

/** Put the catalogue back to the mig-0040 seed: every zone but Grand Tunis goes, dependents first. */
export const resetZonesToSeed = async (): Promise<void> => {
  const foreign = await db
    .select({ id: zones.id })
    .from(zones)
    .where(ne(zones.id, GRAND_TUNIS_ZONE_ID));
  await sweepZones(foreign.map((z) => z.id));
};
