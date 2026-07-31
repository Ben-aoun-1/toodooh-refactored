import { desc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, userBankDetailsAudit, userDocuments, users } from '../src/db/schema.js';
import { adminRoutes } from '../src/routes/admin.js';
import { profileRoutes } from '../src/routes/profile.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// REV1 — the INTERNAL fraud trail for the owner's payout coordinates (architect deviation).
// An untraced RIB change is a fraud surface: users.bank_details_updated_at only ever answered
// WHEN. user_bank_details_audit answers WHAT moved and BY WHOM, with both snapshots.
//
// Keyed on user_id, per the 2026-07-31 ruling: the payout account is PER OWNER. A per-venue key
// would have let a fleet owner hold a different account per venue — a change to where money is
// paid. (The facture stays per-établissement; that keying is untouched.)

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = async () => {
  const app = Fastify({ logger: false });
  await app.register(profileRoutes);
  await app.register(adminRoutes);
  return app;
};

const mockSession = (userId: string, role = 'individual_owner'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `rev1-${seq}@example.com`,
      contactName: `Owner ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const RIB_A = '07098050014527001379';
const RIB_B = '11122233344455566677';
const IBAN_A = `TN59${RIB_A}`;
const IBAN_B = `TN59${RIB_B}`;

const auditRows = async (userId: string) =>
  db
    .select()
    .from(userBankDetailsAudit)
    .where(eq(userBankDetailsAudit.userId, userId))
    .orderBy(desc(userBankDetailsAudit.createdAt));

describe('REV1 — the bank-details audit trail (real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await resetAuthTables();
    // The audit references users with ON DELETE restrict, so it must be cleared BEFORE the users
    // it points at — resetAuthTables cannot do it for us without knowing this table.
    await db.delete(userBankDetailsAudit);
    app = await buildApp();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const patchBank = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/bank', payload });

  it('writes ONE audit row per change, carrying the BEFORE and AFTER snapshots', async () => {
    const owner = await seedUser();
    mockSession(owner);

    // First-ever setup: BEFORE is all-null, which is the honest reading of "nothing on file yet".
    expect(
      (
        await patchBank({
          bank_account_holder: 'Sami Ben Salah',
          bank_rib: RIB_A,
          bank_iban: IBAN_A,
        })
      ).statusCode,
    ).toBe(200);

    let rows = await auditRows(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.beforeAccountHolder).toBeNull();
    expect(rows[0]?.beforeRib).toBeNull();
    expect(rows[0]?.beforeIban).toBeNull();
    expect(rows[0]?.afterAccountHolder).toBe('Sami Ben Salah');
    expect(rows[0]?.afterRib).toBe(RIB_A);
    expect(rows[0]?.afterIban).toBe(IBAN_A);
    expect(rows[0]?.changedBy).toBe(owner);

    // A second change: the BEFORE of row 2 is the AFTER of row 1 — the trail is continuous.
    expect((await patchBank({ bank_rib: RIB_B, bank_iban: IBAN_B })).statusCode).toBe(200);

    rows = await auditRows(owner);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.beforeRib).toBe(RIB_A);
    expect(rows[0]?.afterRib).toBe(RIB_B);
    expect(rows[0]?.beforeIban).toBe(IBAN_A);
    expect(rows[0]?.afterIban).toBe(IBAN_B);
  });

  it('REPLACES rather than accumulates on the user row — the owner keeps no history', async () => {
    // A FLEET owner deliberately: the 2026-07-31 ruling is ONE payout account per owner, however
    // many venues they hold. Keying this per-venue would have split their money across accounts.
    const owner = await seedUser({ role: 'fleet_owner' });
    mockSession(owner, 'fleet_owner');
    await patchBank({ bank_account_holder: 'A', bank_rib: RIB_A, bank_iban: IBAN_A });
    await patchBank({ bank_account_holder: 'B', bank_rib: RIB_B, bank_iban: IBAN_B });

    const [row] = await db
      .select({ h: users.bankAccountHolder, r: users.bankRib, i: users.bankIban })
      .from(users)
      .where(eq(users.id, owner));
    // Exactly ONE live mode; the previous coordinates survive only in the internal audit.
    expect(row).toEqual({ h: 'B', r: RIB_B, i: IBAN_B });
    expect(await auditRows(owner)).toHaveLength(2);
  });

  it('refuses an invalid RIB or IBAN in FRENCH — and writes NO audit row for a refusal', async () => {
    const owner = await seedUser();
    mockSession(owner);

    const shortRib = await patchBank({ bank_rib: '1'.repeat(19) });
    expect(shortRib.statusCode).toBe(400);
    expect(JSON.stringify(shortRib.json())).toContain('RIB invalide (exactement 20 chiffres).');

    const letterIban = await patchBank({ bank_iban: `TNA${'2'.repeat(21)}` });
    expect(letterIban.statusCode).toBe(400);
    expect(JSON.stringify(letterIban.json())).toContain('IBAN invalide (TN suivi de 22 chiffres).');

    // A rejected change never moved money, so it must leave no trace pretending it did.
    expect(await auditRows(owner)).toHaveLength(0);
  });

  it('the audit is INVISIBLE on every owner-facing route', async () => {
    const owner = await seedUser();
    mockSession(owner);
    await patchBank({ bank_account_holder: 'Sami', bank_rib: RIB_A, bank_iban: IBAN_A });

    // The owner's own bank read-back carries the CURRENT mode and nothing historical. Both fields
    // move together here: a Tunisian IBAN EMBEDS the RIB, so patching the rib alone would leave
    // RIB_A's digits legitimately present inside the unchanged IBAN_A and the assertion would be
    // testing that coincidence rather than the absence of history.
    const res = await patchBank({ bank_rib: RIB_B, bank_iban: IBAN_B });
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(RIB_A); // the superseded value is not echoed back
    expect(body).not.toContain('before');
    expect(body).not.toContain('audit');

    // And there is no owner route that serves it at all.
    const owner404 = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${owner}/bank-audit`,
    });
    expect(owner404.statusCode).toBe(403); // authenticated, but not an admin
  });

  it('an ADMIN can read the trail; a non-admin cannot', async () => {
    const owner = await seedUser();
    mockSession(owner);
    await patchBank({ bank_account_holder: 'Sami', bank_rib: RIB_A, bank_iban: IBAN_A });
    await patchBank({ bank_rib: RIB_B });

    const admin = await seedUser({ role: 'admin', email: `rev1-admin-${seq}@example.com` });
    mockSession(admin, 'admin');
    const res = await app.inject({ method: 'GET', url: `/api/admin/users/${owner}/bank-audit` });
    expect(res.statusCode).toBe(200);
    const list = res.json() as {
      before: { bank_rib: string | null };
      after: { bank_rib: string };
    }[];
    expect(list).toHaveLength(2);
    // Newest first: the most recent change is RIB_A → RIB_B.
    expect(list[0]?.before.bank_rib).toBe(RIB_A);
    expect(list[0]?.after.bank_rib).toBe(RIB_B);
    expect(list[1]?.before.bank_rib).toBeNull();

    // A stale link to a deleted/unknown user is a distinct 404, not an empty list.
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/users/00000000-0000-0000-0000-000000000000/bank-audit',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('audits a FILE-ONLY change: swapping the identity document is a money-routing change', async () => {
    const owner = await seedUser();
    mockSession(owner);
    await patchBank({ bank_account_holder: 'Sami', bank_rib: RIB_A, bank_iban: IBAN_A });
    expect(await auditRows(owner)).toHaveLength(1);

    // The upload route is exercised through the DB effect it produces: inserting the cap-1 `bank`
    // slot is what the multipart handler does, and the audit must record the document id moving
    // while the digits stand still. (The multipart wire itself is covered by the documents suite.)
    const [doc] = await db
      .insert(userDocuments)
      .values({
        userId: owner,
        category: 'bank',
        position: 1,
        storageKey: `bank/${owner}/seed`,
        mimeType: 'image/jpeg',
      })
      .returning();

    const { snapshotBankState, writeBankAudit } = await import('../src/lib/bank-audit.js');
    const before = { accountHolder: 'Sami', rib: RIB_A, iban: IBAN_A, bankDocumentId: null };
    const after = await snapshotBankState(db, owner);
    await writeBankAudit(db, { userId: owner, changedBy: owner, before, after });

    const rows = await auditRows(owner);
    expect(rows).toHaveLength(2);
    // The digits are unchanged across the row — the DOCUMENT is what moved.
    expect(rows[0]?.beforeRib).toBe(RIB_A);
    expect(rows[0]?.afterRib).toBe(RIB_A);
    expect(rows[0]?.beforeBankDocumentId).toBeNull();
    expect(rows[0]?.afterBankDocumentId).toBe(doc?.id ?? null);
  });
});
