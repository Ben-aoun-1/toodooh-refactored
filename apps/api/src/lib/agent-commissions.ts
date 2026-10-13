import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  type AgentAffiliation,
  type AgentCommissionLine,
  agentAffiliations,
  agentCommissionLines,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaigns,
  eventAllocations,
  proofOfPlay,
  reversementLines,
} from '../db/schema.js';

import { agentCommissionPct } from './agent-sheet.js';
import { isDemoCampaign } from './demo.js';
import { getDispatchConfig } from './dispatch/config.js';
import { proofInstantSql } from './playout/proof-instant.js';
import { type ReversementPcts, reversementBaseMillimes } from './reversement/split.js';

// AGT-3 (agent specs v1.0 §10, rulings 2026-10-13) — THE AGENT COMMISSION LINES, one home.
//
// The commission is an OUTPUT of the engine, never an interface computation. Instead of hooking
// every engine write path (dispatch, acceptance, redispatch, cascade, boost, events), one
// idempotent sync DERIVES the forecast lines from the current allocations and affiliations:
//   • Screencaster agent — one line per campaign, for the advertiser's affiliation live at the
//     campaign's launch date; forecast = rate × value of the non-refused allocations.
//   • Screenhost agent — one line per (campaign, ACCEPTED venue) for the venue's live affiliation
//     (not excluded, not « exploité » without a convention); forecast = rate × venue value.
//   • The rate is FROZEN on the line when it is first written: a later rate change only reaches
//     new lines. A closed agent account (clôturé) gets no line.
// At settlement the reversement split READS these frozen rates (settlementAgentTerms), so the
// reversement line stays the single source of the acquired money; acquireAgentCommissions then
// turns each line 'acquise' (or 'annulee'). A Screenhost agent's line is acquired only for the
// diffusion days inside the venue's affiliation window, pro rata of the proofs; while the venue
// is pending activation it stays 'previsionnel' and the tick acquires it once the window exists.
// What no agent takes stays on the reversement line unattributed — it remains Toodooh's.

type Executor = typeof db;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The affiliation that earns (its agent, role and window). */
interface LiveAffiliation {
  affiliation: AgentAffiliation;
}

const openAgent = sql`exists (select 1 from ${agents} where ${agents.userId} = ${agentAffiliations.agentUserId} and ${agents.accountStatus} <> 'cloture')`;

/** The advertiser's Screencaster-agent affiliation whose window covers the launch date. */
export const liveScAffiliation = async (
  advertiserId: string,
  launchDate: string,
  executor: Executor = db,
): Promise<LiveAffiliation | null> => {
  const [row] = await executor
    .select()
    .from(agentAffiliations)
    .where(
      and(
        eq(agentAffiliations.referredUserId, advertiserId),
        isNull(agentAffiliations.screenhostId),
        inArray(agentAffiliations.status, ['en_cours', 'terminee']),
        sql`${agentAffiliations.startDate} <= ${launchDate}::date`,
        sql`${launchDate}::date < ${agentAffiliations.endDate}`,
        openAgent,
      ),
    )
    .limit(1);
  return row ? { affiliation: row } : null;
};

/** The venue's earning Screenhost-agent affiliation (the window is applied per day later). */
export const liveShAffiliations = async (
  screenhostIds: string[],
  executor: Executor = db,
): Promise<Map<string, LiveAffiliation>> => {
  if (screenhostIds.length === 0) return new Map();
  const rows = await executor
    .select()
    .from(agentAffiliations)
    .where(
      and(
        inArray(agentAffiliations.screenhostId, screenhostIds),
        ne(agentAffiliations.status, 'exclue'),
        sql`not (${agentAffiliations.exploitedByAgent} and ${agentAffiliations.conventionRef} is null)`,
        openAgent,
      ),
    );
  return new Map(rows.map((a) => [a.screenhostId ?? '', { affiliation: a }]));
};

/** Each venue's value in TND (HT) and whether its owner accepted, from the dispatch. */
const venueValues = async (
  campaignId: string,
  eventId: string | null,
): Promise<{ screenhostId: string; valueTnd: number; accepted: boolean }[]> => {
  if (eventId) {
    const rows = await db
      .select()
      .from(eventAllocations)
      .where(
        and(eq(eventAllocations.campaignId, campaignId), ne(eventAllocations.statut, 'REFUSE')),
      );
    return rows.map((r) => ({
      screenhostId: r.screenhostId,
      valueTnd: Number(r.montantTnd),
      accepted: r.statut === 'ACCEPTE',
    }));
  }
  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId))
    .limit(1);
  if (!plan) return [];
  const t = Number(plan.tTierCoef);
  const cCible = (plan.iCible * Number(plan.cpm)) / 1000;
  const rows = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(
      and(
        eq(campaignDispatchAllocation.planId, plan.id),
        ne(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  return rows.map((r) => {
    const imp = r.creneaux.reduce((s, c) => s + c.impressions, 0);
    return {
      screenhostId: r.screenhostId,
      valueTnd: reversementBaseMillimes(imp * t, plan.iCible, cCible) / 1000,
      accepted: r.statutAcceptation === 'ACCEPTE',
    };
  });
};

const isSettled = async (campaignId: string) => {
  const [r] = await db
    .select({ id: campaignReconciliation.id })
    .from(campaignReconciliation)
    .where(eq(campaignReconciliation.campaignId, campaignId))
    .limit(1);
  return r !== undefined;
};

const linesOf = (campaignId: string) =>
  db
    .select()
    .from(agentCommissionLines)
    .where(
      and(
        eq(agentCommissionLines.campaignId, campaignId),
        eq(agentCommissionLines.kind, 'commission'),
      ),
    );

/** Write (or revive) one forecast line, keeping the rate frozen on an existing line. */
const upsertForecast = async (
  existing: AgentCommissionLine | undefined,
  live: LiveAffiliation,
  campaignId: string,
  screenhostId: string | null,
  valueTnd: number,
) => {
  const a = live.affiliation;
  if (existing) {
    if (existing.status === 'acquise') return;
    await db
      .update(agentCommissionLines)
      .set({
        status: 'previsionnel',
        forecastTnd: String(round4((valueTnd * Number(existing.ratePct)) / 100)),
        affiliationId: a.id,
        updatedAt: new Date(),
      })
      .where(eq(agentCommissionLines.id, existing.id));
    return;
  }
  const rate = await agentCommissionPct(a.agentUserId, a.agentRole);
  await db
    .insert(agentCommissionLines)
    .values({
      agentUserId: a.agentUserId,
      agentRole: a.agentRole,
      campaignId,
      screenhostId,
      affiliationId: a.id,
      ratePct: String(rate),
      forecastTnd: String(round4((valueTnd * rate) / 100)),
    })
    .onConflictDoNothing();
};

const cancel = async (ids: string[]) => {
  if (ids.length === 0) return;
  await db
    .update(agentCommissionLines)
    .set({ status: 'annulee', updatedAt: new Date() })
    .where(
      and(inArray(agentCommissionLines.id, ids), eq(agentCommissionLines.status, 'previsionnel')),
    );
};

/**
 * Bring one campaign's commission lines in line with its dispatch (forecast) or, once settled,
 * acquire them. Idempotent; demo campaigns never earn.
 */
export const syncAgentCommissions = async (campaignId: string): Promise<void> => {
  const [c] = await db
    .select({
      advertiserId: campaigns.advertiserId,
      startDate: campaigns.startDate,
      eventId: campaigns.eventId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!c || (await isDemoCampaign(db, campaignId))) return;
  if (await isSettled(campaignId)) {
    await acquireAgentCommissions(campaignId);
    return;
  }

  const values = await venueValues(campaignId, c.eventId);
  const lines = await linesOf(campaignId);
  const keep = new Set<string>();

  // Screencaster agent — the whole redistributed value.
  const sc = c.startDate ? await liveScAffiliation(c.advertiserId, c.startDate) : null;
  if (sc && values.length > 0) {
    const existing = lines.find(
      (l) => l.screenhostId === null && l.agentUserId === sc.affiliation.agentUserId,
    );
    if (existing) keep.add(existing.id);
    const total = values.reduce((s, v) => s + v.valueTnd, 0);
    await upsertForecast(existing, sc, campaignId, null, total);
  }

  // Screenhost agents — one line per accepted venue.
  const accepted = values.filter((v) => v.accepted);
  const shLive = await liveShAffiliations(accepted.map((v) => v.screenhostId));
  for (const v of accepted) {
    const live = shLive.get(v.screenhostId);
    if (!live) continue;
    const existing = lines.find(
      (l) => l.screenhostId === v.screenhostId && l.agentUserId === live.affiliation.agentUserId,
    );
    if (existing) keep.add(existing.id);
    await upsertForecast(existing, live, campaignId, v.screenhostId, v.valueTnd);
  }

  await cancel(lines.filter((l) => !keep.has(l.id)).map((l) => l.id));
};

/**
 * The agent side of a settlement split: per venue, the frozen rates of the live lines (the
 * defaults when no agent earns) and the agent ids the reversement line is attributed to.
 */
export const settlementAgentTerms = async (
  campaignId: string,
  screenhostIds: string[],
): Promise<
  Map<string, { pcts: ReversementPcts; agentShId: string | null; agentScId: string | null }>
> => {
  const cfg = await getDispatchConfig();
  const configured = cfg.pctSh + cfg.pctToodooh + cfg.pctAgentSh + cfg.pctAgentSc;
  // A drifted engine config still refuses the settlement, whatever the agents' own rates.
  if (Math.abs(configured - 100) > 1e-9) {
    throw new Error(`reversement percentages must sum to 100, got ${configured}`);
  }
  await syncAgentCommissions(campaignId);
  const lines = (await linesOf(campaignId)).filter((l) => l.status === 'previsionnel');
  const sc = lines.find((l) => l.screenhostId === null);
  const out = new Map<
    string,
    { pcts: ReversementPcts; agentShId: string | null; agentScId: string | null }
  >();
  for (const id of screenhostIds) {
    const sh = lines.find((l) => l.screenhostId === id);
    const agentSh = sh ? Number(sh.ratePct) : cfg.pctAgentSh;
    const agentSc = sc ? Number(sc.ratePct) : cfg.pctAgentSc;
    const toodooh = Math.round((100 - cfg.pctSh - agentSh - agentSc) * 100) / 100;
    if (toodooh < 0) throw new Error(`agent rates exceed the Toodooh share (${toodooh} %)`);
    out.set(id, {
      pcts: { sh: cfg.pctSh, toodooh, agentSh, agentSc },
      agentShId: sh?.agentUserId ?? null,
      agentScId: sc?.agentUserId ?? null,
    });
  }
  return out;
};

/** Proof counts of one venue for one campaign: all, and inside [start, end). */
const proofShare = async (
  campaignId: string,
  screenhostId: string,
  start: string,
  end: string,
): Promise<number> => {
  const day = sql`(${proofInstantSql} at time zone 'Africa/Tunis')::date`;
  const [r] = await db
    .select({
      all: sql<number>`count(*)::int`,
      inside: sql<number>`count(*) filter (where ${day} >= ${start}::date and ${day} < ${end}::date)::int`,
    })
    .from(proofOfPlay)
    .where(
      and(
        eq(proofOfPlay.campaignId, campaignId),
        eq(proofOfPlay.screenhostId, screenhostId),
        eq(proofOfPlay.eventType, 'VIDEO_ENDED'),
      ),
    );
  if (!r || r.all === 0) return 0;
  return r.inside / r.all;
};

/** Settled campaign: each forecast line becomes 'acquise' from its reversement line, or 'annulee'. */
export const acquireAgentCommissions = async (campaignId: string): Promise<void> => {
  const lines = (await linesOf(campaignId)).filter((l) => l.status === 'previsionnel');
  if (lines.length === 0) return;
  const rev = await db
    .select()
    .from(reversementLines)
    .where(eq(reversementLines.campaignId, campaignId));
  const now = new Date();
  for (const l of lines) {
    let millimes = 0;
    if (l.screenhostId === null) {
      millimes = rev
        .filter((r) => r.agentScId === l.agentUserId)
        .reduce((s, r) => s + Math.round(Number(r.agentScAmountTnd) * 1000), 0);
    } else {
      const r = rev.find((x) => x.screenhostId === l.screenhostId && x.agentShId === l.agentUserId);
      if (r) {
        const [a] = l.affiliationId
          ? await db
              .select()
              .from(agentAffiliations)
              .where(eq(agentAffiliations.id, l.affiliationId))
              .limit(1)
          : [];
        if (a?.status === 'en_attente_activation') continue; // acquired at activation
        if (a?.startDate && a.endDate && a.status !== 'exclue') {
          const share = await proofShare(campaignId, l.screenhostId, a.startDate, a.endDate);
          millimes = Math.floor(Math.round(Number(r.agentShAmountTnd) * 1000) * share);
        }
      }
    }
    await db
      .update(agentCommissionLines)
      .set(
        millimes > 0
          ? {
              status: 'acquise',
              acquiredTnd: String(millimes / 1000),
              acquiredAt: now,
              updatedAt: now,
            }
          : { status: 'annulee', updatedAt: now },
      )
      .where(eq(agentCommissionLines.id, l.id));
  }
};

/**
 * Every campaign whose lines can still move: dispatched and not settled (forecast), or settled
 * with a line still 'previsionnel' (a Screenhost pending activation).
 */
export const runAgentCommissionTick = async (): Promise<{ synced: number }> => {
  const open = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        inArray(campaigns.status, ['upcoming', 'active', 'completed']),
        sql`not exists (select 1 from ${campaignReconciliation} where ${campaignReconciliation.campaignId} = ${campaigns.id})`,
        sql`(${campaigns.eventId} is not null or exists (select 1 from ${campaignDispatchPlan} where ${campaignDispatchPlan.campaignId} = ${campaigns.id}))`,
      ),
    );
  const pending = await db
    .selectDistinct({ id: agentCommissionLines.campaignId })
    .from(agentCommissionLines)
    .where(eq(agentCommissionLines.status, 'previsionnel'));
  const ids = [...new Set([...open.map((r) => r.id), ...pending.map((r) => r.id)])];
  for (const id of ids) await syncAgentCommissions(id);
  return { synced: ids.length };
};

/** Boot + every minute, unref'd (forecasts follow the dispatch within a minute). */
export function startAgentCommissionJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentCommissionTick().catch((err: unknown) =>
      log.warn({ err }, 'agent commission tick failed'),
    );
  tick();
  setInterval(tick, 60 * 1000).unref();
}
