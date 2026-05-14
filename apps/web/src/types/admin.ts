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

export interface AdminDashboardStats {
  totalUsers: number;
  totalOwners: number;
  totalAdvertisers: number;
  totalScreens: number;
  totalRevenue: number;
  monthlyRevenue: number;
  pendingVerifications: number;
  activeCampaigns: number;
}

export interface AdminActivity {
  id: string;
  admin_id: string;
  admin_name: string;
  action: string;
  resource: string;
  resource_id?: string;
  details?: unknown;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}
