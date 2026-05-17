import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';
import type { BusinessProfile } from '@/features/auth/types/auth';

import { advertiserKeys } from './queryKeys';

interface UseUserProfileResult {
  profile: BusinessProfile | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the user's `business_profiles` row via React Query.
 *
 * The pre-React-Query hook took a `reloadKey` param to force a refetch on
 * navigation (a workaround for the old Dashboard.tsx behavior). React Query
 * makes that obsolete — cache invalidation handles refetching — and no
 * caller ever passed it, so the param is dropped.
 *
 * Typed as `BusinessProfile | null` (the real return type of
 * `authService.getBusinessProfile`); the original hook's `any` was an
 * unnecessary widening. `UserProfile.tsx` consumes this hook + the
 * `advertiserKeys.profile` key, and its writes invalidate that key via
 * `useProfileMutations`.
 */
export function useUserProfile(userId: string | undefined): UseUserProfileResult {
  const query = useQuery({
    queryKey: advertiserKeys.profile(userId ?? ''),
    queryFn: () => authService.getBusinessProfile(),
    enabled: !!userId,
  });

  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
  };
}
