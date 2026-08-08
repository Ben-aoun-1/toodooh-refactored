import { pathToFileURL } from 'node:url';

import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignRedispatchRounds,
  campaigns,
  users,
} from '../src/db/schema.js';
import { tunisDateOf } from '../src/lib/campaign-dates.js';
import { loadDeliveredSlots } from '../src/lib/reconcile/delivered-slots.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { type AllocationInput, reconcileCampaign } from '../src/lib/reconcile/valuation.js';
import { S_MIN_TND } from '../src/lib/vf-constants.js';

// SETTLE1 — the settlement runner: the ONLY missing piece between the intact reconcile engine and
// a prod that has never settled a campaign. Diagnosis (2026-08-08): the auto-trigger
// (onCampaignCompleted) is a DELIBERATE no-op banked pending an operator ruling; the manual admin
// route requires status 'active' past end-date, but the lifecycle tick flips active→completed the
// next day — so every normally-ended campaign is unreconcilable through the route (its "no
// terminal enum value yet" comment predates CF-S1); and no admin UI ever called it anyway.
//
// This script calls the EXISTING reconcile-service (engine semantics byte-untouched, E6/E7
// conservation as-is). DRY-RUN BY DEFAULT: it prints the full inventory of ended-unreconciled
// CLASSIC campaigns with a valuation PREVIEW computed by the same loading recipe + the same pure
// valuation the service uses, and writes NOTHING. --execute (with --by <admin-uuid>) performs the
// real settlements one campaign at a time through reconcileCampaignById.
//
// Out of scope, reported as classes and never touched: event positionings (they settle through
// EV5's own settleEventPositioning path) and past-end pending/upcoming campaigns (never launched
// — no plan, nothing to settle).
//
// Usage:  pnpm --filter @toodooh/api reconcile:run -- --all-ended
//         pnpm --filter @toodooh/api reconcile:run -- --campaign <id>
//         ... -- --all-ended --execute --by <admin-user-id>

/** SETTLE1 charter §5 — accounts no fixture or walk may ever touch; the inventory asserts on it. */
export const PROTECTED_ACCOUNT_MARKERS = ['hillside', 'anis ben abdallah', 'focus', 'bilel khaled'];

export type OutcomeClass =
  | 'refund-full' // nothing delivered, gap ≥ S_min → full refund
  | 'partial' // some delivered, material gap → spend + refund
  | 'spend' // réussie: gap below S_min (or none) → full spend, no refund
  | 'no-plan-skip' // no frozen plan (never dispatched) — nothing to settle
  | 'protected-VIOLATION'; // advertiser matches a protected account — the walk REFUSES to run

export interface InventoryRow {
  campaignId: string;
  name: string;
  status: string;
  endDate: string;
  advertiserName: string;
  advertiserEmail: string;
  requestedBudgetTnd: number | null;
  outcome: OutcomeClass;
  /** Valuation preview (absent for no-plan/protected rows) — MUST equal what --execute persists. */
  preview: {
    expectedImp: number;
    deliveredImp: number;
    spendTnd: number;
    refundTnd: number;
    status: 'reussie' | 'partial';
    /** Venues receiving reversement value (delivered > 0) — the E7 lines --execute will write. */
    venuesWithValue: string[];
  } | null;
}

export interface SettlementInventory {
  today: string;
  rows: InventoryRow[];
  /** Ended event positionings (unsettled) — EV5's path, NEVER touched by this runner. */
  eventPositioningsSkipped: number;
  /** Past-end pending/upcoming — never launched, nothing to settle. */
  neverLaunchedSkipped: number;
  protectedViolations: InventoryRow[];
  totals: { spendTnd: number; refundTnd: number };
}

const isProtected = (name: string, email: string): boolean => {
  const hay = `${name} ${email}`.toLowerCase();
  return PROTECTED_ACCOUNT_MARKERS.some((m) => hay.includes(m));
};

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The service's own loading recipe (read-only) + its pure valuation — the dry-run preview. */
const previewValuation = async (campaignId: string): Promise<InventoryRow['preview']> => {
  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId))
    .limit(1);
  if (!plan) return null;
  const allocations = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan.id));
  const deliveredBySh = await loadDeliveredSlots(campaignId);
  const rounds = await db
    .select({
      placedFact: campaignRedispatchRounds.placedFact,
      reliquatConsumedFact: campaignRedispatchRounds.reliquatConsumedFact,
    })
    .from(campaignRedispatchRounds)
    .where(eq(campaignRedispatchRounds.campaignId, campaignId));
  const replacedMissedFact = rounds.reduce(
    (sum, r) => sum + Math.max(0, r.placedFact - r.reliquatConsumedFact),
    0,
  );
  const inputs: AllocationInput[] = allocations.map((a) => ({
    screenhostId: a.screenhostId,
    creneaux: a.creneaux.map((c) => ({ date: c.date, hour: c.hour, impressions: c.impressions })),
    deliveredSlots: deliveredBySh.get(a.screenhostId) ?? new Set<string>(),
  }));
  const valuation = reconcileCampaign(inputs, Number(plan.cpm), S_MIN_TND, {
    t: Number(plan.tTierCoef),
    reliquatStockeFact: plan.reliquatStocke,
    replacedMissedFact,
  });
  return {
    expectedImp: valuation.expectedImp,
    deliveredImp: valuation.deliveredImp,
    spendTnd: valuation.spendTnd,
    refundTnd: valuation.refundTnd,
    status: valuation.status,
    venuesWithValue: valuation.perScreenhost
      .filter((p) => p.deliveredImp > 0)
      .map((p) => p.screenhostId),
  };
};

const classify = (preview: InventoryRow['preview']): OutcomeClass => {
  if (preview === null) return 'no-plan-skip';
  if (preview.deliveredImp === 0 && preview.refundTnd > 0) return 'refund-full';
  if (preview.refundTnd > 0) return 'partial';
  return 'spend';
};

/**
 * The dry-run deliverable: every ended-unreconciled CLASSIC campaign (status active/completed —
 * 'active' covers the tick-lag day), with advertiser, budget, valuation preview and outcome
 * class; plus the skipped-class counts and the protected-accounts assertion.
 */
export const collectSettlementInventory = async (
  now: Date = new Date(),
  onlyCampaignId?: string,
): Promise<SettlementInventory> => {
  const today = tunisDateOf(now);
  const endedUnreconciled = and(
    isNull(campaignReconciliation.id),
    isNotNull(campaigns.endDate),
    lt(campaigns.endDate, today),
    ...(onlyCampaignId ? [eq(campaigns.id, onlyCampaignId)] : []),
  );

  const classicRows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      endDate: campaigns.endDate,
      requestedBudget: campaigns.requestedBudget,
      advertiserName: users.contactName,
      advertiserEmail: users.email,
    })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.advertiserId))
    .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(
      and(
        endedUnreconciled,
        isNull(campaigns.eventId),
        inArray(campaigns.status, ['active', 'completed']),
      ),
    )
    .orderBy(campaigns.endDate);

  const [eventSkips, neverLaunched] = await Promise.all([
    db
      .select({ id: campaigns.id })
      .from(campaigns)
      .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
      .where(and(endedUnreconciled, isNotNull(campaigns.eventId))),
    db
      .select({ id: campaigns.id })
      .from(campaigns)
      .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
      .where(
        and(
          endedUnreconciled,
          isNull(campaigns.eventId),
          inArray(campaigns.status, ['pending', 'upcoming']),
        ),
      ),
  ]);

  const rows: InventoryRow[] = [];
  for (const c of classicRows) {
    const protectedHit = isProtected(c.advertiserName ?? '', c.advertiserEmail);
    const preview = protectedHit ? null : await previewValuation(c.id);
    rows.push({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      endDate: c.endDate ?? '',
      advertiserName: c.advertiserName ?? '',
      advertiserEmail: c.advertiserEmail,
      requestedBudgetTnd: c.requestedBudget === null ? null : Number(c.requestedBudget),
      outcome: protectedHit ? 'protected-VIOLATION' : classify(preview),
      preview,
    });
  }

  return {
    today,
    rows,
    eventPositioningsSkipped: eventSkips.length,
    neverLaunchedSkipped: neverLaunched.length,
    protectedViolations: rows.filter((r) => r.outcome === 'protected-VIOLATION'),
    totals: {
      spendTnd: round4(rows.reduce((s, r) => s + (r.preview?.spendTnd ?? 0), 0)),
      refundTnd: round4(rows.reduce((s, r) => s + (r.preview?.refundTnd ?? 0), 0)),
    },
  };
};

export interface WalkResult {
  settled: { campaignId: string; spendTnd: number; refundTnd: number; status: string }[];
  skipped: { campaignId: string; reason: string }[];
}

/**
 * --execute — the real settlements, one campaign at a time through the UNTOUCHED
 * reconcileCampaignById. Refuses outright on any protected-account violation. Settles ONLY the
 * settleable classes (refund-full / partial / spend); no-plan rows are reported skips.
 */
export const runSettlementWalk = async (
  inventory: SettlementInventory,
  reconciledBy: string,
): Promise<WalkResult> => {
  if (inventory.protectedViolations.length > 0) {
    throw new Error(
      `protected-account violation: ${inventory.protectedViolations
        .map((r) => `${r.campaignId} (${r.advertiserName})`)
        .join(', ')} — the walk refuses to run`,
    );
  }
  const result: WalkResult = { settled: [], skipped: [] };
  for (const row of inventory.rows) {
    if (row.preview === null) {
      result.skipped.push({ campaignId: row.campaignId, reason: 'no-plan' });
      continue;
    }
    const settled = await reconcileCampaignById(row.campaignId, reconciledBy);
    if (settled.status === 'OK') {
      result.settled.push({
        campaignId: row.campaignId,
        spendTnd: Number(settled.reconciliation.spendTnd),
        refundTnd: Number(settled.reconciliation.refundTnd),
        status: settled.reconciliation.status,
      });
    } else {
      result.skipped.push({ campaignId: row.campaignId, reason: settled.status });
    }
  }
  return result;
};

// ── CLI (console permitted under scripts/) ────────────────────────────────────────────────────
const printInventory = (inv: SettlementInventory): void => {
  console.info(`SETTLE1 inventory — Tunis today ${inv.today}`);
  console.info(
    `classic ended-unreconciled: ${inv.rows.length} · event positionings (EV5 path, untouched): ${inv.eventPositioningsSkipped} · never-launched (untouched): ${inv.neverLaunchedSkipped}`,
  );
  for (const r of inv.rows) {
    const p = r.preview;
    console.info(
      `  [${r.outcome}] ${r.name} (${r.campaignId})\n` +
        `    advertiser: ${r.advertiserName} <${r.advertiserEmail}> · status ${r.status} · ended ${r.endDate} · budget ${r.requestedBudgetTnd ?? '—'}\n` +
        (p
          ? `    preview: expected ${p.expectedImp} / delivered ${p.deliveredImp} imp → spend ${p.spendTnd} TND, refund ${p.refundTnd} TND (${p.status}); venues with value: ${p.venuesWithValue.length}`
          : `    preview: none (${r.outcome})`),
    );
  }
  console.info(
    `Σ preview — spend ${inv.totals.spendTnd} TND · refund ${inv.totals.refundTnd} TND · protected violations: ${inv.protectedViolations.length}`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const byIdx = args.indexOf('--by');
  const reconciledBy = byIdx >= 0 ? args[byIdx + 1] : undefined;
  const campaignIdx = args.indexOf('--campaign');
  const onlyCampaign = campaignIdx >= 0 ? args[campaignIdx + 1] : undefined;
  const allEnded = args.includes('--all-ended');

  (async () => {
    if (!allEnded && !onlyCampaign) {
      console.error(
        'usage: reconcile:run -- --all-ended | --campaign <id> [--execute --by <admin-user-id>]',
      );
      process.exit(1);
    }
    const inventory = await collectSettlementInventory(new Date(), onlyCampaign);
    printInventory(inventory);

    if (!execute) {
      console.info(
        'DRY-RUN — nothing written. Re-run with --execute --by <admin-user-id> to settle.',
      );
      await sql.end();
      process.exit(inventory.protectedViolations.length > 0 ? 1 : 0);
    }

    if (!reconciledBy) {
      console.error('--execute requires --by <admin-user-id>');
      await sql.end();
      process.exit(1);
    }
    const [byUser] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, reconciledBy))
      .limit(1);
    if (!byUser || (byUser.role !== 'admin' && byUser.role !== 'superadmin')) {
      console.error(`--by ${reconciledBy} is not an existing admin user`);
      await sql.end();
      process.exit(1);
    }

    const walk = await runSettlementWalk(inventory, reconciledBy);
    for (const s of walk.settled) {
      console.info(
        `SETTLED ${s.campaignId}: spend ${s.spendTnd} TND, refund ${s.refundTnd} TND (${s.status})`,
      );
    }
    for (const sk of walk.skipped) console.info(`SKIPPED ${sk.campaignId}: ${sk.reason}`);
    console.info(`done: ${walk.settled.length} settled, ${walk.skipped.length} skipped`);
    await sql.end();
    process.exit(0);
  })().catch(async (err) => {
    console.error('reconcile:run failed:', err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
}
