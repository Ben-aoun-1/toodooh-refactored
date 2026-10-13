import { addDays, addMonths, format, parseISO } from 'date-fns';
import { and, asc, eq, inArray, isNull, lte, min, ne } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agentReferrals,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  proofOfPlay,
  screenhosts,
  users,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';

// AGT-2 (agent specs v1.0 §6, rulings 2026-10-13) — ONE home for the agent affiliations:
//   • at the validation of a referred signup: a Screencaster agent's affiliation starts that day
//     (24 months); a Screenhost agent gets one PENDING affiliation per venue of the owner;
//   • the tick: venues the owner adds later are attached; a pending venue is ACTIVATED by the
//     first campaign that completes there — its first day of diffusion starts the 24 months
//     (« fixée … à la date de fin de cette campagne, avec effet rétroactif à son premier jour de
//     diffusion »); the 30-day end reminder; ended windows become 'terminee';
//   • the admin's hub actions: exclude (Key Account, Secteur Réservé…), reassign, « exploité par
//     l'agent » with a convention reference, amend the end date (avenant).

export const AFFILIATION_MONTHS = 24;
export const END_REMINDER_DAYS = 30;

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type Role = 'screenhost_agent' | 'screencast_agent';

/** start + 24 months (an ISO date, Tunis calendar). */
export const affiliationEnd = (startIso: string, months = AFFILIATION_MONTHS): string =>
  format(addMonths(parseISO(startIso), months), 'yyyy-MM-dd');

const frDate = (iso: string): string => format(parseISO(iso), 'dd/MM/yyyy');

const notifyAgent = (
  executor: Executor,
  agentUserId: string,
  type: string,
  title: string,
  body: string,
) => executor.insert(notifications).values({ userId: agentUserId, type, title, body });

/** The referral of a user and its agent's role, or null. */
const referralOf = async (executor: Executor, userId: string) => {
  const [row] = await executor
    .select({ agentUserId: agentReferrals.agentUserId, role: users.role })
    .from(agentReferrals)
    .innerJoin(users, eq(users.id, agentReferrals.agentUserId))
    .where(eq(agentReferrals.referredUserId, userId))
    .limit(1);
  if (!row || (row.role !== 'screenhost_agent' && row.role !== 'screencast_agent')) return null;
  return { agentUserId: row.agentUserId, role: row.role as Role };
};

/** Attach the venues of a referred, approved owner that have no live affiliation yet. */
const attachVenues = async (
  executor: Executor,
  ownerId: string,
  agentUserId: string,
  now: Date,
): Promise<string[]> => {
  const venues = await executor
    .select({ id: screenhosts.id, name: screenhosts.name })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, ownerId));
  if (venues.length === 0) return [];
  const live = await executor
    .select({ id: agentAffiliations.screenhostId })
    .from(agentAffiliations)
    .where(
      and(
        inArray(
          agentAffiliations.screenhostId,
          venues.map((v) => v.id),
        ),
        ne(agentAffiliations.status, 'exclue'),
      ),
    );
  const taken = new Set(live.map((l) => l.id));
  const fresh = venues.filter((v) => !taken.has(v.id));
  if (fresh.length === 0) return [];
  await executor
    .insert(agentAffiliations)
    .values(
      fresh.map((v) => ({
        agentUserId,
        agentRole: 'screenhost_agent' as const,
        referredUserId: ownerId,
        screenhostId: v.id,
        attachedAt: now,
        status: 'en_attente_activation' as const,
      })),
    )
    .onConflictDoNothing();
  for (const v of fresh) {
    await notifyAgent(
      executor,
      agentUserId,
      'agent_affiliate_new',
      `Nouveau Screenhost affilié : ${v.name}`,
      `${v.name} rejoint votre portefeuille, en attente d’activation.`,
    );
  }
  return fresh.map((v) => v.id);
};

/**
 * At the validation of a signup (admin approve): the referring agent's affiliation(s). Idempotent
 * (a re-approval after a rejection creates nothing new).
 */
export const createAffiliationsOnApproval = async (
  executor: Executor,
  userId: string,
  now = new Date(),
): Promise<void> => {
  const ref = await referralOf(executor, userId);
  if (!ref) return;
  if (ref.role === 'screenhost_agent') {
    await attachVenues(executor, userId, ref.agentUserId, now);
    return;
  }
  const [live] = await executor
    .select({ id: agentAffiliations.id })
    .from(agentAffiliations)
    .where(
      and(
        eq(agentAffiliations.referredUserId, userId),
        isNull(agentAffiliations.screenhostId),
        ne(agentAffiliations.status, 'exclue'),
      ),
    )
    .limit(1);
  if (live) return;
  const start = tunisDateOf(now);
  await executor.insert(agentAffiliations).values({
    agentUserId: ref.agentUserId,
    agentRole: 'screencast_agent',
    referredUserId: userId,
    attachedAt: now,
    startDate: start,
    endDate: affiliationEnd(start),
    status: 'en_cours',
  });
  const [u] = await executor
    .select({ name: users.businessName, contact: users.contactName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const name = u?.name ?? u?.contact ?? 'Un annonceur';
  await notifyAgent(
    executor,
    ref.agentUserId,
    'agent_affiliate_new',
    `Nouveau Screencaster affilié : ${name}`,
    `${name} rejoint votre portefeuille jusqu’au ${frDate(affiliationEnd(start))}.`,
  );
};

/**
 * A pending venue's activation: the first campaign that COMPLETED there (an accepted allocation)
 * — its first day of diffusion at the venue (first proof), else its start date.
 */
const activationFor = async (screenhostId: string) => {
  const [first] = await db
    .select({
      campaignId: campaigns.id,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .where(
      and(
        eq(campaignDispatchAllocation.screenhostId, screenhostId),
        eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
        eq(campaigns.status, 'completed'),
      ),
    )
    .orderBy(asc(campaigns.endDate))
    .limit(1);
  if (!first) return null;
  const [proof] = await db
    .select({ first: min(proofOfPlay.receivedAt) })
    .from(proofOfPlay)
    .where(
      and(eq(proofOfPlay.screenhostId, screenhostId), eq(proofOfPlay.campaignId, first.campaignId)),
    );
  const day = proof?.first ? tunisDateOf(proof.first) : first.startDate;
  return day ? { campaignId: first.campaignId, day } : null;
};

export interface AffiliationTickResult {
  attached: number;
  activated: number;
  reminded: number;
  ended: number;
}

/** The affiliation tick (hourly): attach, activate, remind, end. Idempotent. */
export const runAgentAffiliationTick = async (
  log?: FastifyBaseLogger,
  now = new Date(),
): Promise<AffiliationTickResult> => {
  const result: AffiliationTickResult = { attached: 0, activated: 0, reminded: 0, ended: 0 };
  const today = tunisDateOf(now);

  // 1. Venues added later by an approved owner referred by a Screenhost agent.
  const referred = await db
    .select({ ownerId: agentReferrals.referredUserId, agentUserId: agentReferrals.agentUserId })
    .from(agentReferrals)
    .innerJoin(users, eq(users.id, agentReferrals.referredUserId))
    .where(eq(users.status, 'approved'));
  const shAgents = new Set(
    referred.length === 0
      ? []
      : (
          await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                inArray(
                  users.id,
                  referred.map((r) => r.agentUserId),
                ),
                eq(users.role, 'screenhost_agent'),
              ),
            )
        ).map((u) => u.id),
  );
  for (const o of referred) {
    if (!shAgents.has(o.agentUserId)) continue;
    result.attached += (await attachVenues(db, o.ownerId, o.agentUserId, now)).length;
  }

  // 2. Activation of pending venues.
  const pending = await db
    .select({
      id: agentAffiliations.id,
      agentUserId: agentAffiliations.agentUserId,
      screenhostId: agentAffiliations.screenhostId,
      name: screenhosts.name,
    })
    .from(agentAffiliations)
    .innerJoin(screenhosts, eq(screenhosts.id, agentAffiliations.screenhostId))
    .where(eq(agentAffiliations.status, 'en_attente_activation'));
  for (const p of pending) {
    if (!p.screenhostId) continue;
    const act = await activationFor(p.screenhostId);
    if (!act) continue;
    const end = affiliationEnd(act.day);
    await db.transaction(async (tx) => {
      await tx
        .update(agentAffiliations)
        .set({
          status: 'en_cours',
          startDate: act.day,
          endDate: end,
          activationCampaignId: act.campaignId,
        })
        .where(
          and(
            eq(agentAffiliations.id, p.id),
            eq(agentAffiliations.status, 'en_attente_activation'),
          ),
        );
      await notifyAgent(
        tx,
        p.agentUserId,
        'agent_affiliate_activated',
        `Screenhost activé : ${p.name}`,
        `Affiliation en cours du ${frDate(act.day)} au ${frDate(end)}.`,
      );
    });
    result.activated += 1;
  }

  // 3. The 30-day end reminder (« Rappels et événements » preference), once per affiliation.
  const reminderEdge = format(addDays(parseISO(today), END_REMINDER_DAYS), 'yyyy-MM-dd');
  const ending = await db
    .select({ a: agentAffiliations, notify: users.notifyRemindersEvents })
    .from(agentAffiliations)
    .innerJoin(users, eq(users.id, agentAffiliations.agentUserId))
    .where(
      and(
        eq(agentAffiliations.status, 'en_cours'),
        isNull(agentAffiliations.endReminderSentAt),
        lte(agentAffiliations.endDate, reminderEdge),
      ),
    );
  for (const { a, notify } of ending) {
    if (!a.endDate) continue;
    const name = await affiliateName(a);
    await db.transaction(async (tx) => {
      if (notify) {
        await notifyAgent(
          tx,
          a.agentUserId,
          'agent_affiliation_ending',
          `L’affiliation de ${name} se termine le ${frDate(a.endDate ?? today)}`,
          'Les diffusions après cette date ne généreront plus de commission.',
        );
      }
      await tx
        .update(agentAffiliations)
        .set({ endReminderSentAt: now })
        .where(eq(agentAffiliations.id, a.id));
    });
    result.reminded += 1;
  }

  // 4. Windows that have ended.
  const ended = await db
    .update(agentAffiliations)
    .set({ status: 'terminee' })
    .where(and(eq(agentAffiliations.status, 'en_cours'), lte(agentAffiliations.endDate, today)))
    .returning({ id: agentAffiliations.id });
  result.ended = ended.length;

  if (result.attached + result.activated + result.reminded + result.ended > 0) {
    log?.info(result, 'agent affiliation tick applied changes');
  }
  return result;
};

/** The venue name (SH) or the company name (SC) of an affiliation. */
export const affiliateName = async (a: typeof agentAffiliations.$inferSelect): Promise<string> => {
  if (a.screenhostId) {
    const [v] = await db
      .select({ name: screenhosts.name })
      .from(screenhosts)
      .where(eq(screenhosts.id, a.screenhostId))
      .limit(1);
    return v?.name ?? 'Screenhost';
  }
  const [u] = await db
    .select({ name: users.businessName, contact: users.contactName })
    .from(users)
    .where(eq(users.id, a.referredUserId))
    .limit(1);
  return u?.name ?? u?.contact ?? 'Screencaster';
};

/** Boot + hourly, unref'd. */
export function startAgentAffiliationJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentAffiliationTick(log).catch((err: unknown) =>
      log.warn({ err }, 'agent affiliation tick failed'),
    );
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}

// ── admin (hub) actions ────────────────────────────────────────────────────────

export type AffiliationAction =
  | { kind: 'exclude'; reason: 'key_account' | 'secteur_reserve' | 'exclu' }
  | { kind: 'reassign'; agentUserId: string }
  | { kind: 'exploited'; exploited: boolean; conventionRef: string | null }
  | { kind: 'avenant'; endDate: string };

export type AffiliationActionResult =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'NOT_LIVE' | 'BAD_AGENT' | 'NOT_SH' | 'BAD_DATE' };

/** Apply one hub action to a live affiliation (never to an excluded row). */
export const applyAffiliationAction = async (
  id: string,
  action: AffiliationAction,
  now = new Date(),
): Promise<AffiliationActionResult> => {
  const [a] = await db
    .select()
    .from(agentAffiliations)
    .where(eq(agentAffiliations.id, id))
    .limit(1);
  if (!a) return { ok: false, error: 'NOT_FOUND' };
  if (a.status === 'exclue') return { ok: false, error: 'NOT_LIVE' };
  switch (action.kind) {
    case 'exclude':
      await db
        .update(agentAffiliations)
        .set({ status: 'exclue', exclusionReason: action.reason })
        .where(eq(agentAffiliations.id, id));
      return { ok: true };
    case 'reassign': {
      const [target] = await db
        .select({ role: users.role, status: agents.accountStatus })
        .from(agents)
        .innerJoin(users, eq(users.id, agents.userId))
        .where(eq(agents.userId, action.agentUserId))
        .limit(1);
      if (
        !target ||
        target.role !== a.agentRole ||
        target.status !== 'actif' ||
        action.agentUserId === a.agentUserId
      ) {
        return { ok: false, error: 'BAD_AGENT' };
      }
      await db.transaction(async (tx) => {
        await tx
          .update(agentAffiliations)
          .set({ status: 'exclue', exclusionReason: 'reaffecte' })
          .where(eq(agentAffiliations.id, id));
        await tx.insert(agentAffiliations).values({
          agentUserId: action.agentUserId,
          agentRole: a.agentRole,
          referredUserId: a.referredUserId,
          screenhostId: a.screenhostId,
          attachedAt: now,
          startDate: a.startDate,
          endDate: a.endDate,
          status: a.status,
          exploitedByAgent: false,
          activationCampaignId: a.activationCampaignId,
        });
        const name = await affiliateName(a);
        await notifyAgent(
          tx,
          action.agentUserId,
          'agent_affiliate_new',
          a.screenhostId
            ? `Nouveau Screenhost affilié : ${name}`
            : `Nouveau Screencaster affilié : ${name}`,
          `${name} vous est réaffecté par Toodooh.`,
        );
      });
      return { ok: true };
    }
    case 'exploited':
      if (!a.screenhostId) return { ok: false, error: 'NOT_SH' };
      await db
        .update(agentAffiliations)
        .set({ exploitedByAgent: action.exploited, conventionRef: action.conventionRef })
        .where(eq(agentAffiliations.id, id));
      return { ok: true };
    case 'avenant':
      if (a.startDate && action.endDate <= a.startDate) return { ok: false, error: 'BAD_DATE' };
      await db
        .update(agentAffiliations)
        .set({
          endDate: action.endDate,
          endReminderSentAt: null,
          ...(a.status === 'terminee' && action.endDate > tunisDateOf(now)
            ? { status: 'en_cours' as const }
            : {}),
        })
        .where(eq(agentAffiliations.id, id));
      return { ok: true };
  }
};
