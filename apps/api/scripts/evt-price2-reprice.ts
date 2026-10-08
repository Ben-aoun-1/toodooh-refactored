import { pathToFileURL } from 'node:url';

import { and, eq, inArray, isNotNull, notExists } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { campaignReconciliation, campaigns, eventAllocations } from '../src/db/schema.js';
import { checkEventMinutes } from '../src/lib/event-minutes-gate.js';
import { eventMinuteImpressions, eventMinutePriceTnd } from '../src/lib/event-pricing/minutes.js';
import { campaignPlaysPerMinute } from '../src/lib/event-pricing/spot.js';

// EVT-PRICE2 (operator ruling 2026-10-08, « c: modify them ») — ONE-OFF repricing, DRY-RUN BY
// DEFAULT. A minute used to be worth A_max × 4 impressions; it is now A_max ÷ 3 × R (R = the
// spot's plays per minute, lib/event-pricing/minutes.ts). The new price is ALWAYS lower (R ≤ 6, so
// A_max ÷ 3 × R ≤ 2 × A_max < 4 × A_max): repricing only ever gives money back.
//
// Scope: minutes-model positionings (event_minutes set) that are NOT settled (no
// campaign_reconciliation row) in draft, pending, rejected, upcoming or active. Completed ones are
// settled — payouts and invoices issued — and are never touched. An allocation is repriced only if
// it was written BEFORE --dispatched-before (the EVT-PRICE2 deploy: later ones were priced by the
// new formula already) and does not carry the « repriced » mark this script leaves on its blocs —
// so the A_max read back from the stored impressions is always the OLD formula's.
//
//   • Not dispatched (draft / pending / rejected): requested_budget = the live price of its
//     minutes at its spot's R (the minutes gate — what a PATCH computes from now on).
//   • Dispatched (upcoming / active): each allocation keeps its blocs; a bloc's A_max is read
//     back from its stored impressions (A_max × 4 at dispatch), so ONLY the formula changes:
//     impressions = A_max ÷ 3 × R, montant = Σ the blocs' new prices (never above the old one).
//     requested_budget drops by what the live allocations lose, and the rest of it (a refused
//     share not re-placed, refunded at settlement) scales by the same R ÷ 12.
//
// NO money moves here: a positioning's wallet « engagé » IS its requested_budget, and settlement
// charges its allocations' montants × the delivered share — both read the new values. The venue's
// share follows the montant. Each campaign is written in its own transaction that re-checks the
// predicate (status, budget and no settlement unchanged since the read), so a re-run changes
// nothing and a row settled in between is skipped.
//
// Usage (prod):
//   sudo docker compose -f /srv/toodooh/docker-compose.prod.yml exec api \
//     node_modules/.bin/tsx scripts/evt-price2-reprice.ts --dispatched-before <deploy ISO>  # dry-run
//   … the same command … --execute                                                         # write
// Locally: pnpm --filter @toodooh/api evt-price2:reprice -- --dispatched-before <iso> [--execute]

const REPRICED_STATUSES = ['draft', 'pending', 'rejected', 'upcoming', 'active'] as const;
const OLD_MINUTE_REPS = 4; // EVT-MIN1 ruling 1A: a minute was A_max × 4 impressions
/** Left on every repriced bloc: a re-run must never read the NEW impressions back as A_max × 4. */
export const REPRICED_MARK = 'EVT-PRICE2';
const USAGE =
  'usage: evt-price2-reprice --dispatched-before <ISO timestamp with Z or offset> [--execute]';
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const centimes = (tnd: number): number => Math.round(tnd * 100) / 100;

interface StoredBloc {
  start: string;
  end: string;
  impressions: number;
  repriced?: string;
}

const readBlocs = (raw: unknown): StoredBloc[] =>
  (Array.isArray(raw) ? raw : []).flatMap((b: unknown) => {
    if (typeof b !== 'object' || b === null) return [];
    const r = b as Record<string, unknown>;
    if (
      typeof r['start'] !== 'string' ||
      typeof r['end'] !== 'string' ||
      typeof r['impressions'] !== 'number'
    ) {
      return [];
    }
    const bloc: StoredBloc = { start: r['start'], end: r['end'], impressions: r['impressions'] };
    if (typeof r['repriced'] === 'string') bloc.repriced = r['repriced'];
    return [bloc];
  });

/** True once this script has repriced the allocation (every bloc carries the mark). */
export const isRepriced = (blocs: unknown): boolean => {
  const read = readBlocs(blocs);
  return read.length > 0 && read.every((b) => b.repriced === REPRICED_MARK);
};

export interface AllocationReprice {
  allocationId: string;
  statut: string;
  oldMontantTnd: number;
  newMontantTnd: number;
  oldImpressions: number;
  newImpressions: number;
  blocs: StoredBloc[];
}

/**
 * One allocation under the new formula. A bloc's A_max is its stored impressions ÷ 4 (what EVT-MIN1
 * wrote); a legacy whole-antenne bloc never reaches here (event_minutes is set). Pure.
 */
export const repriceAllocation = (
  allocation: {
    id: string;
    statut: string;
    blocs: unknown;
    montantTnd: number;
    impressionsTotal: number;
  },
  cpmEvtTnd: number,
  playsPerMinute: number,
): AllocationReprice => {
  const blocs = readBlocs(allocation.blocs).map((b) => {
    const amax = b.impressions / OLD_MINUTE_REPS;
    return {
      ...b,
      impressions: eventMinuteImpressions(amax, playsPerMinute),
      price: eventMinutePriceTnd(amax, cpmEvtTnd, playsPerMinute),
    };
  });
  const priced = centimes(blocs.reduce((sum, b) => sum + b.price, 0));
  return {
    allocationId: allocation.id,
    statut: allocation.statut,
    oldMontantTnd: allocation.montantTnd,
    newMontantTnd: Math.min(allocation.montantTnd, priced),
    oldImpressions: allocation.impressionsTotal,
    newImpressions: blocs.reduce((sum, b) => sum + b.impressions, 0),
    blocs: blocs.map(({ start, end, impressions }) => ({
      start,
      end,
      impressions,
      repriced: REPRICED_MARK,
    })),
  };
};

/** The budget of a dispatched positioning after its allocations are repriced. Pure. */
export const repricedBudget = (
  oldBudgetTnd: number,
  allocations: readonly AllocationReprice[],
  playsPerMinute: number,
): number => {
  const live = allocations.filter((a) => a.statut !== 'REFUSE');
  const oldLive = live.reduce((sum, a) => sum + a.oldMontantTnd, 0);
  const newLive = live.reduce((sum, a) => sum + a.newMontantTnd, 0);
  const rest = Math.max(0, oldBudgetTnd - oldLive);
  return centimes(
    Math.min(oldBudgetTnd, newLive + rest * (playsPerMinute / (OLD_MINUTE_REPS * 3))),
  );
};

export interface CampaignReprice {
  campaignId: string;
  name: string;
  status: string;
  minutes: number;
  playsPerMinute: number;
  oldBudgetTnd: number;
  newBudgetTnd: number | null;
  allocations: AllocationReprice[];
  note: string | null;
}

/** The plan: every in-scope positioning, repriced in memory. Reads only. */
export const planReprice = async (dispatchedBefore: Date): Promise<CampaignReprice[]> => {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      eventId: campaigns.eventId,
      eventMinutes: campaigns.eventMinutes,
      requestedBudget: campaigns.requestedBudget,
      eventCpmTnd: campaigns.eventCpmTnd,
    })
    .from(campaigns)
    .where(
      and(
        isNotNull(campaigns.eventId),
        isNotNull(campaigns.eventMinutes),
        inArray(campaigns.status, [...REPRICED_STATUSES]),
        notExists(
          db
            .select({ one: campaignReconciliation.campaignId })
            .from(campaignReconciliation)
            .where(eq(campaignReconciliation.campaignId, campaigns.id)),
        ),
      ),
    );
  const plan: CampaignReprice[] = [];
  for (const c of rows) {
    if (c.eventId === null || c.eventMinutes === null) continue;
    const r = await campaignPlaysPerMinute(c.id);
    const cpm = Number(c.eventCpmTnd);
    const oldBudget = Number(c.requestedBudget ?? 0);
    const allocs = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, c.id));
    const base = {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      minutes: c.eventMinutes,
      playsPerMinute: r,
      oldBudgetTnd: oldBudget,
    };
    if (allocs.length > 0) {
      const due = allocs.filter((a) => a.createdAt < dispatchedBefore && !isRepriced(a.blocs));
      if (due.length < allocs.length) {
        // Already repriced, or dispatched under the new formula: nothing to do — and a campaign
        // half-done would need a person, not a formula.
        if (due.length > 0) {
          plan.push({
            ...base,
            newBudgetTnd: null,
            allocations: [],
            note: 'not repriced: some allocations repriced or new, others not — check by hand',
          });
        }
        continue;
      }
      const repriced = allocs.map((a) =>
        repriceAllocation(
          {
            id: a.id,
            statut: a.statut,
            blocs: a.blocs,
            montantTnd: Number(a.montantTnd),
            impressionsTotal: a.impressionsTotal,
          },
          cpm,
          r,
        ),
      );
      plan.push({
        ...base,
        newBudgetTnd: repricedBudget(oldBudget, repriced, r),
        allocations: repriced,
        note: null,
      });
      continue;
    }
    const verdict = await checkEventMinutes(c.eventId, c.eventMinutes, cpm, r);
    plan.push({
      ...base,
      newBudgetTnd: verdict.ok ? Math.min(oldBudget || Infinity, verdict.priceTnd) : null,
      allocations: [],
      note: verdict.ok ? null : `not repriced: ${verdict.reason}`,
    });
  }
  return plan;
};

/** Write ONE campaign's repricing, re-checking the predicate inside the transaction. */
const applyOne = async (p: CampaignReprice): Promise<'written' | 'skipped'> => {
  if (p.newBudgetTnd === null) return 'skipped';
  return db.transaction(async (tx) => {
    const [still] = await tx
      .select({ status: campaigns.status, requestedBudget: campaigns.requestedBudget })
      .from(campaigns)
      .where(eq(campaigns.id, p.campaignId))
      .for('update');
    const [settled] = await tx
      .select({ one: campaignReconciliation.campaignId })
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, p.campaignId));
    if (
      !still ||
      settled ||
      still.status !== p.status ||
      Number(still.requestedBudget ?? 0) !== p.oldBudgetTnd
    ) {
      return 'skipped';
    }
    for (const a of p.allocations) {
      await tx
        .update(eventAllocations)
        .set({
          blocs: a.blocs,
          impressionsTotal: a.newImpressions,
          montantTnd: a.newMontantTnd.toFixed(3),
        })
        .where(eq(eventAllocations.id, a.allocationId));
    }
    await tx
      .update(campaigns)
      .set({ requestedBudget: p.newBudgetTnd?.toFixed(2) ?? null })
      .where(eq(campaigns.id, p.campaignId));
    return 'written';
  });
};

const tnd = (n: number | null): string => (n === null ? '—' : n.toFixed(2));

export const run = async (argv: readonly string[]): Promise<void> => {
  const index = argv.indexOf('--dispatched-before');
  const before = index >= 0 ? argv[index + 1] : undefined;
  if (
    before === undefined ||
    !ISO_WITH_ZONE_RE.test(before) ||
    Number.isNaN(new Date(before).getTime())
  ) {
    throw new Error(USAGE);
  }
  const execute = argv.includes('--execute');
  const plan = await planReprice(new Date(before));
  const lines: string[] = [`EVT-PRICE2 reprice — ${execute ? 'EXECUTE' : 'DRY-RUN'}`];
  let refund = 0;
  for (const p of plan) {
    lines.push(
      `${p.campaignId} « ${p.name} » [${p.status}] ${p.minutes} min, R ${p.playsPerMinute}: ` +
        `budget ${tnd(p.oldBudgetTnd)} → ${tnd(p.newBudgetTnd)} TND${p.note ? ` (${p.note})` : ''}`,
    );
    for (const a of p.allocations) {
      lines.push(
        `    allocation ${a.allocationId} [${a.statut}] montant ${tnd(a.oldMontantTnd)} → ` +
          `${tnd(a.newMontantTnd)} TND, impressions ${a.oldImpressions} → ${a.newImpressions}`,
      );
    }
    if (p.newBudgetTnd !== null) refund += p.oldBudgetTnd - p.newBudgetTnd;
  }
  lines.push(
    `${plan.length} positioning(s); budgets lowered by ${tnd(centimes(refund))} TND in all`,
  );
  if (execute) {
    let written = 0;
    for (const p of plan) if ((await applyOne(p)) === 'written') written += 1;
    lines.push(`written: ${written}, skipped: ${plan.length - written}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run(process.argv.slice(2))
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 1;
    })
    .finally(() => void sql.end());
}
