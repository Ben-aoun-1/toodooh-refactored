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

  /** Paginated, filtered recharge list (`adminRechargesService.getRecharges`). */
  recharges: (status: string, search: string, page: number, perPage: number) =>
    [...adminKeys.all, 'recharges', status, search, page, perPage] as const,
  /** Prefix for invalidating every recharge-list variant. */
  rechargesAll: () => [...adminKeys.all, 'recharges'] as const,
  rechargeStats: () => [...adminKeys.all, 'rechargeStats'] as const,
  /** Approved-advertiser picker for the manual-recharge form. */
  rechargeAdvertisers: () => [...adminKeys.all, 'rechargeAdvertisers'] as const,

  /** Video-validation list, filtered by status (`adminVideoService.getVideos`). */
  videos: (status: string) => [...adminKeys.all, 'videos', status] as const,
  videoStats: () => [...adminKeys.all, 'videoStats'] as const,

  /** Creative-moderation list (NEW pipeline), filtered by status (`adminCreativesService.list`). */
  creatives: (status: string) => [...adminKeys.all, 'creatives', status] as const,
  /** Prefix for invalidating every creative-list variant. */
  creativesAll: () => [...adminKeys.all, 'creatives'] as const,

  /** Campaign-review queue (ACTIVATION keystone), filtered by status (`adminCampaignsService.list`). */
  campaigns: (status: string) => [...adminKeys.all, 'campaigns', status] as const,
  /** Prefix for invalidating every campaign-review-list variant. */
  campaignsAll: () => [...adminKeys.all, 'campaigns'] as const,

  monitoringCampaigns: () => [...adminKeys.all, 'monitoringCampaigns'] as const,
  monitoringStats: () => [...adminKeys.all, 'monitoringStats'] as const,
  monitoringCategories: () => [...adminKeys.all, 'monitoringCategories'] as const,

  globalConfiguration: () => [...adminKeys.all, 'globalConfiguration'] as const,

  /** End-user list for UserManagement (`adminUserService.getUsers`). */
  users: () => [...adminKeys.all, 'users'] as const,
  /** One user's grouped documents for the review modal (`adminUserService.getUserDocuments`). */
  userDocuments: (id: string) => [...adminKeys.all, 'userDocuments', id] as const,
  /** Admin-account list for AdminManagement (`adminService.getAdmins`). */
  admins: () => [...adminKeys.all, 'admins'] as const,

  /** Special-event list + stats for EventManagement (`adminEventsService`). */
  events: () => [...adminKeys.all, 'events'] as const,
  eventStats: () => [...adminKeys.all, 'eventStats'] as const,

  /** Paginated, filtered location list for ScreenManagement. */
  adminLocations: (
    status: string,
    ownerId: string,
    search: string,
    page: number,
    perPage: number,
  ) => [...adminKeys.all, 'adminLocations', status, ownerId, search, page, perPage] as const,
  screenOwners: () => [...adminKeys.all, 'screenOwners'] as const,

  /** AdminDashboard's platform-stats composite. */
  platformStats: () => [...adminKeys.all, 'platformStats'] as const,

  /** Per-location hourly affluence schedule (AffluenceModal). */
  affluenceSchedule: (locationId: string) =>
    [...adminKeys.all, 'affluenceSchedule', locationId] as const,
};
