-- Script pour corriger la vue admin_videos_view

-- 1. Supprimer l'ancienne vue
DROP VIEW IF EXISTS admin_videos_view;

-- 2. Recréer la vue correctement avec campaigns.video_id
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
    v.uploaded_by,
    bp.business_name as uploaded_by_business,
    bp.contact_name as uploaded_by_contact,
    bp.email as uploaded_by_email,
    admin_bp.first_name || ' ' || admin_bp.last_name as validated_by_admin,
    COUNT(DISTINCT c.id) as campaigns_count
FROM videos v
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN admin_profiles admin_bp ON v.validated_by = admin_bp.id
LEFT JOIN campaigns c ON c.video_id = v.id
GROUP BY 
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
    bp.business_name, 
    bp.contact_name, 
    bp.email,
    admin_bp.first_name, 
    admin_bp.last_name;

-- 3. Tester la nouvelle vue
SELECT 
    'Vidéos dans la vue (après correction):' as info,
    COUNT(*) as count
FROM admin_videos_view;

-- 4. Afficher le contenu de la vue
SELECT 
    id,
    filename,
    uploaded_by_business,
    validation_status,
    campaigns_count
FROM admin_videos_view
ORDER BY filename;

-- 5. Vérifier qu'il n'y a plus de doublons dans la vue
SELECT 
    filename,
    COUNT(*) as occurrences
FROM admin_videos_view
GROUP BY filename
HAVING COUNT(*) > 1;












































