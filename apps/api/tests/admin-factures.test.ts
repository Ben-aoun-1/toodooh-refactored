import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  notifications,
  screenhostFactureActions,
  screenhostFactures,
  screenhostVersements,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { ttcFromHt } from '../src/lib/facture.js';
import { VERSEMENT_MODE_UNKNOWN, isMaskedSafe } from '../src/lib/versement-mode.js';
import { adminFacturesRoutes } from '../src/routes/admin-factures.js';
import { ownerStatementsRoutes } from '../src/routes/owner-statements.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// REV3 — the admin transition matrix, the versement FREEZE, and the completed deposit guard.
// Real Postgres. The four actions are the only way a facture leaves 'emise'/'en_verification',
// and each is legal from exactly ONE status — so the matrix below is the specification.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type Statut = 'emise' | 'en_verification' | 'en_paiement' | 'refusee' | 'payee';
type Action = 'valider' | 'refuser' | 'marquer-payee' | 'paper';

const ALL_STATUSES: Statut[] = ['emise', 'en_verification', 'en_paiement', 'refusee', 'payee'];

/** THE MATRIX. Action → the ONE status it is legal from. Everything else must 409. */
const LEGAL_FROM: Record<Action, Statut> = {
  valider: 'en_verification',
  refuser: 'en_verification',
  'marquer-payee': 'en_paiement',
  paper: 'emise',
};

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
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
      email: `rev3-${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// A REAL Tunisian pair: RIB = 20 digits, IBAN = TN + 22. The masking tests assert neither reaches
// the versement row, so the fixtures have to be the real shapes or the assertion proves nothing.
const RIB = '12345678901234567890';
const IBAN = 'TN5912345678901234567890';

interface Fixture {
  ownerId: string;
  adminId: string;
  screenhostId: string;
  factureId: string;
}

const seedFacture = async (
  opts: { status?: Statut; deposited?: boolean; rib?: string | null; iban?: string | null } = {},
): Promise<Fixture> => {
  const ownerId = await seedUser({
    role: 'individual_owner',
    businessName: 'Café Lac 2 SARL',
    bankRib: opts.rib === undefined ? RIB : opts.rib,
    bankIban: opts.iban === undefined ? IBAN : opts.iban,
  });
  const adminId = await seedUser({ role: 'admin' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Venue ${seq}`, ownerId })
    .returning();
  const screenhostId = sh?.id ?? '';
  const deposited = opts.deposited ?? opts.status === 'en_verification';
  const [f] = await db
    .insert(screenhostFactures)
    .values({
      screenhostId,
      month: '2026-07',
      totalShTnd: '42.5000',
      reference: `FS-${String(seq).padStart(8, '0')}`,
      pdfKey: `statements/${screenhostId}/2026-07.pdf`,
      status: opts.status ?? 'emise',
      signedFileKey: deposited ? `signed-factures/x-${seq}.pdf` : null,
      signedFileMime: deposited ? 'application/pdf' : null,
      depositedAt: deposited ? new Date('2026-08-03T09:00:00Z') : null,
      refusalMotif: opts.status === 'refusee' ? 'Cachet manquant.' : null,
    })
    .returning();
  return { ownerId, adminId, screenhostId, factureId: f?.id ?? '' };
};

describe('REV3 — admin facture transitions, versements + trace (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminFacturesRoutes);
    await app.register(ownerStatementsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  afterAll(async () => {
    await sql.end();
  });

  const act = (id: string, action: Action, body: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/admin/screenhost-factures/${id}/${action}`,
      payload: body,
    });

  // ── THE MATRIX ─────────────────────────────────────────────────────────────
  describe('the transition matrix — each action is legal from exactly ONE status', () => {
    for (const action of Object.keys(LEGAL_FROM) as Action[]) {
      for (const from of ALL_STATUSES) {
        const legal = LEGAL_FROM[action] === from;
        it(`${action} from ${from} → ${legal ? 'succeeds' : '409'}`, async () => {
          const f = await seedFacture({ status: from });
          mockSession(f.adminId);
          const res = await act(f.factureId, action, action === 'refuser' ? { motif: 'Non.' } : {});
          if (legal) {
            expect(res.statusCode).toBe(200);
          } else {
            expect(res.statusCode).toBe(409);
            // French, and it names why — never a bare code the admin UI has to guess at.
            expect(String((res.json() as { message: string }).message)).toMatch(/[a-z]{4}/);
            expect(res.json()).toHaveProperty('currentStatus', from);
          }
        });
      }
    }

    it('paper REFUSES a facture that was deposited, even though it is still emise', async () => {
      // The guard that matters: a deposited document is waiting to be checked. Paying it through
      // the paper path would skip the verification entirely.
      const f = await seedFacture({ status: 'emise', deposited: true });
      mockSession(f.adminId);
      const res = await act(f.factureId, 'paper', {});
      expect(res.statusCode).toBe(409);
      expect((res.json() as { message: string }).message).toContain('déjà été déposée');
      expect(await db.select().from(screenhostVersements)).toHaveLength(0);
    });

    it('refuser without a motif is a 400, and changes nothing', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      for (const body of [{}, { motif: '' }, { motif: '   ' }]) {
        expect((await act(f.factureId, 'refuser', body)).statusCode).toBe(400);
      }
      const [row] = await db
        .select()
        .from(screenhostFactures)
        .where(eq(screenhostFactures.id, f.factureId));
      expect(row?.status).toBe('en_verification');
      expect(row?.refusalMotif).toBeNull();
    });
  });

  // ── THE VERSEMENT, AND ITS FREEZE ──────────────────────────────────────────
  describe('the versement line', () => {
    it('valider writes ONE line whose montant is the facture TTC exactly', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      expect((await act(f.factureId, 'valider', {})).statusCode).toBe(200);

      const rows = await db.select().from(screenhostVersements);
      expect(rows).toHaveLength(1);
      // 42.50 HT → 50.58 TTC, the same figure the document and the owner's screen show.
      expect(Number(rows[0]?.montantTtc)).toBe(ttcFromHt(42.5));
      expect(Number(rows[0]?.montantTtc)).toBe(50.58);
      expect(rows[0]?.designation).toBe('Facture juillet 2026');
      expect(rows[0]?.userId).toBe(f.ownerId);
      expect(rows[0]?.createdBy).toBe(f.adminId);
    });

    it('THE FREEZE: changing the owner’s bank details leaves a written line byte-identical', async () => {
      // The load-bearing pin of the whole table. A derived label would silently rewrite history the
      // moment the coordinates moved; an owner must still see the account a past payment went to.
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'valider', {});
      const [before] = await db.select().from(screenhostVersements);
      expect(before?.modeLabelMasked).toBe('Virement bancaire — IBAN ••••7890');

      await db
        .update(users)
        .set({
          bankRib: '09876543210987654321',
          bankIban: 'TN1109876543210987654321',
          bankAccountHolder: 'Quelqu’un d’autre',
          bankDetailsUpdatedAt: new Date(),
        })
        .where(eq(users.id, f.ownerId));

      const [after] = await db.select().from(screenhostVersements);
      expect(after).toEqual(before);
      expect(after?.modeLabelMasked).toBe('Virement bancaire — IBAN ••••7890');
    });

    it('the mode is a LABEL — no RIB, no IBAN, nothing longer than four digits', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'valider', {});
      const [row] = await db.select().from(screenhostVersements);
      const label = row?.modeLabelMasked ?? '';
      expect(label).not.toContain(RIB);
      expect(label).not.toContain(IBAN);
      // Assert the SHAPE, not just the two fixtures: no run of digits long enough to be a
      // coordinate can appear, however the label is formatted in future.
      expect(label).not.toMatch(/[0-9]{5,}/);
      expect(isMaskedSafe(label)).toBe(true);
      // …and the whole row, in case a coordinate ever lands in another column.
      expect(JSON.stringify(row)).not.toContain(RIB);
      expect(JSON.stringify(row)).not.toContain(IBAN);
    });

    it('an owner with no coordinates on file still gets an honest label, not a crash', async () => {
      const f = await seedFacture({ status: 'en_verification', rib: null, iban: null });
      mockSession(f.adminId);
      expect((await act(f.factureId, 'valider', {})).statusCode).toBe(200);
      const [row] = await db.select().from(screenhostVersements);
      expect(row?.modeLabelMasked).toBe(VERSEMENT_MODE_UNKNOWN);
    });

    it('marquer-payee does NOT touch screenhost_versements', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'valider', {});
      const before = await db.select().from(screenhostVersements);
      expect(before).toHaveLength(1);

      expect((await act(f.factureId, 'marquer-payee', {})).statusCode).toBe(200);
      const after = await db.select().from(screenhostVersements);
      // Same count AND same content: the money moved once, at validation.
      expect(after).toEqual(before);
    });

    it('paper writes the line and pays in ONE action', async () => {
      const f = await seedFacture({ status: 'emise', deposited: false });
      mockSession(f.adminId);
      expect((await act(f.factureId, 'paper', {})).statusCode).toBe(200);

      const [facture] = await db
        .select()
        .from(screenhostFactures)
        .where(eq(screenhostFactures.id, f.factureId));
      expect(facture?.status).toBe('payee');
      const rows = await db.select().from(screenhostVersements);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.montantTtc)).toBe(50.58);
    });

    it('refuser writes NO versement line', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'refuser', { motif: 'Document illisible.' });
      expect(await db.select().from(screenhostVersements)).toHaveLength(0);
    });
  });

  // ── TRACE + NOTIFICATIONS ──────────────────────────────────────────────────
  describe('the admin trace and the owner notifications', () => {
    it('every action appends exactly one trace row, and refuser carries the motif', async () => {
      const v = await seedFacture({ status: 'en_verification' });
      mockSession(v.adminId);
      await act(v.factureId, 'valider', {});
      await act(v.factureId, 'marquer-payee', {});
      const trace = await db
        .select()
        .from(screenhostFactureActions)
        .where(eq(screenhostFactureActions.factureId, v.factureId));
      expect(trace.map((t) => t.action).sort()).toEqual(['marquer_payee', 'valider']);
      expect(trace.every((t) => t.adminId === v.adminId)).toBe(true);

      const r = await seedFacture({ status: 'en_verification' });
      mockSession(r.adminId);
      await act(r.factureId, 'refuser', { motif: 'Signature absente.' });
      const [refused] = await db
        .select()
        .from(screenhostFactureActions)
        .where(eq(screenhostFactureActions.factureId, r.factureId));
      expect(refused?.action).toBe('refuser');
      expect(refused?.motif).toBe('Signature absente.');

      const p = await seedFacture({ status: 'emise' });
      mockSession(p.adminId);
      await act(p.factureId, 'paper', {});
      const [paper] = await db
        .select()
        .from(screenhostFactureActions)
        .where(eq(screenhostFactureActions.factureId, p.factureId));
      expect(paper?.action).toBe('paper_payee');
    });

    it('each transition notifies the owner in French, and the refusal carries the motif', async () => {
      const v = await seedFacture({ status: 'en_verification' });
      mockSession(v.adminId);
      await act(v.factureId, 'valider', {});
      await act(v.factureId, 'marquer-payee', {});
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, v.ownerId));
      expect(notifs.map((n) => n.type).sort()).toEqual([
        'screenhost_facture_paid',
        'screenhost_facture_validated',
      ]);
      expect(notifs.find((n) => n.type === 'screenhost_facture_validated')?.body).toContain(
        'en cours de paiement',
      );

      const r = await seedFacture({ status: 'en_verification' });
      mockSession(r.adminId);
      await act(r.factureId, 'refuser', { motif: 'Cachet manquant.' });
      const [refusal] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, r.ownerId));
      expect(refusal?.type).toBe('screenhost_facture_refused');
      // The owner must be able to ACT on a refusal — the motif reaches them verbatim.
      expect(refusal?.body).toContain('Cachet manquant.');
    });
  });

  // ── THE COMPLETED DEPOSIT GUARD ────────────────────────────────────────────
  describe('the deposit guard, completed (REV2 refused only payee)', () => {
    const deposit = (id: string) => {
      const boundary = '----rev3';
      return app.inject({
        method: 'POST',
        url: `/api/screenhosts/statements/${id}/signed-deposit`,
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
          ),
          Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
    };

    for (const [status, expected] of [
      ['emise', 200],
      ['en_verification', 200],
      ['refusee', 200],
      ['en_paiement', 409],
      ['payee', 409],
    ] as const) {
      it(`a deposit from ${status} → ${expected}`, async () => {
        const f = await seedFacture({ status });
        mockSession(f.ownerId, 'individual_owner');
        expect((await deposit(f.factureId)).statusCode).toBe(expected);
      });
    }

    it('re-depositing on a REFUSED facture recovers it and CLEARS the motif', async () => {
      const f = await seedFacture({ status: 'refusee' });
      const [before] = await db
        .select()
        .from(screenhostFactures)
        .where(eq(screenhostFactures.id, f.factureId));
      expect(before?.refusalMotif).toBe('Cachet manquant.');

      mockSession(f.ownerId, 'individual_owner');
      expect((await deposit(f.factureId)).statusCode).toBe(200);

      const [after] = await db
        .select()
        .from(screenhostFactures)
        .where(eq(screenhostFactures.id, f.factureId));
      expect(after?.status).toBe('en_verification');
      // THE INVARIANT: refusal_motif is non-null if and only if status is 'refusee'.
      expect(after?.refusalMotif).toBeNull();
    });
  });

  // ── THE OWNER WIRES ────────────────────────────────────────────────────────
  describe('the owner wires stay status-free', () => {
    it('GET /versements returns EXACTLY the four frozen fields', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'valider', {});

      mockSession(f.ownerId, 'individual_owner');
      const res = await app.inject({ method: 'GET', url: '/api/screenhosts/versements' });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      // The KEY SET exactly — not "status is absent", which would pass for any richer row.
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
        'created_at',
        'designation',
        'mode_label_masked',
        'montant_ttc',
      ]);
      expect(rows[0]?.['montant_ttc']).toBe(50.58);
      // No status, no facture_id, no admin, no coordinates.
      for (const forbidden of ['status', 'facture_id', 'created_by', 'en_paiement', RIB, IBAN]) {
        expect(res.body).not.toContain(forbidden);
      }
    });

    it('a versement is owner-scoped — a stranger sees none of it', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'valider', {});
      const stranger = await seedUser({ role: 'individual_owner' });
      mockSession(stranger, 'individual_owner');
      expect(
        (await app.inject({ method: 'GET', url: '/api/screenhosts/versements' })).json(),
      ).toHaveLength(0);
    });

    it('the facture wires STILL carry no status, now that four more transitions exist', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.adminId);
      await act(f.factureId, 'refuser', { motif: 'Cachet manquant.' });

      mockSession(f.ownerId, 'individual_owner');
      const list = await app.inject({ method: 'GET', url: '/api/screenhosts/statements' });
      const detail = await app.inject({
        method: 'GET',
        url: `/api/screenhosts/statements/${f.factureId}`,
      });
      for (const res of [list, detail]) {
        expect(res.body).not.toContain('status');
        expect(res.body).not.toContain('refusee');
        // The motif reaches the owner by NOTIFICATION, never on a line.
        expect(res.body).not.toContain('Cachet manquant.');
      }
    });
  });

  // ── ADMIN LIST + FILTER ────────────────────────────────────────────────────
  describe('the admin list', () => {
    it('carries the status (the pill lives here and only here) and filters by statut', async () => {
      const a = await seedFacture({ status: 'en_verification' });
      mockSession(a.adminId);
      const [row] = (await app
        .inject({
          method: 'GET',
          url: '/api/admin/screenhost-factures',
        })
        .then((r) => r.json())) as Record<string, unknown>[];
      expect(row?.['status']).toBe('en_verification');
      expect(row?.['montant_ttc']).toBe(50.58);
      expect(row?.['designation']).toBe('Facture juillet 2026');

      await seedFacture({ status: 'payee' });
      mockSession(a.adminId);
      const filtered = (await app
        .inject({ method: 'GET', url: '/api/admin/screenhost-factures?statut=payee' })
        .then((r) => r.json())) as Record<string, unknown>[];
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.['status']).toBe('payee');

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/admin/screenhost-factures?statut=nope',
          })
        ).statusCode,
      ).toBe(400);
    });

    it('a non-admin cannot reach the admin surface at all', async () => {
      const f = await seedFacture({ status: 'en_verification' });
      mockSession(f.ownerId, 'individual_owner');
      expect(
        (await app.inject({ method: 'GET', url: '/api/admin/screenhost-factures' })).statusCode,
      ).toBe(403);
      expect((await act(f.factureId, 'valider', {})).statusCode).toBe(403);
    });
  });
});
