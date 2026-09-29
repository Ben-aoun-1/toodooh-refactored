import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { reversementLines, screenhostVersements, screenhosts } from '../db/schema.js';

// OWN-REV1 — the owner dashboard's two money cards (operator, 2026-09-29).
//
//   « Revenus »         = what the owner is still OWED: every screenhost share ever settled on their
//                         venues, minus everything already paid out to them.
//   « Revenu encaissé » = everything already paid out: Σ screenhost_versements.montant_ttc.
//
// A versement is written the moment an admin validates a facture (or takes the paper path), so a
// validation moves exactly the facture's amount from the first card to the second (ruling 3A:
// « Revenus » reaches 0 only when nothing else is owed — later months keep accruing).
//
// BOTH ARE TTC (SH-TTC1): reversement_lines.sh_amount_tnd is the owner's 50 % share and the
// operator ruled that share IS a TTC amount; the versement stores the same figure. Campaign AND
// event settlements are counted — both write reversement_lines (source 'campaign' | 'event').
//
// Earned is scoped by the venue's CURRENT owner, paid by the versement's user — the same two
// scopes the factures and the versements history already use.

export interface OwnerRevenueSummary {
  /** « Revenus » — owed, TTC. Never negative (see the clamp note). */
  aEncaisserTtc: number;
  /** « Revenu encaissé » — paid out, TTC. */
  encaisseTtc: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export async function ownerRevenueSummary(userId: string): Promise<OwnerRevenueSummary> {
  const [earned] = await db
    .select({ total: sql<string>`coalesce(sum(${reversementLines.shAmountTnd}), 0)` })
    .from(reversementLines)
    .innerJoin(screenhosts, eq(screenhosts.id, reversementLines.screenhostId))
    .where(eq(screenhosts.ownerId, userId));
  const [paid] = await db
    .select({ total: sql<string>`coalesce(sum(${screenhostVersements.montantTtc}), 0)` })
    .from(screenhostVersements)
    .where(eq(screenhostVersements.userId, userId));

  const earnedTtc = round4(Number(earned?.total ?? 0));
  const encaisseTtc = round4(Number(paid?.total ?? 0));
  // Clamp: a versement written before SH-TTC1 carried HT × 1.19, so paid can exceed earned for a
  // pre-ruling payout. « Revenus » owed is never shown negative.
  return { aEncaisserTtc: Math.max(0, round4(earnedTtc - encaisseTtc)), encaisseTtc };
}
