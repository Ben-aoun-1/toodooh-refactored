import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { authKeys } from './queryKeys';

const log = logger.child({ module: 'useOwnerProfileMutations' });

/** The partial-profile patch accepted by `authService.updateProfile`. */
type ProfileUpdate = Parameters<typeof authService.updateProfile>[0];
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
 * `OwnerSettings` (Commit 5c1) and reused by `MyAccount` (Commit 5c2).
 *
 * The owner-side counterpart to the advertiser feature's `useProfileMutations`
 * (TBD-P, Commit 9, tracks consolidating the two). Every mutation that writes
 * the profile invalidates `authKeys.profile(userId)` on success — refetching
 * the live `useBusinessProfile` query and replacing the page handlers' former
 * manual `loadProfile()` calls.
 *
 * Factoring (CF-13 amendment 1): OwnerSettings' eleven write handlers collapse
 * to seven distinct `mutationFn` shapes. Five plain-field writes share
 * `updateProfile` (the patch is the argument); `updateBusinessProfile` covers
 * three more. `removeDocument` is split from `uploadDocument` because clearing
 * the individual-owner CIN column is a direct `business_profiles` write —
 * `cin_doc_url` is not on `authService.updateProfile`'s patch type.
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

  // Generic field write — DEAD post-F4b (Supabase removed); kept only for the deferred logo-remove /
  // RNE-doc-remove handlers (D9 / F5), which still call it.
  const updateProfile = useMutation({
    mutationFn: (patch: ProfileUpdate) => authService.updateProfile(patch),
    onSuccess: invalidateProfile,
  });

  // Generic business-profile write — DEAD post-F4b; kept only for the deferred bank sub-form
  // (handleSaveBankDetails — money-slice). Entreprise/adresse now route to the section methods above.
  const updateBusinessProfile = useMutation({
    mutationFn: (patch: BusinessProfileUpdate) => authService.updateBusinessProfile(patch),
    onSuccess: invalidateProfile,
  });

  // handleUpdatePassword — no profile-row write, so no invalidation.
  const updatePasswordWithOld = useMutation({
    mutationFn: ({ currentPassword, newPassword }: UpdatePasswordInput) =>
      authService.updatePasswordWithOld(currentPassword, newPassword),
  });

  // MyAccount's optional password change (Commit 5c2) — `updatePassword`
  // takes no old-password argument, distinct from `updatePasswordWithOld`.
  // No profile-row write, so no invalidation.
  const updatePassword = useMutation({
    mutationFn: (password: string) => authService.updatePassword(password),
  });

  // handleDeactivateAccount — sets is_active=false then logs out; the page
  // handler runs the password re-auth check before calling this.
  const deactivateAccount = useMutation({
    mutationFn: () => authService.deactivateAccount(),
  });

  // handleLogoUpload — storage upload + signed URL + profile.logo_url write.
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop() || 'png';
      const filePath = `logo_${userId}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('registres')
        .upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: signed, error: signedError } = await supabase.storage
        .from('registres')
        .createSignedUrl(filePath, 604800);
      if (signedError || !signed) throw signedError || new Error('URL signée');
      await authService.updateProfile({ logo_url: signed.signedUrl });
    },
    onSuccess: invalidateProfile,
  });

  // Phase-1f F5 — individual owners upload a CIN (→ /documents/cin), fleet owners an RNE
  // (→ /documents/rne). Multipart, post-signin; onSuccess refetches /api/me → documents.* flips.
  const uploadDocument = useMutation({
    mutationFn: ({ file, isIndividualOwner }: DocumentInput) =>
      authService.uploadProfileDocument(isIndividualOwner ? 'cin' : 'rne', file),
    onSuccess: invalidateProfile,
  });

  // handleRemoveDocument — CIN clear is a direct write (`cin_doc_url` is not on
  // `updateProfile`'s patch type); the RNE clear routes through the service.
  const removeDocument = useMutation({
    mutationFn: async (isIndividualOwner: boolean) => {
      if (isIndividualOwner) {
        const { error } = await supabase
          .from('business_profiles')
          .update({ cin_doc_url: null })
          .eq('user_id', userId as string);
        if (error) throw error;
      } else {
        await authService.updateProfile({
          registration_doc_url: null,
          registration_doc_path: null,
        });
      }
    },
    onSuccess: invalidateProfile,
    onError: (error) => {
      log.error({ error: getErrorMessage(error) }, 'failed to remove owner legal document');
    },
  });

  return {
    updateContact,
    updateBusiness,
    updateAddress,
    updateNotifications,
    updateProfile,
    updateBusinessProfile,
    updatePasswordWithOld,
    updatePassword,
    deactivateAccount,
    uploadLogo,
    uploadDocument,
    removeDocument,
  };
}
