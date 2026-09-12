/**
 * Step 10 — React Query key factory for the `screenhost` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 *
 * `screenhost` owns owner-facing reads — e.g. the `OwnerCampaigns` oversight
 * list, shaped for the owner view (their allocations, their totals, their
 * decision). Generic campaign-domain reads belong to the `campaigns` feature
 * (Commit 7), not here.
 */
export const screenhostKeys = {
  all: ['screenhost'] as const,

  /** CAMP-E1 — OwnerCampaigns: every campaign allocated on the owner's venues (GET /campaigns). */
  campaigns: (userId: string) => [...screenhostKeys.all, 'campaigns', userId] as const,

  /** The owner notification-bell feed (Commit 8 — D5). */
  notifications: (userId: string) => [...screenhostKeys.all, 'notifications', userId] as const,

  /** REV2 — the owner's monthly « Mes factures » (GET /api/screenhosts/statements). */
  factures: (userId: string) => [...screenhostKeys.all, 'factures', userId] as const,

  /** REV2 — ONE facture with its per-source lines (GET /api/screenhosts/statements/:id). */
  facture: (factureId: string) => [...screenhostKeys.all, 'facture', factureId] as const,

  /** REV3 — the owner's « Historique des versements » (GET /api/screenhosts/versements). */
  versements: (userId: string) => [...screenhostKeys.all, 'versements', userId] as const,

  /** The owner's screenhosts WiFi list (GET /api/screenhosts/mine). */
  screenhostsMine: (userId: string) => [...screenhostKeys.all, 'screenhostsMine', userId] as const,

  /** A screenhost's weekday×hour audience grid (L-aff-view — GET /:id/affluence). PERF-R2 —
   * the optional période slots key the masked read; null = the unscoped typical week. */
  affluence: (screenhostId: string, from?: string, to?: string) =>
    [...screenhostKeys.all, 'affluence', screenhostId, from ?? null, to ?? null] as const,

  /** PERF-R1 — a venue's merged période audience (GET /:id/audience?from&to). */
  audience: (screenhostId: string, from: string, to: string) =>
    [...screenhostKeys.all, 'audience', screenhostId, from, to] as const,

  /** The owner's EN_ATTENTE dispatch allocations awaiting accept/reject (GET /allocations). */
  pendingAllocations: (userId: string) =>
    [...screenhostKeys.all, 'pendingAllocations', userId] as const,

  /** CF-O1 — an allocation's short-TTL presigned spot url (GET /allocations/:id/creative-url). */
  allocationCreativeUrl: (allocationId: string) =>
    [...screenhostKeys.all, 'allocationCreativeUrl', allocationId] as const,

  /** E2 — a venue's declared days in a month window (GET /:id/unavailability?from&to). */
  unavailability: (screenhostId: string, from: string, to: string) =>
    [...screenhostKeys.all, 'unavailability', screenhostId, from, to] as const,

  /** The owner's ACCEPTE allocations + créneaux for the diffusion calendar (GET /calendar). */
  calendar: (userId: string) => [...screenhostKeys.all, 'calendar', userId] as const,

  /** CF-D1 — the owner's devices with real liveness (GET /api/screenhosts/screens). */
  devices: (userId: string) => [...screenhostKeys.all, 'devices', userId] as const,

  /** Lane F — a venue's identity card (GET /:id/profile: sector, class, hours, sps, ratios). */
  profile: (screenhostId: string) => [...screenhostKeys.all, 'profile', screenhostId] as const,

  /** Lane F — a venue's hub-pushed monthly audience stats (GET /:id/monthly-stats). */
  monthlyStats: (screenhostId: string) =>
    [...screenhostKeys.all, 'monthlyStats', screenhostId] as const,

  /** Lane F — a venue's delivered impressions per day (GET /:id/impressions-daily?from&to). */
  impressionsDaily: (screenhostId: string, from: string, to: string) =>
    [...screenhostKeys.all, 'impressionsDaily', screenhostId, from, to] as const,

  /** Lane F — the owner's payout lines incl. campaign metadata (GET /earnings). */
  earnings: (userId: string) => [...screenhostKeys.all, 'earnings', userId] as const,

  /** PERF-QA1 R1 — a venue's generated-reports listing (GET /:id/reports). */
  reports: (screenhostId: string) => [...screenhostKeys.all, 'reports', screenhostId] as const,

  /** PERF-QA1 R6 — a venue's live SPS breakdown (GET /:id/sps). */
  sps: (screenhostId: string) => [...screenhostKeys.all, 'sps', screenhostId] as const,

  /** PERF-QA1 R5 — a venue's S07 pistes over the active period (GET /:id/pistes?from&to). */
  pistes: (screenhostId: string, from: string, to: string) =>
    [...screenhostKeys.all, 'pistes', screenhostId, from, to] as const,

  /** PERF-QA1 R11 — the owner's all-time playout summary (GET /playout-summary). */
  playoutSummary: (userId: string) => [...screenhostKeys.all, 'playoutSummary', userId] as const,
};
