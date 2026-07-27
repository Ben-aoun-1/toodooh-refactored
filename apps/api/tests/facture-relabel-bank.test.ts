import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, dispatchConfig, recharges, users } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { renderFacturePdf, resolveFactureBankDetails } from '../src/lib/facture.js';
import { rechargesRoutes } from '../src/routes/recharges.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FCT2 — two pins on the per-recharge document:
//  (1) the RELABEL (US-FCT-12): it is a « RÉCAPITULATIF DE COMMANDE », never a « FACTURE » —
//      recharges never invoice; the real facture is the monthly consolidated one.
//  (2) the bank-coords CONVERGENCE: dispatch_config.bank_* wins, FACTURE_BANK_* env is the
//      transition fallback (config '—' → env → '—'), Banque ↔ bank_domiciliation.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    if (hex.length % 2 === 0) out += Buffer.from(hex, 'hex').toString('latin1');
  }
  return out;
};

describe('resolveFactureBankDetails (config-first, env fallback)', () => {
  const fakeEnv = {
    ...env,
    FACTURE_BANK_BENEFICIARY: 'TOODOOH',
    FACTURE_BANK_NAME: 'BIAT (env)',
    FACTURE_BANK_RIB: 'RIB-ENV',
    FACTURE_BANK_IBAN: 'IBAN-ENV',
  };

  it('a provisioned config wins field by field', () => {
    expect(
      resolveFactureBankDetails(fakeEnv, {
        bankRib: 'RIB-CFG',
        bankIban: 'IBAN-CFG',
        bankDomiciliation: 'BIAT — Agence Lac (config)',
      }),
    ).toEqual({
      beneficiary: 'TOODOOH',
      bankName: 'BIAT — Agence Lac (config)',
      rib: 'RIB-CFG',
      iban: 'IBAN-CFG',
    });
  });

  it("an unprovisioned config ('—') falls back to env, per field", () => {
    expect(
      resolveFactureBankDetails(fakeEnv, {
        bankRib: '—',
        bankIban: 'IBAN-CFG',
        bankDomiciliation: '—',
      }),
    ).toEqual({
      beneficiary: 'TOODOOH',
      bankName: 'BIAT (env)',
      rib: 'RIB-ENV',
      iban: 'IBAN-CFG',
    });
  });

  it("both unprovisioned → the '—' placeholders (the pre-provisioning posture)", () => {
    const bare = {
      ...fakeEnv,
      FACTURE_BANK_NAME: '—',
      FACTURE_BANK_RIB: '—',
      FACTURE_BANK_IBAN: '—',
    };
    expect(
      resolveFactureBankDetails(bare, { bankRib: '—', bankIban: '—', bankDomiciliation: '—' }),
    ).toEqual({ beneficiary: 'TOODOOH', bankName: '—', rib: '—', iban: '—' });
  });
});

describe('the relabel — « RÉCAPITULATIF DE COMMANDE », never « FACTURE »', () => {
  it('the rendered document titles as a récapitulatif and carries no FACTURE title', async () => {
    const pdf = await renderFacturePdf({
      reference: 'FCT-RELABEL1',
      amountTnd: 100,
      advertiserName: 'Acme Cafe',
      issuedAt: new Date('2026-07-27T10:00:00Z'),
      bank: { beneficiary: 'TOODOOH', bankName: 'BIAT', rib: '08 123', iban: 'TN59' },
    });
    const text = pdfText(pdf);
    expect(text).toContain('RÉCAPITULATIF DE COMMANDE');
    expect(text).not.toContain('FACTURE');
  });
});

describe('GET /api/recharges/:id/facture — filename relabel + config-backed bank block (real Postgres)', () => {
  const buildApp = () => Fastify({ logger: false });
  let app: ReturnType<typeof buildApp>;
  let seq = 0;

  const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
    seq += 1;
    const [u] = await db
      .insert(users)
      .values({
        email: `relabel${seq}@example.com`,
        contactName: `User ${seq}`,
        role: 'advertiser',
        status: 'approved',
        ...values,
      })
      .returning();
    return u?.id ?? '';
  };

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(rechargesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await db
      .update(dispatchConfig)
      .set({ bankRib: '—', bankIban: '—', bankBic: '—', bankDomiciliation: '—' });
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('serves recapitulatif-<ref>.pdf and prints the PROVISIONED config coordinates', async () => {
    // NOTE: no em-dash in the fixture values — pdfkit WinAnsi-encodes U+2014 as 0x97, which the
    // latin1 pdfText decode can't round-trip; plain text keeps the assertion byte-exact.
    await db.update(dispatchConfig).set({
      bankRib: 'RIB-CONFIG-99',
      bankIban: 'TN59CONFIG',
      bankDomiciliation: 'BIAT Agence Tunis Lac',
    });
    const me = await seedUser();
    const [r] = await db
      .insert(recharges)
      .values({ advertiserId: me, amountTnd: '320.00', reference: 'FCT-CONV0001' })
      .returning();
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: me, role: 'advertiser', status: 'approved' },
    } as unknown as GetSessionResult);

    const res = await app.inject({ method: 'GET', url: `/api/recharges/${r?.id ?? ''}/facture` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="recapitulatif-FCT-CONV0001.pdf"',
    );
    const text = pdfText(res.rawPayload);
    expect(text).toContain('RÉCAPITULATIF DE COMMANDE');
    expect(text).toContain('RIB-CONFIG-99');
    expect(text).toContain('TN59CONFIG');
    expect(text).toContain('BIAT Agence Tunis Lac');
  });
});
