import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authKeys } from '@/features/auth/hooks/queryKeys';
import { authService } from '@/features/auth/services/auth.service';
import type { BusinessProfile } from '@/features/auth/types/auth';
import { supabase } from '@/lib/supabase';

interface SaveBankDetailsInput {
  userId: string;
  name: string;
  rib: string;
  iban: string;
  /** A newly-picked document to upload, or `null` to keep the existing one. */
  bankDocFile: File | null;
  /** The currently-stored document path, reused when no new file is picked. */
  existingBankDocPath: string | null;
}

interface SaveBankDetailsResult {
  /** The document path persisted on the profile (new upload or the prior one). */
  bankDocPath: string | null;
}

/**
 * Persists the owner's bank details — an optional `registres` storage upload
 * + signed URL, then a profile update routed through
 * `authService.updateBusinessProfile` (the service path, not a direct
 * `supabase.from('business_profiles').update()` — Commit 5c1 reconciliation,
 * shared by `OwnerRevenue` and `OwnerSettings`).
 *
 * Caller-side validation (required fields, the 5 MB size limit) stays in the
 * page handler; this mutation owns only the async upload + write.
 */
async function saveBankDetails(input: SaveBankDetailsInput): Promise<SaveBankDetailsResult> {
  const { userId, name, rib, iban, bankDocFile, existingBankDocPath } = input;

  let uploadedPath = existingBankDocPath;
  let signedUrl: string | undefined;

  if (bankDocFile) {
    const ext = bankDocFile.name.split('.').pop() || 'pdf';
    const path = `bank_${userId}_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('registres')
      .upload(path, bankDocFile);
    if (uploadError) throw uploadError;

    const { data: signedData, error: signedError } = await supabase.storage
      .from('registres')
      .createSignedUrl(path, 604800);
    if (signedError || !signedData?.signedUrl)
      throw signedError || new Error('URL signée introuvable');

    uploadedPath = path;
    signedUrl = signedData.signedUrl;
  }

  const patch: Partial<BusinessProfile> = {
    bank_account_holder: name,
    bank_rib: rib,
    bank_iban: iban,
    bank_details_updated_at: new Date().toISOString(),
  };
  if (uploadedPath) patch.bank_doc_path = uploadedPath;
  if (signedUrl) patch.bank_doc_url = signedUrl;

  await authService.updateBusinessProfile(patch);

  return { bankDocPath: uploadedPath };
}

/**
 * Mutation for the owner's bank details.
 *
 * Invalidation graph: writes `business_profiles`, so on success it
 * invalidates `authKeys.profile(userId)` — the cache `useBusinessProfile`
 * reads, keeping the OwnerRevenue / OwnerDashboard "coordonnées bancaires"
 * derivations fresh.
 */
export function useSaveBankDetails() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveBankDetails,
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: authKeys.profile(variables.userId) });
    },
  });
}
