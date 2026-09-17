import { eq } from 'drizzle-orm';

import { db, sql } from '../../src/db/client.js';
import { campaigns } from '../../src/db/schema.js';
import { type TTiers, campaignTTiers } from '../../src/lib/dispatch/config.js';

// CPM-1 — pin the dispatch_config CPMs for a test and put back exactly what was there. The
// singleton is shared by every file of a worker, and some suites leave it EMPTY (the FIX2 hygiene
// note in admin-campaigns.test.ts): when this helper had to create the row, restore deletes it.

export interface CpmConfigSnapshot {
  created: boolean;
  standard: string;
  event: string;
}

export const setCpmConfig = async (standard: string, event: string): Promise<void> => {
  await sql`update dispatch_config set standard_cpm_tnd = ${standard}, event_cpm_tnd = ${event}`;
};

export const pinCpmConfig = async (standard: string, event: string): Promise<CpmConfigSnapshot> => {
  const [row] = await sql<{ standard: string; event: string }[]>`
    select standard_cpm_tnd::text as standard, event_cpm_tnd::text as event from dispatch_config`;
  if (row === undefined) {
    await sql`insert into dispatch_config (seuil_diffusable, g_mois, jours_actifs, r_min_efficace)
      values (1000, '100', 30, 2)`;
  }
  await setCpmConfig(standard, event);
  return row === undefined
    ? { created: true, standard, event }
    : { created: false, standard: row.standard, event: row.event };
};

export const restoreCpmConfig = async (snapshot: CpmConfigSnapshot): Promise<void> => {
  if (snapshot.created) await sql`delete from dispatch_config`;
  else await setCpmConfig(snapshot.standard, snapshot.event);
};

// CPM-2 — the same pin/restore for the attention index T (t_10s / t_20s / t_30s). Restore the pins
// in the REVERSE order they were taken: the first pin may be the one that created the row.

export interface TConfigSnapshot {
  created: boolean;
  t10: string;
  t20: string;
  t30: string;
}

export const setTConfig = async (t10: string, t20: string, t30: string): Promise<void> => {
  await sql`update dispatch_config set t_10s = ${t10}, t_20s = ${t20}, t_30s = ${t30}`;
};

export const pinTConfig = async (
  t10: string,
  t20: string,
  t30: string,
): Promise<TConfigSnapshot> => {
  const [row] = await sql<{ t10: string; t20: string; t30: string }[]>`
    select t_10s::text as t10, t_20s::text as t20, t_30s::text as t30 from dispatch_config`;
  if (row === undefined) {
    await sql`insert into dispatch_config (seuil_diffusable, g_mois, jours_actifs, r_min_efficace)
      values (1000, '100', 30, 2)`;
  }
  await setTConfig(t10, t20, t30);
  return row === undefined ? { created: true, t10, t20, t30 } : { created: false, ...row };
};

export const restoreTConfig = async (snapshot: TConfigSnapshot): Promise<void> => {
  if (snapshot.created) await sql`delete from dispatch_config`;
  else await setTConfig(snapshot.t10, snapshot.t20, snapshot.t30);
};

/** CPM-2 — an existing campaign's own T tiers, read the way production reads them: suites that
 *  call runDispatch directly pass these, exactly as the activation does. */
export const campaignTiersOf = async (campaignId: string): Promise<TTiers> => {
  const [row] = await db
    .select({ t10s: campaigns.t10s, t20s: campaigns.t20s, t30s: campaigns.t30s })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row) throw new Error(`campaign ${campaignId} not found`);
  return campaignTTiers(row);
};
