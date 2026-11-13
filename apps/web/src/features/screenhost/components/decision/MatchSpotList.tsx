import { Film, Play } from 'lucide-react';
import { useRef, useState } from 'react';

import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';
import DecisionSection from '@/features/screenhost/components/decision/DecisionSection';
import { useEventAllocationCreativeUrl } from '@/features/screenhost/hooks/useScreenhostEventAllocations';
import {
  matchSpotsHeading,
  spotDurationLabel,
  spotName,
} from '@/features/screenhost/lib/match-decision';
import type { EventMatchSpot } from '@/features/screenhost/services/screenhost-event-matches.service';

const CHIP_COLORS = ['bg-brand-primary', 'bg-brand-accent', 'bg-rose-300'] as const;

/** One spot's 16:9 thumbnail: the poster frame (or the photo), its number and its length. */
function SpotThumb({ spot, index }: { spot: EventMatchSpot; index: number }) {
  const media = useEventAllocationCreativeUrl(spot.allocation_id, Boolean(spot.creative));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const isPhoto = spot.creative?.kind === 'photo';

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-gray-800 to-gray-950">
      {media.url && isPhoto ? (
        <img
          src={media.url}
          alt={spotName(spot.creative, index)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : media.url ? (
        <video
          ref={videoRef}
          // #t=0.1 paints the first frame as a poster without a separate image.
          src={`${media.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          controls={playing}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <Film className={`h-5 w-5 text-gray-500 ${media.isLoading ? 'animate-pulse' : ''}`} />
        </span>
      )}
      {!playing && (
        <>
          <span
            className={`absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-brand-deep ${
              CHIP_COLORS[index % CHIP_COLORS.length]
            }`}
          >
            {index + 1}
          </span>
          {media.url && !isPhoto ? (
            <button
              type="button"
              onClick={() => {
                setPlaying(true);
                void videoRef.current?.play();
              }}
              aria-label={`Lire ${spotName(spot.creative, index)}`}
              className="absolute inset-0 flex items-center justify-center"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90">
                <Play className="ml-0.5 h-3.5 w-3.5 fill-brand-deep text-brand-deep" />
              </span>
            </button>
          ) : null}
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[9px] font-semibold text-white">
            {spotDurationLabel(spot.creative?.duration_seconds ?? null)}
          </span>
        </>
      )}
    </div>
  );
}

/** The one spot of a match, large (the mockup's single-spot example). */
function SingleSpot({ spot }: { spot: EventMatchSpot }) {
  const media = useEventAllocationCreativeUrl(spot.allocation_id, Boolean(spot.creative));
  return (
    <CreativePreviewTile
      creativeType={spot.creative?.kind}
      title={spotName(spot.creative, 0)}
      durationSeconds={spot.creative?.duration_seconds ?? null}
      url={media.url}
      isLoading={media.isLoading}
    />
  );
}

/**
 * Mariem 05/11 — « Spots à diffuser (n) »: each spot of the match at this venue, numbered, with its
 * thumbnail, name and length; a single spot shows large.
 */
export default function MatchSpotList({ spots }: { spots: readonly EventMatchSpot[] }) {
  const [first] = spots;
  return (
    <DecisionSection label={matchSpotsHeading(spots.length)}>
      {spots.length === 1 && first ? (
        <SingleSpot spot={first} />
      ) : (
        <div className="grid gap-2.5">
          {spots.map((spot, index) => (
            <div
              key={spot.allocation_id}
              className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[#EBEBEB] p-2"
            >
              <SpotThumb spot={spot} index={index} />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#171717]">
                  {spotName(spot.creative, index)}
                </p>
                <p className="mt-0.5 text-[11px] text-[#5C5C5C]">
                  Durée{' '}
                  <b className="font-medium text-[#171717]">
                    {spotDurationLabel(spot.creative?.duration_seconds ?? null)}
                  </b>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </DecisionSection>
  );
}
