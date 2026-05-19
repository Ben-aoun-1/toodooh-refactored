-- Script de diagnostic pour la table videos

-- 1. Vérifier si la table existe
SELECT 
    'Table videos exists: ' || CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'videos') 
        THEN 'YES' 
        ELSE 'NO' 
    END as status;

-- 2. Voir la structure complète
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'videos'
ORDER BY ordinal_position;

-- 3. Vérifier les contraintes
SELECT
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'videos'
ORDER BY tc.constraint_type, tc.constraint_name;

-- 4. Vérifier les triggers
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'videos';

-- 5. Vérifier les politiques RLS
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE tablename = 'videos';

-- 6. Tester la génération d'UUID
SELECT gen_random_uuid() as test_uuid;

-- 7. Tester un INSERT minimal
-- Décommentez pour tester:
/*
INSERT INTO videos (id, url, filename, validation_status, uploaded_by)
VALUES (
    gen_random_uuid(),
    'https://test.com/test.mp4',
    'test.mp4',
    'pending',
    (SELECT id FROM auth.users LIMIT 1)
);
*/

-- 8. Si la table n'existe pas ou est corrompue, la recréer:
/*
DROP TABLE IF EXISTS campaign_videos CASCADE;
DROP TABLE IF EXISTS videos CASCADE;

-- Puis ré-exécuter create_videos_validation_system.sql
*/












































