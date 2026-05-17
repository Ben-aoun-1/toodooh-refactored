import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminVideoService } from '@/features/admin/services/admin-video.service';
import type { Video, VideoValidationStats } from '@/features/admin/types/video';

import { adminKeys } from './queryKeys';

type VideoStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

/** The video-validation list, filtered by status. */
export function useVideos(statusFilter: VideoStatusFilter): {
  videos: Video[];
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: adminKeys.videos(statusFilter),
    queryFn: () => adminVideoService.getVideos(statusFilter),
  });
  return {
    videos: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

/** Video-validation counters. */
export function useVideoStats(): { stats: VideoValidationStats | undefined } {
  const query = useQuery({
    queryKey: adminKeys.videoStats(),
    queryFn: () => adminVideoService.getValidationStats(),
  });
  return { stats: query.data };
}

interface VideoDecisionInput {
  videoId: string;
  adminId: string;
}

/**
 * Video approve / reject mutations. The service methods return a `boolean`
 * (they do not throw on a soft failure), so `onSuccess` invalidates only when
 * the decision actually landed. Invalidation is intra-feature: the video list
 * (every status variant — prefix-matched) + the validation counters. The
 * advertiser/owner campaign views that depend on video approval have no React
 * Query consumer yet (Commit 7 owns them) — no cross-feature key exists.
 */
export function useVideoMutations() {
  const queryClient = useQueryClient();

  const invalidateVideoViews = () => {
    queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'videos'] });
    queryClient.invalidateQueries({ queryKey: adminKeys.videoStats() });
  };

  const approveVideo = useMutation({
    mutationFn: ({ videoId, adminId }: VideoDecisionInput) =>
      adminVideoService.approveVideo(videoId, adminId),
    onSuccess: (success) => {
      if (success) invalidateVideoViews();
    },
  });

  const rejectVideo = useMutation({
    mutationFn: ({ videoId, adminId }: VideoDecisionInput) =>
      adminVideoService.rejectVideo(videoId, adminId),
    onSuccess: (success) => {
      if (success) invalidateVideoViews();
    },
  });

  return { approveVideo, rejectVideo };
}
