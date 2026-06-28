import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type CampaignView,
  type CreateCampaignInput,
  type UpdateCampaignInput,
  campaignsApi,
} from '../services/campaigns.api';

import { campaignsKeys } from './queryKeys';

// React Query hooks over the new campaigns REST engine. Additive — the wizard + MyCampaigns wire
// onto these in later commits. Mutations invalidate the advertiser's list key so the (repointed)
// MyCampaigns refreshes, and seed the detail cache so edit-mode reads are warm.

/** The signed-in advertiser's campaigns (GET /api/campaigns/mine). */
export function useMyCampaignsList(userId: string | undefined) {
  return useQuery({
    queryKey: campaignsKeys.list(userId ?? ''),
    queryFn: () => campaignsApi.mine(),
    enabled: Boolean(userId),
  });
}

/** A single campaign (GET /api/campaigns/:id) — edit-mode prefill; idle until an id is known. */
export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: campaignsKeys.detail(id ?? ''),
    queryFn: () => campaignsApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCampaign(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) => campaignsApi.create(input),
    onSuccess: (campaign: CampaignView) => {
      queryClient.setQueryData(campaignsKeys.detail(campaign.id), campaign);
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });
    },
  });
}

export function useUpdateCampaign(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCampaignInput }) =>
      campaignsApi.update(id, input),
    onSuccess: (campaign: CampaignView) => {
      queryClient.setQueryData(campaignsKeys.detail(campaign.id), campaign);
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });
    },
  });
}

export function useSubmitCampaign(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignsApi.submit(id),
    onSuccess: (campaign: CampaignView) => {
      queryClient.setQueryData(campaignsKeys.detail(campaign.id), campaign);
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });
    },
  });
}
