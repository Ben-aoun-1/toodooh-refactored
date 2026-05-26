import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { advertiserKeys } from './queryKeys';

/**
 * Step 10 — write mutations for the advertiser's `business_profiles` row.
 *
 * Bundled by coupling (Commit 2 / MyClients precedent): all mutations mutate
 * the same profile row and, on success, invalidate the single key
 * `advertiserKeys.profile(userId)` — which refetches the live `useUserProfile`
 * query.
 *
 * Phase-1f F7b — the generic `updateProfile` + `uploadLogo` mutations were
 * removed (D-F4-4 logo defer wired; the dead-Supabase chain severed). The
 * four section-scoped saves (the F4a PATCH endpoints) + `uploadDocument`
 * remain.
 */
export function useProfileMutations(userId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateProfile = () =>
    queryClient.invalidateQueries({ queryKey: advertiserKeys.profile(userId ?? '') });

  // Phase-1f F4a — section-scoped saves → the 4 PATCH endpoints (the forms already save per-section).
  const updateContact = useMutation({
    mutationFn: (patch: Parameters<typeof authService.updateProfileContact>[0]) =>
      authService.updateProfileContact(patch),
    onSuccess: invalidateProfile,
  });
  const updateBusiness = useMutation({
    mutationFn: (patch: Parameters<typeof authService.updateProfileBusiness>[0]) =>
      authService.updateProfileBusiness(patch),
    onSuccess: invalidateProfile,
  });
  const updateAddress = useMutation({
    mutationFn: (patch: Parameters<typeof authService.updateProfileAddress>[0]) =>
      authService.updateProfileAddress(patch),
    onSuccess: invalidateProfile,
  });
  const updateNotifications = useMutation({
    mutationFn: (patch: Parameters<typeof authService.updateProfileNotifications>[0]) =>
      authService.updateProfileNotifications(patch),
    onSuccess: invalidateProfile,
  });

  // Phase-1f F5 — the advertiser document is the RNE (Registre de commerce) → POST /documents/rne
  // (multipart, post-signin). onSuccess refetches /api/me → documents.registration flips true.
  const uploadDocument = useMutation({
    mutationFn: (file: File) => authService.uploadProfileDocument('rne', file),
    onSuccess: invalidateProfile,
  });

  return {
    updateContact,
    updateBusiness,
    updateAddress,
    updateNotifications,
    uploadDocument,
  };
}
