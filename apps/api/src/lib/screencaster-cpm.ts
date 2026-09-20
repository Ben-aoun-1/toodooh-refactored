import { and, asc, count, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../db/client.js';
import {
  campaignDispatchPlan,
  campaigns,
  eventAllocations,
  screencasterCpmChanges,
  users,
} from '../db/schema.js';

import type { CpmRates } from './dispatch/config.js';

// CPM-3 (operator rulings 2026-09-18) — THE home of the CPM per screencaster. The price is a
// property of the advertiser account (users.cpm_standard_tnd / cpm_event_tnd). When an admin
// changes it:
//   • the screencaster's DRAFTS take the new CPM (re-priced here, in the same transaction) —
//     EXCEPT a draft already locked in by a frozen plan or event allocations (ruling A below);
//   • pending, rejected, upcoming, active and completed campaigns keep the CPM they carry — this
//     file never touches them; activated ones price at the frozen plan.cpm anyway;
//   • a campaign created afterwards captures the new CPM through the migration-0076 trigger,
//     which now locks the advertiser row FOR KEY SHARE so it waits out a bulk change in flight
//     rather than reading the pre-change CPM underneath it.
// Every change writes one screencaster_cpm_changes row per screencaster.

// Operator ruling A (2026-09-19) — a `draft` that already has a frozen dispatch plan
// (campaign_dispatch_plan) or event allocations (event_allocations) was confirmed and paid at
// cart-confirm and is STRANDED in `draft` status; repricing the campaign row alone would disagree
// with the frozen plan.cpm / allocations montant_tnd a retried runDispatch / runEventDispatch
// would see (both return ALREADY_DISPATCHED and never re-read the campaign's CPM). ONE predicate
// for both the repricing UPDATE and the draft_count the list shows, so draft_count always counts
// exactly the drafts a change would actually reprice.
const repriceableDraft = and(
  eq(campaigns.status, 'draft'),
  notExists(
    db.select().from(campaignDispatchPlan).where(eq(campaignDispatchPlan.campaignId, campaigns.id)),
  ),
  notExists(
    db.select().from(eventAllocations).where(eq(eventAllocations.campaignId, campaigns.id)),
  ),
);

export interface ScreencasterCpmRow {
  id: string;
  company_name: string | null;
  contact_name: string;
  email: string;
  business_type: string | null;
  status: string;
  cpm_standard_tnd: number;
  cpm_event_tnd: number;
  draft_count: number;
  last_change: { changed_at: string; changed_by_name: string } | null;
}

export type UpdateScreencasterCpmResult =
  | { ok: true; updated: number; draftsRepriced: number }
  | { ok: false; error: 'NOT_ADVERTISER'; ids: string[] };

const changer = alias(users, 'changer');

/** Every advertiser account with its CPMs, its draft count and its last CPM change. */
export const listScreencasterCpm = async (): Promise<ScreencasterCpmRow[]> => {
  const advertisers = await db
    .select({
      id: users.id,
      businessName: users.businessName,
      contactName: users.contactName,
      email: users.email,
      businessType: users.businessType,
      status: users.status,
      cpmStandardTnd: users.cpmStandardTnd,
      cpmEventTnd: users.cpmEventTnd,
    })
    .from(users)
    .where(eq(users.role, 'advertiser'))
    .orderBy(asc(sql`lower(coalesce(${users.businessName}, ${users.contactName}))`));
  if (advertisers.length === 0) return [];
  const ids = advertisers.map((a) => a.id);

  const drafts = await db
    .select({ advertiserId: campaigns.advertiserId, n: count() })
    .from(campaigns)
    .where(and(inArray(campaigns.advertiserId, ids), repriceableDraft))
    .groupBy(campaigns.advertiserId);
  const draftsBy = new Map(drafts.map((d) => [d.advertiserId, d.n]));

  const changes = await db
    .selectDistinctOn([screencasterCpmChanges.userId], {
      userId: screencasterCpmChanges.userId,
      changedAt: screencasterCpmChanges.changedAt,
      changedByName: changer.contactName,
    })
    .from(screencasterCpmChanges)
    .innerJoin(changer, eq(screencasterCpmChanges.changedBy, changer.id))
    .where(inArray(screencasterCpmChanges.userId, ids))
    .orderBy(screencasterCpmChanges.userId, desc(screencasterCpmChanges.changedAt));
  const changeBy = new Map(changes.map((c) => [c.userId, c]));

  return advertisers.map((a) => {
    const last = changeBy.get(a.id);
    return {
      id: a.id,
      company_name: a.businessName,
      contact_name: a.contactName,
      email: a.email,
      business_type: a.businessType,
      status: a.status,
      cpm_standard_tnd: Number(a.cpmStandardTnd),
      cpm_event_tnd: Number(a.cpmEventTnd),
      draft_count: draftsBy.get(a.id) ?? 0,
      last_change: last
        ? { changed_at: last.changedAt.toISOString(), changed_by_name: last.changedByName }
        : null,
    };
  });
};

/** The CPMs a NEW campaign of this screencaster captures, or null for a non-advertiser. */
export const screencasterCpmRates = async (userId: string): Promise<CpmRates | null> => {
  const [row] = await db
    .select({ role: users.role, s: users.cpmStandardTnd, e: users.cpmEventTnd })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.role !== 'advertiser') return null;
  return { standardCpmTnd: Number(row.s), eventCpmTnd: Number(row.e) };
};

/**
 * Change the CPM of one or many screencasters (either rate or both) in ONE transaction: lock
 * them, refuse any id that is not an advertiser (nothing written), update each account, re-price
 * its drafts to the account's rates, write its trail row.
 */
export const updateScreencasterCpm = async (input: {
  userIds: readonly string[];
  standardCpmTnd?: number;
  eventCpmTnd?: number;
  changedBy: string;
}): Promise<UpdateScreencasterCpmResult> =>
  db.transaction(async (tx) => {
    const ids = [...new Set(input.userIds)];
    const rows = await tx
      .select({
        id: users.id,
        role: users.role,
        cpmStandardTnd: users.cpmStandardTnd,
        cpmEventTnd: users.cpmEventTnd,
      })
      .from(users)
      .where(inArray(users.id, ids))
      .orderBy(users.id)
      .for('update');
    const bad = ids.filter((id) => rows.find((r) => r.id === id)?.role !== 'advertiser');
    if (bad.length > 0) return { ok: false as const, error: 'NOT_ADVERTISER' as const, ids: bad };

    let draftsRepriced = 0;
    for (const row of rows) {
      const newStandard =
        input.standardCpmTnd !== undefined ? input.standardCpmTnd.toFixed(3) : row.cpmStandardTnd;
      const newEvent =
        input.eventCpmTnd !== undefined ? input.eventCpmTnd.toFixed(3) : row.cpmEventTnd;
      await tx
        .update(users)
        .set({ cpmStandardTnd: newStandard, cpmEventTnd: newEvent })
        .where(eq(users.id, row.id));
      // A draft follows its screencaster: BOTH rates are aligned on the account's — UNLESS it is
      // already stranded behind a frozen plan or event allocations (ruling A: repriceableDraft).
      const repriced = await tx
        .update(campaigns)
        .set({ standardCpmTnd: newStandard, eventCpmTnd: newEvent })
        .where(and(eq(campaigns.advertiserId, row.id), repriceableDraft))
        .returning({ id: campaigns.id });
      await tx.insert(screencasterCpmChanges).values({
        userId: row.id,
        changedBy: input.changedBy,
        oldStandardCpmTnd: row.cpmStandardTnd,
        newStandardCpmTnd: newStandard,
        oldEventCpmTnd: row.cpmEventTnd,
        newEventCpmTnd: newEvent,
        draftsRepriced: repriced.length,
      });
      draftsRepriced += repriced.length;
    }
    return { ok: true as const, updated: rows.length, draftsRepriced };
  });
