-- =====================================================
-- FIX: Restaurer l'isolation des vidéos par annonceur
-- =====================================================

-- Supprimer l'ancienne vue
DROP VIEW IF EXISTS admin_videos_view CASCADE;

-- Recréer la vue avec DISTINCT pour éviter les doublons
CREATE OR REPLACE VIEW admin_videos_view AS
SELECT DISTINCT ON (v.id)
  v.id,
  v.url,
  v.filename,
  v.file_size,
  v.duration,
  v.thumbnail_url,
  v.validation_status,
  v.validated_by,
  v.validated_at,
  v.validation_notes,
  v.uploaded_by,
  v.created_at,
  v.updated_at,
  -- Informations de l'annonceur qui a uploadé
  bp.business_name AS uploaded_by_business,
  bp.contact_name AS uploaded_by_contact,
  -- Nombre de campagnes utilisant cette vidéo
  (SELECT COUNT(DISTINCT c2.id)::INTEGER 
   FROM campaigns c2 
   WHERE c2.video_id = v.id) AS campaigns_count,
  -- Noms des campagnes
  (SELECT STRING_AGG(DISTINCT c2.name, ', ') 
   FROM campaigns c2 
   WHERE c2.video_id = v.id) AS campaign_names
FROM videos v
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
ORDER BY v.id, v.created_at DESC;

-- Vérifier qu'il n'y a plus de doublons
SELECT 
  'Nombre de vidéos uniques:' as info,
  COUNT(DISTINCT id) as count
FROM admin_videos_view;

-- Vérifier la répartition par annonceur
SELECT 
  uploaded_by_business,
  COUNT(*) as nombre_videos
FROM admin_videos_view
GROUP BY uploaded_by_business
ORDER BY uploaded_by_business;

-- Vérifier les RLS (Row Level Security) sur la table videos
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'videos';

SELECT '✅ Vue recréée avec DISTINCT ON pour éviter les doublons' as status;













































