import { desc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { hostAdminEdits, users } from '../db/schema.js';

import { userLabel } from './user-label.js';

// HOST-EDIT1 (ruling Q3 A, 2026-10-25) — the ONE home of the admin edit trail of a venue
// (host_admin_edits). Every admin writer of the « Fiche Host » page calls writeHostAudit with the
// state it read BEFORE its write and the state AFTER; only the keys that moved are stored, and a
// save that changed nothing writes no row. Values are wire-shaped (snake_case), never secrets.
export const HOST_AUDIT_SECTIONS = [
  'venue',
  'owner',
  'eligibility',
  'wifi',
  'declaration',
  'unavailability',
  'lock',
] as const;
export type HostAuditSection = (typeof HOST_AUDIT_SECTIONS)[number];

type Snapshot = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The keys whose value differs, as a before / after pair (keys of either side are compared). */
export const changedFields = (
  before: Snapshot,
  after: Snapshot,
): { before: Snapshot; after: Snapshot } | null => {
  const b: Snapshot = {};
  const a: Snapshot = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[key] ?? null;
    const now = after[key] ?? null;
    if (same(was, now)) continue;
    b[key] = was;
    a[key] = now;
  }
  return Object.keys(a).length === 0 ? null : { before: b, after: a };
};

type Executor = Pick<typeof db, 'insert'>;

/** Append one trail row when something changed; returns whether a row was written. */
export const writeHostAudit = async (
  executor: Executor,
  params: {
    screenhostId: string;
    section: HostAuditSection;
    changedBy: string;
    before: Snapshot;
    after: Snapshot;
  },
): Promise<boolean> => {
  const diff = changedFields(params.before, params.after);
  if (!diff) return false;
  await executor.insert(hostAdminEdits).values({
    screenhostId: params.screenhostId,
    section: params.section,
    changedBy: params.changedBy,
    before: diff.before,
    after: diff.after,
  });
  return true;
};

export interface HostAuditEntry {
  id: string;
  section: string;
  before: Snapshot;
  after: Snapshot;
  changed_by: { id: string; label: string } | null;
  created_at: Date;
}

/** The venue's trail, newest first, with who saved it. */
export const listHostAudit = async (
  screenhostId: string,
  limit = 100,
): Promise<HostAuditEntry[]> => {
  const rows = await db
    .select({
      id: hostAdminEdits.id,
      section: hostAdminEdits.section,
      before: hostAdminEdits.before,
      after: hostAdminEdits.after,
      createdAt: hostAdminEdits.createdAt,
      adminId: users.id,
      adminBusinessName: users.businessName,
      adminContactName: users.contactName,
      adminEmail: users.email,
    })
    .from(hostAdminEdits)
    .leftJoin(users, eq(users.id, hostAdminEdits.changedBy))
    .where(eq(hostAdminEdits.screenhostId, screenhostId))
    .orderBy(desc(hostAdminEdits.createdAt), desc(hostAdminEdits.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    section: r.section,
    before: r.before,
    after: r.after,
    changed_by:
      r.adminId && r.adminContactName !== null && r.adminEmail !== null
        ? {
            id: r.adminId,
            label: userLabel({
              id: r.adminId,
              businessName: r.adminBusinessName,
              contactName: r.adminContactName,
              email: r.adminEmail,
            }),
          }
        : null,
    created_at: r.createdAt,
  }));
};
