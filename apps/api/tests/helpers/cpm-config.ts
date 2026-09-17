import { sql } from '../../src/db/client.js';

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
