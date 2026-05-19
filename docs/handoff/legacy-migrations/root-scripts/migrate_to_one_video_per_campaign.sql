-- Migration vers le modèle: 1 campagne = 1 vidéo
-- Respecte les règles: 1 campagne → 1 vidéo, 1 vidéo → plusieurs campagnes

-- ⚠️ ÉTAPE 1: Sauvegarder les données existantes
CREATE TABLE IF NOT EXISTS campaign_videos_backup_migration AS 
SELECT * FROM campaign_videos;

SELECT 'Sauvegarde créée:', COUNT(*) as records FROM campaign_videos_backup_migration;

-- ⚠️ ÉTAPE 2: Vérifier les campagnes avec plusieurs vidéos
SELECT 
    'Campagnes avec plusieurs vidéos (seront migrées à 1 seule):' as warning,
    c.id,
    c.name,
    COUNT(cv.video_id) as videos_count,
    STRING_AGG(v.filename, ', ') as video_files
FROM campaigns c
JOIN campaign_videos cv ON c.id = cv.campaign_id
JOIN videos v ON cv.video_id = v.id
GROUP BY c.id, c.name
HAVING COUNT(cv.video_id) > 1;

-- ÉTAPE 3: Ajouter la colonne video_id à campaigns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES videos(id) ON DELETE SET NULL;

-- ÉTAPE 4: Migrer les données (garde la première vidéo de chaque campagne)
WITH first_video_per_campaign AS (
    SELECT DISTINCT ON (campaign_id)
        campaign_id,
        video_id
    FROM campaign_videos
    ORDER BY campaign_id, display_order NULLS LAST, created_at
)
UPDATE campaigns c
SET video_id = fv.video_id
FROM first_video_per_campaign fv
WHERE c.id = fv.campaign_id;

-- ÉTAPE 5: Mettre à jour content_validation_status
UPDATE campaigns c
SET content_validation_status = v.validation_status
FROM videos v
WHERE c.video_id = v.id;

-- ÉTAPE 6: Créer un index sur video_id
CREATE INDEX IF NOT EXISTS idx_campaigns_video_id ON campaigns(video_id);

-- ÉTAPE 7: Vérifier le résultat de la migration
SELECT 
    '✅ Résultat de la migration:' as info,
    c.id,
    c.name,
    v.filename as video_assignee,
    v.validation_status,
    c.content_validation_status
FROM campaigns c
LEFT JOIN videos v ON c.video_id = v.id
WHERE c.video_id IS NOT NULL
ORDER BY c.created_at DESC;

-- ÉTAPE 8: Vérifier qu'une vidéo peut être dans plusieurs campagnes
SELECT 
    '✅ Vidéos réutilisées dans plusieurs campagnes:' as info,
    v.filename,
    v.validation_status,
    COUNT(c.id) as campagnes_count,
    STRING_AGG(c.name, ' | ') as campagnes_list
FROM videos v
JOIN campaigns c ON c.video_id = v.id
GROUP BY v.id, v.filename, v.validation_status
HAVING COUNT(c.id) > 1;

-- ÉTAPE 9: Supprimer la table campaign_videos (après vérification)
-- ⚠️ Décommentez seulement après avoir vérifié que tout est OK
-- DROP TABLE campaign_videos CASCADE;

-- ÉTAPE 10: Vérifications finales
SELECT '=== VÉRIFICATIONS FINALES ===' as section;

-- Compter les campagnes avec vidéo
SELECT 
    'Campagnes avec vidéo:' as metric,
    COUNT(*) as count
FROM campaigns 
WHERE video_id IS NOT NULL;

-- Compter les vidéos utilisées
SELECT 
    'Vidéos utilisées:' as metric,
    COUNT(DISTINCT video_id) as count
FROM campaigns 
WHERE video_id IS NOT NULL;

-- Statistiques de validation
SELECT * FROM get_video_validation_stats();












































