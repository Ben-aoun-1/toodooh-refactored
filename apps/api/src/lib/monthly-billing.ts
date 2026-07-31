import { randomUUID } from 'node:crypto';

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignReconciliation,
  campaigns,
  monthlyInvoices,
  notifications,
  screenhostFactures,
  screenhosts,
  users,
} from '../db/schema.js';
import { storage } from '../storage/s3-storage.js';

import { factureLinesByVenue, sumLinesHt } from './facture-lines.js';
import { tvaFromHt, ttcFromHt } from './facture.js';
import { renderMonthlyInvoicePdf } from './monthly-invoice-pdf.js';
import { monthLabelFr, previousClosedMonth } from './report/monthly-job.js';
import { renderScreenhostFacturePdf } from './screenhost-facture-pdf.js';

// FCT2 — the month-end billing sweep (US-FCT-11..12 + the SH relevés), the monthly-report job
// idiom exactly: boot + hourly unref'd interval, previousClosedMonth (Africa/Tunis — effectively
// « the 1st for the previous month »), UNIQUE + onConflictDoNothing idempotency, per-item failure
// isolation, NO backfill (only the previous CLOSED month is ever considered).
//
// INVOICES — FCT-R1 (Kais 29/07, SUPERSEDING US-FCT-12's « consommation réelle », which had
// carried Mejri's deferral): cast = impressions PRÉDITES with pre-paid billing; host = real
// impressions post-paid. The advertiser's consolidated invoice therefore bills the month's
// ENGAGED value — Σ of the month's LEDGER DEBIT rows, ONE source of truth with the
// advertiser's own transaction history (web wallet-ledger composeLedger):
//   debit(C, M)    = campaigns LAUNCHED (status active/completed) with start_date in M,
//                    valued exactly as the ledger values them at sweep time — the reconciled
//                    NET (spend_tnd) once settled, the engaged budget (requested_budget)
//                    otherwise. (HT both ways — the house convention.)
//   total_ht(A, M) = round4(Σ_C debit) ; TVA 19 % via the facture trio. No started campaign
//                    → NO invoice. deliveredFacturableInRange STAYS in its valuation home for
//                    the consumption readers — only THIS caller changed.
// SCREENHOST FACTURES (REV2 — supersedes FCT2's relevés) — one row+PDF per venue with reversement
// lines SETTLED that Tunis month. The DIRECTION REVERSES: the venue is the ÉMETTEUR and Toodooh is
// the CLIENT (a supplier invoice), never to be confused with the FM- screencaster side above.
//   total_sh(V, M)    = round4(Σ sh_amount_tnd over lines with settled_at in M) — SUM, never
//                       one-row-per-pair assumptions; grouped BY SOURCE for the facture's lines.
// Recharges NEVER invoice — this sweep reads campaigns/reversements only, never the recharges
// table (pinned in tests).

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** FM-/REL- + 8 uppercase hex DERIVED from the row id — the makeReference idiom, race-free. */
export const makeBillingReference = (prefix: 'FM' | 'FS', id: string): string =>
  `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const invoicePdfKey = (advertiserId: string, month: string): string =>
  `invoices/${advertiserId}/${month}.pdf`;
// REV2 — the key path stays `statements/...` deliberately: renaming it would orphan every
// already-stored object for no functional gain. The ENTITY is the facture; the bucket path is
// just where its bytes live.
export const facturePdfKey = (screenhostId: string, month: string): string =>
  `statements/${screenhostId}/${month}.pdf`;

export interface BillingSweepResult {
  month: string;
  invoicesGenerated: number;
  invoicesSkipped: number;
  statementsGenerated: number;
  statementsSkipped: number;
  failed: number;
}

/** Per-advertiser consolidated HT for the month — the ledger's DEBIT rows (FCT-R1). */
const engagedDebitsByAdvertiser = async (
  from: string,
  to: string,
): Promise<Map<string, number>> => {
  // The web ledger's isLaunched mirror: active/completed with a start day inside the month.
  // LEFT JOIN the (UNIQUE per campaign) reconciliation: NET once settled, engaged otherwise.
  const rows = await db
    .select({
      advertiserId: campaigns.advertiserId,
      requestedBudget: campaigns.requestedBudget,
      spendTnd: campaignReconciliation.spendTnd,
    })
    .from(campaigns)
    .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(
      and(
        gte(campaigns.startDate, from),
        lte(campaigns.startDate, to),
        inArray(campaigns.status, ['active', 'completed']),
      ),
    );
  const totals = new Map<string, number>();
  for (const row of rows) {
    const amount = Number(row.spendTnd ?? row.requestedBudget ?? 0);
    if (amount <= 0) continue;
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
  const totals = await engagedDebitsByAdvertiser(from, to);
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

  // ── venue FACTURES (REV2 — supersedes the relevés) ──────────────────────────
  // The per-source aggregation lives in lib/facture-lines (REV2 commit 3): the owner's detail
  // endpoint calls the SAME function, so the document this sweep renders and the screen the owner
  // prints cannot show different lines. The per-venue total is the sum of its sources.
  const bySource = await factureLinesByVenue(month);
  const settled = [...bySource.entries()].map(([screenhostId, lines]) => ({
    screenhostId,
    totalSh: String(sumLinesHt(lines)),
  }));

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
        .select({ id: screenhostFactures.id })
        .from(screenhostFactures)
        .where(
          and(
            eq(screenhostFactures.screenhostId, line.screenhostId),
            eq(screenhostFactures.month, month),
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
      const reference = makeBillingReference('FS', id);
      // The owner's earnings are HT; TVA rides on top, exactly as on the screencaster side.
      const subtotalHt = totalSh;
      const totalTtc = ttcFromHt(subtotalHt);
      const tva = round4(totalTtc - subtotalHt);
      const pdf = await renderScreenhostFacturePdf({
        reference,
        month,
        venueName: venue.name,
        ownerName: venue.ownerBusinessName ?? venue.ownerContactName ?? '—',
        lines: bySource.get(line.screenhostId) ?? [],
        subtotalHtTnd: subtotalHt,
        tvaTnd: tva,
        totalTtcTnd: totalTtc,
        issuedAt: now,
      });
      const key = facturePdfKey(line.screenhostId, month);
      const uploaded = await storage.upload({ key, body: pdf, contentType: 'application/pdf' });
      if ('error' in uploaded) {
        result.failed += 1;
        log.warn({ screenhostId: line.screenhostId, month }, 'screenhost facture upload failed');
        continue;
      }
      const inserted = await db
        .insert(screenhostFactures)
        .values({
          id,
          screenhostId: line.screenhostId,
          month,
          totalShTnd: totalSh.toFixed(4),
          reference,
          pdfKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: screenhostFactures.id });
      if (inserted.length === 0) {
        result.statementsSkipped += 1;
        continue;
      }
      if (venue.ownerId !== null) {
        await db.insert(notifications).values({
          userId: venue.ownerId,
          type: 'screenhost_facture_ready',
          title: 'Votre facture est disponible',
          body: `La facture de ${monthLabelFr(month)} pour « ${venue.name} » (${ttcFromHt(totalSh).toFixed(2)} TND TTC) est disponible. Merci de l'imprimer, la signer et la déposer.`,
        });
      }
      result.statementsGenerated += 1;
    } catch (err) {
      result.failed += 1;
      log.warn(
        { err, screenhostId: line.screenhostId, month },
        'screenhost facture generation failed',
      );
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
