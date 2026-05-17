import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

/**
 * A `videos` row, with the fields the campaign pages render. `duration` and
 * `duration_seconds` are both optional — the column set varies across
 * environments and the inherited UI reads `duration`.
 */
export interface VideoRecord {
  id: string;
  filename: string;
  url: string;
  validation_status: string;
  duration_seconds?: number | null;
  duration?: number | null;
}

/**
 * A single `videos` row by id (Commit 7b).
 *
 * CF-13 first-amendment consolidation: four pages ran the identical
 * `supabase.from('videos').select('*').eq('id', …).single()` read inline —
 * `CampaignDetails`, `MyCampaigns` (detail modal), `OwnerCampaigns` (detail
 * drawer) and `NewCampaign` (edit-mode existing video). One `queryFn`
 * identity → one hook, four consumers. A missing row resolves to `null`
 * (every former call site tolerated absence), so the query never errors out
 * its consumer.
 */
export function useVideoById(videoId: string | null | undefined): {
  video: VideoRecord | null;
  loading: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.video(videoId ?? ''),
    queryFn: async (): Promise<VideoRecord | null> => {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('id', videoId as string)
        .single();
      if (error) return null;
      return data;
    },
    enabled: Boolean(videoId),
  });

  return {
    video: query.data ?? null,
    loading: query.isLoading,
  };
}
