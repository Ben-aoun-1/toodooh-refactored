import { useMutation, useQueryClient } from '@tanstack/react-query';

import { screensService, type CreateScreenData } from '@/features/screens/services/screens.service';

import { screensKeys } from './queryKeys';

/**
 * Creates a screen. onSuccess invalidates `screensKeys.all` — a new screen
 * affects the list, the OwnerScreens composite, and the calendar composite.
 */
export function useCreateScreen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (screenData: CreateScreenData) => screensService.createScreen(screenData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: screensKeys.all });
    },
  });
}
