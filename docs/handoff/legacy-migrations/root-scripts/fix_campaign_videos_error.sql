-- =====================================================
-- FIX: Supprimer les références à campaign_videos
-- =====================================================

-- 1. Supprimer la table campaign_videos si elle existe encore
DROP TABLE IF EXISTS campaign_videos CASCADE;

-- 2. Supprimer les triggers qui pourraient référencer campaign_videos
DROP TRIGGER IF EXISTS update_campaign_validation_on_video_change ON videos CASCADE;
DROP TRIGGER IF EXISTS update_campaign_validation_on_video_update ON videos CASCADE;

-- 3. Supprimer les fonctions qui pourraient référencer campaign_videos
DROP FUNCTION IF EXISTS update_campaign_validation_status() CASCADE;
DROP FUNCTION IF EXISTS update_campaigns_on_video_validation() CASCADE;

-- 4. Créer la nouvelle fonction pour mettre à jour les campagnes quand une vidéo change
CREATE OR REPLACE FUNCTION update_campaigns_on_video_validation()
RETURNS TRIGGER AS $$
BEGIN
  -- Mettre à jour toutes les campagnes qui utilisent cette vidéo
  UPDATE campaigns
  SET content_validation_status = NEW.validation_status
  WHERE video_id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Créer le trigger pour mettre à jour automatiquement les campagnes
CREATE TRIGGER update_campaign_validation_on_video_change
  AFTER UPDATE OF validation_status ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_campaigns_on_video_validation();

-- 6. Vérifier la structure
SELECT 
  'Trigger créé: ' || trigger_name as status
FROM information_schema.triggers
WHERE trigger_name = 'update_campaign_validation_on_video_change';

-- 7. Mettre à jour la vue admin_videos_view pour ne pas utiliser campaign_videos
DROP VIEW IF EXISTS admin_videos_view CASCADE;

CREATE OR REPLACE VIEW admin_videos_view AS
SELECT 
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
  COUNT(DISTINCT c.id)::INTEGER AS campaigns_count,
  -- Noms des campagnes
  STRING_AGG(DISTINCT c.name, ', ') AS campaign_names
FROM videos v
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN campaigns c ON c.video_id = v.id
GROUP BY 
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
  bp.business_name,
  bp.contact_name;

-- 8. Vérifier que tout fonctionne
SELECT 
  'Vue recréée avec succès' as status,
  COUNT(*) as total_videos
FROM admin_videos_view;

-- 9. Test de mise à jour
-- Vérifier qu'il n'y a plus de références à campaign_videos dans les contraintes
SELECT 
  constraint_name,
  table_name
FROM information_schema.table_constraints
WHERE constraint_name LIKE '%campaign_videos%';

SELECT '✅ Fix appliqué avec succès - campaign_videos supprimé' as status;













































