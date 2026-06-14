import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { authKeys } from './queryKeys';

/** The partial patch accepted by `authService.updateBusinessProfile`. */
type BusinessProfileUpdate = Parameters<typeof authService.updateBusinessProfile>[0];

interface UpdatePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Step 10 — write mutations for the owner's `business_profiles` row, used by
 * `OwnerSettings` (Commit 5c1).
 *
 * Phase-1f F7b — the generic `updateProfile` mutation + `uploadLogo` +
 * `removeDocument` + `deactivateAccount` mutations were removed (the
 * D-F4-4 / D-F5-3 / D-F7-2 defers wired). The section-scoped saves + the
 * password-change + `updateBusinessProfile` (kept for the wallet's
 * later-slice bank-details edit) remain; the F5 single-slot `uploadDocument`
 * moved to `ProfileDocumentsManager`'s slot mutations (F-docs Commit 2) —
 * `invalidateProfile` is exported so the manager's writes can refresh the
 * /api/me-backed profile (its booleans flip).
 */
export function useOwnerProfileMutations(userId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateProfile = () =>
    queryClient.invalidateQueries({ queryKey: authKeys.profile(userId ?? '') });

  // Phase-1f F4b — section-scoped saves → the 4 PATCH endpoints (the shared, F4a-tested service
  // methods). handleSaveResponsable→Contact, handleSaveEntreprise→Business, handleSaveAdresse→
  // Address, handleSaveNotifications→Notifications.
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

  // Generic business-profile write — kept only for the deferred bank sub-form
  // (handleSaveBankDetails — wallet/later-slice). Entreprise/adresse route to the section methods.
  const updateBusinessProfile = useMutation({
    mutationFn: (patch: BusinessProfileUpdate) => authService.updateBusinessProfile(patch),
    onSuccess: invalidateProfile,
  });

  // handleUpdatePassword — no profile-row write, so no invalidation.
  const updatePasswordWithOld = useMutation({
    mutationFn: ({ currentPassword, newPassword }: UpdatePasswordInput) =>
      authService.updatePasswordWithOld(currentPassword, newPassword),
  });

  return {
    updateContact,
    updateBusiness,
    updateAddress,
    updateNotifications,
    updateBusinessProfile,
    updatePasswordWithOld,
    invalidateProfile,
  };
}
