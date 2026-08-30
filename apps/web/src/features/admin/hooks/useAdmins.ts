import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminService } from '@/features/admin/services/admin.service';
import type { CreateInternalAccountInput } from '@/features/admin/types/admin';

import { adminKeys } from './queryKeys';

/** The staff-account list for AdminManagement (GET /api/admin/admins, superadmin). */
export function useAdmins() {
  const query = useQuery({
    queryKey: adminKeys.admins(),
    queryFn: () => adminService.getAdmins(),
  });
  return {
    admins: query.data ?? [],
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
  const invalidateAdmins = () => queryClient.invalidateQueries({ queryKey: adminKeys.admins() });

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
