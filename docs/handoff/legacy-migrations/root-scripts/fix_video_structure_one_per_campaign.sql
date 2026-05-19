-- Script pour corriger la structure et respecter la règle: 1 campagne = 1 vidéo

-- ⚠️ ATTENTION: Ce script modifie la structure de la base de données
-- Assurez-vous d'avoir une sauvegarde avant d'exécuter

-- 1. Vérifier la structure actuelle
SELECT 'Structure actuelle:' as info;

SELECT 
    c.id,
    c.name,
    COUNT(cv.video_id) as videos_count,
    STRING_AGG(v.filename, ', ') as video_files
FROM campaigns c
LEFT JOIN campaign_videos cv ON c.id = cv.campaign_id
LEFT JOIN videos v ON cv.video_id = v.id
GROUP BY c.id, c.name
HAVING COUNT(cv.video_id) > 0
ORDER BY c.created_at DESC;

-- 2. Ajouter la colonne video_id à campaigns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES videos(id) ON DELETE SET NULL;

-- 3. Migrer les données: Garder seulement la PREMIÈRE vidéo de chaque campagne
UPDATE campaigns c
SET video_id = (
    SELECT cv.video_id 
    FROM campaign_videos cv 
    WHERE cv.campaign_id = c.id 
    ORDER BY cv.display_order, cv.created_at 
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1 FROM campaign_videos cv WHERE cv.campaign_id = c.id
);

-- 4. Vérifier la migration
SELECT 
    c.id,
    c.name,
    c.video_id,
    v.filename as video_file,
    v.validation_status
FROM campaigns c
LEFT JOIN videos v ON c.video_id = v.id
WHERE c.video_id IS NOT NULL
ORDER BY c.created_at DESC;

-- 5. SAUVEGARDER campaign_videos avant de la supprimer (optionnel)
CREATE TABLE IF NOT EXISTS campaign_videos_backup AS 
SELECT * FROM campaign_videos;

SELECT 'Sauvegarde créée:' as info, COUNT(*) as records FROM campaign_videos_backup;

-- 6. Supprimer la table campaign_videos (décommentez après vérification)
-- DROP TABLE campaign_videos CASCADE;

-- 7. Mettre à jour le trigger pour utiliser campaigns.video_id
CREATE OR REPLACE FUNCTION update_campaigns_on_video_validation()
RETURNS TRIGGER AS $$
BEGIN
    -- Mettre à jour toutes les campagnes utilisant cette vidéo
    UPDATE campaigns
    SET 
        content_validation_status = NEW.validation_status,
        updated_at = NOW()
    WHERE video_id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Le trigger existe déjà, pas besoin de le recréer

-- 8. Mettre à jour la fonction get_campaigns_using_video
CREATE OR REPLACE FUNCTION get_campaigns_using_video(video_uuid UUID)
RETURNS TABLE (
    campaign_id UUID,
    campaign_name TEXT,
    campaign_status TEXT,
    advertiser_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id as campaign_id,
        c.name as campaign_name,
        c.status::TEXT as campaign_status,
        bp.business_name as advertiser_name
    FROM campaigns c
    LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
    WHERE c.video_id = video_uuid
    ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 9. Mettre à jour la vue admin_videos_view
CREATE OR REPLACE VIEW admin_videos_view AS
SELECT
    v.id,
    v.filename,
    v.url,
    v.file_size,
    v.duration,
    v.thumbnail_url,
    v.validation_status,
    v.validated_at,
    v.validation_notes,
    v.created_at,
    v.updated_at,
    bp.business_name as uploaded_by_business,
    bp.contact_name as uploaded_by_contact,
    u.email as uploaded_by_email,
    admin_bp.first_name || ' ' || admin_bp.last_name as validated_by_admin,
    COUNT(DISTINCT c.id) as campaigns_count
FROM videos v
LEFT JOIN auth.users u ON v.uploaded_by = u.id
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN admin_profiles admin_bp ON v.validated_by = admin_bp.id
LEFT JOIN campaigns c ON c.video_id = v.id
GROUP BY 
    v.id, v.filename, v.url, v.file_size, v.duration, v.thumbnail_url,
    v.validation_status, v.validated_at, v.validation_notes, v.created_at, v.updated_at,
    bp.business_name, bp.contact_name, u.email, admin_bp.first_name, admin_bp.last_name;

-- 10. Vérifier la nouvelle structure
SELECT 'Nouvelle structure:' as info;

SELECT 
    c.id,
    c.name,
    v.filename as video_file,
    v.validation_status,
    c.content_validation_status
FROM campaigns c
LEFT JOIN videos v ON c.video_id = v.id
WHERE c.video_id IS NOT NULL
ORDER BY c.created_at DESC;

-- 11. Vérifier qu'il n'y a plus de campagnes avec plusieurs vidéos
SELECT 
    'Campagnes avec plusieurs vidéos (devrait être 0):' as check_name,
    COUNT(*) as should_be_zero
FROM (
    SELECT campaign_id, COUNT(video_id) as video_count
    FROM campaign_videos
    GROUP BY campaign_id
    HAVING COUNT(video_id) > 1
) subquery;












































