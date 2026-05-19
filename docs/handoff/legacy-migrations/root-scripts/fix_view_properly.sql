-- Script pour corriger définitivement la vue admin_videos_view

-- 1. Supprimer la vue
DROP VIEW IF EXISTS admin_videos_view CASCADE;

-- 2. Recréer la vue SANS GROUP BY pour éviter les doublons
CREATE OR REPLACE VIEW admin_videos_view AS
SELECT DISTINCT
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
        SELECT COUNT(DISTINCT c2.id)
        FROM campaigns c2
        WHERE c2.video_id = v.id
    ) as campaigns_count
FROM videos v
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN admin_profiles admin_bp ON v.validated_by = admin_bp.id;

-- 3. Tester la vue
SELECT 
    'Total vidéos dans la vue:' as info,
    COUNT(*) as count
FROM admin_videos_view;

-- 4. Vérifier qu'il n'y a plus de doublons
SELECT 
    filename,
    COUNT(*) as occurrences,
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ Unique'
        ELSE '❌ Encore doublon'
    END as status
FROM admin_videos_view
GROUP BY filename
ORDER BY COUNT(*) DESC, filename;

-- 5. Afficher le contenu de la vue
SELECT 
    id,
    filename,
    uploaded_by_business,
    validation_status,
    campaigns_count
FROM admin_videos_view
ORDER BY filename;

-- 6. Statistiques
SELECT * FROM get_video_validation_stats();












































