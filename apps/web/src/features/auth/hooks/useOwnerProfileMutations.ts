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

  // handleSaveResponsable / handleSaveNotifications / handleLogoRemove +
  // the RNE branch of handleRemoveDocument — every plain profile-field write.
  const updateProfile = useMutation({
    mutationFn: (patch: ProfileUpdate) => authService.updateProfile(patch),
    onSuccess: invalidateProfile,
  });

  // handleSaveEntreprise / handleSaveAdresse / handleSaveBankDetails.
  const updateBusinessProfile = useMutation({
    mutationFn: (patch: BusinessProfileUpdate) => authService.updateBusinessProfile(patch),
    onSuccess: invalidateProfile,
  });

  // handleUpdatePassword — no profile-row write, so no invalidation.
  const updatePasswordWithOld = useMutation({
    mutationFn: ({ currentPassword, newPassword }: UpdatePasswordInput) =>
      authService.updatePasswordWithOld(currentPassword, newPassword),
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

  // handleUploadDocument — storage upload + signed URL, then a branch write:
  // individual owners store `cin_doc_url`, fleet owners store the RNE path+url.
  const uploadDocument = useMutation({
    mutationFn: async ({ file, isIndividualOwner }: DocumentInput) => {
      const ext = file.name.split('.').pop();
      const filePrefix = isIndividualOwner ? 'cin' : 'rne';
      const filePath = `${filePrefix}_${userId}_${Date.now()}.${ext}`;
      await supabase.storage.from('registres').upload(filePath, file);
      const { data: signedData, error: signedError } = await supabase.storage
        .from('registres')
        .createSignedUrl(filePath, 604800);
      if (signedError || !signedData) throw signedError || new Error('URL signée');

      if (isIndividualOwner) {
        const { error } = await supabase
          .from('business_profiles')
          .update({ cin_doc_url: signedData.signedUrl })
          .eq('user_id', userId as string);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('business_profiles')
          .update({
            registration_doc_path: filePath,
            registration_doc_url: signedData.signedUrl,
          })
          .eq('user_id', userId as string);
        if (error) throw error;
      }
    },
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
    updateProfile,
    updateBusinessProfile,
    updatePasswordWithOld,
    deactivateAccount,
    uploadLogo,
    uploadDocument,
    removeDocument,
  };
}
