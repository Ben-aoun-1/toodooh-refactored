import { eq } from 'drizzle-orm';

import type { db } from '../db/client.js';
import { campaigns, users } from '../db/schema.js';

import { campaignCpmRates, cpmForCampaign } from './dispatch/config.js';

// CPM-3 (final review, ruled 2026-09-19) — THE freeze-time CPM check. An activation freezes a plan
// (runDispatch) or event allocations (runEventDispatch) at a CPM its caller read EARLIER and
// unlocked: the cart confirm reads the campaign row, prepareActivation derives the CPM from it,
// then the engine freezes. An admin CPM change (lib/screencaster-cpm.ts) committing in between
// re-priced the draft row while the plan froze the old rate (reproduced: row 8.000, plan 12.000).
//
// The check runs as the freeze transaction's FIRST statements:
//   1. lock the advertiser's users row FOR KEY SHARE — the lock the migration-0076 trigger takes;
//      it conflicts with the change's FOR UPDATE, so a change in flight is waited out, and no
//      change can start for this screencaster until the freeze commits;
//   2. re-read the campaign's own CPM (the rate cpmForCampaign derives from the row NOW). If it is
//      not the CPM the freeze is about to use, the freeze refuses (CPM_CHANGED, nothing written)
//      and the caller retries at the new rate.
// So either the change committed first (→ the freeze refuses), or the change waits for the freeze,
// then finds its plan / allocations and leaves the draft alone (ruling A) — the row and the frozen
// price can no longer disagree. OPT-IN: the admin POST /api/campaigns/:id/dispatch freezes at an
// explicit body CPM on purpose and passes no check.

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** Runs inside the freeze transaction; false ⇒ the campaign's CPM is no longer `freezeCpm`. */
export type CpmFreezeCheck = (tx: Tx, freezeCpm: number) => Promise<boolean>;

export const cpmFreezeCheck =
  (target: { campaignId: string; advertiserId: string }): CpmFreezeCheck =>
  async (tx, freezeCpm) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, target.advertiserId))
      .for('key share');
    const [row] = await tx
      .select({
        campaignType: campaigns.campaignType,
        standardCpmTnd: campaigns.standardCpmTnd,
        eventCpmTnd: campaigns.eventCpmTnd,
      })
      .from(campaigns)
      .where(eq(campaigns.id, target.campaignId))
      .limit(1);
    return (
      row !== undefined && cpmForCampaign(row.campaignType, campaignCpmRates(row)) === freezeCpm
    );
  };
