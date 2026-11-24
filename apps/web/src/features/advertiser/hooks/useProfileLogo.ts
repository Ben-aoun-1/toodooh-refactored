import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/stores/auth.store';

import { profileLogoService } from '../services/profile-logo.service';

import { advertiserKeys } from './queryKeys';

/**
 * The signed-in Screencaster's own logo, or null when none is set. One cached read shared by his
 * profile's « Logo » block and every campaign card that shows it.
 */
export function useProfileLogo() {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: advertiserKeys.profileLogo(userId ?? ''),
    queryFn: () => profileLogoService.get(),
    select: (d) => d.logo,
    enabled: !!userId,
  });
}

/** Send a new logo; the cached read refreshes so the campaigns show it at once. */
export function useUploadProfileLogo() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: (file: File) => profileLogoService.upload(file),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: advertiserKeys.profileLogo(userId ?? '') }),
  });
}
