import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { advertiserKeys } from './queryKeys';

const log = logger.child({ module: 'useProfileMutations' });

/** The partial-profile patch accepted by `authService.updateProfile`. */
type ProfileUpdate = Parameters<typeof authService.updateProfile>[0];

/**
 * Step 10 — write mutations for the advertiser's `business_profiles` row.
 *
 * Bundled by coupling (Commit 2 / MyClients precedent): all three mutations
 * mutate the same profile row and, on success, invalidate the single key
 * `advertiserKeys.profile(userId)` — which refetches the live `useUserProfile`
 * query. That invalidation replaces the manual `loadProfile()` call the eight
 * `UserProfile.tsx` write handlers used to run.
 *
 * Factoring note: six of `UserProfile.tsx`'s eight write handlers are the
 * *same* operation — `authService.updateProfile(<patch>)` — differing only by
 * the patch. They share one `updateProfile` mutation (the patch is the
 * mutate argument), rather than six identical hooks. The two storage-coupled
 * writes get their own mutations: `uploadLogo`, `uploadDocument`.
 */
export function useProfileMutations(userId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateProfile = () =>
    queryClient.invalidateQueries({ queryKey: advertiserKeys.profile(userId ?? '') });

  // Covers handleSaveResponsable / Entreprise / Adresse / Notifications +
  // handleLogoRemove + handleRemoveDocument — every plain profile-field write.
  const updateProfile = useMutation({
    mutationFn: (patch: ProfileUpdate) => authService.updateProfile(patch),
    onSuccess: invalidateProfile,
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

  // handleUploadDocument — storage upload + business_profiles row update.
  // Errors are logged and rethrown with their user-facing message so the
  // page handler's `toast.error(getErrorMessage(err))` shows the same text
  // the pre-React-Query inline flow did.
  const uploadDocument = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop();
      const filePath = `rne_${userId}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('registres')
        .upload(filePath, file);
      if (uploadError) {
        log.error({ error: uploadError }, 'failed to upload registration document');
        throw new Error(getErrorMessage(uploadError) || 'Erreur upload du document');
      }

      const { error: updateError } = await supabase
        .from('business_profiles')
        .update({ registration_doc_path: filePath, registration_doc_url: null })
        .eq('user_id', userId as string);
      if (updateError) {
        // The file is in storage but the DB doesn't reference it. We do not
        // attempt cleanup — best-effort delete creates more failure modes
        // than it solves; the orphan can be reclaimed by a storage GC job.
        log.error(
          { error: updateError },
          'failed to update business_profile after document upload',
        );
        throw new Error(
          getErrorMessage(updateError) || 'Erreur enregistrement du chemin du document',
        );
      }
    },
    onSuccess: invalidateProfile,
  });

  return { updateProfile, uploadLogo, uploadDocument };
}
