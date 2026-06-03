// The single post-auth landing resolver. Login (LoginForm) and post-verify auto-login (VerifyEmail)
// both route through this so a verified user lands exactly where a normal login lands — owners on the
// owner dashboard, everyone else on the advertiser dashboard. Mirrors the guard redirects in App.tsx
// (PublicRoute/OwnerRoute/AdvertiserRoute); keep them in step.
export function resolveHomeRoute(profileType: string | null): string {
  return profileType === 'individual_owner' || profileType === 'fleet_owner'
    ? '/owner-dashboard'
    : '/dashboard';
}
