import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { getErrorMessage } from '../lib/errors';

const log = logger.child({ module: 'video-upload.service' });

export interface UploadProgress {
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  message?: string;
}

function tryReadVideoElementDuration(video: HTMLVideoElement): number | null {
  const d = video.duration;
  if (!Number.isFinite(d) || d <= 0 || d === Infinity) return null;
  return Math.round(d);
}

/** Lit la durée (secondes entières) depuis les métadonnées du fichier, navigateur uniquement. */
export async function readVideoDurationFromFile(file: File): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.setAttribute('playsinline', '');
    let settled = false;
    const done = (n: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.remove();
      resolve(n);
    };
    const tick = () => {
      const n = tryReadVideoElementDuration(video);
      if (n != null) done(n);
    };
    video.onloadedmetadata = tick;
    video.onloadeddata = tick;
    video.ondurationchange = tick;
    video.oncanplay = tick;
    video.onerror = () => done(null);
    video.src = url;
    video.load();
    window.setTimeout(() => done(tryReadVideoElementDuration(video)), 6000);
  });
}

/**
 * Durée depuis une URL (ex. URL signée après upload). Peut échouer si le navigateur ne peut pas charger les métadonnées.
 */
export async function readVideoDurationFromUrl(url: string): Promise<number | null> {
  if (typeof document === 'undefined' || !url?.trim()) return null;
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.setAttribute('playsinline', '');
    let settled = false;
    const done = (n: number | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.remove();
      resolve(n);
    };
    const tick = () => {
      const n = tryReadVideoElementDuration(video);
      if (n != null) done(n);
    };
    video.onloadedmetadata = tick;
    video.onloadeddata = tick;
    video.ondurationchange = tick;
    video.oncanplay = tick;
    video.onerror = () => done(null);
    video.src = url;
    video.load();
    window.setTimeout(() => done(tryReadVideoElementDuration(video)), 8000);
  });
}

export const videoUploadService = {
  // Upload une vidéo dans Supabase Storage
  async uploadVideo(
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<{ url: string; path: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non connecté');

      // Validation du fichier
      const maxSize = 100 * 1024 * 1024; // 100 MB
      if (file.size > maxSize) {
        throw new Error('Le fichier est trop volumineux (max 100 MB)');
      }

      const allowedTypes = [
        'video/mp4',
        'video/mpeg',
        'video/quicktime',
        'video/x-msvideo',
        'video/webm',
      ];
      if (!allowedTypes.includes(file.type)) {
        throw new Error('Type de fichier non supporté. Utilisez MP4, MOV, AVI ou WebM');
      }

      onProgress?.({ progress: 0, status: 'uploading', message: "Préparation de l'upload..." });

      // Créer un nom de fichier unique dans le dossier campaign-videos
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `campaign-videos/${user.id}_${fileName}`;

      // Upload le fichier dans le bucket 'media'
      const { data, error } = await supabase.storage.from('media').upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

      if (error) {
        throw error;
      }

      onProgress?.({ progress: 100, status: 'complete', message: 'Upload terminé' });

      // Récupérer une URL signée (valide 1 an) car le bucket est privé
      const { data: signedUrlData, error: signedError } = await supabase.storage
        .from('media')
        .createSignedUrl(filePath, 31536000); // 365 jours en secondes

      if (signedError) {
        log.error({ signedError }, 'Erreur création URL signée');
        // Fallback sur URL publique
        const {
          data: { publicUrl },
        } = supabase.storage.from('media').getPublicUrl(filePath);

        return {
          url: publicUrl,
          path: filePath,
        };
      }

      return {
        url: signedUrlData.signedUrl,
        path: filePath,
      };
    } catch (error) {
      log.error({ error }, "❌ Erreur lors de l'upload de la vidéo");
      onProgress?.({
        progress: 0,
        status: 'error',
        message: getErrorMessage(error) || "Erreur lors de l'upload",
      });
      throw error;
    }
  },

  // Supprimer une vidéo
  async deleteVideo(path: string): Promise<boolean> {
    try {
      const { error } = await supabase.storage.from('media').remove([path]);

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      throw error;
    }
  },

  // Récupérer l'URL d'une vidéo
  getVideoUrl(path: string): string {
    const {
      data: { publicUrl },
    } = supabase.storage.from('media').getPublicUrl(path);

    return publicUrl;
  },

  // Créer une entrée vidéo dans la table videos
  async createVideoEntry(
    videoUrl: string,
    videoPath: string,
    filename: string,
    fileSize?: number,
    durationSeconds?: number | null,
  ): Promise<any> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non connecté');

      const insertRow: Record<string, unknown> = {
        url: videoUrl,
        filename: filename,
        file_size: fileSize,
        uploaded_by: user.id,
        validation_status: 'pending',
      };
      if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
        insertRow.duration_seconds = durationSeconds;
      }

      let { data, error } = await supabase.from('videos').insert(insertRow).select().single();

      if (
        error &&
        insertRow.duration_seconds != null &&
        (error.code === '42703' || String(error.message).includes('duration_seconds'))
      ) {
        const { duration_seconds: _d, ...withoutDuration } = insertRow;
        const retry = await supabase.from('videos').insert(withoutDuration).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  /** Met à jour `duration_seconds` (ligne déjà créée). */
  async updateVideoDurationSeconds(videoId: string, durationSeconds: number): Promise<void> {
    if (!videoId || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
    const { error } = await supabase
      .from('videos')
      .update({ duration_seconds: Math.round(durationSeconds) })
      .eq('id', videoId);
    if (error) {
      log.warn({ message: error.message }, 'updateVideoDurationSeconds');
      throw error;
    }
  },
};
