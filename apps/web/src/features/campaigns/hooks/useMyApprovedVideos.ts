import { useQuery } from '@tanstack/react-query';

import type { ApprovedVideo } from '@/features/campaigns/pages/new-campaign/Step5';
import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

/**
 * The signed-in advertiser's approved videos — the campaign wizard's
 * existing-spot picker source (`Step5`, consumed via `NewCampaign`).
 *
 * Commit 7b — one of the five `NewCampaign` raw-Supabase reads folded in from
 * 7a's CF-10 §5.1 finding. The former `loadMyApprovedVideos` resolved the user
 * via `supabase.auth.getUser`; the userId is now passed by the caller (the
 * auth store already holds it). `NewCampaign` mirrors this query into local
 * state because `Step5` patches a row's `duration_seconds` after a successful
 * duration write (per-page mirror discrimination — a local mutating handler
 * exists).
 */
export function useMyApprovedVideos(userId: string | undefined): {
  videos: ApprovedVideo[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.myApprovedVideos(userId ?? ''),
    queryFn: async (): Promise<ApprovedVideo[]> => {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('uploaded_by', userId as string)
        .eq('validation_status', 'approved')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
  });

  return {
    videos: query.data ?? [],
    loading: query.isLoading,
  };
}
