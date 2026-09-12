import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { agents, users } from '../db/schema.js';

import { fromProfileType } from './profile-type.js';

// AGENT-V1 (Mejri 09/09 point 2, operator ruling 2026-09-12): the agent code typed at signup must
// name an EXISTING agent of the right type. This reverses the 2026-06-06 A2 rule (accept + store
// unlinked + flag for admin). ONE resolver, shared by the signup pre-check and the wizard's
// availability probe, so the inline verdict and the submit verdict can never disagree.

export type AgentRole = 'screenhost_agent' | 'screencast_agent';

/** The same normalisation the web applies on input: uppercase, whitespace stripped. */
export const normalizeAgentCode = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

export interface ResolvedAgent {
  agentUserId: string;
  agentRole: AgentRole;
}

/** The agent whose issued code this is, or null. */
export const resolveAgentByCode = async (raw: string): Promise<ResolvedAgent | null> => {
  const code = normalizeAgentCode(raw);
  if (!code) return null;
  const [row] = await db
    .select({ agentUserId: agents.userId, agentRole: users.role })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.code, code))
    .limit(1);
  if (!row) return null;
  if (row.agentRole !== 'screenhost_agent' && row.agentRole !== 'screencast_agent') return null;
  return { agentUserId: row.agentUserId, agentRole: row.agentRole };
};

/** A screenhost agent refers owners; a screencast agent refers advertisers (incl. agencies). */
export const agentCompatibleWith = (
  agentRole: AgentRole,
  profileType: string | undefined,
): boolean => {
  const referredRole = profileType ? fromProfileType(profileType as never).role : 'advertiser';
  return (
    (agentRole === 'screenhost_agent' &&
      (referredRole === 'individual_owner' || referredRole === 'fleet_owner')) ||
    (agentRole === 'screencast_agent' && referredRole === 'advertiser')
  );
};

export type AgentCodeVerdict = 'ok' | 'unknown' | 'incompatible';

export const agentCodeVerdict = async (
  raw: string,
  profileType: string | undefined,
): Promise<AgentCodeVerdict> => {
  const agent = await resolveAgentByCode(raw);
  if (!agent) return 'unknown';
  return agentCompatibleWith(agent.agentRole, profileType) ? 'ok' : 'incompatible';
};
