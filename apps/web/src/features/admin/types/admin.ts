export interface AdminProfile {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'superadmin' | 'admin' | 'moderator';
  permissions: string[];
  is_active: boolean;
  last_login?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface AdminRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  is_system_role: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminPermission {
  id: string;
  name: string;
  description: string;
  type: string;
  resource: string;
  created_at: string;
  updated_at?: string;
}

export interface AdminLoginData {
  email: string;
  password: string;
}

export interface AdminSignUpData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'moderator';
  permissions?: string[];
}

// Slice-2 A — internal-account creation via the apps/api endpoint POST /api/admin/accounts
// (superadmin-only). `moderator` is intentionally absent (not a user_role value); the agent roles
// are the new admin-creatable types. Distinct from the legacy admin_profiles shape above.
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
