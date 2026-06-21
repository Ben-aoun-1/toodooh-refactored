import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminUserService,
  type AdminUser,
  type GroupedAdminDocuments,
  type UserStatus,
} from '@/features/admin/services/admin-user.service';

import { adminKeys } from './queryKeys';

// The backend requires a status filter (no all-users dump) and excludes admin-role users
// server-side. To preserve the page's all-tab + the per-status stat cards, fetch all three
// statuses in parallel and merge (G2 D-G2-2). Three calls on a low-traffic admin screen is cheap.
const STATUSES: readonly UserStatus[] = ['pending', 'approved', 'rejected'];

export function useUsers(): { users: AdminUser[]; loading: boolean; isError: boolean } {
  const results = useQueries({
    queries: STATUSES.map((status) => ({
      queryKey: [...adminKeys.users(), status],
      queryFn: () => adminUserService.getUsersByStatus(status),
    })),
  });
  return {
    users: results.flatMap((r) => r.data ?? []),
    loading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}

// The reviewed user's documents, grouped by category, for the details modal. Disabled until a user
// is selected (userId null → no fetch); presigning a single document is a separate imperative call
// (getDocumentUrlById) the page makes on the "Voir" click, not server state.
export function useUserDocuments(userId: string | null): {
  documents: GroupedAdminDocuments | undefined;
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: adminKeys.userDocuments(userId ?? 'none'),
    queryFn: () => adminUserService.getUserDocuments(userId as string),
    enabled: userId !== null,
  });
  return { documents: query.data, loading: query.isLoading, isError: query.isError };
}

interface ApproveInput {
  id: string;
  notes?: string;
}

interface RejectInput {
  id: string;
  notes: string;
  topics: string[];
}

/**
 * UserManagement write mutations, repointed onto the Phase-1g G1 admin endpoints. Both invalidate
 * the `['admin','users']` prefix (catching all three per-status queries). The mutations throw
 * `ApiError` on failure (the api-client contract — G2 D-G2-3): the page catches and branches on
 * `error.status === 409` to open the prior-state modal. The legacy boolean-returning service +
 * the bulk / delete / doc-upload / agent-code mutations are gone — those operations have no
 * backend yet (disabled + severed, G2 D-G2-1; tracked as future-slice carry-forwards).
 */
export function useUserMutations() {
  const queryClient = useQueryClient();
  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: adminKeys.users() });

  const approveUser = useMutation({
    mutationFn: ({ id, notes }: ApproveInput) => adminUserService.approveUser(id, notes),
    onSuccess: invalidateUsers,
  });

  const rejectUser = useMutation({
    mutationFn: ({ id, notes, topics }: RejectInput) =>
      adminUserService.rejectUser(id, notes, topics),
    onSuccess: invalidateUsers,
  });

  return { approveUser, rejectUser };
}
