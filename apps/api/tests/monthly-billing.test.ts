import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaignReconciliation,
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  monthlyInvoices,
  notifications,
  proofOfPlay,
  recharges,
  reversementLines,
  screenhostMonthlyStatements,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runMonthlyBillingSweep } from '../src/lib/monthly-billing.js';
import { makeReference } from '../src/lib/recharges.js';
import { deliveredFacturableInRange } from '../src/lib/reconcile/valuation.js';
import { ownerStatementsRoutes } from '../src/routes/owner-statements.js';
import { walletDocumentsRoutes } from '../src/routes/wallet-documents.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FCT2 (US-FCT-11..12 + relevés) — the month-end billing sweep on PROOF-VERIFIED consumption
// only: an unproven créneau never bills, engaged-but-undelivered is not consumption, a campaign
// ending mid-month stops contributing, recharges never invoice. Real Postgres + real MinIO.
// Sweep NOW = 2026-08-02 → previous CLOSED Tunis month = 2026-07.

const NOW = new Date('2026-08-02T10:00:00Z');
const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof runMonthlyBillingSweep>[0];

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `mbill${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface Scenario {
  advertiser: string;
  campaignId: string;
  planId: string;
  creativeId: string;
  screenhostId: string;
  screenId: string;
  ownerId: string;
}

// One campaign + frozen plan + one venue allocation (the e7 harness, single venue).
const seedScenario = async (
  creneaux: DispatchCreneau[],
  opts: {
    cpm?: string;
    tTierCoef?: string;
    advertiser?: string;
    name?: string;
    budget?: string;
  } = {},
): Promise<Scenario> => {
  const advertiser = opts.advertiser ?? (await seedUser());
  const ownerId = await seedUser({ role: 'individual_owner' });
  const iCible = creneaux.reduce((s, c) => s + c.impressions, 0);

  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/${advertiser}/c`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: opts.name ?? 'Campagne Estivale',
      campaignType: 'standard',
      status: 'active',
      startDate: creneaux[0]?.date ?? '2026-07-01',
      endDate: creneaux[creneaux.length - 1]?.date ?? '2026-07-31',
      requestedBudget: opts.budget ?? null,
      creativeId: creative?.id,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible,
      cpm: opts.cpm ?? '10',
      sSpotSeconds: 10,
      tTierCoef: opts.tTierCoef ?? '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: iCible,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Venue ${seq}`, ownerId })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: `Screen ${seq}` })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel: iCible,
    rI: 100,
    revenuPrevisionnel: String((iCible * 10) / 1000),
    creneaux,
  });
  return {
    advertiser,
    campaignId: campaign?.id ?? '',
    planId: plan?.id ?? '',
    creativeId: creative?.id ?? '',
    screenhostId: sh?.id ?? '',
    screenId: screen?.id ?? '',
    ownerId,
  };
};

// A VIDEO_ENDED proof whose SERVER received_at lands in (date, tunisHour) — Tunis = UTC+1.
const deliverSlot = async (s: Scenario, date: string, tunisHour: number): Promise<void> => {
  await db.insert(proofOfPlay).values({
    screenId: s.screenId,
    screenhostId: s.screenhostId,
    campaignId: s.campaignId,
    creativeId: s.creativeId,
    videoIdAsSent: s.campaignId,
    eventType: 'VIDEO_ENDED' as const,
    receivedAt: new Date(`${date}T${String(tunisHour - 1).padStart(2, '0')}:30:00Z`),
  });
};

const seedReversementLine = async (
  campaignId: string,
  screenhostId: string,
  shAmount: string,
  settledAt: Date,
): Promise<void> => {
  await db.insert(reversementLines).values({
    campaignId,
    screenhostId,
    baseValueTnd: String(Number(shAmount) * 2),
    shAmountTnd: shAmount,
    toodoohAmountTnd: '0.0000',
    agentShAmountTnd: '0.0000',
    agentScAmountTnd: '0.0000',
    settledAt,
  });
};

const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    if (hex.length % 2 === 0) out += Buffer.from(hex, 'hex').toString('latin1');
  }
  return out;
};

const JULY_CRENEAUX: DispatchCreneau[] = [
  { date: '2026-07-10', hour: 9, reps: 100, impressions: 6000 },
  { date: '2026-07-11', hour: 10, reps: 100, impressions: 4000 },
];

describe('deliveredFacturableInRange (pure)', () => {
  const creneaux = [
    { date: '2026-06-30', hour: 8, impressions: 1000 },
    { date: '2026-07-01', hour: 8, impressions: 2000 },
    { date: '2026-07-31', hour: 9, impressions: 3000 },
    { date: '2026-08-01', hour: 8, impressions: 4000 },
  ];
  const delivered = new Set(['2026-06-30:8', '2026-07-01:8', '2026-07-31:9', '2026-08-01:8']);

  it('sums ONLY the delivered créneaux dated inside the window, × t', () => {
    const inputs = [{ screenhostId: 's', creneaux, deliveredSlots: delivered }];
    expect(deliveredFacturableInRange(inputs, 1, '2026-07-01', '2026-07-31')).toBe(5000);
    expect(deliveredFacturableInRange(inputs, 0.6, '2026-07-01', '2026-07-31')).toBe(3000);
  });

  it('an UNPROVEN créneau contributes nothing (engaged-but-undelivered ≠ consumption)', () => {
    const inputs = [{ screenhostId: 's', creneaux, deliveredSlots: new Set<string>() }];
    expect(deliveredFacturableInRange(inputs, 1, '2026-07-01', '2026-07-31')).toBe(0);
  });
});

describe('month-end billing sweep (real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(walletDocumentsRoutes);
    await app.register(ownerStatementsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Sweep the stored PDFs (rows die at the NEXT test's truncate).
    const invoices = await db.select({ key: monthlyInvoices.pdfKey }).from(monthlyInvoices);
    const statements = await db
      .select({ key: screenhostMonthlyStatements.pdfKey })
      .from(screenhostMonthlyStatements);
    for (const r of [...invoices, ...statements]) {
      await storage.delete({ key: r.key }).catch(() => undefined);
    }
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it("bills the month's ENGAGED value (FCT-R1, Kais 29/07): a July-started campaign invoices its budget with ZERO proofs", async () => {
    const s = await seedScenario(JULY_CRENEAUX, { cpm: '10', budget: '100' });
    // NOT ONE deliverSlot — the pre-paid predicted base needs no proof (US-FCT-12 superseded).
    const result = await runMonthlyBillingSweep(silentLog, NOW);
    expect(result.month).toBe('2026-07');
    expect(result.invoicesGenerated).toBe(1);

    const [row] = await db
      .select()
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.advertiserId, s.advertiser));
    // 100 HT engaged → 19 TVA → 119 TTC.
    expect(row).toMatchObject({ month: '2026-07' });
    expect(Number(row?.totalHt)).toBe(100);
    expect(Number(row?.tvaTnd)).toBe(19);
    expect(Number(row?.totalTtc)).toBe(119);
    expect(row?.reference).toMatch(/^FM-[0-9A-F]{8}$/);

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, s.advertiser));
    expect(notifs.map((n) => n.type)).toContain('monthly_invoice_ready');
    expect(notifs.find((n) => n.type === 'monthly_invoice_ready')?.body).toContain('juillet 2026');
  });

  it('the invoice PDF is the ONE consolidated « FACTURE » — engagement-honest wording, no per-campaign detail', async () => {
    const s = await seedScenario(JULY_CRENEAUX, { name: 'Campagne Secrète', budget: '100' });
    await runMonthlyBillingSweep(silentLog, NOW);

    const [row] = await db
      .select()
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.advertiserId, s.advertiser));
    mockSession(s.advertiser);
    const res = await app.inject({ method: 'GET', url: `/api/wallet/invoices/${row?.id}/pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `inline; filename="facture-${row?.reference ?? ''}.pdf"`,
    );
    const text = pdfText(res.rawPayload);
    expect(text).toContain('FACTURE');
    expect(text).toContain('juillet 2026');
    // FCT-R1 — the engagement-honest line; the « consommation réelle » era is over.
    expect(text).toContain('montant engagé (impressions prévues)');
    expect(text).not.toContain('consommation réelle');
    expect(text).toContain('100.00 TND');
    expect(text).toContain('119.00 TND');
    // The chartered pin: ONE amount, never a campaign line.
    expect(text).not.toContain('Campagne Secrète');
  });

  it('the FCT2 pin FLIPS: zero July-STARTED campaigns → no invoice, even with July deliveries of a June campaign', async () => {
    // A JUNE-started campaign (its window reaches into July) fully delivered in July: under the
    // old consumption base this WAS the invoice; under the ledger base its debit belongs to JUNE
    // (dated at start_date) — July emits nothing.
    const s = await seedScenario(
      [{ date: '2026-06-28', hour: 8, reps: 100, impressions: 4000 }, ...JULY_CRENEAUX],
      { budget: '100' },
    );
    await deliverSlot(s, '2026-07-10', 9);
    await deliverSlot(s, '2026-07-11', 10);
    const result = await runMonthlyBillingSweep(silentLog, NOW);
    expect(result.invoicesGenerated).toBe(0);
    expect(await db.$count(monthlyInvoices)).toBe(0);
  });

  it('one source of truth: the invoice ≡ Σ ledger debits — NET once settled, engaged otherwise', async () => {
    const advertiser = await seedUser();
    // Campaign A: settled — the reconciliation's NET (spend 80 of the 100 engaged) bills.
    const a = await seedScenario(JULY_CRENEAUX, { advertiser, budget: '100' });
    await db.insert(campaignReconciliation).values({
      campaignId: a.campaignId,
      expectedImp: 10000,
      deliveredImp: 8000,
      manquementImp: 2000,
      pPerteTnd: '20.0000',
      refundTnd: '20.0000',
      spendTnd: '80.0000',
      status: 'partial',
    });
    // Campaign B: unsettled — the engaged budget bills.
    await seedScenario([{ date: '2026-07-20', hour: 12, reps: 50, impressions: 5000 }], {
      advertiser,
      budget: '50',
    });

    await runMonthlyBillingSweep(silentLog, NOW);
    const [row] = await db
      .select()
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.advertiserId, advertiser));
    // Exactly what Mes finances shows for July: 80 (NET) + 50 (engaged) = 130.
    expect(Number(row?.totalHt)).toBe(130);
  });

  it('idempotent: a re-run skips (UNIQUE) and never duplicates the notification', async () => {
    const s = await seedScenario(JULY_CRENEAUX, { budget: '60' });
    await runMonthlyBillingSweep(silentLog, NOW);
    const second = await runMonthlyBillingSweep(silentLog, NOW);
    expect(second.invoicesGenerated).toBe(0);
    expect(second.invoicesSkipped).toBe(1);
    expect(await db.$count(monthlyInvoices)).toBe(1);
    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, s.advertiser),
          eq(notifications.type, 'monthly_invoice_ready'),
        ),
      );
    expect(notifs).toHaveLength(1);
  });

  it('recharges NEVER invoice: an advertiser with only confirmed recharges in the month gets no invoice', async () => {
    const advertiser = await seedUser();
    const id = randomUUID();
    await db.insert(recharges).values({
      id,
      advertiserId: advertiser,
      amountTnd: '5000.00',
      reference: makeReference(id),
      status: 'confirmed',
      confirmedAt: new Date('2026-07-15T10:00:00Z'),
    });
    const result = await runMonthlyBillingSweep(silentLog, NOW);
    expect(result.invoicesGenerated).toBe(0);
    expect(await db.$count(monthlyInvoices)).toBe(0);
  });

  it('the advertiser lists + downloads own invoices; a foreign invoice is a plain 404', async () => {
    const s = await seedScenario(JULY_CRENEAUX, { budget: '60' });
    await runMonthlyBillingSweep(silentLog, NOW);

    mockSession(s.advertiser);
    const list = (
      await app.inject({ method: 'GET', url: '/api/wallet/invoices' })
    ).json() as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ month: '2026-07', total_ht: 60 });

    const stranger = await seedUser();
    mockSession(stranger);
    expect((await app.inject({ method: 'GET', url: '/api/wallet/invoices' })).json()).toHaveLength(
      0,
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/wallet/invoices/${list[0]?.['id'] as string}/pdf`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('relevés: Σ sh_amount over the lines SETTLED that Tunis month (pinned vs reversement_lines), REL- ref, owner notified', async () => {
    const s = await seedScenario(JULY_CRENEAUX);
    // Two July settlements + one June one (excluded by the settled_at bucket).
    await seedReversementLine(
      s.campaignId,
      s.screenhostId,
      '30.0000',
      new Date('2026-07-05T10:00:00Z'),
    );
    await seedReversementLine(
      s.campaignId,
      s.screenhostId,
      '12.5000',
      new Date('2026-07-20T15:00:00Z'),
    );
    await seedReversementLine(
      s.campaignId,
      s.screenhostId,
      '99.0000',
      new Date('2026-06-10T10:00:00Z'),
    );

    const result = await runMonthlyBillingSweep(silentLog, NOW);
    expect(result.statementsGenerated).toBe(1);

    const [row] = await db
      .select()
      .from(screenhostMonthlyStatements)
      .where(eq(screenhostMonthlyStatements.screenhostId, s.screenhostId));
    expect(row).toMatchObject({ month: '2026-07' });
    expect(Number(row?.totalShTnd)).toBe(42.5);
    expect(row?.reference).toMatch(/^REL-[0-9A-F]{8}$/);

    const notifs = await db.select().from(notifications).where(eq(notifications.userId, s.ownerId));
    expect(notifs.map((n) => n.type)).toContain('reversement_statement_ready');

    // Idempotent re-run.
    const second = await runMonthlyBillingSweep(silentLog, NOW);
    expect(second.statementsGenerated).toBe(0);
    expect(second.statementsSkipped).toBe(1);
  });

  it('the owner lists + downloads own relevés (the PDF carries the venue + the amount); foreign is 404', async () => {
    const s = await seedScenario(JULY_CRENEAUX);
    await seedReversementLine(
      s.campaignId,
      s.screenhostId,
      '42.5000',
      new Date('2026-07-05T10:00:00Z'),
    );
    await runMonthlyBillingSweep(silentLog, NOW);

    mockSession(s.ownerId, 'individual_owner');
    const list = (
      await app.inject({ method: 'GET', url: '/api/screenhosts/statements' })
    ).json() as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ month: '2026-07', total_sh_tnd: 42.5 });

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/statements/${list[0]?.['id'] as string}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    const text = pdfText(pdfRes.rawPayload);
    expect(text).toContain('RELEVÉ DE REVERSEMENT');
    expect(text).toContain('juillet 2026');
    expect(text).toContain('42.50 TND');

    const stranger = await seedUser({ role: 'individual_owner' });
    mockSession(stranger, 'individual_owner');
    expect(
      (await app.inject({ method: 'GET', url: '/api/screenhosts/statements' })).json(),
    ).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/screenhosts/statements/${list[0]?.['id'] as string}/pdf`,
        })
      ).statusCode,
    ).toBe(404);
  });
});
