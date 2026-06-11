import { useMutation, useQueryClient } from '@tanstack/react-query';

import { authKeys } from '@/features/auth/hooks/queryKeys';
import { authService } from '@/features/auth/services/auth.service';

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
  /** Truthy marker that a bank document is on file (new upload's row id or the prior path). */
  bankDocPath: string | null;
}

/**
 * Persists the owner's bank details — an optional document upload through
 * POST /api/profile/documents/bank, then PATCH /api/profile/bank (QA-fix lane;
 * replaces the dead Supabase `registres` upload + `business_profiles` write,
 * which had no session and no backing columns post auth-migration). F-docs
 * Commit 2: bank stays SINGLE-SLOT — no position is sent, so the cap-1
 * category resolves to slot 1 and a re-upload replaces in place; the upload
 * response is the document row (no storage key on the wire anymore).
 *
 * Caller-side validation (required fields, the 5 MB size limit) stays in the
 * page handler; this mutation owns only the async upload + write.
 */
async function saveBankDetails(input: SaveBankDetailsInput): Promise<SaveBankDetailsResult> {
  const { name, rib, iban, bankDocFile, existingBankDocPath } = input;

  let bankDocPath = existingBankDocPath;
  if (bankDocFile) {
    const document = await authService.uploadProfileDocument('bank', bankDocFile);
    bankDocPath = document.id;
  }

  await authService.updateProfileBank({
    bank_account_holder: name,
    bank_rib: rib,
    bank_iban: iban,
  });

  return { bankDocPath };
}

/**
 * Mutation for the owner's bank details.
 *
 * Invalidation graph: writes the user's bank columns, so on success it
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
