import {
  ArrowRight,
  CheckCircle,
  Film,
  Image as ImageIcon,
  Info,
  Loader2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useCreativeUpload, useMyCreatives } from '@/features/campaigns/hooks/useCreativeApi';
import { readVideoDurationSeconds } from '@/features/campaigns/services/creative-media';
import type { CreativeType, CreativeView } from '@/features/campaigns/services/creatives.api';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'StepCreative' });

const MAX_VIDEO_DURATION_SECONDS = 30;
const PHOTO_DURATIONS = [10, 20, 30] as const;
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const STATUS_LABEL: Record<string, string> = {
  pending: 'En attente de validation',
  approved: 'Validée',
  rejected: 'Refusée',
};
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
};

interface StepCreativeProps {
  draftCampaignId: string | null;
  userId: string | undefined;
  /** The currently linked creative id (mirrors campaigns.creative_id). */
  selectedCreativeId: string | null;
  /** Link a creative onto the draft (PATCH creative_id) — owned by the orchestrator. */
  onSelectCreative: (creativeId: string) => void | Promise<void>;
  /** True while the link PATCH is in flight (disables the picker). */
  linking: boolean;
  onNext: () => void | Promise<void>;
  onBack: () => void;
}

/**
 * Creative step of the de-Supabase wizard (L-spot). Uploads a VIDEO or PHOTO creative via the REST
 * library (multipart POST /api/creatives) and links the chosen creative onto the draft
 * (PATCH /api/campaigns/:id { creative_id }) — replacing the legacy Supabase video upload. Video
 * duration is probed client-side (≤30s); a photo's diffusion duration is chosen from {10,20,30}s.
 */
export default function StepCreative({
  draftCampaignId,
  userId,
  selectedCreativeId,
  onSelectCreative,
  linking,
  onNext,
  onBack,
}: StepCreativeProps) {
  const { data: creatives = [], isLoading } = useMyCreatives(userId);
  const upload = useCreativeUpload(userId);

  const [uploadType, setUploadType] = useState<CreativeType>('video');
  const [photoDuration, setPhotoDuration] = useState<(typeof PHOTO_DURATIONS)[number]>(20);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draftCampaignId) return;

    let durationSeconds: number;
    if (uploadType === 'video') {
      const probed = await readVideoDurationSeconds(file);
      if (probed == null) {
        toast.error('Impossible de lire la durée de la vidéo. Réessayez avec un fichier MP4.');
        return;
      }
      if (probed > MAX_VIDEO_DURATION_SECONDS) {
        toast.error('La vidéo ne doit pas dépasser 30 secondes.');
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
      });
      toast.success('Création téléversée avec succès.');
      await onSelectCreative(created.id);
    } catch (error) {
      log.error({ err: error }, 'creative upload failed');
      toast.error(getErrorMessage(error) || 'Erreur lors du téléversement de la création.');
    }
  };

  const handleNext = () => {
    if (!selectedCreativeId) {
      toast.error('Sélectionnez ou téléversez une création avant de continuer.');
      return;
    }
    void onNext();
  };

  const accept = uploadType === 'video' ? VIDEO_ACCEPT : PHOTO_ACCEPT;
  const busy = upload.isPending || linking;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-[#00263A]">Création</h2>
          <p className="text-gray-600 mt-1">Téléversez ou choisissez le visuel à diffuser</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Type + photo-duration selector */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">Type de création</span>
              <div className="inline-flex rounded-xl border border-gray-200 p-1">
                <button
                  type="button"
                  onClick={() => setUploadType('video')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    uploadType === 'video' ? 'bg-brand-primary text-white' : 'text-gray-600'
                  }`}
                >
                  <Film className="h-4 w-4" /> Vidéo
                </button>
                <button
                  type="button"
                  onClick={() => setUploadType('photo')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    uploadType === 'photo' ? 'bg-brand-primary text-white' : 'text-gray-600'
                  }`}
                >
                  <ImageIcon className="h-4 w-4" /> Photo
                </button>
              </div>
            </div>
            {uploadType === 'photo' && (
              <div>
                <label
                  htmlFor="creative-photo-duration"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Durée de diffusion
                </label>
                <select
                  id="creative-photo-duration"
                  value={photoDuration}
                  onChange={(e) =>
                    setPhotoDuration(Number(e.target.value) as (typeof PHOTO_DURATIONS)[number])
                  }
                  className="px-4 py-2 text-sm border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-brand-primary focus:border-transparent"
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

          {/* Upload dropzone */}
          {busy ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-gray-50/50">
              <Loader2 className="h-8 w-8 text-brand-primary animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">
                {upload.isPending ? 'Téléversement…' : 'Association à la campagne…'}
              </p>
            </div>
          ) : (
            <label
              className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-brand-primary/50 hover:bg-gray-50/50 transition-colors cursor-pointer"
              aria-label="Téléverser une nouvelle création"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-brand-primary/15 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-brand-primary" />
                </div>
                <p className="font-bold text-gray-900">Téléverser une nouvelle création</p>
                <p className="text-sm text-gray-500">
                  {uploadType === 'video'
                    ? 'MP4, WebM ou MOV · 30 secondes maximum'
                    : 'JPEG, PNG ou WebP'}
                </p>
                <span className="inline-flex items-center px-4 py-2.5 mt-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50">
                  Parcourir les fichiers
                </span>
              </div>
              <input type="file" className="sr-only" accept={accept} onChange={handleFile} />
            </label>
          )}

          {/* Library picker */}
          <div>
            <p className="text-sm font-bold text-gray-900 mb-2">Vos créations</p>
            {isLoading ? (
              <div className="flex items-center gap-2 text-gray-400 py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Chargement de vos créations…</span>
              </div>
            ) : creatives.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                Aucune création pour le moment. Téléversez votre premier spot ci-dessus.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {creatives.map((creative: CreativeView) => {
                  const isSelected = creative.id === selectedCreativeId;
                  return (
                    <button
                      key={creative.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void onSelectCreative(creative.id)}
                      className={`relative text-left p-4 rounded-xl border-2 transition-all disabled:opacity-60 ${
                        isSelected
                          ? 'border-brand-primary bg-brand-primary/5'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {isSelected && (
                        <CheckCircle className="absolute top-3 right-3 h-5 w-5 text-brand-primary" />
                      )}
                      <div className="flex items-center gap-2 mb-1">
                        {creative.creative_type === 'video' ? (
                          <Film className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ImageIcon className="h-4 w-4 text-gray-500" />
                        )}
                        <span className="font-medium text-gray-900 text-sm truncate">
                          {creative.title || creative.original_filename || 'Création'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{creative.duration_seconds ?? '—'}s</span>
                        <span
                          className={`px-2 py-0.5 rounded-full font-medium ${
                            STATUS_STYLE[creative.validation_status] ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {STATUS_LABEL[creative.validation_status] ?? creative.validation_status}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
              <Info className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 mb-2">Spécifications</p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>Vidéo : 30 secondes maximum (MP4 / WebM / MOV)</li>
                <li>Photo : durée de diffusion 10, 20 ou 30 secondes (JPEG / PNG / WebP)</li>
                <li>Votre création sera validée par notre équipe avant diffusion</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!selectedCreativeId || busy}
          className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
            !selectedCreativeId || busy
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-brand-primary to-brand-deep text-white hover:from-brand-primary/90 hover:to-brand-deep'
          }`}
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
