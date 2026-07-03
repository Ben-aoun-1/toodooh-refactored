import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type CreativeView,
  type UploadCreativeInput,
  creativesApi,
} from '../services/creatives.api';

import { campaignsKeys } from './queryKeys';

// React Query hooks over the creatives REST library (L-spot) — the wizard's Creative step picker +
// upload, replacing the legacy Supabase `videos` flow.

/** The signed-in advertiser's creatives (GET /api/creatives/mine), newest first. */
export function useMyCreatives(userId: string | undefined) {
  return useQuery({
    queryKey: campaignsKeys.myCreatives(userId ?? ''),
    queryFn: () => creativesApi.mine(),
    enabled: Boolean(userId),
  });
}

/**
 * A linked creative's presigned media URL (GET /api/creatives/:id/url) — the Validation-step Spot
 * preview. Idle until an id is known. The presigned URL is short-lived, so this leans on React
 * Query's default staleness (a re-render after expiry refetches) rather than caching it forever.
 */
export function useCreativePreviewUrl(creativeId: string | null) {
  return useQuery({
    queryKey: campaignsKeys.creativeUrl(creativeId ?? ''),
    queryFn: () => creativesApi.presignedUrl(creativeId as string),
    enabled: Boolean(creativeId),
  });
}

/** Multipart upload (POST /api/creatives). Seeds the detail cache + refreshes the library list. */
export function useCreativeUpload(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadCreativeInput) => creativesApi.upload(input),
    onSuccess: (creative: CreativeView) => {
      queryClient.setQueryData(campaignsKeys.creative(creative.id), creative);
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.myCreatives(userId ?? '') });
    },
  });
}
