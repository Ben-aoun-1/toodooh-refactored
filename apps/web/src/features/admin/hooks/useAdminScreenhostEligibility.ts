import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminScreenhostService,
  type EligibilityPatch,
} from '@/features/admin/services/admin-screenhost.service';

import { adminKeys } from './queryKeys';

/** EL1 — one venue's eligibility view; fetched per card in the UserManagement details modal. */
export function useScreenhostEligibility(screenhostId: string) {
  return useQuery({
    queryKey: adminKeys.screenhostEligibility(screenhostId),
    queryFn: () => adminScreenhostService.getEligibility(screenhostId),
  });
}

interface UpdateEligibilityInput {
  screenhostId: string;
  patch: EligibilityPatch;
}

/**
 * Admin eligibility edit. The PATCH response IS the fresh view (same projection as the GET), so
 * on success it is written straight into the venue's query cache — no refetch round-trip.
 */
export function useUpdateScreenhostEligibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenhostId, patch }: UpdateEligibilityInput) =>
      adminScreenhostService.updateEligibility(screenhostId, patch),
    onSuccess: (view, { screenhostId }) => {
      queryClient.setQueryData(adminKeys.screenhostEligibility(screenhostId), view);
    },
  });
}
