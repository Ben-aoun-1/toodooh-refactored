import { eq, inArray } from 'drizzle-orm';

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
