-- Script pour recréer le système vidéo correctement
-- Règle: 1 campagne = 1 vidéo UNIQUE, 1 vidéo peut être dans plusieurs campagnes

-- ⚠️ SAUVEGARDE D'ABORD
CREATE TABLE IF NOT EXISTS campaign_videos_backup AS 
SELECT * FROM campaign_videos;

CREATE TABLE IF NOT EXISTS videos_backup AS 
SELECT * FROM videos;

SELECT 'Sauvegardes créées' as info;

-- 1. Supprimer les anciennes tables/colonnes
DROP TABLE IF EXISTS campaign_videos CASCADE;

-- 2. Ajouter la colonne video_id à campaigns si elle n'existe pas
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES videos(id) ON DELETE SET NULL;

-- 3. Ajouter la colonne content_validation_status si elle n'existe pas
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS content_validation_status VARCHAR(20) DEFAULT 'pending' 
CHECK (content_validation_status IN ('pending', 'approved', 'rejected'));

-- 4. Restaurer les vidéos depuis la sauvegarde
INSERT INTO videos (id, url, filename, file_size, duration, thumbnail_url, validation_status, validated_by, validated_at, validation_notes, uploaded_by, created_at, updated_at)
SELECT id, url, filename, file_size, duration, thumbnail_url, validation_status, validated_by, validated_at, validation_notes, uploaded_by, created_at, updated_at
FROM videos_backup
ON CONFLICT (id) DO NOTHING;

-- 5. Lier UNE vidéo par campagne (prendre la première de chaque campagne)
WITH first_video_per_campaign AS (
    SELECT DISTINCT ON (campaign_id)
        campaign_id,
        video_id
    FROM campaign_videos_backup
    ORDER BY campaign_id, display_order, created_at
)
UPDATE campaigns c
SET 
    video_id = fv.video_id,
    content_validation_status = (
        SELECT validation_status FROM videos WHERE id = fv.video_id
    )
FROM first_video_per_campaign fv
WHERE c.id = fv.campaign_id;

-- 6. Créer un index sur video_id
CREATE INDEX IF NOT EXISTS idx_campaigns_video_id ON campaigns(video_id);

-- 7. Vérifier le résultat: 1 campagne = 1 vidéo
SELECT 
    c.id,
    c.name as campaign_name,
    c.content_validation_status,
    v.filename as video_file,
    v.validation_status as video_status,
    bp.business_name as annonceur
FROM campaigns c
LEFT JOIN videos v ON c.video_id = v.id
LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
WHERE c.video_id IS NOT NULL
ORDER BY c.created_at DESC;

-- 8. Vérifier qu'une vidéo peut être dans plusieurs campagnes
SELECT 
    v.filename,
    v.validation_status,
    COUNT(c.id) as utilisee_dans_campagnes,
    STRING_AGG(c.name, ', ') as campagnes
FROM videos v
LEFT JOIN campaigns c ON c.video_id = v.id
GROUP BY v.id, v.filename, v.validation_status
HAVING COUNT(c.id) > 0
ORDER BY COUNT(c.id) DESC;

-- 9. Statistiques finales
SELECT * FROM get_video_validation_stats();

-- 10. Nettoyer les sauvegardes (optionnel, décommentez après vérification)
-- DROP TABLE campaign_videos_backup;
-- DROP TABLE videos_backup;
