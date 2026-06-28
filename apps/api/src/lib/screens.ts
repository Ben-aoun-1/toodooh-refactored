import { asc, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { screenhosts, screens } from '../db/schema.js';

// Screen-row generation (MAP M1 commit 2). Screens are materialized when a screenhost owner
// is APPROVED: screen_count rows per screenhost, named "Écran 1..N". The same rule backfills
// already-approved owners in migration 0014. Idempotent per screenhost — one that already
// has ANY screens is left alone (re-approval after a rejection must not duplicate, and an
// admin-adjusted fleet keeps its existing rows).
export const OWNER_ROLES = new Set(['individual_owner', 'fleet_owner']);

export const createMissingScreensForOwner = async (userId: string): Promise<void> => {
  const hosts = await db
    .select({ id: screenhosts.id, screenCount: screenhosts.screenCount })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, userId));
  if (hosts.length === 0) return;

  const withScreens = new Set(
    (
      await db
        .select({ screenhostId: screens.screenhostId })
        .from(screens)
        .where(
          inArray(
            screens.screenhostId,
            hosts.map((h) => h.id),
          ),
        )
    ).map((r) => r.screenhostId),
  );

  const rows = hosts
    .filter((h) => !withScreens.has(h.id) && h.screenCount > 0)
    .flatMap((h) =>
      Array.from({ length: h.screenCount }, (_, i) => ({
        screenhostId: h.id,
        name: `Écran ${i + 1}`,
      })),
    );
  if (rows.length > 0) await db.insert(screens).values(rows);
};

// Lane 5 (TV-app login) self-heal. A screenhost owner signs into the TV app expecting the
// screen they're holding to be openable, but screen rows only get materialized at approval
// from screen_count (createMissingScreensForOwner) — and an individual_owner's signup leaves
// screen_count at its 0 default (a fleet venue can also be declared with 0), so an APPROVED
// owner can end up with ZERO screen rows and an empty GET /api/screens/mine — nothing to pair.
// This guarantees the device read is never empty for an owner who actually has a venue: if the
// caller owns at least one screenhost but has no screen rows at all, register a single
// "Écran 1" on their first screenhost (by name, the order /mine lists in). Idempotent — a
// no-op the moment ANY screen exists, so it never fights createMissingScreensForOwner or a
// multi-screen fleet, and never over-provisions venues that already have screens. An owner
// with zero screenhosts is left untouched (no venue to attach a screen to).
export const ensureOwnerHasScreen = async (userId: string): Promise<void> => {
  const [existing] = await db
    .select({ id: screens.id })
    .from(screens)
    .innerJoin(screenhosts, eq(screens.screenhostId, screenhosts.id))
    .where(eq(screenhosts.ownerId, userId))
    .limit(1);
  if (existing) return;

  const [host] = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, userId))
    .orderBy(asc(screenhosts.name), asc(screenhosts.createdAt), asc(screenhosts.id))
    .limit(1);
  if (!host) return;

  await db.insert(screens).values({ screenhostId: host.id, name: 'Écran 1' });
};
