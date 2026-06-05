// The single post-auth landing resolver. Login (LoginForm) and post-verify auto-login (VerifyEmail)
// both route through this so a verified user lands exactly where a normal login lands — agents in the
// agent workspace, owners on the owner dashboard, everyone else on the advertiser dashboard. Mirrors
// the guard redirects in App.tsx (PublicRoute/OwnerRoute/AdvertiserRoute/AgentRoute); keep them in step.
export function resolveHomeRoute(profileType: string | null, role?: string | null): string {
  // screenhost_agent (Slice-2 E) lands in the agent establishment workspace; screencast_agent has no
  // product surface yet (deferred). Agents have profile_type=null, so they must route by ROLE here.
  if (role === 'screenhost_agent') return '/agent';
  return profileType === 'individual_owner' || profileType === 'fleet_owner'
    ? '/owner-dashboard'
    : '/dashboard';
}
