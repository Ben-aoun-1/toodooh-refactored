import { and, gte, lte, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { reversementLines } from '../db/schema.js';

import { monthBounds } from './report/monthly-job.js';

// REV2 commit 3 — THE ONE PLACE a screenhost facture's per-source revenue lines are computed.
//
// WHY IT IS ONE PLACE. The detail screen offers « Imprimer », which renders the screen itself as
// the printable — so that screen IS a signable artifact, exactly like the stored PDF. Two print
// paths for one invoice must not produce two different documents. Before this module the sweep
// computed the split inline for the PDF and the owner endpoint had no split at all; now the PDF
// builder and the detail endpoint call the SAME function, so the two cannot disagree by
// construction rather than by discipline.
//
// WHY READ-TIME DERIVATION IS SAFE. `settled_at` is stamped at settlement, and a settlement cannot
// land inside a month that has already closed — so re-aggregating a past month later returns what
// it returned when the facture was emitted. That determinism is what makes it legitimate to derive
// the lines on read instead of storing them alongside the row. A fixture-equality test pins the
// PDF and the wire to the same values rather than trusting this note.
//
// ORDERING IS PART OF THE CONTRACT. A GROUP BY has no inherent order, so the lines are sorted by
// source: without that, the PDF and the screen could list the same amounts in different orders and
// read as different documents.

export interface FactureSourceLine {
  /** 'campaign' | 'event' — the reversement_lines.source bucket. */
  source: string;
  /** Σ sh_amount_tnd for that source in the month (HT). */
  amountHtTnd: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Every venue with reversement lines settled in `month`, mapped to its per-source lines.
 *
 * `settled_at` is bucketed on its Africa/Tunis calendar date — « settlements that month » means the
 * local month, not a UTC window. A source contributing nothing is DROPPED rather than printed as
 * « 0,00 TND » against a revenue stream that was simply idle.
 */
export async function factureLinesByVenue(
  month: string,
): Promise<Map<string, FactureSourceLine[]>> {
  const { from, to } = monthBounds(month);
  const rows = await db
    .select({
      screenhostId: reversementLines.screenhostId,
      source: reversementLines.source,
      totalSh: sql<string>`coalesce(sum(${reversementLines.shAmountTnd}), 0)`,
    })
    .from(reversementLines)
    .where(
      and(
        gte(sql`(${reversementLines.settledAt} AT TIME ZONE 'Africa/Tunis')::date`, from),
        lte(sql`(${reversementLines.settledAt} AT TIME ZONE 'Africa/Tunis')::date`, to),
      ),
    )
    .groupBy(reversementLines.screenhostId, reversementLines.source);

  const byVenue = new Map<string, FactureSourceLine[]>();
  for (const row of rows) {
    const amountHtTnd = round4(Number(row.totalSh));
    if (amountHtTnd <= 0) continue;
    const list = byVenue.get(row.screenhostId) ?? [];
    list.push({ source: row.source, amountHtTnd });
    byVenue.set(row.screenhostId, list);
  }
  for (const list of byVenue.values()) list.sort((a, b) => a.source.localeCompare(b.source));
  return byVenue;
}

/** One venue's lines for one month — the facture-read path. */
export async function factureLinesFor(
  screenhostId: string,
  month: string,
): Promise<FactureSourceLine[]> {
  return (await factureLinesByVenue(month)).get(screenhostId) ?? [];
}

/** The lines' HT total. The sweep stores this as the facture's `total_sh_tnd`. */
export const sumLinesHt = (lines: readonly FactureSourceLine[]): number =>
  round4(lines.reduce((s, l) => s + l.amountHtTnd, 0));
