import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { type CampaignCtaBody, campaignsApi } from '@/features/campaigns/services/campaigns.api';

import { campaignsKeys } from './queryKeys';

/** QR-CTA1 — the campaign's call to action. Re-read every 4 s while its QR copy is being made. */
export function useCampaignCta(campaignId: string | null) {
  return useQuery({
    queryKey: campaignsKeys.cta(campaignId ?? ''),
    queryFn: () => campaignsApi.getCta(campaignId ?? ''),
    enabled: Boolean(campaignId),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 4000 : false),
  });
}

function useCtaMutation<TVars>(
  campaignId: string,
  fn: (vars: TVars) => ReturnType<typeof campaignsApi.getCta>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      queryClient.setQueryData(campaignsKeys.cta(campaignId), view);
    },
  });
}

export const useSaveCampaignCta = (campaignId: string) =>
  useCtaMutation(campaignId, (body: CampaignCtaBody) => campaignsApi.setCta(campaignId, body));

export const useRemoveCampaignCta = (campaignId: string) =>
  useCtaMutation(campaignId, () => campaignsApi.removeCta(campaignId));
