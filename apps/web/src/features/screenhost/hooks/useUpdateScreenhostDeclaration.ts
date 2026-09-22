import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type DeclarationPatch, screenhostService } from '../services/screenhost.service';

import { screenhostKeys } from './queryKeys';

interface UpdateScreenhostDeclarationInput {
  /** The owner whose `/mine` list is refreshed on success (key scoping). */
  userId: string;
  screenhostId: string;
  patch: DeclarationPatch;
}

/**
 * SCR-DECL1 — PATCH a venue's declared screens / rooms, then refresh the owner's `/mine` list so
 * the « Écrans et salles » cards re-render from the saved values (the reload-proof state), and
 * the owner's device list, whose rows may have followed the count.
 */
export function useUpdateScreenhostDeclaration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenhostId, patch }: UpdateScreenhostDeclarationInput) =>
      screenhostService.updateDeclaration(screenhostId, patch),
    onSuccess: (_data, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: screenhostKeys.screenhostsMine(userId) });
      void queryClient.invalidateQueries({ queryKey: screenhostKeys.devices(userId) });
    },
  });
}
