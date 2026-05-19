/*
  Diagnostic complet pour identifier le problème d'upload admin
  Exécutez ce script pour voir exactement ce qui ne va pas
*/

-- ================================================================
-- 1. VÉRIFIER LE BUCKET 'registres'
-- ================================================================
SELECT '🔍 1. Vérification du bucket registres' as etape;

SELECT 
  id,
  name,
  public,
  created_at
FROM storage.buckets
WHERE name = 'registres';

-- Si le bucket n'existe pas, le créer :
-- INSERT INTO storage.buckets (id, name, public) VALUES ('registres', 'registres', false);

-- ================================================================
-- 2. VÉRIFIER LES POLITIQUES RLS DU BUCKET
-- ================================================================
SELECT '🔍 2. Politiques RLS actuelles du bucket registres' as etape;

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'objects' 
  AND (
    policyname LIKE '%registres%' 
    OR qual::text LIKE '%registres%'
    OR with_check::text LIKE '%registres%'
  )
ORDER BY policyname;

-- ================================================================
-- 3. VÉRIFIER VOTRE PROFIL ADMIN
-- ================================================================
SELECT '🔍 3. Votre profil admin' as etape;

-- Trouvez votre email dans la liste et vérifiez is_admin
SELECT 
  id,
  user_id,
  contact_name,
  email,
  is_admin,
  created_at
FROM business_profiles
ORDER BY created_at DESC
LIMIT 10;

-- ================================================================
-- 4. VÉRIFIER LA COLONNE is_admin
-- ================================================================
SELECT '🔍 4. Structure de la table business_profiles' as etape;

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'business_profiles'
  AND column_name IN ('is_admin', 'user_id', 'id');

-- ================================================================
-- 5. TEST : METTRE UN UTILISATEUR EN ADMIN (REMPLACEZ L'EMAIL)
-- ================================================================
SELECT '🔍 5. Pour définir un admin, exécutez cette requête :' as etape;

-- DÉCOMMENTEZ ET REMPLACEZ L'EMAIL PAR LE VÔTRE :
-- UPDATE business_profiles
-- SET is_admin = true
-- WHERE email = 'VOTRE_EMAIL@example.com';

-- ================================================================
-- 6. VÉRIFIER LES POLITIQUES RLS SUR business_profiles
-- ================================================================
SELECT '🔍 6. Politiques RLS sur business_profiles' as etape;

SELECT 
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- ================================================================
-- 7. SOLUTION ALTERNATIVE : DÉSACTIVER RLS SUR LE BUCKET (TEMPORAIRE)
-- ================================================================
SELECT '🔍 7. Solution temporaire si rien ne fonctionne' as etape;

-- Pour tester uniquement, vous pouvez temporairement désactiver RLS sur storage.objects
-- ATTENTION : À ne faire qu'en développement !

-- ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;

-- Puis réactiver après les tests :
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- 8. RÉSUMÉ DES ACTIONS
-- ================================================================
SELECT '📋 RÉSUMÉ DES VÉRIFICATIONS' as titre;

SELECT 
  'Bucket existe:' as check_item,
  CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'registres')
    THEN '✅ OUI'
    ELSE '❌ NON - Créez-le avec INSERT INTO storage.buckets (id, name, public) VALUES (''registres'', ''registres'', false)'
  END as resultat
UNION ALL
SELECT 
  'Politiques RLS bucket:' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname LIKE '%registres%'
  )
    THEN '✅ OUI'
    ELSE '❌ NON - Exécutez fix_admin_upload_rls.sql'
  END as resultat
UNION ALL
SELECT 
  'Colonne is_admin:' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'business_profiles' 
    AND column_name = 'is_admin'
  )
    THEN '✅ OUI'
    ELSE '❌ NON - Exécutez: ALTER TABLE business_profiles ADD COLUMN is_admin boolean DEFAULT false'
  END as resultat
UNION ALL
SELECT 
  'Admin existe:' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM business_profiles 
    WHERE is_admin = true
  )
    THEN '✅ OUI - ' || (SELECT email FROM business_profiles WHERE is_admin = true LIMIT 1)
    ELSE '❌ NON - Définissez un admin avec UPDATE business_profiles SET is_admin = true WHERE email = ''VOTRE_EMAIL'''
  END as resultat;

