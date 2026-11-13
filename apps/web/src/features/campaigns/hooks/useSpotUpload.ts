import type { ChangeEvent } from 'react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useCreativeUpload } from '@/features/campaigns/hooks/useCreativeApi';
import {
  VIDEO_DURATION_MESSAGE,
  isClassicVideoDurationValid,
} from '@/features/campaigns/lib/spot-duration';
import {
  creativeUploadErrorMessage,
  readVideoDurationSeconds,
  unreadableVideoMessage,
} from '@/features/campaigns/services/creative-media';
import type { CreativeType } from '@/features/campaigns/services/creatives.api';
import { EVENT_VIDEO_MIN_SECONDS } from '@/features/events/lib/event-minutes';
import {
  EVENT_SPOT_MAX_SECONDS,
  EVENT_SPOT_TOO_LONG_MESSAGE,
} from '@/features/events/lib/event-positioning';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'useSpotUpload' });

export const PHOTO_DURATIONS = [10, 20, 30] as const;
export type PhotoDuration = (typeof PHOTO_DURATIONS)[number];

interface UseSpotUploadOptions {
  draftCampaignId: string | null;
  userId: string | undefined;
  /** EV3 — the Foot parcours: a video lasts 10–30 s and the server re-checks it (for_event). */
  eventMode: boolean;
  /** Link the uploaded creative onto the draft — owned by the step's orchestrator. */
  onSelectCreative: (creativeId: string) => void | Promise<void>;
}

/**
 * The spot upload of the Création steps (the classic wizard's and the Foot parcours'), ONE home:
 * the type and photo-duration choice, the client probe of a video's length, the multipart upload
 * (POST /api/creatives) and the link of the new creative onto the draft.
 */
export function useSpotUpload({
  draftCampaignId,
  userId,
  eventMode,
  onSelectCreative,
}: UseSpotUploadOptions) {
  const upload = useCreativeUpload(userId);
  const [uploadType, setUploadType] = useState<CreativeType>('video');
  const [photoDuration, setPhotoDuration] = useState<PhotoDuration>(20);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draftCampaignId) return;

    let durationSeconds: number;
    if (uploadType === 'video') {
      const probed = await readVideoDurationSeconds(file);
      if (probed == null) {
        // UPL-2 — a photo or a PDF picked under « Vidéo » stops here, before any upload: its
        // bytes name the kind (and the type to choose) instead of a duration error.
        toast.error(await unreadableVideoMessage(file));
        return;
      }
      // EVT-MIN1 (events) / SPOT-MIN1 (classic, Mariem 27/10): a video lasts 10 to 30 s.
      const validLength = eventMode
        ? probed >= EVENT_VIDEO_MIN_SECONDS && probed <= EVENT_SPOT_MAX_SECONDS
        : isClassicVideoDurationValid(probed);
      if (!validLength) {
        toast.error(eventMode ? EVENT_SPOT_TOO_LONG_MESSAGE : VIDEO_DURATION_MESSAGE);
        return;
      }
      durationSeconds = Math.max(1, probed);
    } else {
      durationSeconds = photoDuration;
    }

    try {
      const created = await upload.mutateAsync({
        file,
        type: uploadType,
        duration_seconds: durationSeconds,
        title: file.name,
        // EV3 — the server re-checks the event range on its own measured duration.
        ...(eventMode ? { for_event: true } : {}),
      });
      toast.success('Création téléversée avec succès.');
      await onSelectCreative(created.id);
    } catch (error) {
      log.error({ err: error }, 'creative upload failed');
      // CF-SH1 — the server's hardening rejections get their French copy; anything else keeps
      // the generic fallback.
      toast.error(
        creativeUploadErrorMessage(error) ??
          (getErrorMessage(error) || 'Erreur lors du téléversement de la création.'),
      );
    }
  };

  return {
    uploadType,
    setUploadType,
    photoDuration,
    setPhotoDuration,
    handleFile,
    uploading: upload.isPending,
  };
}
