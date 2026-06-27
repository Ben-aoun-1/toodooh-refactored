import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { agents } from '../db/schema.js';

// R5 — the agent's OWN issued referral code (agents.code, 1:1 with users). Surfaced on the signin
// response AND GET /api/me (the store's mapRouting is fed by both) so the agent dashboard's CODE AGENT
// card renders it. It is the caller's own code — not sensitive to them. Non-agent roles have no agents
// row, so they short-circuit to null with NO query. The two routes share this so they can't drift.
const AGENT_ROLES = new Set(['screenhost_agent', 'screencast_agent']);

export const lookupAgentCode = async (
  userId: string,
  role: string | null,
): Promise<string | null> => {
  if (!role || !AGENT_ROLES.has(role)) return null;
  const [agentRow] = await db
    .select({ code: agents.code })
    .from(agents)
    .where(eq(agents.userId, userId))
    .limit(1);
  return agentRow?.code ?? null;
};
