import { useQuery } from '@tanstack/react-query';

import { screensService, type Screen } from '@/features/screens/services/screens.service';

import { screensKeys } from './queryKeys';

interface UseScreensResult {
  screens: Screen[];
  loading: boolean;
  isError: boolean;
}

/** The owner's screen list. Used by OwnerLocations (and any read-only consumer). */
export function useScreens(): UseScreensResult {
  const query = useQuery({
    queryKey: screensKeys.list(),
    queryFn: () => screensService.getScreens(),
  });

  return {
    screens: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
