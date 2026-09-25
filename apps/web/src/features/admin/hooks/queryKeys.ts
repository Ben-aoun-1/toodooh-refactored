/**
 * Step 10 — React Query key factory for the `admin` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix. Created by Commit 6a (first admin
 * consumer); 6b / 6c extend it with their own accessors.
 *
 * The recharge-list key carries its filter + pagination args, so changing a
 * filter or page refetches naturally. Mutations that touch the recharge list
 * invalidate the `['admin','recharges']` prefix to catch every filter combo.
 */
export const adminKeys = {
  all: ['admin'] as const,

  /** SUP-1 — the admin « Support » queue (GET /api/admin/support?status=). */
  support: (status: string) => [...adminKeys.all, 'support', status] as const,
  supportAll: () => [...adminKeys.all, 'support'] as const,

  /** ADM-BELL1 — the admin notification-bell feed (GET /api/notifications, session-scoped). */
  notifications: (userId: string) => [...adminKeys.all, 'notifications', userId] as const,

  /** ADM-OBS1 — the « Tests » page picker and one screenhost's report for a période. */
  testingScreenhosts: () => [...adminKeys.all, 'testing', 'screenhosts'] as const,
  testingReport: (id: string, from: string, to: string) =>
    [...adminKeys.all, 'testing', 'report', id, from, to] as const,
  // SIM-0 — the admin « Simulateur » registry.
  simulations: () => [...adminKeys.all, 'simulations'] as const,
  simulation: (id: string) => [...adminKeys.all, 'simulations', id] as const,
  simulationProbe: (id: string) => [...adminKeys.all, 'simulations', id, 'probe'] as const,
  world: (id: string) => [...adminKeys.all, 'simulations', id, 'world'] as const,
  worldVenues: (id: string) => [...adminKeys.all, 'simulations', id, 'world', 'venues'] as const,
  simulationBoard: (id: string) => [...adminKeys.all, 'simulations', id, 'board'] as const,
  simulationLaunchOptions: (id: string) =>
    [...adminKeys.all, 'simulations', id, 'launchOptions'] as const,
  simulationPricing: (id: string) => [...adminKeys.all, 'simulations', id, 'pricing'] as const,
  simulationVenueReport: (id: string, venueId: string, from: string, to: string) =>
    [...adminKeys.all, 'simulations', id, 'venueReport', venueId, from, to] as const,
  simulationCampaignInspection: (id: string, campaignId: string) =>
    [...adminKeys.all, 'simulations', id, 'inspect', campaignId] as const,
  simulationEligibleHosts: (id: string, campaignId: string) =>
    [...adminKeys.all, 'simulations', id, 'eligibleHosts', campaignId] as const,

  /** Paginated, filtered recharge list (`adminRechargesService.getRecharges`). */
  recharges: (status: string, search: string, page: number, perPage: number) =>
    [...adminKeys.all, 'recharges', status, search, page, perPage] as const,
  /** Prefix for invalidating every recharge-list variant. */
  rechargesAll: () => [...adminKeys.all, 'recharges'] as const,
  rechargeStats: () => [...adminKeys.all, 'rechargeStats'] as const,
  /** Approved-advertiser picker for the manual-recharge form. */
  rechargeAdvertisers: () => [...adminKeys.all, 'rechargeAdvertisers'] as const,
  /** CF-M2 — one recharge's presigned justificatif URL (short-TTL; fetched per modal open). */
  rechargeDocumentUrl: (id: string) => [...adminKeys.all, 'rechargeDocumentUrl', id] as const,
  /** FCT1 — one recharge's presigned GENERATED-bon URL (short-TTL; fetched per modal open). */
  rechargeBonUrl: (id: string) => [...adminKeys.all, 'rechargeBonUrl', id] as const,
  /** FCT1 — one recharge's presigned SIGNED-bon URL (short-TTL; fetched per modal open). */
  rechargeSignedBonUrl: (id: string) => [...adminKeys.all, 'rechargeSignedBonUrl', id] as const,
  /** FCT2 — one advertiser's wallet-adjustment audit trail (US-FCT-9). */
  walletAdjustments: (advertiserId: string) =>
    [...adminKeys.all, 'walletAdjustments', advertiserId] as const,

  /** Video-validation list, filtered by status (`adminVideoService.getVideos`). */
  videos: (status: string) => [...adminKeys.all, 'videos', status] as const,
  videoStats: () => [...adminKeys.all, 'videoStats'] as const,

  /** Creative-moderation list (NEW pipeline), filtered by status (`adminCreativesService.list`). */
  creatives: (status: string) => [...adminKeys.all, 'creatives', status] as const,
  /** Prefix for invalidating every creative-list variant. */
  creativesAll: () => [...adminKeys.all, 'creatives'] as const,

  /** Campaign-review queue (ACTIVATION keystone), filtered by status (`adminCampaignsService.list`). */
  campaigns: (status: string) => [...adminKeys.all, 'campaigns', status] as const,
  /** E7 — one campaign's settlement reversement breakdown (`adminCampaignsService.getReversements`). */
  campaignReversements: (id: string) => [...adminKeys.all, 'campaignReversements', id] as const,
  campaignEligibleHosts: (id: string) => [...adminKeys.all, 'campaignEligibleHosts', id] as const,
  /** LOG1 — one campaign's engine journal, keyed by the phase filter (`getEngineJournal`). */
  campaignEngineJournal: (id: string, phase: string) =>
    [...adminKeys.all, 'campaignEngineJournal', id, phase] as const,
  /** Prefix for invalidating every campaign-review-list variant. */
  campaignsAll: () => [...adminKeys.all, 'campaigns'] as const,

  monitoringCampaigns: () => [...adminKeys.all, 'monitoringCampaigns'] as const,
  monitoringStats: () => [...adminKeys.all, 'monitoringStats'] as const,
  monitoringCategories: () => [...adminKeys.all, 'monitoringCategories'] as const,

  /** Resolved dispatch CPM config (admin-editable, new engine: `adminDispatchConfigService.get`). */
  dispatchConfig: () => [...adminKeys.all, 'dispatchConfig'] as const,

  /** CPM-3 — the « CPM par screencaster » table (GET /api/admin/screencasters/cpm). */
  screencasterCpm: () => [...adminKeys.all, 'screencasterCpm'] as const,

  /** End-user list for UserManagement (`adminUserService.getUsers`). */
  users: () => [...adminKeys.all, 'users'] as const,
  /** EL1 — one venue's dispatch-eligibility view (`adminScreenhostService.getEligibility`). */
  screenhostEligibility: (id: string) => [...adminKeys.all, 'screenhostEligibility', id] as const,
  /** E4 — one venue's live SPS breakdown (`adminScreenhostService.getSps`). */
  screenhostSps: (id: string) => [...adminKeys.all, 'screenhostSps', id] as const,
  /** CF-HF4 — one venue's live devices (the admin liveness chip). */
  screenhostDevices: (id: string) => [...adminKeys.all, 'screenhostDevices', id] as const,
  /** One user's grouped documents for the review modal (`adminUserService.getUserDocuments`). */
  userDocuments: (id: string) => [...adminKeys.all, 'userDocuments', id] as const,
  /** Admin-account list for AdminManagement (`adminService.getAdmins`). */
  admins: () => [...adminKeys.all, 'admins'] as const,
  /** ADM-FIX1 — the agent half of that same listing (`adminService.getAgents`). */
  agents: () => [...adminKeys.all, 'agents'] as const,

  /** EV1 — the full event list for EventManagement (`adminEventsService.list`). */
  events: () => [...adminKeys.all, 'events'] as const,
  /** EV1 — one event's presigned affiche URL (admin surface). */
  eventImageUrl: (id: string) => [...adminKeys.all, 'events', 'imageUrl', id] as const,
  /** EV2 — one event's tarification detail (`adminEventsService.tarification`). */
  eventTarification: (id: string) => [...adminKeys.all, 'events', 'tarification', id] as const,

  /** ADM-SCR1 — paginated, filtered venue list for ScreenManagement (GET /api/admin/screenhosts). */
  adminLocations: (
    status: string,
    ownerId: string,
    search: string,
    page: number,
    perPage: number,
  ) => [...adminKeys.all, 'adminLocations', status, ownerId, search, page, perPage] as const,
  /** SCR-DECL1 — the prefix of every venue-list key (a declaration edit refetches them all). */
  adminLocationsAll: () => [...adminKeys.all, 'adminLocations'] as const,
  /** ADM-SCR1 — the owner picker (GET /api/admin/screenhosts/owners). */
  screenOwners: () => [...adminKeys.all, 'screenOwners'] as const,

  /** AdminDashboard's platform-stats composite. */
  platformStats: () => [...adminKeys.all, 'platformStats'] as const,
};
