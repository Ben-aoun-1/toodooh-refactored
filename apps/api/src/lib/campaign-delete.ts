import { and, eq, gt } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  proofOfPlay,
  reversementLines,
} from '../db/schema.js';

// Mariem 05/11 (ruling 1A) — « Supprimer », superadmin only and ONLY after « Arrêter »
// (lib/campaign-stop): a stopped campaign or match positioning that aired NOTHING leaves the
// platform — its rows go with it (allocations, targeting, cart line…; its notices stay, unlinked)
// and so does its zero settlement. Anything that aired stays: its proofs, the venues' earnings,
// reversements and invoices are real money history (operator ruling 3A), so the delete refuses
// it. The stop already freed its places, its holds and the match's seat rule.

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'NOT_STOPPED' | 'AIRED' };

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** Any trace of airing or of money owed: a proof, a venue earning, a reversement, a billed spend. */
export const hasAired = async (tx: Executor, campaignId: string): Promise<boolean> => {
  const [proof] = await tx
    .select({ id: proofOfPlay.id })
    .from(proofOfPlay)
    .where(eq(proofOfPlay.campaignId, campaignId))
    .limit(1);
  const [payout] = await tx
    .select({ id: campaignScreenhostPayout.id })
    .from(campaignScreenhostPayout)
    .where(eq(campaignScreenhostPayout.campaignId, campaignId))
    .limit(1);
  const [line] = await tx
    .select({ id: reversementLines.id })
    .from(reversementLines)
    .where(eq(reversementLines.campaignId, campaignId))
    .limit(1);
  const [billed] = await tx
    .select({ id: campaignReconciliation.id })
    .from(campaignReconciliation)
    .where(
      and(
        eq(campaignReconciliation.campaignId, campaignId),
        gt(campaignReconciliation.spendTnd, '0'),
      ),
    )
    .limit(1);
  return [proof, payout, line, billed].some((row) => row !== undefined);
};

export async function deleteStoppedCampaign(campaignId: string): Promise<DeleteOutcome> {
  return db.transaction(async (tx): Promise<DeleteOutcome> => {
    const [c] = await tx
      .select({ id: campaigns.id, stoppedAt: campaigns.stoppedAt })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update');
    if (!c) return { ok: false, error: 'NOT_FOUND' };
    if (c.stoppedAt === null) return { ok: false, error: 'NOT_STOPPED' };
    if (await hasAired(tx, c.id)) return { ok: false, error: 'AIRED' };
    await tx.delete(campaignReconciliation).where(eq(campaignReconciliation.campaignId, c.id));
    await tx.delete(campaigns).where(eq(campaigns.id, c.id));
    return { ok: true };
  });
}

/**
 * The cleanup's delete (lib/cleanup-screencasters): any campaign no longer live — a draft, a cart
 * line, a rejected or ended one — with no trace of airing. True when it was deleted.
 */
export async function purgeCampaignWithoutHistory(campaignId: string): Promise<boolean> {
  return db.transaction(async (tx): Promise<boolean> => {
    const [c] = await tx
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update');
    if (!c || ['pending', 'upcoming', 'active'].includes(c.status)) return false;
    if (await hasAired(tx, c.id)) return false;
    await tx.delete(campaignReconciliation).where(eq(campaignReconciliation.campaignId, c.id));
    await tx.delete(campaigns).where(eq(campaigns.id, c.id));
    return true;
  });
}
