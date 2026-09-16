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

/** CF-U1 — the coverage-map venues (GET /:id/coverage); idle until the draft exists. */
export function useCampaignCoverage(campaignId: string | null) {
  return useQuery({
    queryKey: campaignsKeys.coverage(campaignId ?? ''),
    queryFn: () => campaignsApi.coverage(campaignId as string),
    enabled: Boolean(campaignId),
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
      // MAP-4 — the coverage map depends on the saved dates (a venue needs one available day in
      // the window) and on zone_ids; its key carries neither, so a PATCH must drop the cached map
      // or a quick Période → Zones round trip would show the OLD window's venues.
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.coverage(campaign.id) });
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

/** CF-RJ1 « Rejouer » — clone a completed campaign into a fresh draft (POST /:id/replay). */
export function useReplayCampaign(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignsApi.replay(id),
    onSuccess: (campaign: CampaignView) => {
      queryClient.setQueryData(campaignsKeys.detail(campaign.id), campaign);
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });
    },
  });
}

export function useDeleteCampaign(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });
    },
  });
}
