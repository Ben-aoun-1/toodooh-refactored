import { db } from '../../src/db/client.js';
import { agentAffiliations } from '../../src/db/schema.js';

// AGT-3 — a live agent affiliation for settlement fixtures: attribution reads affiliations
// (lib/agent-commissions), no longer agent_referrals.
export const seedLiveAffiliation = async (v: {
  agentUserId: string;
  referredUserId: string;
  screenhostId?: string;
  start?: string;
  end?: string;
}): Promise<string> => {
  const [row] = await db
    .insert(agentAffiliations)
    .values({
      agentUserId: v.agentUserId,
      agentRole: v.screenhostId ? 'screenhost_agent' : 'screencast_agent',
      referredUserId: v.referredUserId,
      screenhostId: v.screenhostId ?? null,
      startDate: v.start ?? '2020-01-01',
      endDate: v.end ?? '2030-01-01',
      status: 'en_cours',
    })
    .returning();
  return row?.id ?? '';
};
