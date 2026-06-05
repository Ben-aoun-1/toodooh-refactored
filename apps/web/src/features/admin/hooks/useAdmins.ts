import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminService } from '@/features/admin/services/admin.service';
import type { CreateInternalAccountInput } from '@/features/admin/types/admin';

import { adminKeys } from './queryKeys';

/** The admin-account list for AdminManagement. */
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

/**
 * Admin-account write mutations: deactivate (`deleteAdmin`), reactivate, and
 * create. Each invalidates `adminKeys.admins()`. The activity-log calls stay
 * in the page handlers — `logActivity` is a fire-and-forget audit side effect,
 * not part of the account-write operation.
 */
export function useAdminMutations() {
  const queryClient = useQueryClient();
  const invalidateAdmins = () => queryClient.invalidateQueries({ queryKey: adminKeys.admins() });

  const deleteAdmin = useMutation({
    mutationFn: (id: string) => adminService.deleteAdmin(id),
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

  return { deleteAdmin, reactivateAdmin, createAdmin };
}
