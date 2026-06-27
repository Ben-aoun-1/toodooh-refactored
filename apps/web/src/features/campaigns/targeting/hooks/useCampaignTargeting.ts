import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';

import { type TargetingLineWire } from '../lib/targeting-lines';
import { type TargetingLineRow, targetingService } from '../services/targeting.service';

/**
 * A campaign's audience targeting (L-target). Loads the persisted lines (GET) and saves the full set
 * (PUT replace-set). `campaignId` may be null — the query then stays idle so the builder is usable on
 * a not-yet-persisted campaign (local-only) until a real draft id is available.
 */
export function useCampaignTargeting(campaignId: string | null) {
  const queryClient = useQueryClient();
  const key = campaignsKeys.targeting(campaignId ?? '');

  const query = useQuery({
    queryKey: key,
    queryFn: () => targetingService.get(campaignId as string),
    enabled: Boolean(campaignId),
  });

  const mutation = useMutation({
    mutationFn: (lines: TargetingLineWire[]) => targetingService.save(campaignId as string, lines),
    onSuccess: (rows: TargetingLineRow[]) => {
      queryClient.setQueryData(key, rows);
    },
  });

  return {
    rows: query.data ?? [],
    isLoading: Boolean(campaignId) && query.isLoading,
    isError: query.isError,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    isSaved: mutation.isSuccess,
    saveError: mutation.error,
  };
}
