import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { authKeys } from './queryKeys';

/** The partial patch accepted by `authService.updateBusinessProfile`. */
type BusinessProfileUpdate = Parameters<typeof authService.updateBusinessProfile>[0];

interface UpdatePasswordInput {
  currentPassword: string;
  newPassword: string;
}

interface DocumentInput {
  file: File;
  /** Individual owners store a CIN; fleet owners store an RNE registration document. */
  isIndividualOwner: boolean;
}

/**
 * Step 10 — write mutations for the owner's `business_profiles` row, used by
 * `OwnerSettings` (Commit 5c1).
 *
 * Phase-1f F7b — the generic `updateProfile` mutation + `uploadLogo` +
 * `removeDocument` + `deactivateAccount` mutations were removed (the
 * D-F4-4 / D-F5-3 / D-F7-2 defers wired). The section-scoped saves + the
 * password-change + document-upload + `updateBusinessProfile` (kept for the
 * wallet's later-slice bank-details edit) remain.
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

  // Phase-1f F5 — individual owners upload a CIN (→ /documents/cin), fleet owners an RNE
  // (→ /documents/rne). Multipart, post-signin; onSuccess refetches /api/me → documents.* flips.
  const uploadDocument = useMutation({
    mutationFn: ({ file, isIndividualOwner }: DocumentInput) =>
      authService.uploadProfileDocument(isIndividualOwner ? 'cin' : 'rne', file),
    onSuccess: invalidateProfile,
  });

  return {
    updateContact,
    updateBusiness,
    updateAddress,
    updateNotifications,
    updateBusinessProfile,
    updatePasswordWithOld,
    uploadDocument,
  };
}
