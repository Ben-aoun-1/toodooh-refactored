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
  dashboard: () => [...agentKeys.all, 'dashboard'] as const,
  campaigns: () => [...agentKeys.all, 'campaigns'] as const,
  affiliates: () => [...agentKeys.all, 'affiliates'] as const,

  /** AGT-7 — the Screenhost agent's lists, follow-up panel and venue sheet. */
  shCampaigns: () => [...agentKeys.all, 'sh-campaigns'] as const,
  shAffiliates: () => [...agentKeys.all, 'sh-affiliates'] as const,
  followup: () => [...agentKeys.all, 'followup'] as const,
  followupSheet: (id: string) => [...agentKeys.all, 'followup', id] as const,
};
