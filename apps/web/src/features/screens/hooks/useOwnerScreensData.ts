import { useQuery } from '@tanstack/react-query';

import {
  screensService,
  type Screen,
  type UnavailabilityPeriod,
} from '@/features/screens/services/screens.service';
import { supabase } from '@/lib/supabase';

import { screensKeys } from './queryKeys';

interface OwnerScreensData {
  screens: Screen[];
  unavailabilityPeriods: UnavailabilityPeriod[];
  autoAccept: Map<string, boolean>;
}

interface UseOwnerScreensDataResult {
  /** The raw query payload — a stable reference per fetch (undefined until loaded). */
  data: OwnerScreensData | undefined;
  loading: boolean;
  isError: boolean;
}

/**
 * Composite read for OwnerScreens — verbatim port of the former
 * `loadScreensData`: the screen list + unavailability periods + a per-screen
 * `screen_configurations.auto_accept_campaigns` map. Missing/erroring config
 * rows default to `false`, as before.
 */
async function fetchOwnerScreensData(): Promise<OwnerScreensData> {
  const [screens, unavailabilityPeriods] = await Promise.all([
    screensService.getScreens(),
    screensService.getUnavailabilityPeriods(),
  ]);

  const autoAccept = new Map<string, boolean>();
  for (const screen of screens) {
    const { data: configs, error } = await supabase
      .from('screen_configurations')
      .select('auto_accept_campaigns')
      .eq('screen_id', screen.id);

    if (error || !configs || configs.length === 0) {
      autoAccept.set(screen.id, false);
    } else {
      autoAccept.set(screen.id, configs[0]?.auto_accept_campaigns || false);
    }
  }

  return { screens, unavailabilityPeriods, autoAccept };
}

export function useOwnerScreensData(): UseOwnerScreensDataResult {
  const query = useQuery({
    queryKey: screensKeys.ownerScreensData(),
    queryFn: fetchOwnerScreensData,
  });

  return {
    data: query.data,
    loading: query.isLoading,
    isError: query.isError,
  };
}
