/**
 * React Query key factory for the `agent` feature (CF-13 convention: one
 * `queryKeys.ts` per feature; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix).
 */
export const agentKeys = {
  all: ['agent'] as const,

  /** The caller agent's referred-clients list (`agentClientsService.getClients`). */
  clients: () => [...agentKeys.all, 'clients'] as const,

  /** AGT-1 — the account (status, CGE, onboarding, RIB) and the editable profile. */
  account: () => [...agentKeys.all, 'account'] as const,
  profile: () => [...agentKeys.all, 'profile'] as const,
};
