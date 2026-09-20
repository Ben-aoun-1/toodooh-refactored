import { compareDesc, parseISO } from 'date-fns';

import type { AdminAccount, StaffRole } from '@/features/admin/types/admin';

/**
 * ADM-FIX1 — the /admin-management listing now spans the four INTERNAL roles: the two staff ones
 * (GET /api/admin/admins, superadmin-only) and the two agent ones (GET /api/admin/agents, readable
 * by an admin too). The merge / filter / label rules live here as pure functions because apps/web
 * has no render harness — the page renders what these return, and these are what the tests assert.
 */

/** The French label each role renders as, in the table, the badge and the role filter. */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  superadmin: 'Super Administrateur',
  admin: 'Administrateur',
  screenhost_agent: 'Agent ScreenHost',
  screencast_agent: 'Agent ScreenCast',
};

/** Display order of the role-filter options (staff first, then the two agent types). */
export const STAFF_ROLE_ORDER: readonly StaffRole[] = [
  'superadmin',
  'admin',
  'screenhost_agent',
  'screencast_agent',
];

export const isAgentRole = (role: StaffRole): boolean =>
  role === 'screenhost_agent' || role === 'screencast_agent';

/**
 * The roles a given actor can SEE on the page: a superadmin sees every internal account; an admin
 * sees the agents only — the staff listing stays superadmin-only server-side (privilege
 * escalation), so offering « Administrateur » in their filter would promise rows that never come.
 */
export const visibleStaffRoles = (actorRole: string | null): readonly StaffRole[] =>
  actorRole === 'superadmin' ? STAFF_ROLE_ORDER : STAFF_ROLE_ORDER.filter(isAgentRole);

/**
 * ONE newest-first list out of the two sources. Each arrives newest-first on its own, so the
 * interleave is a sort on created_at (date-fns, never Date arithmetic).
 */
export const mergeStaffAccounts = (
  admins: readonly AdminAccount[],
  agents: readonly AdminAccount[],
): AdminAccount[] =>
  [...admins, ...agents].sort((a, b) =>
    compareDesc(parseISO(a.created_at), parseISO(b.created_at)),
  );

export interface StaffFilter {
  /** Free text matched against the name AND the email, case-insensitively. */
  search: string;
  /** 'all', or one of the four roles. */
  role: StaffRole | 'all';
}

export const filterStaffAccounts = (
  accounts: readonly AdminAccount[],
  { search, role }: StaffFilter,
): AdminAccount[] => {
  const needle = search.trim().toLowerCase();
  return accounts.filter((a) => {
    const matchesSearch =
      needle === '' ||
      a.contact_name.toLowerCase().includes(needle) ||
      a.email.toLowerCase().includes(needle);
    return matchesSearch && (role === 'all' || a.role === role);
  });
};

/**
 * The deactivate / reactivate pair, unchanged by ADM-FIX1: a SUPERADMIN actor on a staff-`admin`
 * target. The superadmin is never deactivated from this page, and the AGENT rows are listed
 * READ-ONLY on purpose — POST /api/admin/users/:id/unban refuses a non-admin target (409
 * NOT_ADMIN_ACCOUNT, « end-user bans are terminal »), so a « Désactiver » on an agent would be an
 * irreversible one-way button. Deactivating an agent needs an operator ruling on unban's target
 * allowlist first; until then the page lists them and creates them, and nothing else.
 */
export const canDeactivate = (account: AdminAccount, actorRole: string | null): boolean =>
  actorRole === 'superadmin' && account.role === 'admin';

/** Reactivation (POST /api/admin/users/:id/unban): superadmin actor, staff-`admin` target only. */
export const canReactivate = (account: AdminAccount, actorRole: string | null): boolean =>
  actorRole === 'superadmin' && account.role === 'admin';
