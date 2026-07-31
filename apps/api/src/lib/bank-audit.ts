// REV1 — the internal fraud trail for the owner's payout coordinates (architect deviation).
//
// Two routes can move where money is sent, and BOTH must leave a trace:
//   PATCH /api/profile/bank                — the digits (titulaire / RIB / IBAN)
//   POST  /api/profile/documents/bank      — the identity file alone
// A file-only change is still a money-routing change: a fresh RIB scan against unchanged digits
// is exactly the shape a fraudulent swap would take, so it is audited like any other.
//
// Snapshot-in / snapshot-out rather than a diff: the caller reads the state BEFORE its write and
// again AFTER, and this appends the pair. That keeps the helper ignorant of WHICH field moved and
// makes a no-op change visibly a no-op (before ≡ after) instead of silently absent.
//
// The screenhost NEVER sees this. There is no owner route that reads it — admin only, by design.
// Bank digits are values, never logged: nothing here writes to the logger.

import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { userBankDetailsAudit, userDocuments, users } from '../db/schema.js';

/** The four fields that together say where an owner's money goes. */
export interface BankSnapshot {
  accountHolder: string | null;
  rib: string | null;
  iban: string | null;
  /** The user_documents row id for category 'bank' (cap 1), or null when nothing is on file. */
  bankDocumentId: string | null;
}

type Executor = Pick<typeof db, 'select' | 'insert'>;

/**
 * Read an owner's current payout state. Returns nulls (never throws) for a user with nothing
 * recorded — a first-time setup then audits as before ≡ all-null, which is the honest reading.
 */
export const snapshotBankState = async (
  executor: Executor,
  userId: string,
): Promise<BankSnapshot> => {
  const [row] = await executor
    .select({
      accountHolder: users.bankAccountHolder,
      rib: users.bankRib,
      iban: users.bankIban,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [doc] = await executor
    .select({ id: userDocuments.id })
    .from(userDocuments)
    .where(and(eq(userDocuments.userId, userId), eq(userDocuments.category, 'bank')))
    .limit(1);

  return {
    accountHolder: row?.accountHolder ?? null,
    rib: row?.rib ?? null,
    iban: row?.iban ?? null,
    bankDocumentId: doc?.id ?? null,
  };
};

/**
 * Append one audit row. `changedBy` is separate from `userId` so an admin-performed correction is
 * expressible without a migration; today the routes are session-scoped, so they coincide.
 */
export const writeBankAudit = async (
  executor: Executor,
  params: { userId: string; changedBy: string; before: BankSnapshot; after: BankSnapshot },
): Promise<void> => {
  const { userId, changedBy, before, after } = params;
  await executor.insert(userBankDetailsAudit).values({
    userId,
    changedBy,
    beforeAccountHolder: before.accountHolder,
    beforeRib: before.rib,
    beforeIban: before.iban,
    beforeBankDocumentId: before.bankDocumentId,
    afterAccountHolder: after.accountHolder,
    afterRib: after.rib,
    afterIban: after.iban,
    afterBankDocumentId: after.bankDocumentId,
  });
};
