import { randomUUID } from 'node:crypto';

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  monthlyInvoices,
  notifications,
  reversementLines,
  screenhostMonthlyStatements,
  screenhosts,
  users,
} from '../db/schema.js';
import { storage } from '../storage/s3-storage.js';

import { tvaFromHt, ttcFromHt } from './facture.js';
import { renderMonthlyInvoicePdf } from './monthly-invoice-pdf.js';
import { loadDeliveredSlots } from './reconcile/delivered-slots.js';
import { type AllocationInput, deliveredFacturableInRange } from './reconcile/valuation.js';
import { renderRelevePdf } from './releve-pdf.js';
import { monthLabelFr, previousClosedMonth } from './report/monthly-job.js';

// FCT2 — the month-end billing sweep (US-FCT-11..12 + the SH relevés), the monthly-report job
// idiom exactly: boot + hourly unref'd interval, previousClosedMonth (Africa/Tunis — effectively
// « the 1st for the previous month »), UNIQUE + onConflictDoNothing idempotency, per-item failure
// isolation, NO backfill (only the previous CLOSED month is ever considered).
//
// INVOICES — one consolidated row+PDF per screencaster with consumption that month:
//   consumption(C, M) = deliveredFacturableInRange(allocations(C), plan.t, M.from, M.to)
//                       — PROOF-VERIFIED facturable only (an unproven créneau never bills;
//                         engaged-but-undelivered is not consumption; a campaign ending mid-month
//                         stops contributing by construction — its créneaux stop).
//   amount(C, M)      = round4(consumption × plan.cpm / 1000)   (HT; the valuation convention)
//   total_ht(A, M)    = round4(Σ_C amount) ; TVA 19 % via the facture trio. Zero → NO invoice.
// RELEVÉS — one row+PDF per venue with reversement lines SETTLED that Tunis month:
//   total_sh(V, M)    = round4(Σ sh_amount_tnd over lines with settled_at in M) — SUM, never
//                       one-row-per-pair assumptions (source='event' may add lines later).
// Recharges NEVER invoice — this sweep reads campaigns/reversements only, never the recharges
// table (pinned in tests).

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** FM-/REL- + 8 uppercase hex DERIVED from the row id — the makeReference idiom, race-free. */
export const makeBillingReference = (prefix: 'FM' | 'REL', id: string): string =>
  `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const invoicePdfKey = (advertiserId: string, month: string): string =>
  `invoices/${advertiserId}/${month}.pdf`;
export const statementPdfKey = (screenhostId: string, month: string): string =>
  `statements/${screenhostId}/${month}.pdf`;

export interface BillingSweepResult {
  month: string;
  invoicesGenerated: number;
  invoicesSkipped: number;
  statementsGenerated: number;
  statementsSkipped: number;
  failed: number;
}

/** Per-advertiser consolidated HT for the month — proof-verified consumption only. */
const consumptionByAdvertiser = async (from: string, to: string): Promise<Map<string, number>> => {
  // Campaigns that COULD have créneaux in the window: started on/before its end. No end-date upper
  // bound (boosts/redispatch extend campaigns); no status filter (reconcile leaves 'active', and
  // status can't gate money). The créneau dates are the truth — this filter is efficiency only.
  const rows = await db
    .select({
      campaignId: campaigns.id,
      advertiserId: campaigns.advertiserId,
      planId: campaignDispatchPlan.id,
      cpm: campaignDispatchPlan.cpm,
      tTierCoef: campaignDispatchPlan.tTierCoef,
    })
    .from(campaignDispatchPlan)
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .where(lte(campaigns.startDate, to));

  const totals = new Map<string, number>();
  for (const row of rows) {
    const allocations = await db
      .select({
        screenhostId: campaignDispatchAllocation.screenhostId,
        creneaux: campaignDispatchAllocation.creneaux,
      })
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, row.planId));
    if (allocations.length === 0) continue;
    const deliveredBySh = await loadDeliveredSlots(row.campaignId);
    const inputs: AllocationInput[] = allocations.map((a) => ({
      screenhostId: a.screenhostId,
      creneaux: a.creneaux,
      deliveredSlots: deliveredBySh.get(a.screenhostId) ?? new Set<string>(),
    }));
    const fact = deliveredFacturableInRange(inputs, Number(row.tTierCoef), from, to);
    if (fact <= 0) continue;
    const amount = round4((fact * Number(row.cpm)) / 1000);
    totals.set(row.advertiserId, round4((totals.get(row.advertiserId) ?? 0) + amount));
  }
  return totals;
};

export async function runMonthlyBillingSweep(
  log: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<BillingSweepResult> {
  const { month, from, to } = previousClosedMonth(now);
  const result: BillingSweepResult = {
    month,
    invoicesGenerated: 0,
    invoicesSkipped: 0,
    statementsGenerated: 0,
    statementsSkipped: 0,
    failed: 0,
  };

  // ── advertiser invoices ─────────────────────────────────────────────────────
  const totals = await consumptionByAdvertiser(from, to);
  for (const [advertiserId, totalHt] of totals) {
    try {
      const [existing] = await db
        .select({ id: monthlyInvoices.id })
        .from(monthlyInvoices)
        .where(
          and(eq(monthlyInvoices.advertiserId, advertiserId), eq(monthlyInvoices.month, month)),
        )
        .limit(1);
      if (existing) {
        result.invoicesSkipped += 1;
        continue;
      }
      const [advertiser] = await db
        .select({ contactName: users.contactName, businessName: users.businessName })
        .from(users)
        .where(eq(users.id, advertiserId))
        .limit(1);
      if (!advertiser) continue;

      const id = randomUUID();
      const reference = makeBillingReference('FM', id);
      const tva = tvaFromHt(totalHt);
      const ttc = ttcFromHt(totalHt);
      const pdf = await renderMonthlyInvoicePdf({
        reference,
        month,
        advertiserName: advertiser.businessName ?? advertiser.contactName,
        totalHt,
        tvaTnd: tva,
        totalTtc: ttc,
        issuedAt: now,
      });
      const key = invoicePdfKey(advertiserId, month);
      const uploaded = await storage.upload({ key, body: pdf, contentType: 'application/pdf' });
      if ('error' in uploaded) {
        result.failed += 1;
        log.warn({ advertiserId, month, error: uploaded.error }, 'monthly invoice upload failed');
        continue;
      }
      const inserted = await db
        .insert(monthlyInvoices)
        .values({
          id,
          advertiserId,
          month,
          totalHt: totalHt.toFixed(4),
          tvaTnd: tva.toFixed(4),
          totalTtc: ttc.toFixed(4),
          reference,
          pdfKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: monthlyInvoices.id });
      if (inserted.length === 0) {
        // UNIQUE(advertiser, month) — a concurrent tick won; no duplicate notification either.
        result.invoicesSkipped += 1;
        continue;
      }
      await db.insert(notifications).values({
        userId: advertiserId,
        type: 'monthly_invoice_ready',
        title: 'Votre facture mensuelle est disponible',
        body: `La facture de ${monthLabelFr(month)} (${totalHt.toFixed(2)} TND HT) est disponible dans « Mes factures ».`,
      });
      result.invoicesGenerated += 1;
    } catch (err) {
      result.failed += 1;
      log.warn({ err, advertiserId, month }, 'monthly invoice generation failed');
    }
  }

  // ── venue relevés ───────────────────────────────────────────────────────────
  // settled_at bucketed on its Africa/Tunis calendar date — « venues with settlements that month ».
  const settled = await db
    .select({
      screenhostId: reversementLines.screenhostId,
      totalSh: sql<string>`coalesce(sum(${reversementLines.shAmountTnd}), 0)`,
    })
    .from(reversementLines)
    .where(
      and(
        gte(sql`(${reversementLines.settledAt} AT TIME ZONE 'Africa/Tunis')::date`, from),
        lte(sql`(${reversementLines.settledAt} AT TIME ZONE 'Africa/Tunis')::date`, to),
      ),
    )
    .groupBy(reversementLines.screenhostId);

  const venueIds = settled.map((s) => s.screenhostId);
  const venues = venueIds.length
    ? await db
        .select({
          id: screenhosts.id,
          name: screenhosts.name,
          ownerId: screenhosts.ownerId,
          ownerBusinessName: users.businessName,
          ownerContactName: users.contactName,
        })
        .from(screenhosts)
        .leftJoin(users, eq(users.id, screenhosts.ownerId))
        .where(inArray(screenhosts.id, venueIds))
    : [];
  const venueById = new Map(venues.map((v) => [v.id, v]));

  for (const line of settled) {
    const totalSh = round4(Number(line.totalSh));
    if (totalSh <= 0) continue;
    try {
      const [existing] = await db
        .select({ id: screenhostMonthlyStatements.id })
        .from(screenhostMonthlyStatements)
        .where(
          and(
            eq(screenhostMonthlyStatements.screenhostId, line.screenhostId),
            eq(screenhostMonthlyStatements.month, month),
          ),
        )
        .limit(1);
      if (existing) {
        result.statementsSkipped += 1;
        continue;
      }
      const venue = venueById.get(line.screenhostId);
      if (!venue) continue;

      const id = randomUUID();
      const reference = makeBillingReference('REL', id);
      const pdf = await renderRelevePdf({
        reference,
        month,
        venueName: venue.name,
        ownerName: venue.ownerBusinessName ?? venue.ownerContactName ?? '—',
        totalShTnd: totalSh,
        issuedAt: now,
      });
      const key = statementPdfKey(line.screenhostId, month);
      const uploaded = await storage.upload({ key, body: pdf, contentType: 'application/pdf' });
      if ('error' in uploaded) {
        result.failed += 1;
        log.warn({ screenhostId: line.screenhostId, month }, 'relevé upload failed');
        continue;
      }
      const inserted = await db
        .insert(screenhostMonthlyStatements)
        .values({
          id,
          screenhostId: line.screenhostId,
          month,
          totalShTnd: totalSh.toFixed(4),
          reference,
          pdfKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: screenhostMonthlyStatements.id });
      if (inserted.length === 0) {
        result.statementsSkipped += 1;
        continue;
      }
      if (venue.ownerId !== null) {
        await db.insert(notifications).values({
          userId: venue.ownerId,
          type: 'reversement_statement_ready',
          title: 'Votre relevé de reversement est disponible',
          body: `Le relevé de ${monthLabelFr(month)} pour « ${venue.name} » (${totalSh.toFixed(2)} TND) est disponible.`,
        });
      }
      result.statementsGenerated += 1;
    } catch (err) {
      result.failed += 1;
      log.warn({ err, screenhostId: line.screenhostId, month }, 'relevé generation failed');
    }
  }

  if (result.invoicesGenerated > 0 || result.statementsGenerated > 0 || result.failed > 0) {
    log.info(result, 'monthly billing sweep');
  }
  return result;
}

/** Boot + hourly unref'd interval (the sweepUnexported pattern) — never holds the process open. */
export function startMonthlyBillingJob(log: FastifyBaseLogger): void {
  void runMonthlyBillingSweep(log).catch((err: unknown) =>
    log.warn({ err }, 'monthly billing boot sweep failed'),
  );
  const timer = setInterval(
    () => {
      void runMonthlyBillingSweep(log).catch((err: unknown) =>
        log.warn({ err }, 'monthly billing sweep failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
}
