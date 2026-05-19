-- Script pour mettre à jour automatiquement le status de la campagne quand la vidéo est validée
-- Date: 2025-01-30

-- 1. Supprimer l'ancien trigger et fonction
DROP TRIGGER IF EXISTS trigger_update_campaigns_validation ON videos;
DROP TRIGGER IF EXISTS update_campaign_validation_on_video_change ON videos;
DROP FUNCTION IF EXISTS update_campaigns_on_video_validation() CASCADE;

-- 2. Créer la nouvelle fonction améliorée
CREATE OR REPLACE FUNCTION update_campaigns_on_video_validation()
RETURNS TRIGGER AS $$
BEGIN
    -- Mettre à jour toutes les campagnes utilisant cette vidéo
    UPDATE campaigns
    SET 
        content_validation_status = NEW.validation_status,
        status = CASE 
            -- Si vidéo approuvée et campagne en pending → passer à active (prête à diffuser)
            WHEN NEW.validation_status = 'approved' AND status = 'pending' THEN 'active'
            -- Si vidéo rejetée → passer à rejected
            WHEN NEW.validation_status = 'rejected' THEN 'rejected'
            -- Sinon garder le status actuel
            ELSE status
        END
    WHERE video_id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Créer le nouveau trigger
CREATE TRIGGER trigger_update_campaigns_on_video_validation
    AFTER UPDATE OF validation_status ON videos
    FOR EACH ROW
    WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
    EXECUTE FUNCTION update_campaigns_on_video_validation();

-- 4. Mettre à jour les campagnes existantes avec vidéos déjà validées
UPDATE campaigns c
SET 
    content_validation_status = v.validation_status,
    status = CASE 
        WHEN v.validation_status = 'approved' AND c.status = 'pending' THEN 'active'
        WHEN v.validation_status = 'rejected' THEN 'rejected'
        ELSE c.status
    END
FROM videos v
WHERE c.video_id = v.id
AND c.content_validation_status != v.validation_status;

-- 5. Vérifier les résultats
SELECT 
    c.name as campagne,
    c.status as status_campagne,
    c.content_validation_status,
    v.validation_status as status_video,
    v.filename as video
FROM campaigns c
LEFT JOIN videos v ON c.video_id = v.id
WHERE c.video_id IS NOT NULL
ORDER BY c.created_at DESC
LIMIT 10;

-- 6. Message de confirmation
SELECT 
    '✅ TRIGGER MIS À JOUR' as message,
    'Les campagnes passent automatiquement à approved quand leur vidéo est validée' as details;

