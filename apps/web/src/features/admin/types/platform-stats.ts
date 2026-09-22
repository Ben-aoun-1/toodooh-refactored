// Admin dashboard platform-stats — the wire shape of GET /api/admin/platform-stats (new engine).
// De-Supabase: the legacy PlatformGlobalStats/RevenueStats/OccupancyStats/CampaignsPerformance/
// TopPerformingScreen/RecentActivity shapes (Supabase RPCs + business_profiles) are GONE. Fields the
// new engine does NOT yet model — events, per-screen revenue (top screens), occupancy/uptime, revenue
// growth-rate, daily-revenue, average-revenue-per-screen, campaign impressions/views — are NOT in this
// payload; the dashboard renders them as 0/—/empty (never faked).

export interface PlatformStats {
  users: {
    /** DASH-1 (R5) — every end-user account EXCEPT banned ones. */
    total: number;
    pending: number;
    approved: number;
    /** SIGN-4 — the OWNER half of `pending`: how many Hosts are awaiting validation. */
    pending_owners: number;
    /** DASH-1 (R5) — APPROVED owners only. */
    owners: number;
    /** DASH-1 (R5) — APPROVED advertisers only. */
    advertisers: number;
  };
  screens: {
    /** Every screens row — a declaration, not an installation. */
    total: number;
    /** DASH-1 (R4) — paired_at OR last_seen_at: a real device once ran against the row. */
    installed: number;
    /** DASH-1 (R4) — a heartbeat within the redispatch tolerance (the one liveness rule). */
    online: number;
  };
  campaigns: {
    total: number;
    draft: number;
    pending: number;
    /** ADM-FIX1 — the two stored statuses the buckets used to skip while `total` counted them. */
    upcoming: number;
    active: number;
    rejected: number;
    completed: number;
    /** AVG(requested_budget) over every status — left as is by DASH-1 (flagged). HT. */
    average_budget_tnd: number;
  };
  creatives: {
    total: number;
    pending: number;
    approved: number;
  };
  /**
   * DASH-1 (operator rulings R1–R3, 2026-09-21). Every amount is HT. The CURRENT api's shape: a
   * pre-DASH-1 api sent `{ total_tnd, monthly_tnd }`, so the view reads this block only through
   * lib/admin-dashboard.ts `revenueFigures` (the deploy-window guard).
   */
  revenue: {
    /** R1 « Revenu total » — Σ settled advertiser spend (campaign_reconciliation.spend_tnd). */
    total_tnd: number;
    /**
     * R2 (amended) « Revenu Toodooh » — Σ reversement_lines.toodooh_amount_tnd + each settled
     * campaign's unsplit remainder (spend_tnd − Σ its lines' base_value_tnd). Pre-E7 settlements
     * are left out.
     */
    toodooh_tnd: number;
    /** R3 « Revenu mensuel » — both figures over the current Tunis calendar month. */
    monthly: {
      /** 'YYYY-MM', the Tunis month the two figures cover. */
      month: string;
      total_tnd: number;
      toodooh_tnd: number;
    };
  };
}
