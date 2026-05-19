-- Durée réelle de la vidéo (secondes), renseignée côté client après lecture des métadonnées du fichier.

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS duration_seconds double precision;

COMMENT ON COLUMN public.videos.duration_seconds IS 'Durée en secondes (métadonnées fichier), pour le moteur DOOH.';
