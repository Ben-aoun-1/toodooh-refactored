import { pathToFileURL } from 'node:url';

import { and, eq, isNull } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { screenhostFactures, screenhosts, users } from '../src/db/schema.js';
import { factureLinesFor, sumLinesTtc } from '../src/lib/facture-lines.js';
import { screenhostFactureMoney } from '../src/lib/facture.js';
import { renderScreenhostFacturePdf } from '../src/lib/screenhost-facture-pdf.js';
import { storage } from '../src/storage/s3-storage.js';

// SH-TTC1 — one-shot re-render of the screenhost factures emitted under the pre-ruling « HT + 19 % »
// framing (operator ruling A, 2026-09-29).
//
// SCOPE = status 'emise' AND never deposited. Those are documents the owner has not signed yet, so
// replacing the PDF at its EXISTING pdf_key changes nothing anyone has acted on. Everything else is
// left alone on purpose:
//   - deposited / en_verification / en_paiement / refusee: the owner signed the old document.
//   - payee: its versement is frozen at write (REV3) — ruling A keeps the pre-ruling 14.820 as is.
//
// total_sh_tnd is NOT rewritten: it was always Σ share, and under SH-TTC1 that same number is the
// TTC. Only the rendered HT/TVA split changes. Reference, month and issue date are kept. A facture
// whose re-derived lines no longer sum to its stored total is SKIPPED and reported, never
// « corrected »: the stored total is what was emitted.
//
// DRY-RUN BY DEFAULT. Usage (on the box, after deploy):
//   pnpm --filter @toodooh/api facture:regenerate-ttc              # inventory, writes nothing
//   pnpm --filter @toodooh/api facture:regenerate-ttc -- --execute # re-render + overwrite PDFs

export interface RegenerateResult {
  scanned: number;
  regenerated: string[]; // references
  skippedMismatch: string[];
  failed: string[];
}

export async function regenerateEmiseFactures(opts: {
  execute: boolean;
}): Promise<RegenerateResult> {
  const rows = await db
    .select({
      id: screenhostFactures.id,
      reference: screenhostFactures.reference,
      month: screenhostFactures.month,
      screenhostId: screenhostFactures.screenhostId,
      totalShTnd: screenhostFactures.totalShTnd,
      pdfKey: screenhostFactures.pdfKey,
      createdAt: screenhostFactures.createdAt,
      venueName: screenhosts.name,
      ownerBusinessName: users.businessName,
      ownerContactName: users.contactName,
    })
    .from(screenhostFactures)
    .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
    .leftJoin(users, eq(users.id, screenhosts.ownerId))
    .where(and(eq(screenhostFactures.status, 'emise'), isNull(screenhostFactures.depositedAt)));

  const result: RegenerateResult = {
    scanned: rows.length,
    regenerated: [],
    skippedMismatch: [],
    failed: [],
  };

  for (const row of rows) {
    const stored = Number(row.totalShTnd);
    const lines = await factureLinesFor(row.screenhostId, row.month);
    if (Math.abs(sumLinesTtc(lines) - stored) > 1e-4) {
      result.skippedMismatch.push(row.reference);
      continue;
    }
    if (!opts.execute) {
      result.regenerated.push(row.reference);
      continue;
    }
    const { subtotalHt, tva, totalTtc } = screenhostFactureMoney(stored);
    const pdf = await renderScreenhostFacturePdf({
      reference: row.reference,
      month: row.month,
      venueName: row.venueName,
      ownerName: row.ownerBusinessName ?? row.ownerContactName ?? '—',
      lines,
      subtotalHtTnd: subtotalHt,
      tvaTnd: tva,
      totalTtcTnd: totalTtc,
      issuedAt: row.createdAt,
    });
    const uploaded = await storage.upload({
      key: row.pdfKey,
      body: pdf,
      contentType: 'application/pdf',
    });
    if ('error' in uploaded) result.failed.push(row.reference);
    else result.regenerated.push(row.reference);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const execute = process.argv.includes('--execute');
  regenerateEmiseFactures({ execute })
    .then((r) => {
      console.log(JSON.stringify({ mode: execute ? 'EXECUTE' : 'DRY-RUN', ...r }, null, 2));
      return sql.end();
    })
    .catch(async (err: unknown) => {
      console.error(err);
      await sql.end();
      process.exit(1);
    });
}
