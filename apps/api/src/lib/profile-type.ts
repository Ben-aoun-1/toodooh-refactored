// Reconstruct the frontend's profile_type from role + business_type (inverse of the signup
// mapping; contract §5.2/§7.2). `agency` is NOT a role — it is advertiser + business_type='agency'.
// admin/superadmin have no FE profile_type (separate admin login, Phase 1f).
export const toProfileType = (role: string, businessType: string | null): string | null => {
  if (role === 'advertiser') return businessType === 'agency' ? 'agency' : 'advertiser';
  if (role === 'individual_owner' || role === 'fleet_owner') return role;
  return null;
};

// The non-privileged account-type hints the signup wizard sends (NOT roles — role/status stay
// server-controlled / input:false, the CF-24 class-b guard).
export const PROFILE_TYPES = ['advertiser', 'agency', 'individual_owner', 'fleet_owner'] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

type MappedRole = 'advertiser' | 'individual_owner' | 'fleet_owner';

// Inverse of toProfileType: map the validated profile_type hint to the server-controlled role
// (+ a business_type override for agency, which is advertiser + business_type='agency', not a
// role). Runs server-side on a zod-validated enum at signup — never trusting a client-sent role.
export const fromProfileType = (
  profileType: ProfileType,
): { role: MappedRole; businessTypeOverride?: string } => {
  if (profileType === 'agency') return { role: 'advertiser', businessTypeOverride: 'agency' };
  if (profileType === 'individual_owner' || profileType === 'fleet_owner')
    return { role: profileType };
  return { role: 'advertiser' };
};
