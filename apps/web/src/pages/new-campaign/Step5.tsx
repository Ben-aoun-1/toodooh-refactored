import { ArrowRight, CheckCircle, Info, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { getErrorMessage } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  readVideoDurationFromFile,
  readVideoDurationFromUrl,
  type UploadProgress,
  videoUploadService,
} from '../../services/video-upload.service';

const log = logger.child({ module: 'Step5' });

const MAX_VIDEO_DURATION_SECONDS = 30;

// Minimal slice of the `videos` row that Step 5 reads. The parent currently
// types its myApprovedVideos cache as any[]; tightening that to
// ApprovedVideo[] across the file is Commit 12 cleanup work.
export interface ApprovedVideo {
  id: string;
  url: string;
  filename: string;
  duration_seconds: number | null;
}

interface Step5Props {
  // WizardState slice
  uploadedVideoId: string;
  uploadedVideoUrl: string;
  existingVideoId: string | null;
  setUploadedVideoId: (value: string) => void;
  setUploadedVideoUrl: (value: string) => void;
  setExistingVideoId: (value: string | null) => void;
  // Server data (loaded + owned by parent — multiple consumers via
  // `selectedExistingVideo` memo: DOOH estimate, saveDraft, cart actions,
  // Step 6 recap). Step 5 only renders + patches duration_seconds.
  myApprovedVideos: ApprovedVideo[];
  selectedExistingVideo: ApprovedVideo | null;
  setMyApprovedVideos: React.Dispatch<React.SetStateAction<ApprovedVideo[]>>;
  // Navigation
  onNext: () => boolean;
  onBack: () => void;
}

/**
 * Step 5 of the standard advertiser campaign wizard (also Step 2 in the
 * event-campaign flow): video upload + existing-video selection. Owns the
 * upload flow (handleVideoUpload), the existing-video picker
 * (handleSelectExistingVideo), and the transient local state
 * (selectedVideo / uploading / uploadProgress).
 *
 * Extracted from NewCampaign.tsx (formerly lines ~1563-1690 JSX block plus
 * handleVideoUpload / handleSelectExistingVideo / MAX_VIDEO_DURATION_SECONDS
 * and the selectedVideo / uploading / uploadProgress useState slots).
 *
 * Note: myApprovedVideos cache and selectedExistingVideo memo stay in the
 * parent because they have parent-level consumers (DOOH estimate effect,
 * saveDraft, cart create) — Step 5 receives them as props.
 */
export default function Step5({
  uploadedVideoId: _uploadedVideoId,
  uploadedVideoUrl,
  existingVideoId: _existingVideoId,
  setUploadedVideoId,
  setUploadedVideoUrl,
  setExistingVideoId,
  myApprovedVideos,
  selectedExistingVideo,
  setMyApprovedVideos,
  onNext,
  onBack,
}: Step5Props) {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const handleVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const durationSeconds = await readVideoDurationFromFile(file);
      if (durationSeconds != null && durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        toast.error(
          'La vidéo ne doit pas dépasser 30 secondes. Veuillez choisir une vidéo plus courte.',
        );
        event.target.value = '';
        return;
      }

      setUploading(true);
      setSelectedVideo(file);
      setExistingVideoId(null);

      const result = await videoUploadService.uploadVideo(file, (progress) => {
        setUploadProgress(progress);
      });

      setUploadedVideoUrl(result.url);

      const videoEntry = await videoUploadService.createVideoEntry(
        result.url,
        result.path,
        file.name,
        file.size,
        durationSeconds,
      );
      setUploadedVideoId(videoEntry.id);

      if ((durationSeconds == null || durationSeconds <= 0) && result.url) {
        const fromUrl = await readVideoDurationFromUrl(result.url);
        if (fromUrl != null) {
          try {
            await videoUploadService.updateVideoDurationSeconds(videoEntry.id, fromUrl);
          } catch {
            /* colonne absente ou RLS : le moteur DOOH utilisera la durée par défaut */
          }
        }
      }

      toast.success('Vidéo uploadée avec succès !');
    } catch (error) {
      toast.error(getErrorMessage(error) || "Erreur lors de l'upload");
      setSelectedVideo(null);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleSelectExistingVideo = (id: string) => {
    if (!id) {
      setExistingVideoId(null);
      setUploadedVideoId('');
      setUploadedVideoUrl('');
      return;
    }

    const video = myApprovedVideos.find((v) => v.id === id);
    if (!video) return;

    const ds = Number(video.duration_seconds);
    if (Number.isFinite(ds) && ds > MAX_VIDEO_DURATION_SECONDS) {
      toast.error('La vidéo ne doit pas dépasser 30 secondes. Veuillez en sélectionner une autre.');
      setExistingVideoId(null);
      setUploadedVideoId('');
      setUploadedVideoUrl('');
      return;
    }

    setExistingVideoId(video.id);
    setUploadedVideoId(video.id);
    setUploadedVideoUrl(video.url);
    setSelectedVideo(null);
    toast.success('Vidéo sélectionnée !');

    if (video.url && (!Number.isFinite(ds) || ds <= 0)) {
      void (async () => {
        const d = await readVideoDurationFromUrl(video.url);
        if (d == null) return;
        if (d > MAX_VIDEO_DURATION_SECONDS) {
          toast.error(
            'La vidéo ne doit pas dépasser 30 secondes. Veuillez en sélectionner une autre.',
          );
          setExistingVideoId(null);
          setUploadedVideoId('');
          setUploadedVideoUrl('');
          return;
        }
        try {
          await videoUploadService.updateVideoDurationSeconds(video.id, d);
          const patched: ApprovedVideo = { ...video, duration_seconds: d };
          setMyApprovedVideos((prev) => prev.map((v) => (v.id === video.id ? patched : v)));
        } catch (err) {
          log.error({ err }, 'Failed to patch video duration_seconds');
        }
      })();
    }
  };

  const handleNext = () => {
    if (!uploadedVideoUrl && !selectedExistingVideo) {
      toast.error('Veuillez sélectionner ou uploader une vidéo avant de continuer.');
      return;
    }
    onNext();
  };

  const nextDisabled = !uploadedVideoUrl && !selectedExistingVideo;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Contenu média</h2>
          <p className="text-gray-500 mt-1">
            Sélectionnez ou uploadez votre spot publicitaire
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Spot publicitaire — sélection existant */}
          <div>
            <label
              htmlFor="step5-existing-video"
              className="block text-sm font-bold text-gray-900 mb-2"
            >
              Spot publicitaire
            </label>
            <select
              id="step5-existing-video"
              value={selectedExistingVideo?.id ?? ''}
              onChange={(e) => handleSelectExistingVideo(e.target.value)}
              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-xl bg-gray-50 text-gray-700 focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent cursor-pointer"
            >
              <option value="">Sélectionner un spot existant</option>
              {myApprovedVideos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.filename}
                </option>
              ))}
            </select>
          </div>

          {/* Zone upload — ou uploadez un nouveau spot */}
          {uploading ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-gray-50/50">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#00B3A6] border-t-transparent mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">Upload en cours...</p>
              {uploadProgress && (
                <div className="max-w-xs mx-auto mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-[#00B3A6] h-1.5 rounded-full transition-all"
                      style={{ width: `${uploadProgress.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{uploadProgress.message}</p>
                </div>
              )}
            </div>
          ) : selectedVideo && uploadedVideoUrl && !selectedExistingVideo ? (
            <div className="space-y-3">
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 bg-green-50/50">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">
                        {selectedVideo.name}
                      </p>
                      <p className="text-xs text-gray-600">
                        {(selectedVideo.size / 1024 / 1024).toFixed(2)} MB · Uploadée avec
                        succès
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVideo(null);
                      setUploadedVideoUrl('');
                      setUploadedVideoId('');
                    }}
                    className="text-sm text-[#00B3A6] hover:underline font-medium"
                  >
                    Changer
                  </button>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
                <video src={uploadedVideoUrl} controls className="w-full max-h-80" />
              </div>
            </div>
          ) : (
            <label className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-[#00B3A6]/50 hover:bg-gray-50/50 transition-colors cursor-pointer">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#00B3A6]/15 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-[#00B3A6]" />
                </div>
                <p className="font-bold text-gray-900">Ou uploadez un nouveau spot</p>
                <p className="text-sm text-gray-500">
                  Formats acceptés : MP4, MOV (max 100MB)
                </p>
                <span className="inline-flex items-center px-4 py-2.5 mt-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50">
                  Parcourir les fichiers
                </span>
              </div>
              <input
                type="file"
                className="sr-only"
                accept="video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov"
                onChange={handleVideoUpload}
              />
            </label>
          )}

          {/* Spécifications techniques */}
          <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
              <Info className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 mb-2">
                Spécifications techniques
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>Format : 16:9 (1920×1080px minimum)</li>
                <li>Durée : 30 secondes maximum</li>
                <li>Format vidéo : MP4 (H.264)</li>
              </ul>
            </div>
          </div>

          {/* Aperçu si spot existant sélectionné */}
          {selectedExistingVideo && (
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
              <video src={selectedExistingVideo.url} controls className="w-full max-h-80" />
            </div>
          )}
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
          disabled={nextDisabled}
          className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
            nextDisabled
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-[#00B3A6] to-[#00D4C4] text-white hover:from-[#00A396] hover:to-[#00C4B4]'
          }`}
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
