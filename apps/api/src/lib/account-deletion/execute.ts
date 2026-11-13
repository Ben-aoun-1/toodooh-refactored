import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { accountDeletions, users } from '../../db/schema.js';
import { storage } from '../../storage/s3-storage.js';
import { pushPlaylistToVenue } from '../playout/push.js';
import { screenRegistry } from '../playout/registry.js';

import {
  type DeletionTargets,
  collectTargets,
  pgTextArray,
  refValues,
  rowsAsJson,
  valuesOf,
} from './collect.js';
import { deletionOrder } from './graph.js';
import { kickHubDeletions } from './hub.js';

// DEL-1 (operator 2026-10-19, rulings A A B A) — COMPLETE account deletion, by a superadmin:
//   D1 A — complete: the user and every row that depends on it (graph.ts), other users' linked
//          rows included;
//   D2 A — the user's financial records (rows + PDFs) are first copied to a PRIVATE archive
//          (archives/deleted-accounts/<id>/), the one thing kept;
//   D3 B — nothing blocks it: running campaigns stop (the TVs get a fresh playlist), the
//          balance and unpaid earnings go with the account;
//   D4 A — superadmin only (the route's guard).
// The hub is told to delete the user's places (and agent user) — lib/account-deletion/hub.ts,
// retried until it confirms. Staff accounts (admin, superadmin) are never deleted here.

export const DELETABLE_ROLES: ReadonlySet<string> = new Set([
  'advertiser',
  'individual_owner',
  'fleet_owner',
  'screenhost_agent',
  'screencast_agent',
]);
const AGENT_ROLES: ReadonlySet<string> = new Set(['screenhost_agent', 'screencast_agent']);

/** Columns holding storage keys, per table — every file of the account is deleted. */
export const STORAGE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  creatives: ['storage_key'],
  campaigns: ['cta_storage_key'],
  user_documents: ['storage_key'],
  screenhost_monthly_reports: ['storage_key'],
  agents: ['photo_key'],
  agent_rib_submissions: ['storage_key'],
  agent_payouts: ['invoice_key'],
  recharges: ['document_key', 'bon_key', 'signed_bon_key'],
  monthly_invoices: ['pdf_key'],
  screenhost_factures: ['pdf_key', 'signed_file_key'],
};

/** D2 A — the financial records archived before deletion (rows as JSON). */
export const ARCHIVE_TABLES: readonly string[] = [
  'users',
  'campaigns',
  'recharges',
  'wallet_adjustments',
  'monthly_invoices',
  'campaign_reconciliation',
  'campaign_screenhost_payout',
  'reversement_lines',
  'screenhost_factures',
  'screenhost_facture_actions',
  'screenhost_versements',
  'agent_commission_lines',
  'agent_payouts',
  'user_bank_details_audit',
];

/** D2 A — the financial FILES copied into the archive (invoices, receipts, payment proofs). */
export const ARCHIVE_FILE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  recharges: ['document_key', 'bon_key', 'signed_bon_key'],
  monthly_invoices: ['pdf_key'],
  screenhost_factures: ['pdf_key', 'signed_file_key'],
  agent_payouts: ['invoice_key'],
};

export class AccountDeletionRefused extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_DELETABLE' | 'SELF') {
    super(code);
  }
}

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

const countsOf = (targets: DeletionTargets): Record<string, number> =>
  Object.fromEntries(
    [...targets.rows.entries()].filter(([, ids]) => ids.size > 0).map(([t, ids]) => [t, ids.size]),
  );

/** What a deletion would remove, without removing anything (the confirm dialog). */
export const previewAccountDeletion = async (userId: string) => {
  const [user] = await db
    .select({ id: users.id, role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AccountDeletionRefused('NOT_FOUND');
  if (!DELETABLE_ROLES.has(user.role)) throw new AccountDeletionRefused('NOT_DELETABLE');
  const targets = await collectTargets(db, userId);
  return { role: user.role, email: user.email, counts: countsOf(targets) };
};

/** Copies the financial records + files under the archive prefix (D2 A). */
const archive = async (tx: Tx, targets: DeletionTargets, prefix: string): Promise<number> => {
  const records: Record<string, unknown[]> = {};
  for (const table of ARCHIVE_TABLES) {
    const rows = await rowsAsJson(tx, targets, table);
    if (rows.length > 0) records[table] = rows;
  }
  let files = 0;
  for (const [table, columns] of Object.entries(ARCHIVE_FILE_COLUMNS)) {
    for (const column of columns) {
      for (const key of await valuesOf(tx, targets, table, column)) {
        const got = await storage.download({ key });
        if ('error' in got) continue;
        const saved = await storage.upload({
          key: `${prefix}files/${key}`,
          body: got.body,
          contentType: got.contentType ?? 'application/octet-stream',
        });
        if ('error' in saved) throw new Error(`archive upload failed: ${saved.error}`);
        files += 1;
      }
    }
  }
  const saved = await storage.upload({
    key: `${prefix}records.json`,
    body: Buffer.from(JSON.stringify({ archivedAt: new Date().toISOString(), records }, null, 2)),
    contentType: 'application/json',
  });
  if ('error' in saved) throw new Error(`archive upload failed: ${saved.error}`);
  return files;
};

export interface AccountDeletionResult {
  deletionId: string;
  role: string;
  counts: Record<string, number>;
  archivePrefix: string;
  archivedFiles: number;
}

export const deleteAccountCompletely = async (input: {
  userId: string;
  adminId: string;
  reason: string;
  log?: FastifyBaseLogger;
}): Promise<AccountDeletionResult> => {
  const { userId, adminId, reason, log } = input;
  if (userId === adminId) throw new AccountDeletionRefused('SELF');
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AccountDeletionRefused('NOT_FOUND');
  if (!DELETABLE_ROLES.has(user.role)) throw new AccountDeletionRefused('NOT_DELETABLE');

  const archivePrefix = `archives/deleted-accounts/${userId}/`;
  const outcome = await db.transaction(async (tx) => {
    const targets = await collectTargets(tx, userId);
    const archivedFiles = await archive(tx, targets, archivePrefix);

    const files: string[] = [];
    for (const [table, columns] of Object.entries(STORAGE_COLUMNS)) {
      for (const column of columns) files.push(...(await valuesOf(tx, targets, table, column)));
    }
    const deletedVenues = new Set(targets.rows.get('screenhosts') ?? []);
    const airedOn = new Set([
      ...(await valuesOf(tx, targets, 'campaign_dispatch_allocation', 'screenhost_id')),
      ...(await valuesOf(tx, targets, 'event_allocations', 'screenhost_id')),
    ]);
    const venuesToRefresh = [...airedOn].filter((id) => !deletedVenues.has(id));
    const deletedScreens = [...(targets.rows.get('screens') ?? [])];

    for (const [child, column, parent, ref] of targets.nullifies) {
      const values = await refValues(tx, targets, parent, ref);
      if (values.length === 0) continue;
      await tx.execute(
        sql`UPDATE ${sql.identifier(child)} SET ${sql.identifier(column)} = NULL
            WHERE ${sql.identifier(column)}::text = ANY(${pgTextArray(values)}::text[])`,
      );
    }
    for (const [child, column, parent, ref] of targets.leafDeletes) {
      const values = await refValues(tx, targets, parent, ref);
      if (values.length === 0) continue;
      await tx.execute(
        sql`DELETE FROM ${sql.identifier(child)} WHERE ${sql.identifier(column)}::text = ANY(${pgTextArray(values)}::text[])`,
      );
    }
    for (const table of deletionOrder([...targets.rows.keys()], targets.edges)) {
      const ids = [...(targets.rows.get(table) ?? [])];
      if (ids.length === 0) continue;
      const pk = targets.pk.get(table) ?? 'id';
      await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(pk)}::text = ANY(${pgTextArray(ids)}::text[])`,
      );
    }
    // Password-reset tokens carry the user id as their value (better-auth).
    await tx.execute(sql`DELETE FROM verifications WHERE value = ${userId}`);

    const counts = countsOf(targets);
    const agent = AGENT_ROLES.has(user.role);
    const [row] = await tx
      .insert(accountDeletions)
      .values({
        deletedUserId: userId,
        role: user.role,
        deletedBy: adminId,
        reason,
        archivePrefix,
        counts,
        hubLocationIds: [...deletedVenues],
        hubAgent: agent,
        hubStatus: deletedVenues.size > 0 || agent ? 'pending' : 'none',
      })
      .returning({ id: accountDeletions.id });
    return {
      deletionId: row?.id ?? '',
      counts,
      archivedFiles,
      files,
      venuesToRefresh,
      deletedScreens,
    };
  });

  // After the commit: files, TVs, hub. Each is best-effort and logged — the rows are gone.
  for (const key of outcome.files) {
    const res = await storage.delete({ key });
    if ('error' in res) log?.warn({ key, err: res.error }, 'account deletion: file not deleted');
  }
  for (const venueId of outcome.venuesToRefresh) await pushPlaylistToVenue(venueId, log);
  for (const screenId of outcome.deletedScreens) {
    for (const socket of screenRegistry.get(screenId)) socket.close(4403, 'screen deleted');
  }
  kickHubDeletions(log);
  log?.info(
    { deletionId: outcome.deletionId, role: user.role, tables: Object.keys(outcome.counts).length },
    'account deleted completely',
  );
  return {
    deletionId: outcome.deletionId,
    role: user.role,
    counts: outcome.counts,
    archivePrefix,
    archivedFiles: outcome.archivedFiles,
  };
};
