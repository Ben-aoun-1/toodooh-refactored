import { Film, Play } from 'lucide-react';
import { useRef, useState } from 'react';

import { formatDurationClock } from '@/features/campaigns/lib/campaign-summary';
import type { CreativeType } from '@/features/campaigns/services/creatives.api';

interface CreativePreviewTileProps {
  creativeType: CreativeType | undefined;
  title: string | null;
  durationSeconds: number | null;
  /** Presigned media URL (GET /api/creatives/:id/url). Undefined while loading. */
  url: string | undefined;
  isLoading: boolean;
}

/**
 * A 16:9 preview tile for the linked creative on the Validation step. A video shows its poster frame
 * with a centered play overlay (title bottom-left, duration bottom-right, as mocked) — clicking plays
 * it inline with native controls, so the overlay is honest, not decorative. Media is CONTAINED (CF-HF4).
 * The media URL is the existing presigned read (no new player dependency).
 */
export default function CreativePreviewTile({
  creativeType,
  title,
  durationSeconds,
  url,
  isLoading,
}: CreativePreviewTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const shellClass =
    'relative aspect-video w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-900';

  if (isLoading || !url) {
    return (
      <div className={`${shellClass} flex items-center justify-center bg-gray-100`}>
        <Film className={`h-8 w-8 text-gray-300 ${isLoading ? 'animate-pulse' : ''}`} />
      </div>
    );
  }

  if (creativeType === 'photo') {
    return (
      <div className={shellClass}>
        {/* CF-HF4 — contained, never cropped/stretched: the 16:9 shell letterboxes any ratio. */}
        <img
          src={url}
          alt={title ?? 'Création'}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>
    );
  }

  const startPlayback = () => {
    setPlaying(true);
    void videoRef.current?.play();
  };

  return (
    <div className={shellClass}>
      <video
        ref={videoRef}
        // #t=0.1 nudges the browser to paint the first frame as a poster without a separate image.
        src={`${url}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        controls={playing}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {!playing && (
        <button
          type="button"
          onClick={startPlayback}
          aria-label="Lire l’aperçu du spot"
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/50 via-transparent to-transparent transition-colors hover:from-black/60"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/85 shadow-lg">
            <Play className="ml-0.5 h-6 w-6 fill-brand-deep text-brand-deep" />
          </span>
        </button>
      )}
      {!playing && (
        <>
          <span className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] truncate text-sm font-semibold text-white drop-shadow">
            {title ?? 'Spot publicitaire'}
          </span>
          <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDurationClock(durationSeconds)}
          </span>
        </>
      )}
    </div>
  );
}
