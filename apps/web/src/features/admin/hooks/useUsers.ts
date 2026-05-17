import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminUserService, type AdminUser } from '@/features/admin/services/admin-user.service';
import { supabase } from '@/lib/supabase';

import { adminKeys } from './queryKeys';

/** The full end-user list (filtering + pagination are done client-side in the page). */
export function useUsers(): { users: AdminUser[]; loading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: adminKeys.users(),
    queryFn: () => adminUserService.getUsers(),
  });
  return {
    users: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

interface UserDecisionInput {
  userId: string;
  adminId?: string;
}

interface BulkUserInput {
  userIds: string[];
  adminId?: string;
}

interface UploadUserDocumentInput {
  authUserId: string;
  isIndividualOwner: boolean;
  file: File;
}

interface UploadUserDocumentResult {
  updateField: 'cin_doc_url' | 'registration_doc_url';
  signedUrl: string;
}

interface SaveAgentCodeInput {
  profileId: string;
  code: string;
}

/**
 * UserManagement write mutations. Every mutation invalidates `adminKeys.users()`
 * — the single end-user list query the page renders. The former post-success
 * `setUsers` patches are dropped: invalidate-and-refetch is the Step-10 default
 * (resume brief §4), and the list is not a local mirror.
 *
 * Invalidation is intra-feature only. A user's own approval status lives in
 * their Zustand auth store (D1) in a separate session — there is no React
 * Query key for it, so no (b)-class cross-session entry (CF-14).
 *
 * `single` approve/reject return the service `boolean`; `onSuccess` invalidates
 * only when the decision landed. `bulkApprove`/`bulkReject` are direct
 * `business_profiles` updates (the page's pre-existing bulk path, distinct from
 * the per-user service calls).
 */
export function useUserMutations() {
  const queryClient = useQueryClient();
  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: adminKeys.users() });

  const approveUser = useMutation({
    mutationFn: ({ userId, adminId }: UserDecisionInput) =>
      adminUserService.approveUser(userId, adminId),
    onSuccess: (success) => {
      if (success) invalidateUsers();
    },
  });

  const rejectUser = useMutation({
    mutationFn: ({ userId, adminId }: UserDecisionInput) =>
      adminUserService.rejectUser(userId, adminId),
    onSuccess: (success) => {
      if (success) invalidateUsers();
    },
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => adminUserService.deleteUser(userId),
    onSuccess: (success) => {
      if (success) invalidateUsers();
    },
  });

  const bulkApprove = useMutation({
    mutationFn: async ({ userIds, adminId }: BulkUserInput) => {
      const { error } = await supabase
        .from('business_profiles')
        .update({
          status: 'approved',
          verification_status: 'approved',
          onboarding_completed: true,
          validated_at: new Date().toISOString(),
          validated_by: adminId || 'admin',
        })
        .in('id', userIds);
      if (error) throw error;
    },
    onSuccess: invalidateUsers,
  });

  const bulkReject = useMutation({
    mutationFn: async ({ userIds, adminId }: BulkUserInput) => {
      const { error } = await supabase
        .from('business_profiles')
        .update({
          status: 'rejected',
          verification_status: 'rejected',
          validated_at: new Date().toISOString(),
          validated_by: adminId || 'admin',
        })
        .in('id', userIds);
      if (error) throw error;
    },
    onSuccess: invalidateUsers,
  });

  // Admin-side document upload for a user — storage upload + signed URL, then
  // a branch write (CIN for individual owners, RNE registration otherwise).
  // Returns the patched field + URL so the page can refresh its open modal.
  const uploadUserDocument = useMutation({
    mutationFn: async ({
      authUserId,
      isIndividualOwner,
      file,
    }: UploadUserDocumentInput): Promise<UploadUserDocumentResult> => {
      const ext = file.name.split('.').pop();
      const filePrefix = isIndividualOwner ? 'cin' : 'rne';
      const filePath = `${filePrefix}_${authUserId}_admin_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('registres')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: signedData, error: signedError } = await supabase.storage
        .from('registres')
        .createSignedUrl(filePath, 604800);
      if (signedError || !signedData)
        throw signedError || new Error("Impossible de créer l'URL signée");

      const updateField: UploadUserDocumentResult['updateField'] = isIndividualOwner
        ? 'cin_doc_url'
        : 'registration_doc_url';
      const { error: updateError } = await supabase
        .from('business_profiles')
        .update({ [updateField]: signedData.signedUrl })
        .eq('user_id', authUserId);
      if (updateError) throw updateError;

      return { updateField, signedUrl: signedData.signedUrl };
    },
    onSuccess: invalidateUsers,
  });

  // Bulk delete loops the per-user service call and invalidates once (rather
  // than once per user); returns the success/error tally for the page toast.
  const bulkDelete = useMutation({
    mutationFn: async (userIds: string[]): Promise<{ successCount: number; errorCount: number }> => {
      let successCount = 0;
      let errorCount = 0;
      for (const userId of userIds) {
        try {
          const ok = await adminUserService.deleteUser(userId);
          if (ok) successCount += 1;
          else errorCount += 1;
        } catch {
          errorCount += 1;
        }
      }
      return { successCount, errorCount };
    },
    onSuccess: invalidateUsers,
  });

  const saveAgentCode = useMutation({
    mutationFn: async ({ profileId, code }: SaveAgentCodeInput) => {
      const { error } = await supabase
        .from('business_profiles')
        .update({ agent_toodooh: code, updated_at: new Date().toISOString() })
        .eq('id', profileId);
      if (error) throw error;
    },
    onSuccess: invalidateUsers,
  });

  return {
    approveUser,
    rejectUser,
    deleteUser,
    bulkApprove,
    bulkReject,
    bulkDelete,
    uploadUserDocument,
    saveAgentCode,
  };
}
