// ADM-ADM1 — one staff account as GET /api/admin/admins serves it (users where role ∈
// admin/superadmin). `moderator`, permissions and last_login are GONE: none exists in the users
// model (moderator is not a user_role value — slice-2 A ruling 2). users carries ONE contact_name;
// first_name/last_name are a server-side split on the first space (display sugar for initials).
// is_active = status !== 'banned' (deactivation IS the ban route; unban restores).
export interface AdminAccount {
  id: string;
  email: string;
  contact_name: string;
  first_name: string;
  last_name: string;
  role: 'superadmin' | 'admin';
  is_active: boolean;
  created_at: string;
}

// Slice-2 A — internal-account creation via the apps/api endpoint POST /api/admin/accounts
// (superadmin-only). `moderator` is intentionally absent (not a user_role value); the agent roles
// are the new admin-creatable types.
export type InternalAccountRole = 'admin' | 'screenhost_agent' | 'screencast_agent';

export interface CreateInternalAccountInput {
  email: string;
  // Optional: the agent roles get a SYSTEM-generated password server-side (the field is omitted for
  // them). Only the admin role sends a typed password (Kais GTM).
  password?: string;
  contact_name: string;
  role: InternalAccountRole;
}

export interface InternalAccount {
  id: string;
  email: string;
  role: string;
  status: string;
  contact_name: string;
  email_verified: boolean;
  // The agent's OWN issued referral code (agents.code), returned by POST /api/admin/accounts:
  // present for the agent roles, null for admin. Surfaced after creation so the superadmin can
  // relay it to the agent.
  code?: string | null;
  // The system-generated temporary password, returned ONCE on create for the agent roles (null for
  // admin, whose password is admin-chosen). Surfaced in the success panel for the admin to relay.
  temp_password?: string | null;
}
