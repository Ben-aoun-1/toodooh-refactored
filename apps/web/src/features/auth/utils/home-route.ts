// The single post-auth landing resolver. Login (LoginForm) and post-verify auto-login (VerifyEmail)
// both route through this so a verified user lands exactly where a normal login lands — agents in the
// agent workspace, owners on the owner dashboard, everyone else on the advertiser dashboard. Mirrors
// the guard redirects in App.tsx (PublicRoute/OwnerRoute/AdvertiserRoute/AgentRoute); keep them in step.
export function resolveHomeRoute(
  profileType: string | null,
  role?: string | null,
  status?: string | null,
): string {
  // Both agent roles (Slice-2 E screenhost_agent; P2 screencast_agent) land in the agent
  // referred-clients workspace. Agents have profile_type=null, so they must route by ROLE here.
  // (Agents are admin-created, never moderation-rejected, so the status gate below is end-user only.)
  if (role === 'screenhost_agent' || role === 'screencast_agent') return '/agent';
  // N3 — a rejected end-user account is gated OUT of the app onto the status screen. pending/approved
  // are unchanged: pending still reaches the dashboard (features grised), approved gets the full app.
  if (status === 'rejected') return '/account-rejected';
  return profileType === 'individual_owner' || profileType === 'fleet_owner'
    ? '/owner-dashboard'
    : '/dashboard';
}
