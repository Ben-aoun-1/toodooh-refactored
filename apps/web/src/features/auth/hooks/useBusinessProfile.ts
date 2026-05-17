import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';
import type { BusinessProfile } from '@/features/auth/types/auth';

import { authKeys } from './queryKeys';

interface UseBusinessProfileResult {
  profile: BusinessProfile | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the owner's `business_profiles` row via React Query.
 *
 * This is the screenhost-side counterpart to the advertiser feature's
 * `useUserProfile`: both wrap the same session-scoped
 * `authService.getBusinessProfile()`. The duplication is intentional and
 * contained — a user is advertiser XOR owner (mutually exclusive route
 * guards in `App.tsx`: `AdvertiserRoute` / `OwnerRoute`), so the two cache
 * entries never both populate within one session. TBD-P (Commit 9) tracks
 * consolidating them onto one auth-owned hook in Phase 1.
 *
 * Keyed `authKeys.profile(userId)` — `userId` is for per-user cache
 * isolation only; `getBusinessProfile()` itself takes no argument. Typed
 * `BusinessProfile | null` (the real service return type — no `any`).
 */
export function useBusinessProfile(userId: string | undefined): UseBusinessProfileResult {
  const query = useQuery({
    queryKey: authKeys.profile(userId ?? ''),
    queryFn: () => authService.getBusinessProfile(),
    enabled: !!userId,
  });

  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
  };
}
