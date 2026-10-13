import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  agentCgeAcceptances,
  agentCgeVersions,
  agentRibSubmissions,
  agents,
  users,
} from '../db/schema.js';

import { getDispatchConfig } from './dispatch/config.js';

// AGT-1 (Youssef's agent specs v1.0 §2, operator rulings 2026-10-13) — ONE home for the agent
// sheet's derived states: which CGE version is in force and whether the agent accepted it, the
// RIB status, the « Finalisez votre compte » steps and the commission rate that applies. Admin
// routes, agent routes and (later) the commission engine read these, never their own copy.

export type AgentRole = 'screenhost_agent' | 'screencast_agent';

export const isAgentRole = (role: string | null | undefined): role is AgentRole =>
  role === 'screenhost_agent' || role === 'screencast_agent';

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** The CGE version in force for a role (the latest published), or null when none is published. */
export const currentCge = async (role: AgentRole, executor: Executor = db) => {
  const [row] = await executor
    .select()
    .from(agentCgeVersions)
    .where(eq(agentCgeVersions.agentRole, role))
    .orderBy(desc(agentCgeVersions.publishedAt))
    .limit(1);
  return row ?? null;
};

/** The agent's acceptance of a given version, or null. */
export const cgeAcceptance = async (agentUserId: string, cgeVersionId: string) => {
  const [row] = await db
    .select()
    .from(agentCgeAcceptances)
    .where(
      and(
        eq(agentCgeAcceptances.agentUserId, agentUserId),
        eq(agentCgeAcceptances.cgeVersionId, cgeVersionId),
      ),
    )
    .limit(1);
  return row ?? null;
};

/**
 * Whether the agent must accept the CGE before anything else (the blocking modal). Ruling Q6: no
 * CGE is published yet, so with no version in force nothing blocks.
 */
export const agentCgeRequired = async (agentUserId: string, role: AgentRole): Promise<boolean> => {
  const cge = await currentCge(role);
  if (!cge) return false;
  return (await cgeAcceptance(agentUserId, cge.id)) === null;
};

export type RibState = 'non_fourni' | 'en_attente' | 'valide' | 'refuse';

/** The RIB status (the latest deposit) and whether a validated RIB is in use (any 'valide'). */
export const agentRibState = async (
  agentUserId: string,
): Promise<{
  state: RibState;
  latest: typeof agentRibSubmissions.$inferSelect | null;
  validated: boolean;
}> => {
  const rows = await db
    .select()
    .from(agentRibSubmissions)
    .where(eq(agentRibSubmissions.agentUserId, agentUserId))
    .orderBy(desc(agentRibSubmissions.submittedAt));
  const latest = rows[0] ?? null;
  return {
    state: latest?.status ?? 'non_fourni',
    latest,
    validated: rows.some((r) => r.status === 'valide'),
  };
};

export interface OnboardingStep {
  key: 'cge' | 'photo' | 'info' | 'rib';
  done: boolean;
  mandatory: boolean;
  /** RIB only — « En attente de validation » between deposit and validation. */
  pending?: boolean;
}

/** The « Finalisez votre compte » card (spec §2): four steps, three mandatory. */
export const onboardingSteps = (input: {
  cgeAccepted: boolean;
  hasPhoto: boolean;
  infoVerified: boolean;
  rib: RibState;
}): { steps: OnboardingStep[]; done: number; complete: boolean } => {
  const steps: OnboardingStep[] = [
    { key: 'cge', done: input.cgeAccepted, mandatory: true },
    { key: 'photo', done: input.hasPhoto, mandatory: false },
    { key: 'info', done: input.infoVerified, mandatory: true },
    {
      key: 'rib',
      done: input.rib === 'valide',
      mandatory: true,
      pending: input.rib === 'en_attente',
    },
  ];
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    complete: steps.every((s) => !s.mandatory || s.done),
  };
};

/** The agent's onboarding, read from the database. */
export const agentOnboarding = async (agentUserId: string, role: AgentRole) => {
  const [row] = await db
    .select({ image: users.image, infoVerifiedAt: agents.infoVerifiedAt })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.userId, agentUserId))
    .limit(1);
  const rib = await agentRibState(agentUserId);
  return onboardingSteps({
    cgeAccepted: !(await agentCgeRequired(agentUserId, role)),
    hasPhoto: Boolean(row?.image),
    infoVerified: row?.infoVerifiedAt != null,
    rib: rib.state,
  });
};

/** Ruling Q2 A — the agent's own rate, else the engine default for its role. */
export const agentCommissionPct = async (agentUserId: string, role: AgentRole): Promise<number> => {
  const [row] = await db
    .select({ pct: agents.commissionPct })
    .from(agents)
    .where(eq(agents.userId, agentUserId))
    .limit(1);
  if (row?.pct != null) return Number(row.pct);
  const cfg = await getDispatchConfig();
  return role === 'screenhost_agent' ? cfg.pctAgentSh : cfg.pctAgentSc;
};
