// Reconstruct the frontend's profile_type from role + business_type (inverse of the signup
// mapping; contract §5.2/§7.2). `agency` is NOT a role — it is advertiser + business_type='agency'.
// admin/superadmin have no FE profile_type (separate admin login, Phase 1f).
export const toProfileType = (role: string, businessType: string | null): string | null => {
  if (role === 'advertiser') return businessType === 'agency' ? 'agency' : 'advertiser';
  if (role === 'individual_owner' || role === 'fleet_owner') return role;
  return null;
};
