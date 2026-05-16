import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { advertiserKeys } from './queryKeys';

interface UseUserProfileResult {
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the user's `business_profiles` row via React Query.
 *
 * The pre-React-Query hook took a `reloadKey` param to force a refetch on
 * navigation (a workaround for the old Dashboard.tsx behavior). React Query
 * makes that obsolete — cache invalidation handles refetching — and no
 * caller ever passed it, so the param is dropped. Commit 2b rewires
 * `UserProfile.tsx` onto this same hook + the `advertiserKeys.profile` key.
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
