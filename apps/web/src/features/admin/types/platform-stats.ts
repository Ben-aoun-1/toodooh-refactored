// Admin dashboard platform-stats — the wire shape of GET /api/admin/platform-stats (new engine).
// De-Supabase: the legacy PlatformGlobalStats/RevenueStats/OccupancyStats/CampaignsPerformance/
// TopPerformingScreen/RecentActivity shapes (Supabase RPCs + business_profiles) are GONE. Fields the
// new engine does NOT yet model — events, per-screen revenue (top screens), occupancy/uptime, revenue
// growth-rate, daily-revenue, average-revenue-per-screen, campaign impressions/views — are NOT in this
// payload; the dashboard renders them as 0/—/empty (never faked).

export interface PlatformStats {
  users: {
    total: number;
    pending: number;
    approved: number;
    /** SIGN-4 — the OWNER half of `pending`: how many Hosts are awaiting validation. */
    pending_owners: number;
    owners: number;
    advertisers: number;
  };
  screens: {
    total: number;
    active: number;
  };
  campaigns: {
    total: number;
    draft: number;
    pending: number;
    active: number;
    rejected: number;
    total_budget_tnd: number;
    average_budget_tnd: number;
  };
  creatives: {
    total: number;
    pending: number;
    approved: number;
  };
  revenue: {
    total_tnd: number;
    monthly_tnd: number;
  };
}
