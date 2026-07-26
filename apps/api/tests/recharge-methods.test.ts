import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, dispatchConfig, notifications, recharges, users } from '../src/db/schema.js';
import { BON_RETURN_INSTRUCTION, BON_SIGNATURE_MENTION } from '../src/lib/bon-de-commande.js';
import {
  MIN_RECHARGE_TND,
  REFERENCE_PATTERN,
  isAdminDecidable,
  makeMethodReference,
  makeReference,
} from '../src/lib/recharges.js';
import { adminRechargesRoutes } from '../src/routes/admin-recharges.js';
import { rechargesRoutes } from '../src/routes/recharges.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FCT1 — recharge parcours v2: the TWO manual methods (virement + bon de commande), per-method
// lifecycles, the Bon émis admin-invisibility pin, credit-at-validation timing and the French
// notification fan-out. Integration suite: real Postgres (DATABASE_URL) + real MinIO (STORAGE_*),
// session mocked (the recharges.test.ts harness). Fixtures carry REAL magic bytes (CF-SH1).

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
      email: `rchmeth${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// Dependency-free multipart body (the recharge-document.test.ts pattern). Single `file` part; the
// empty variant (no part at all) drives the MANDATORY-justificatif 400.
const multipartBody = (file?: { filename: string; contentType: string; content: Buffer }) => {
  const boundary = `----toodoohtest${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head =
    file === undefined
      ? Buffer.alloc(0)
      : Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
            `Content-Type: ${file.contentType}\r\n\r\n`,
        );
  const content = file?.content ?? Buffer.alloc(0);
  const tail =
    file === undefined
      ? Buffer.from(`--${boundary}--\r\n`)
      : Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0 test jpeg body'),
]);

// Decode pdfkit's uncompressed hex text runs (the facture.test.ts helper) — compress:false in the
// renderer exists exactly for this.
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    if (hex.length % 2 === 0) out += Buffer.from(hex, 'hex').toString('latin1');
  }
  return out;
};

// ── pure pins (no DB) ─────────────────────────────────────────────────────────
describe('v2 references + the decidable predicate (pure)', () => {
  it('makeMethodReference pins VIR-/BC- + 8 uppercase alphanumerics', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(makeMethodReference('virement')).toMatch(/^VIR-[A-Z0-9]{8}$/);
      expect(makeMethodReference('bon_de_commande')).toMatch(/^BC-[A-Z0-9]{8}$/);
    }
    expect(REFERENCE_PATTERN.test(makeMethodReference('virement'))).toBe(true);
    // The legacy FCT- format stays out of the v2 pattern (legacy rows render as-found).
    expect(REFERENCE_PATTERN.test(makeReference(randomUUID()))).toBe(false);
  });

  it('isAdminDecidable: virement/legacy while pending, bon only once bon_returned', () => {
    expect(isAdminDecidable({ method: null, status: 'pending' })).toBe(true);
    expect(isAdminDecidable({ method: 'virement', status: 'pending' })).toBe(true);
    expect(isAdminDecidable({ method: 'bon_de_commande', status: 'bon_returned' })).toBe(true);
    // The invisibility keystone: an ISSUED bon is not decidable.
    expect(isAdminDecidable({ method: 'bon_de_commande', status: 'bon_issued' })).toBe(false);
    expect(isAdminDecidable({ method: 'virement', status: 'confirmed' })).toBe(false);
    expect(isAdminDecidable({ method: null, status: 'rejected' })).toBe(false);
    expect(isAdminDecidable({ method: 'bon_de_commande', status: 'confirmed' })).toBe(false);
  });
});

describe('recharge parcours v2 (real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(rechargesRoutes);
    await app.register(adminRechargesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Sweep the MinIO objects of surviving rows (the truncate runs in the NEXT test's beforeEach).
    const rows = await db
      .select({
        documentKey: recharges.documentKey,
        bonKey: recharges.bonKey,
        signedBonKey: recharges.signedBonKey,
      })
      .from(recharges);
    for (const r of rows) {
      for (const key of [r.documentKey, r.bonKey, r.signedBonKey]) {
        if (key !== null) await storage.delete({ key }).catch(() => undefined);
      }
    }
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const createVirement = (
    amount: number | string,
    body = multipartBody({ filename: 'v.pdf', contentType: 'application/pdf', content: PDF_BYTES }),
  ) => app.inject({ method: 'POST', url: `/api/recharges/virement?amount=${amount}`, ...body });
  const createBon = (amount: number) =>
    app.inject({ method: 'POST', url: '/api/recharges/bon', payload: { amount } });
  const depositSigned = (
    id: string,
    body = multipartBody({ filename: 's.jpg', contentType: 'image/jpeg', content: JPEG_BYTES }),
  ) => app.inject({ method: 'POST', url: `/api/recharges/${id}/signed-bon`, ...body });
  const adminList = (query = '') =>
    app.inject({ method: 'GET', url: `/api/admin/recharges${query}` });
  const confirm = (id: string) =>
    app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` });
  const reject = (id: string, reason = 'Justificatif illisible') =>
    app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/reject`, payload: { reason } });
  const balance = () => app.inject({ method: 'GET', url: '/api/wallet/balance' });
  const notificationsFor = (userId: string) =>
    db.select().from(notifications).where(eq(notifications.userId, userId));

  // ── virement parcours ──────────────────────────────────────────────────────
  it('virement happy path: create (mandatory justificatif) → En attente de réception → Valider credits the EXACT amount at validation', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(me);

    const created = await createVirement(750.5);
    expect(created.statusCode).toBe(201);
    const view = created.json() as Record<string, unknown>;
    expect(view).toMatchObject({
      method: 'virement',
      status: 'pending',
      amount_tnd: 750.5,
      has_document: true,
      has_bon: false,
    });
    expect(view['reference']).toMatch(/^VIR-[A-Z0-9]{8}$/);
    const id = view['id'] as string;

    // The screencaster is notified of the initial status; the admins are notified (actionable).
    const mine = await notificationsFor(me);
    expect(mine.map((n) => n.type)).toContain('recharge_virement_created');
    const adminRows = await notificationsFor(admin);
    expect(adminRows.map((n) => n.type)).toContain('recharge_action_required');

    // Credit-at-validation TIMING pin: nothing is credited while the demande waits.
    expect(((await balance()).json() as { credited_tnd: number }).credited_tnd).toBe(0);

    mockSession(admin, 'admin');
    expect((await adminList()).json()).toHaveLength(1);
    const confirmed = await confirm(id);
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { status: string }).status).toBe('confirmed');

    mockSession(me);
    expect((await balance()).json()).toMatchObject({ credited_tnd: 750.5, balance_tnd: 750.5 });
    const afterConfirm = await notificationsFor(me);
    expect(afterConfirm.map((n) => n.type)).toContain('recharge_credited');
  });

  it('virement without a file is a 400 — nothing stored, nobody notified (MANDATORY justificatif)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await createVirement(600, multipartBody());
    expect(res.statusCode).toBe(400);
    expect(await db.$count(recharges)).toBe(0);
    expect(await notificationsFor(me)).toHaveLength(0);
  });

  it('min 500 holds for BOTH methods (400 under, 201 at the floor)', async () => {
    const me = await seedUser();
    mockSession(me);
    expect((await createVirement(499.99)).statusCode).toBe(400);
    expect((await createBon(499.99)).statusCode).toBe(400);
    expect(await db.$count(recharges)).toBe(0);
    expect((await createVirement(MIN_RECHARGE_TND)).statusCode).toBe(201);
    expect((await createBon(MIN_RECHARGE_TND)).statusCode).toBe(201);
  });

  // ── bon parcours ───────────────────────────────────────────────────────────
  it('bon happy path: generate (stored PDF) → Bon émis → deposit signed → Bon retourné signé → Valider credits at validation', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(me);

    const created = await createBon(1000);
    expect(created.statusCode).toBe(201);
    const view = created.json() as Record<string, unknown>;
    expect(view).toMatchObject({
      method: 'bon_de_commande',
      status: 'bon_issued',
      amount_tnd: 1000,
      has_bon: true,
      has_signed_bon: false,
      has_document: false,
    });
    expect(view['reference']).toMatch(/^BC-[A-Z0-9]{8}$/);
    const id = view['id'] as string;

    // The persisted sign invite (the popup is ephemeral, the notification is not).
    expect((await notificationsFor(me)).map((n) => n.type)).toContain('recharge_bon_issued');

    // The stored bon streams back to the owner, byte-stable.
    const bon = await app.inject({ method: 'GET', url: `/api/recharges/${id}/bon` });
    expect(bon.statusCode).toBe(200);
    expect(bon.headers['content-type']).toBe('application/pdf');
    expect(bon.headers['content-disposition']).toBe(
      `inline; filename="bon-commande-${view['reference'] as string}.pdf"`,
    );
    expect(bon.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Deposit the signed bon → bon_returned; NOW the admins hear about it.
    const deposited = await depositSigned(id);
    expect(deposited.statusCode).toBe(200);
    expect(deposited.json() as Record<string, unknown>).toMatchObject({
      status: 'bon_returned',
      has_signed_bon: true,
    });
    expect(
      (deposited.json() as { signed_bon_deposited_at: string }).signed_bon_deposited_at,
    ).not.toBeNull();
    expect((await notificationsFor(me)).map((n) => n.type)).toContain('recharge_bon_returned');
    expect((await notificationsFor(admin)).map((n) => n.type)).toContain(
      'recharge_action_required',
    );

    // Nothing credited before the Valider.
    expect(((await balance()).json() as { credited_tnd: number }).credited_tnd).toBe(0);

    mockSession(admin, 'admin');
    const confirmed = await confirm(id);
    expect(confirmed.statusCode).toBe(200);

    mockSession(me);
    expect((await balance()).json()).toMatchObject({ credited_tnd: 1000, balance_tnd: 1000 });
    expect((await notificationsFor(me)).map((n) => n.type)).toContain('recharge_funds_received');
  });

  it('the generated bon PDF carries the chartered French content (identity + montant + BC-ref)', async () => {
    const me = await seedUser({ businessName: 'Société Atlas' });
    mockSession(me);
    const created = await createBon(850.25);
    const view = created.json() as { id: string; reference: string };
    const bon = await app.inject({ method: 'GET', url: `/api/recharges/${view.id}/bon` });
    const text = pdfText(bon.rawPayload);
    expect(text).toContain('BON DE COMMANDE');
    expect(text).toContain(view.reference);
    expect(text).toContain('Société Atlas');
    expect(text).toContain('850.25 TND'); // Montant HT
    expect(text).toContain('1011.80 TND'); // Total TTC (19 % TVA, the facture rounding)
    expect(text).toContain('Bon pour accord');
    expect(text).toContain(BON_SIGNATURE_MENTION);
    expect(text).toContain(BON_RETURN_INSTRUCTION);
  });

  // ── the Bon émis admin-invisibility pin ────────────────────────────────────
  it('« Bon émis » rows NEVER appear to the admin: list excludes them, the status filter cannot request them, no admin notification exists', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(me);
    await createBon(600);
    const virement = (await createVirement(500)).json() as { id: string };

    mockSession(admin, 'admin');
    const list = (await adminList()).json() as { id: string; status: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(virement.id);
    expect((await adminList('?status=bon_issued')).statusCode).toBe(400);
    expect((await adminList('?status=bon_returned')).json()).toHaveLength(0);
    // The only admin notification is the VIREMENT one — bon issuance fans out nothing.
    const adminRows = await notificationsFor(admin);
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]?.title).toBe('Nouvelle demande de recharge par virement');
  });

  it('an issued bon cannot be decided: direct confirm/reject 409 until the signed bon is deposited', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(me);
    const bon = (await createBon(700)).json() as { id: string };
    mockSession(admin, 'admin');
    expect((await confirm(bon.id)).statusCode).toBe(409);
    expect((await reject(bon.id)).statusCode).toBe(409);
    mockSession(me);
    expect(((await balance()).json() as { credited_tnd: number }).credited_tnd).toBe(0);
  });

  // ── annuler ────────────────────────────────────────────────────────────────
  it('Annuler: decidable → rejected («Annulée»), cancelled_at stamped, NO credit, reason notified', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(me);
    const virement = (await createVirement(500)).json() as { id: string };

    mockSession(admin, 'admin');
    const rejected = await reject(virement.id, 'Virement introuvable');
    expect(rejected.statusCode).toBe(200);
    const body = rejected.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'rejected', reject_reason: 'Virement introuvable' });
    expect(body['cancelled_at']).not.toBeNull();

    mockSession(me);
    expect(((await balance()).json() as { credited_tnd: number }).credited_tnd).toBe(0);
    const mine = await notificationsFor(me);
    const cancelNote = mine.find((n) => n.type === 'recharge_cancelled');
    expect(cancelNote?.body).toContain('Virement introuvable');
  });

  // ── legacy rows ────────────────────────────────────────────────────────────
  it('legacy rows (method NULL) render as-found and stay admin-decidable', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    const legacyId = randomUUID();
    await db.insert(recharges).values({
      id: legacyId,
      advertiserId: me,
      amountTnd: '150.00',
      reference: makeReference(legacyId),
      status: 'pending',
    });

    mockSession(me);
    const mine = (await app.inject({ method: 'GET', url: '/api/recharges/mine' })).json() as Record<
      string,
      unknown
    >[];
    expect(mine[0]).toMatchObject({
      method: null,
      has_bon: false,
      has_signed_bon: false,
      cancelled_at: null,
    });
    expect(mine[0]?.['reference']).toMatch(/^FCT-[0-9A-F]{8}$/);

    mockSession(admin, 'admin');
    expect((await adminList()).json()).toHaveLength(1);
    expect((await confirm(legacyId)).statusCode).toBe(200);
    mockSession(me);
    expect((await balance()).json()).toMatchObject({ credited_tnd: 150 });
  });

  // ── scoping ────────────────────────────────────────────────────────────────
  it('bon download: foreign ≡ missing ≡ bon-less — one identical 404; signed-bon deposit scopes the same', async () => {
    const me = await seedUser();
    const stranger = await seedUser();
    mockSession(me);
    const bon = (await createBon(500)).json() as { id: string };
    const virement = (await createVirement(500)).json() as { id: string };

    mockSession(stranger);
    const foreign = await app.inject({ method: 'GET', url: `/api/recharges/${bon.id}/bon` });
    const missing = await app.inject({ method: 'GET', url: `/api/recharges/${randomUUID()}/bon` });
    mockSession(me);
    const bonless = await app.inject({ method: 'GET', url: `/api/recharges/${virement.id}/bon` });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(bonless.body).toBe(missing.body);

    mockSession(stranger);
    expect((await depositSigned(bon.id)).statusCode).toBe(404);
    // A signed deposit against a virement row is a state conflict, not a not-found.
    mockSession(me);
    expect((await depositSigned(virement.id)).statusCode).toBe(409);
  });

  it('a second signed-bon deposit 409s (bon_returned is not depositable again)', async () => {
    const me = await seedUser();
    mockSession(me);
    const bon = (await createBon(500)).json() as { id: string };
    expect((await depositSigned(bon.id)).statusCode).toBe(200);
    expect((await depositSigned(bon.id)).statusCode).toBe(409);
  });

  // ── the admin files ────────────────────────────────────────────────────────
  it('admin presigns for the generated bon and the signed bon (404 while absent)', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(me);
    const bon = (await createBon(500)).json() as { id: string };

    mockSession(admin, 'admin');
    const bonUrl = await app.inject({
      method: 'GET',
      url: `/api/admin/recharges/${bon.id}/bon-url`,
    });
    expect(bonUrl.statusCode).toBe(200);
    expect((bonUrl.json() as { url: string }).url).toContain('bon.pdf');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/admin/recharges/${bon.id}/signed-bon-url`,
        })
      ).statusCode,
    ).toBe(404);

    mockSession(me);
    await depositSigned(bon.id);
    mockSession(admin, 'admin');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/admin/recharges/${bon.id}/signed-bon-url`,
        })
      ).statusCode,
    ).toBe(200);
  });

  // ── bank coordinates ───────────────────────────────────────────────────────
  it('bank-coordinates: placeholder «—» quartet until the operator provisions the config row by SQL', async () => {
    const me = await seedUser();
    mockSession(me);
    const before = await app.inject({ method: 'GET', url: '/api/recharges/bank-coordinates' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ rib: '—', iban: '—', bic: '—', domiciliation: '—' });

    // The operator's one-liner (config, never code) — restored right after.
    await db
      .update(dispatchConfig)
      .set({
        bankRib: 'TN59 123',
        bankIban: 'TN5901234567890123456789',
        bankBic: 'BIATTNTT',
        bankDomiciliation: 'BIAT — Agence Tunis Lac',
      });
    try {
      const after = await app.inject({ method: 'GET', url: '/api/recharges/bank-coordinates' });
      expect(after.json()).toEqual({
        rib: 'TN59 123',
        iban: 'TN5901234567890123456789',
        bic: 'BIATTNTT',
        domiciliation: 'BIAT — Agence Tunis Lac',
      });
    } finally {
      await db
        .update(dispatchConfig)
        .set({ bankRib: '—', bankIban: '—', bankBic: '—', bankDomiciliation: '—' });
    }
  });
});
