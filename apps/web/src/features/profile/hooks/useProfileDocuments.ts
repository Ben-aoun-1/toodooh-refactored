import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';
import type { ProfileDocumentCategory } from '@/features/profile/lib/document-caps';

export const profileDocumentsKey = ['profile', 'documents'] as const;

/**
 * F-docs Commit 2 — the grouped multi-document read (GET /api/profile/documents)
 * + the slot upload/delete writes, for `ProfileDocumentsManager`.
 *
 * Invalidation graph: a write changes the user's document rows AND flips the
 * /api/me presence booleans (F5 getting-started predicates, the settings
 * badges), so mutations invalidate this query and then call `onChanged` — the
 * wrapper-provided profile invalidation (advertiser and owner cache their
 * profile under different key families, so the wrapper owns that key).
 */
export function useProfileDocuments() {
  return useQuery({
    queryKey: profileDocumentsKey,
    queryFn: () => authService.listProfileDocuments(),
  });
}

interface UploadInput {
  category: ProfileDocumentCategory;
  file: File;
  /** An explicit slot; omitted → the server picks the lowest free slot. */
  position?: number;
}

export function useUploadProfileDocument(onChanged?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ category, file, position }: UploadInput) =>
      authService.uploadProfileDocument(category, file, position),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileDocumentsKey });
      onChanged?.();
    },
  });
}

export function useDeleteProfileDocument(onChanged?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authService.deleteProfileDocument(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileDocumentsKey });
      onChanged?.();
    },
  });
}
