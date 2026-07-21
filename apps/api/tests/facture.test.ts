import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, recharges, users } from '../src/db/schema.js';
import { TVA_RATE, renderFacturePdf, ttcFromHt, tvaFromHt } from '../src/lib/facture.js';
import { rechargesRoutes } from '../src/routes/recharges.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

// pdfkit (with compress:false) writes text into the content stream as HEX strings inside TJ arrays,
// e.g. [<464354> 140 <2d...>] — so the literal characters are NOT greppable as ASCII. Reconstruct the
// rendered text by decoding every <hex> token; concatenation rejoins kerning-split runs. Robust way
// to assert the facture actually CONTAINS the amount + reference without a heavyweight PDF extractor.
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    if (hex.length % 2 === 0) out += Buffer.from(hex, 'hex').toString('latin1');
  }
  return out;
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `facture${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// ── unit: the PDF builder (the reusable capability) ───────────────────────────
describe('facture PDF builder', () => {
  it('renders a non-empty PDF that contains the amount and the reference', async () => {
    const pdf = await renderFacturePdf({
      reference: 'FCT-ABCD1234',
      amountTnd: 150.5,
      advertiserName: 'Acme Cafe',
      issuedAt: new Date('2026-06-27T10:00:00Z'),
      bank: { beneficiary: 'TOODOOH', bankName: 'BIAT', rib: '08 123 456', iban: 'TN59 1234' },
    });
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('FCT-ABCD1234');
    expect(text).toContain('150.50');
  });

  it('CF-C1 — carries the HT / TVA (19 %) / TTC lines, the TTC wire amount and the HT credit note', async () => {
    const pdf = await renderFacturePdf({
      reference: 'FCT-TVA00001',
      amountTnd: 150.5,
      advertiserName: 'Acme Cafe',
      issuedAt: new Date('2026-07-21T10:00:00Z'),
      bank: { beneficiary: 'TOODOOH', bankName: 'BIAT', rib: '08 123 456', iban: 'TN59 1234' },
    });
    const text = pdfText(pdf);
    // 150.50 HT → TVA 28.60, TTC 179.10 (the money.ts rounding convention, 2 decimals).
    expect(text).toContain('Montant HT');
    expect(text).toContain('150.50 TND');
    expect(text).toContain('TVA (19 %)');
    expect(text).toContain('28.60 TND');
    expect(text).toContain('Total TTC');
    expect(text).toContain('179.10 TND');
    // The wire instruction states the TTC; the wallet credits the HT.
    expect(text).toContain('virement de 179.10 TND TTC');
    expect(text).toContain('Montant crédité au solde : 150.50 TND HT');
  });

  it('CF-C1 — the api TVA constant mirrors the web lib/money.ts rate (0.19) and rounds to 2 decimals', () => {
    expect(TVA_RATE).toBe(0.19);
    expect(ttcFromHt(150.5)).toBe(179.1);
    expect(tvaFromHt(150.5)).toBe(28.6);
    expect(ttcFromHt(100)).toBe(119);
    // HT + TVA always equals the printed TTC (additive-consistent lines).
    expect(Math.round((tvaFromHt(333.33) + 333.33) * 100) / 100).toBe(ttcFromHt(333.33));
  });
});

// ── route: GET /api/recharges/:id/facture (owner-scoped) ──────────────────────
describe('GET /api/recharges/:id/facture (owner-scoped)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(rechargesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const seedRecharge = async (advertiserId: string, reference: string): Promise<string> => {
    const [r] = await db
      .insert(recharges)
      .values({ advertiserId, amountTnd: '320.00', reference })
      .returning();
    return r?.id ?? '';
  };

  it('streams the facture for an owned recharge (200, application/pdf, contains the ref)', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me, 'FCT-FAC00001');
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/recharges/${id}/facture` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.length).toBeGreaterThan(0);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfText(res.rawPayload)).toContain('FCT-FAC00001');
  });

  it('404s a foreign recharge (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedRecharge(other, 'FCT-FAC00002');
    mockSession(me);
    expect(
      (await app.inject({ method: 'GET', url: `/api/recharges/${foreign}/facture` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/recharges/not-a-uuid/facture' })).statusCode,
    ).toBe(400);
  });

  it('requires authentication (401) and forbids a non-advertiser (403)', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me, 'FCT-FAC00003');
    mockNoSession();
    expect(
      (await app.inject({ method: 'GET', url: `/api/recharges/${id}/facture` })).statusCode,
    ).toBe(401);
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner');
    expect(
      (await app.inject({ method: 'GET', url: `/api/recharges/${id}/facture` })).statusCode,
    ).toBe(403);
  });
});
