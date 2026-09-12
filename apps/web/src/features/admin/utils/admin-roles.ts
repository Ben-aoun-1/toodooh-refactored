/**
 * MINOR-1/30 — the two admin roles, one source of truth for routing (resolveHomeRoute,
 * AdvertiserRoute): an admin who lands on /dashboard belongs on /admin-dashboard, not in the
 * advertiser shell. Mirrors AdminRoute's own gate (role ∈ {admin, superadmin}).
 */
export const ADMIN_ROLES = ['admin', 'superadmin'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(role: string | null | undefined): role is AdminRole {
  return role === 'admin' || role === 'superadmin';
}
