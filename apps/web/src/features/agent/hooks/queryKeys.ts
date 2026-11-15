/**
 * React Query key factory for the `agent` feature (CF-13 convention: one
 * `queryKeys.ts` per feature; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix).
 */
export const agentKeys = {
  all: ['agent'] as const,

  /** AGT-1 — the account (status, CGE, onboarding, RIB) and the editable profile. */
  account: () => [...agentKeys.all, 'account'] as const,
  profile: () => [...agentKeys.all, 'profile'] as const,

  /** AGT-3 / AGT-4 — wallet + payouts, the Dashboard, campaigns and affiliates. */
  wallet: () => [...agentKeys.all, 'wallet'] as const,
  transactions: () => [...agentKeys.all, 'transactions'] as const,
  dashboard: () => [...agentKeys.all, 'dashboard'] as const,
  campaigns: () => [...agentKeys.all, 'campaigns'] as const,
  affiliates: () => [...agentKeys.all, 'affiliates'] as const,

  /** AGT-7 — the Screenhost agent's lists, follow-up panel and venue sheet. */
  shCampaigns: () => [...agentKeys.all, 'sh-campaigns'] as const,
  shAffiliates: () => [...agentKeys.all, 'sh-affiliates'] as const,
  followup: () => [...agentKeys.all, 'followup'] as const,
  followupSheet: (id: string) => [...agentKeys.all, 'followup', id] as const,

  /** Agent spec VF §10 — one campaign offer of an affiliated Screenhost. */
  offer: (id: string) => [...agentKeys.all, 'offer', id] as const,

  /** Agent specs VF « Logos » — the logos of the agent's affiliates and campaigns. */
  logos: () => [...agentKeys.all, 'logos'] as const,

  /** Agent Screenhost spec VF §12 / §14 — sensor follow-up and assignment. */
  sensors: () => [...agentKeys.all, 'sensors'] as const,
  sensorVenue: (id: string) => [...agentKeys.all, 'sensors', 'venue', id] as const,
  sensorAssignment: () => [...agentKeys.all, 'sensors', 'assignment'] as const,
};
