import { useQuery } from '@tanstack/react-query';

import {
  type OwnerCampaign,
  screenhostCampaignsService,
} from '@/features/screenhost/services/screenhost-campaigns.service';

import { screenhostKeys } from './queryKeys';

/**
 * CAMP-E1 — the owner's « Mes campagnes » list (GET /api/screenhosts/campaigns). Read-only: the
 * page is oversight, the per-allocation decision lives on /owner-allocations. `data` is returned
 * raw (`undefined` until loaded) so the page can tell "empty" from "not yet fetched".
 */
export function useOwnerCampaigns(userId: string | undefined): {
  data: OwnerCampaign[] | undefined;
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: screenhostKeys.campaigns(userId ?? ''),
    queryFn: () => screenhostCampaignsService.list(),
    enabled: Boolean(userId),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
