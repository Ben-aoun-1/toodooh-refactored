-- Script pour ajouter les noms des campagnes à la vue

-- 1. Supprimer l'ancienne vue
DROP VIEW IF EXISTS admin_videos_view CASCADE;

-- 2. Recréer la vue avec les noms des campagnes
CREATE OR REPLACE VIEW admin_videos_view AS
SELECT DISTINCT ON (v.id)
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
    v.uploaded_by,
    COALESCE(bp.business_name, 'N/A') as uploaded_by_business,
    COALESCE(bp.contact_name, 'N/A') as uploaded_by_contact,
    COALESCE(bp.email, 'N/A') as uploaded_by_email,
    COALESCE(admin_bp.first_name || ' ' || admin_bp.last_name, 'N/A') as validated_by_admin,
    (
        SELECT COUNT(*)
        FROM campaigns c2
        WHERE c2.video_id = v.id
    ) as campaigns_count,
    (
        SELECT STRING_AGG(c2.name, ', ')
        FROM campaigns c2
        WHERE c2.video_id = v.id
    ) as campaign_names
FROM videos v
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN admin_profiles admin_bp ON v.validated_by = admin_bp.id
ORDER BY v.id, bp.created_at DESC;

-- 3. Tester la vue
SELECT 
    id,
    filename,
    uploaded_by_business,
    validation_status,
    campaigns_count,
    campaign_names
FROM admin_videos_view
ORDER BY filename;

-- 4. Vérifier qu'il n'y a plus de doublons
SELECT 
    filename,
    COUNT(*) as occurrences
FROM admin_videos_view
GROUP BY filename
HAVING COUNT(*) > 1;












































