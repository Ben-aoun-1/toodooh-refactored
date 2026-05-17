import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  videoUploadService,
  type UploadProgress,
} from '@/features/campaigns/services/video-upload.service';

interface UploadVideoInput {
  file: File;
  onProgress?: (progress: UploadProgress) => void;
}

interface CreateVideoEntryInput {
  videoUrl: string;
  videoPath: string;
  filename: string;
  fileSize?: number;
  durationSeconds?: number | null;
}

interface UpdateVideoDurationInput {
  videoId: string;
  durationSeconds: number;
}

/** Minimal slice of the `videos` row `createVideoEntry` returns. */
export interface CreatedVideo {
  id: string;
}

/**
 * Campaign-wizard video-upload write mutations (`Step5`, Commit 7a).
 *
 * Per CF-13's first amendment the three distinct service methods —
 * `uploadVideo`, `createVideoEntry`, `updateVideoDurationSeconds` — each have
 * their own mutationFn identity, so they are three `useMutation`s. `Step5`'s
 * handlers orchestrate them in sequence via `mutateAsync`; the transient
 * upload UI (`uploading` / `uploadProgress` / `selectedVideo`) stays as local
 * component state.
 *
 * CF-14 invalidation graph:
 * - `uploadVideo` writes only to Storage (no table row) — nothing to
 *   invalidate.
 * - `createVideoEntry` inserts a `videos` row with `validation_status:
 *   'pending'` and `updateVideoDuration` patches that row. Both reach, as
 *   (b) cross-session cross-role, the admin `VideoManagement` moderation
 *   queue — `adminKeys.videos(*)` (every status bucket, prefix-invalidated)
 *   and `adminKeys.videoStats()`. No-op against the admin's uncached session;
 *   kept for intent. There is no (a) within-session reader: `NewCampaign`'s
 *   `myApprovedVideos` cache lists only *approved* videos and a freshly
 *   created entry is `pending`.
 */
export function useVideoUploadMutations() {
  const queryClient = useQueryClient();

  // (b) every admin VideoManagement status bucket — `adminKeys.videos` keys
  // on a status arg, so invalidate the shared `[...'admin', 'videos']` prefix.
  const invalidateAdminVideos = () => {
    queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'videos'] });
    queryClient.invalidateQueries({ queryKey: adminKeys.videoStats() });
  };

  const uploadVideo = useMutation({
    mutationFn: ({ file, onProgress }: UploadVideoInput) =>
      videoUploadService.uploadVideo(file, onProgress),
  });

  const createVideoEntry = useMutation({
    mutationFn: async ({
      videoUrl,
      videoPath,
      filename,
      fileSize,
      durationSeconds,
    }: CreateVideoEntryInput): Promise<CreatedVideo> => {
      // `createVideoEntry` is typed `Promise<any>` at the (pre-existing,
      // untyped) service layer; narrowed here so no `any` escapes.
      const video: CreatedVideo = await videoUploadService.createVideoEntry(
        videoUrl,
        videoPath,
        filename,
        fileSize,
        durationSeconds,
      );
      return video;
    },
    onSuccess: invalidateAdminVideos,
  });

  const updateVideoDuration = useMutation({
    mutationFn: ({ videoId, durationSeconds }: UpdateVideoDurationInput) =>
      videoUploadService.updateVideoDurationSeconds(videoId, durationSeconds),
    onSuccess: invalidateAdminVideos,
  });

  return { uploadVideo, createVideoEntry, updateVideoDuration };
}
