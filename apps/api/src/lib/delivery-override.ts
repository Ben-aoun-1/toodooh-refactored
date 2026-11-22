import { and, eq, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignReconciliation,
  campaigns,
  eventAllocations,
  notifications,
} from '../db/schema.js';

import { CAMPAIGN_STOPPED_TYPE } from './campaign-stop.js';

// OPS-FULL1 (operator 22/11) — a positioning COUNTED AS FULLY AIRED for its Screencaster.
//
// The derby of 22/11 was a test on production: the three positionings were stopped after one ad
// page, and the operator wants the Screencaster accounts to show the match as it was booked. What
// the Screencaster reads comes from three places, and each is handled once, here:
//   • the settlement line (campaign_reconciliation) — impressions, budget, the wallet debit and
//     the month's invoice. It is MOVED to the full booked value; what it held before is kept in
//     the override so revertFullDelivery restores it to the millime;
//   • the plays and hours — counted from proof_of_play, which is billing EVIDENCE and is never
//     written by hand: the override carries the two figures instead;
//   • the per-venue lines — read from campaign_screenhost_payout, the venues' MONEY rows: for an
//     overridden positioning the Screencaster's readers take the booked allocations instead
//     (lib/advertiser-performances, routes/campaigns event-allocations).
// The Screenhost side is untouched by construction: no payout, no reversement line, no proof, so
// the owners' pages, their statements and the reliability score keep the measured result.

export interface DeliveryOverridePrevious {
  deliveredImp: number;
  manquementImp: number;
  pPerteTnd: string;
  refundTnd: string;
  spendTnd: string;
  status: 'reussie' | 'partial';
}

export interface DeliveryOverride {
  /** « Diffusions du spot » shown to the Screencaster. */
  plays: number;
  /** « Heures de diffusion » shown to the Screencaster. */
  hours: number;
  /** The storage key of the report served in place of the generated one; null = generated. */
  reportKey: string | null;
  setAt: string;
  /** The settlement line as it was measured — what revertFullDelivery puts back. */
  previous: DeliveryOverridePrevious;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const parsePrevious = (raw: unknown): DeliveryOverridePrevious | null => {
  if (!isRecord(raw)) return null;
  const { deliveredImp, manquementImp, pPerteTnd, refundTnd, spendTnd, status } = raw;
  if (
    !isCount(deliveredImp) ||
    !isCount(manquementImp) ||
    typeof pPerteTnd !== 'string' ||
    typeof refundTnd !== 'string' ||
    typeof spendTnd !== 'string' ||
    (status !== 'reussie' && status !== 'partial')
  ) {
    return null;
  }
  return { deliveredImp, manquementImp, pPerteTnd, refundTnd, spendTnd, status };
};

/** The stored column → the override, or null (absent, or a shape this code did not write). */
export const parseDeliveryOverride = (raw: unknown): DeliveryOverride | null => {
  if (!isRecord(raw)) return null;
  const { plays, hours, reportKey, setAt } = raw;
  const previous = parsePrevious(raw['previous']);
  if (!previous || !isCount(plays) || !isCount(hours) || typeof setAt !== 'string') return null;
  return {
    plays,
    hours,
    reportKey: typeof reportKey === 'string' ? reportKey : null,
    setAt,
    previous,
  };
};

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export type DeliveryOverrideResult =
  | { status: 'APPLIED'; spendTnd: number; impressions: number; venues: number }
  | { status: 'NOT_POSITIONING' | 'NOT_SETTLED' | 'NO_ALLOCATIONS' };

/**
 * Count a SETTLED positioning as fully aired: the settlement line takes the whole booked value
 * (every venue that held it, a REFUSE line excluded — the settlement's own accounting) and the
 * Screencaster's « arrêtée » notice goes. Applying it again only replaces the figures: the
 * measured settlement kept in `previous` is never overwritten by an already-moved one.
 */
export const applyFullDelivery = async (input: {
  campaignId: string;
  plays: number;
  hours: number;
  reportKey?: string | null;
  now?: Date;
}): Promise<DeliveryOverrideResult> =>
  db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({
        eventId: campaigns.eventId,
        advertiserId: campaigns.advertiserId,
        deliveryOverride: campaigns.deliveryOverride,
      })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .for('update');
    if (!campaign || campaign.eventId === null) return { status: 'NOT_POSITIONING' };
    const [settled] = await tx
      .select()
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, input.campaignId));
    if (!settled) return { status: 'NOT_SETTLED' };
    const held = await tx
      .select({
        montantTnd: eventAllocations.montantTnd,
      })
      .from(eventAllocations)
      .where(
        and(
          eq(eventAllocations.campaignId, input.campaignId),
          ne(eventAllocations.statut, 'REFUSE'),
        ),
      );
    if (held.length === 0) return { status: 'NO_ALLOCATIONS' };
    const spendTnd = round4(held.reduce((sum, a) => sum + Number(a.montantTnd), 0));

    const existing = parseDeliveryOverride(campaign.deliveryOverride);
    const override: DeliveryOverride = {
      plays: input.plays,
      hours: input.hours,
      reportKey: input.reportKey ?? existing?.reportKey ?? null,
      setAt: (input.now ?? new Date()).toISOString(),
      previous: existing?.previous ?? {
        deliveredImp: settled.deliveredImp,
        manquementImp: settled.manquementImp,
        pPerteTnd: settled.pPerteTnd,
        refundTnd: settled.refundTnd,
        spendTnd: settled.spendTnd,
        status: settled.status === 'reussie' ? 'reussie' : 'partial',
      },
    };
    await tx
      .update(campaignReconciliation)
      .set({
        deliveredImp: settled.expectedImp,
        manquementImp: 0,
        pPerteTnd: '0',
        refundTnd: '0',
        spendTnd: String(spendTnd),
        status: 'reussie',
      })
      .where(eq(campaignReconciliation.id, settled.id));
    await tx
      .update(campaigns)
      .set({ deliveryOverride: { ...override } })
      .where(eq(campaigns.id, input.campaignId));
    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.campaignId, input.campaignId),
          eq(notifications.userId, campaign.advertiserId),
          eq(notifications.type, CAMPAIGN_STOPPED_TYPE),
        ),
      );
    return { status: 'APPLIED', spendTnd, impressions: settled.expectedImp, venues: held.length };
  });

/** Put the measured settlement back and drop the override. False = nothing to revert. */
export const revertFullDelivery = async (campaignId: string): Promise<boolean> =>
  db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ deliveryOverride: campaigns.deliveryOverride })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update');
    const override = parseDeliveryOverride(campaign?.deliveryOverride);
    if (!override) return false;
    await tx
      .update(campaignReconciliation)
      .set({
        deliveredImp: override.previous.deliveredImp,
        manquementImp: override.previous.manquementImp,
        pPerteTnd: override.previous.pPerteTnd,
        refundTnd: override.previous.refundTnd,
        spendTnd: override.previous.spendTnd,
        status: override.previous.status,
      })
      .where(eq(campaignReconciliation.campaignId, campaignId));
    await tx.update(campaigns).set({ deliveryOverride: null }).where(eq(campaigns.id, campaignId));
    return true;
  });
