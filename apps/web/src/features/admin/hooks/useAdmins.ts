import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminService } from '@/features/admin/services/admin.service';
import type { CreateInternalAccountInput } from '@/features/admin/types/admin';

import { adminKeys } from './queryKeys';

/**
 * The staff-account list for AdminManagement (GET /api/admin/admins). SUPERADMIN-ONLY server-side,
 * so `enabled` lets an admin actor skip the call entirely rather than collect a 403 toast.
 */
export function useAdmins(enabled = true) {
  const query = useQuery({
    queryKey: adminKeys.admins(),
    queryFn: () => adminService.getAdmins(),
    enabled,
  });
  return {
    admins: query.data ?? [],
    loading: enabled && query.isLoading,
    isError: query.isError,
  };
}

/** ADM-FIX1 — the agent half of that listing (GET /api/admin/agents, admin OR superadmin). */
export function useAgents() {
  const query = useQuery({
    queryKey: adminKeys.agents(),
    queryFn: () => adminService.getAgents(),
  });
  return {
    agents: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

interface DeactivateAdminInput {
  id: string;
  /** The motif the ban route requires (stored as the validation note). */
  notes: string;
}

/**
 * Staff-account write mutations: deactivate (= the ban route), reactivate (= unban) and create.
 * Each invalidates `adminKeys.admins()`.
 */
export function useAdminMutations() {
  const queryClient = useQueryClient();
  // ADM-FIX1 — the Administrateurs page draws from BOTH listings now (creating an agent must show
  // up there), so every staff write invalidates the two keys.
  const invalidateAdmins = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.admins() });
    await queryClient.invalidateQueries({ queryKey: adminKeys.agents() });
  };

  const deactivateAdmin = useMutation({
    mutationFn: ({ id, notes }: DeactivateAdminInput) => adminService.deactivateAdmin(id, notes),
    onSuccess: invalidateAdmins,
  });

  const reactivateAdmin = useMutation({
    mutationFn: (id: string) => adminService.reactivateAdmin(id),
    onSuccess: invalidateAdmins,
  });

  const createAdmin = useMutation({
    mutationFn: (input: CreateInternalAccountInput) => adminService.createAdmin(input),
    onSuccess: invalidateAdmins,
  });

  return { deactivateAdmin, reactivateAdmin, createAdmin };
}
