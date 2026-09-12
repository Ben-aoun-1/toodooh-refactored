import { useQuery } from '@tanstack/react-query';

import { adminTestingService } from '@/features/admin/services/admin-testing.service';

import { adminKeys } from './queryKeys';

export function useTestingScreenhosts() {
  return useQuery({
    queryKey: adminKeys.testingScreenhosts(),
    queryFn: () => adminTestingService.list(),
  });
}

export function useTestingReport(id: string | null, from: string, to: string) {
  return useQuery({
    queryKey: adminKeys.testingReport(id ?? '', from, to),
    queryFn: () => adminTestingService.report(id ?? '', from, to),
    enabled: Boolean(id) && from <= to,
  });
}
