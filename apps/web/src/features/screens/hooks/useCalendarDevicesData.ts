import { useQuery } from '@tanstack/react-query';

import {
  screensService,
  type Screen,
  type UnavailabilityPeriod,
} from '@/features/screens/services/screens.service';

import { screensKeys } from './queryKeys';

interface CalendarDevicesData {
  screens: Screen[];
  periods: UnavailabilityPeriod[];
}

interface UseCalendarDevicesDataResult {
  screens: Screen[];
  periods: UnavailabilityPeriod[];
  loading: boolean;
}

/**
 * Composite read for OwnerCalendarDevices — verbatim port of the former
 * `[user?.id]` effect: runs the `checkUnavailabilityStatus` maintenance
 * sweep, then fetches screens + unavailability periods in parallel.
 */
async function fetchCalendarDevicesData(): Promise<CalendarDevicesData> {
  await screensService.checkUnavailabilityStatus();
  const [screens, periods] = await Promise.all([
    screensService.getScreens(),
    screensService.getUnavailabilityPeriods(),
  ]);
  return { screens: screens || [], periods: periods || [] };
}

export function useCalendarDevicesData(
  userId: string | undefined,
): UseCalendarDevicesDataResult {
  const query = useQuery({
    queryKey: screensKeys.calendarDevices(),
    queryFn: fetchCalendarDevicesData,
    enabled: !!userId,
  });

  return {
    screens: query.data?.screens ?? [],
    periods: query.data?.periods ?? [],
    loading: query.isLoading,
  };
}
