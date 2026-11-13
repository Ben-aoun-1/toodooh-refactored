import { Film, Image as ImageIcon, ImagePlus, Info, Loader2, Upload } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useMyCreatives } from '@/features/campaigns/hooks/useCreativeApi';
import {
  PHOTO_DURATIONS,
  type PhotoDuration,
  useSpotUpload,
} from '@/features/campaigns/hooks/useSpotUpload';
import SelectedSpotPreview from '@/features/campaigns/pages/new-campaign/SelectedSpotPreview';
import SpotCtaFields from '@/features/campaigns/pages/new-campaign/SpotCtaFields';
import { PHOTO_ACCEPT, VIDEO_ACCEPT } from '@/features/campaigns/services/creative-media';

import {
  EVENT_VIDEO_DROPZONE_HINT,
  EVENT_VIDEO_SPEC_LINE,
  filterEventSpots,
} from '../../lib/event-positioning';
import EventRepeatsNote from '../EventRepeatsNote';

import FootSpotLibrary from './FootSpotLibrary';
import PositioningCard from './PositioningCard';
import PositioningFooter from './PositioningFooter';

interface FootCreativeStepProps {
  draftCampaignId: string | null;
  userId: string | undefined;
  /** The linked creative (mirrors campaigns.creative_id). */
  selectedCreativeId: string | null;
  /** Link a creative onto the draft(s) — owned by the page. */
  onSelectCreative: (creativeId: string) => void | Promise<void>;
  onDeselectCreative: () => void | Promise<void>;
  /** True while the link PATCH is in flight. */
  linking: boolean;
  /** EVT-PLAY1 — the minutes bought so far, for the total-repeats line. */
  eventMinutes: number | null;
  onNext: () => void;
  onBack: () => void;
}

const TYPE_BUTTON = 'flex items-center gap-1.5 rounded-md px-4 py-2 text-sm transition-colors';
const typeButton = (on: boolean): string =>
  `${TYPE_BUTTON} ${on ? 'bg-stadium-cta font-medium text-pitch-ink' : 'text-pitch-grey hover:text-pitch-ink'}`;

/**
 * EV3 — the parcours' Création step, as Mariem drew it (04/11): the video/photo switch, the drop
 * zone, the spot playing in a TV frame, « Vos créations » (only the spots that fit a pod slot,
 * EVT-MIN1), the repeats line, the QR code and the specifications. The upload is the wizard's own
 * (hooks/useSpotUpload, with the event length range).
 */
export default function FootCreativeStep({
  draftCampaignId,
  userId,
  selectedCreativeId,
  onSelectCreative,
  onDeselectCreative,
  linking,
  eventMinutes,
  onNext,
  onBack,
}: FootCreativeStepProps) {
  const { data: allCreatives = [], isLoading } = useMyCreatives(userId);
  const creatives = filterEventSpots(allCreatives);
  const selected = creatives.find((c) => c.id === selectedCreativeId);
  const { uploadType, setUploadType, photoDuration, setPhotoDuration, handleFile, uploading } =
    useSpotUpload({ draftCampaignId, userId, eventMode: true, onSelectCreative });

  const accept = uploadType === 'video' ? VIDEO_ACCEPT : PHOTO_ACCEPT;
  const busy = uploading || linking;

  const handleNext = () => {
    if (!selectedCreativeId) {
      toast.error('Sélectionnez ou téléversez une création avant de continuer.');
      return;
    }
    onNext();
  };

  return (
    <>
      <PositioningCard
        icon={ImagePlus}
        title="Création"
        subtitle="Téléversez ou choisissez le visuel à diffuser"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-2 text-sm text-pitch-ink">Type de création</p>
              <div className="inline-flex gap-1 rounded-lg border border-pitch-line p-1">
                <button
                  type="button"
                  onClick={() => setUploadType('video')}
                  aria-pressed={uploadType === 'video'}
                  className={typeButton(uploadType === 'video')}
                >
                  <Film className="h-4 w-4" aria-hidden="true" />
                  Vidéo
                </button>
                <button
                  type="button"
                  onClick={() => setUploadType('photo')}
                  aria-pressed={uploadType === 'photo'}
                  className={typeButton(uploadType === 'photo')}
                >
                  <ImageIcon className="h-4 w-4" aria-hidden="true" />
                  Photo
                </button>
              </div>
            </div>
            {uploadType === 'photo' && (
              <div>
                <label htmlFor="foot-photo-duration" className="mb-2 block text-sm text-pitch-ink">
                  Durée de diffusion
                </label>
                <select
                  id="foot-photo-duration"
                  value={photoDuration}
                  onChange={(e) => setPhotoDuration(Number(e.target.value) as PhotoDuration)}
                  className="rounded-lg border border-pitch-line bg-white px-3 py-2 text-sm text-pitch-ink focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                >
                  {PHOTO_DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} secondes
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {busy ? (
            <div className="rounded-xl border-[1.5px] border-dashed border-brand-primary/60 bg-stadium-drop p-8 text-center">
              <Loader2
                className="mx-auto mb-3 h-8 w-8 animate-spin text-pitch-leaf"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-pitch-ink">
                {uploading ? 'Téléversement…' : 'Association à la campagne…'}
              </p>
            </div>
          ) : (
            <label
              aria-label="Téléverser une nouvelle création"
              className="block cursor-pointer rounded-xl border-[1.5px] border-dashed border-brand-primary/60 bg-stadium-drop p-8 text-center transition-colors hover:border-pitch-leaf"
            >
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-stadium-tile text-white">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-base font-semibold text-pitch-ink">
                Téléverser une nouvelle création
              </p>
              <p className="mt-2 text-sm text-pitch-grey">
                {uploadType === 'video' ? EVENT_VIDEO_DROPZONE_HINT : 'JPEG, PNG ou WebP'}
              </p>
              <span className="mt-3 inline-flex rounded-lg border border-pitch-line bg-white px-4 py-2 text-sm font-medium text-pitch-ink">
                Parcourir les fichiers
              </span>
              <input type="file" className="sr-only" accept={accept} onChange={handleFile} />
            </label>
          )}

          {selectedCreativeId && (
            <SelectedSpotPreview
              creativeId={selectedCreativeId}
              frameClassName="max-w-md rounded-xl border-[3px] border-white bg-stadium-tv shadow-lg shadow-pitch-ink/20 outline outline-2 outline-brand-primary"
            />
          )}

          <FootSpotLibrary
            creatives={creatives}
            isLoading={isLoading}
            selectedCreativeId={selectedCreativeId}
            busy={busy}
            onSelect={onSelectCreative}
            onDeselect={onDeselectCreative}
          />

          {selected && (
            <EventRepeatsNote
              creativeType={selected.creative_type}
              durationSeconds={selected.duration_seconds}
              minutes={eventMinutes}
            />
          )}

          {/* Mariem 04/11 (Foot point 1) — a Foot positioning takes a QR code too. Keyed by the
              spot: a new spot gets a new copy, so its state is read again instead of keeping the
              old spot's status. */}
          {draftCampaignId && selectedCreativeId && (
            <SpotCtaFields key={selectedCreativeId} campaignId={draftCampaignId} />
          )}

          <div className="flex gap-3 rounded-xl bg-stadium-spec p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-pitch-leaf" aria-hidden="true" />
            <div>
              <p className="mb-1.5 text-sm font-semibold text-pitch-ink">Spécifications</p>
              <ul className="space-y-1">
                <li className="text-sm text-pitch-ink">{EVENT_VIDEO_SPEC_LINE}</li>
                <li className="text-sm text-pitch-ink">
                  Photo : durée de diffusion 10, 20 ou 30 secondes (JPEG / PNG / WebP)
                </li>
                <li className="text-sm text-pitch-ink">
                  Votre création sera validée par notre équipe avant diffusion
                </li>
              </ul>
            </div>
          </div>
        </div>
      </PositioningCard>
      <PositioningFooter
        onBack={onBack}
        onNext={handleNext}
        nextLabel="Suivant"
        disabled={!selectedCreativeId || busy}
      />
    </>
  );
}
