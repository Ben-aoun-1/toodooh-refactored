import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { regenerateEmiseFactures } from '../scripts/sh-ttc1-regenerate-factures.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaigns,
  reversementLines,
  screenhostFactures,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { docText } from './helpers/doc-render-stub.js';

// Every document renders through the report's chromium seam — stubbed (helpers/doc-render-stub).
vi.mock('../src/lib/report/render.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/report/render.js')>()),
  renderPdf: (await import('./helpers/doc-render-stub.js')).renderPdfStub,
}));

// SH-TTC1 ruling A — the one-shot re-render of pre-ruling factures. Real Postgres + real storage
// (MinIO, as in monthly-billing.test). Scope is 'emise' AND never deposited; the stored total is
// never rewritten; a line/total mismatch is skipped, never « corrected ».

// 2026-10-09 — documents render through the stubbed chromium seam; read the HTML back as text.
const pdfText = docText;

let seq = 0;
const seedUser = async (values: Partial<NewUser>): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `sh-ttc1-${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

/** A venue with one settled 42.50 share in July, and a facture row in the given state. */
const seedFacture = async (opts: {
  status: 'emise' | 'payee';
  deposited: boolean;
  storedTotal?: string;
}) => {
  const ownerId = await seedUser({ role: 'individual_owner', businessName: 'Café Test SARL' });
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Venue ${seq}`, ownerId })
    .returning();
  const screenhostId = sh?.id ?? '';
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId, name: `C ${seq}`, campaignType: 'standard', status: 'completed' })
    .returning();
  await db.insert(reversementLines).values({
    source: 'campaign',
    campaignId: c?.id ?? '',
    screenhostId,
    baseValueTnd: '85.0000',
    shAmountTnd: '42.5000',
    toodoohAmountTnd: '37.4000',
    agentShAmountTnd: '2.5500',
    agentScAmountTnd: '2.5500',
    settledAt: new Date('2026-07-15T10:00:00Z'),
  });
  const pdfKey = `statements/${screenhostId}/2026-07.pdf`;
  await storage.upload({
    key: pdfKey,
    body: Buffer.from('%PDF-old'),
    contentType: 'application/pdf',
  });
  const [f] = await db
    .insert(screenhostFactures)
    .values({
      screenhostId,
      month: '2026-07',
      totalShTnd: opts.storedTotal ?? '42.5000',
      reference: `FS-T${String(seq).padStart(7, '0')}`,
      pdfKey,
      status: opts.status,
      signedFileKey: opts.deposited ? `signed-factures/t-${seq}.pdf` : null,
      signedFileMime: opts.deposited ? 'application/pdf' : null,
      depositedAt: opts.deposited ? new Date('2026-08-03T09:00:00Z') : null,
    })
    .returning();
  return { reference: f?.reference ?? '', pdfKey };
};

const downloadText = async (key: string): Promise<string> => {
  const got = await storage.download({ key });
  if ('error' in got) throw new Error(`download failed: ${key}`);
  return pdfText(got.body);
};

describe('SH-TTC1 — regenerate pre-ruling screenhost factures (real Postgres + storage)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('DRY-RUN lists the targets and writes nothing', async () => {
    const f = await seedFacture({ status: 'emise', deposited: false });
    const r = await regenerateEmiseFactures({ execute: false });
    expect(r.regenerated).toEqual([f.reference]);
    const got = await storage.download({ key: f.pdfKey });
    expect('error' in got ? '' : got.body.toString()).toBe('%PDF-old');
  });

  it('EXECUTE re-renders an undeposited emise facture with the TTC split', async () => {
    const f = await seedFacture({ status: 'emise', deposited: false });
    const r = await regenerateEmiseFactures({ execute: true });
    expect(r).toMatchObject({ regenerated: [f.reference], skippedMismatch: [], failed: [] });
    const text = await downloadText(f.pdfKey);
    expect(text).toContain(f.reference);
    expect(text).toContain('Montant TTC');
    expect(text).toContain('42.50 TND');
    expect(text).toContain('35.71 TND');
    expect(text).toContain('6.79 TND');
    expect(text).not.toContain('50.58');
  });

  it('never touches a deposited or a paid facture', async () => {
    await seedFacture({ status: 'emise', deposited: true });
    await seedFacture({ status: 'payee', deposited: true });
    const r = await regenerateEmiseFactures({ execute: true });
    expect(r.scanned).toBe(0);
    expect(r.regenerated).toEqual([]);
  });

  it('skips (never corrects) a facture whose lines no longer sum to its stored total', async () => {
    const f = await seedFacture({ status: 'emise', deposited: false, storedTotal: '40.0000' });
    const r = await regenerateEmiseFactures({ execute: true });
    expect(r.skippedMismatch).toEqual([f.reference]);
    const got = await storage.download({ key: f.pdfKey });
    expect('error' in got ? '' : got.body.toString()).toBe('%PDF-old');
  });
});
