-- Script pour corriger la vue avec DISTINCT ON pour éviter les doublons

-- 1. Supprimer l'ancienne vue
DROP VIEW IF EXISTS admin_videos_view CASCADE;

-- 2. Recréer la vue avec DISTINCT ON pour garantir 1 ligne par vidéo
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
    ) as campaigns_count
FROM videos v
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN admin_profiles admin_bp ON v.validated_by = admin_bp.id
ORDER BY v.id, bp.created_at DESC; -- Prendre le business_profile le plus récent en cas de doublon

-- 3. Tester la vue
SELECT 
    'Vidéos dans la vue (après DISTINCT ON):' as info,
    COUNT(*) as count
FROM admin_videos_view;

-- 4. Vérifier qu'il n'y a plus de doublons
SELECT 
    id,
    COUNT(*) as occurrences
FROM admin_videos_view
GROUP BY id
HAVING COUNT(*) > 1;

-- Si vide, parfait! ✅

-- 5. Afficher les vidéos
SELECT 
    id,
    filename,
    uploaded_by_business,
    validation_status,
    campaigns_count
FROM admin_videos_view
ORDER BY filename;

-- 6. Comparer avec la table videos
SELECT 
    'Comparaison:' as info,
    'Table videos' as source,
    COUNT(*) as count
FROM videos
UNION ALL
SELECT 
    'Comparaison:' as info,
    'Vue admin_videos_view' as source,
    COUNT(*) as count
FROM admin_videos_view;

-- Les deux doivent être identiques! ✅


