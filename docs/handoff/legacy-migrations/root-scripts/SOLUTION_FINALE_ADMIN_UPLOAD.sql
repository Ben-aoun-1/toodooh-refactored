/*
  ⚡ SOLUTION FINALE : Upload admin avec support admin_profiles ET business_profiles
  
  Ce script supporte DEUX systèmes d'admin :
  1. Table admin_profiles (si elle existe)
  2. Champ business_profiles.is_admin
  
  Les admins des DEUX systèmes pourront uploader !
*/

-- ================================================================
-- ÉTAPE 1 : CRÉER LA TABLE admin_profiles SI ELLE N'EXISTE PAS
-- ================================================================

CREATE TABLE IF NOT EXISTS admin_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Activer RLS sur admin_profiles
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques si elles existent
DROP POLICY IF EXISTS "Les admins peuvent voir admin_profiles" ON admin_profiles;
DROP POLICY IF EXISTS "Admins peuvent tout voir dans admin_profiles" ON admin_profiles;
DROP POLICY IF EXISTS "Tous peuvent lire admin_profiles" ON admin_profiles;

-- Tous les utilisateurs authentifiés peuvent lire admin_profiles
-- Cette table ne contient que des user_ids, pas de données sensibles
-- Cela évite la récursion infinie et permet au service de fonctionner
CREATE POLICY "Tous peuvent lire admin_profiles"
ON admin_profiles FOR SELECT
TO authenticated
USING (true);

SELECT '✅ Étape 1 : Table admin_profiles créée/vérifiée' as message;

-- ================================================================
-- ÉTAPE 2 : S'ASSURER QUE LE BUCKET EXISTE
-- ================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('registres', 'registres', false)
ON CONFLICT (id) DO NOTHING;

SELECT '✅ Étape 2 : Bucket registres vérifié' as message;

-- ================================================================
-- ÉTAPE 3 : SUPPRIMER TOUTES LES ANCIENNES POLITIQUES
-- ================================================================

DROP POLICY IF EXISTS "Upload documents registres" ON storage.objects;
DROP POLICY IF EXISTS "Lire documents registres" ON storage.objects;
DROP POLICY IF EXISTS "MAJ documents registres" ON storage.objects;
DROP POLICY IF EXISTS "Supprimer documents registres" ON storage.objects;
DROP POLICY IF EXISTS "Admin peut uploader dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Admin peut lire dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Admin peut modifier dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Admin peut supprimer dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent uploader leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent MAJ leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les admins peuvent tout faire dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Admins full access to registres" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own registres" ON storage.objects;
DROP POLICY IF EXISTS "Tous peuvent uploader registres (TEMPORAIRE)" ON storage.objects;

SELECT '✅ Étape 3 : Anciennes politiques supprimées' as message;

-- ================================================================
-- ÉTAPE 4 : CRÉER LES NOUVELLES POLITIQUES AVEC DOUBLE SUPPORT
-- ================================================================

-- Fonction helper pour vérifier si un utilisateur est admin
CREATE OR REPLACE FUNCTION is_admin_user(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    -- Méthode 1 : Vérifier dans admin_profiles
    EXISTS (SELECT 1 FROM admin_profiles WHERE admin_profiles.user_id = $1)
    OR
    -- Méthode 2 : Vérifier is_admin dans business_profiles
    EXISTS (SELECT 1 FROM business_profiles WHERE business_profiles.user_id = $1 AND is_admin = true)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT '✅ Étape 4 : Fonction is_admin_user créée' as message;

-- ================================================================
-- ÉTAPE 5 : POLITIQUES RLS POUR LE BUCKET REGISTRES
-- ================================================================

-- Supprimer les politiques si elles existent déjà
DROP POLICY IF EXISTS "Upload registres - admins et users" ON storage.objects;
DROP POLICY IF EXISTS "Lire registres - admins et users" ON storage.objects;
DROP POLICY IF EXISTS "Modifier registres - admins" ON storage.objects;
DROP POLICY IF EXISTS "Supprimer registres - admins" ON storage.objects;

-- INSERT : Upload de documents
CREATE POLICY "Upload registres - admins et users"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'registres' AND
  (
    -- Les admins (admin_profiles OU business_profiles.is_admin) peuvent tout uploader
    is_admin_user(auth.uid())
    OR
    -- Les utilisateurs peuvent uploader leurs propres documents
    (
      name ~ ('^cin_' || auth.uid()::text) OR
      name ~ ('^rne_' || auth.uid()::text)
    )
  )
);

-- SELECT : Lecture de documents
CREATE POLICY "Lire registres - admins et users"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'registres' AND
  (
    is_admin_user(auth.uid())
    OR
    (
      name ~ ('^cin_' || auth.uid()::text) OR
      name ~ ('^rne_' || auth.uid()::text)
    )
  )
);

-- UPDATE : Modification de documents
CREATE POLICY "Modifier registres - admins"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'registres' AND is_admin_user(auth.uid())
)
WITH CHECK (
  bucket_id = 'registres' AND is_admin_user(auth.uid())
);

-- DELETE : Suppression de documents
CREATE POLICY "Supprimer registres - admins"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'registres' AND is_admin_user(auth.uid())
);

SELECT '✅ Étape 5 : Nouvelles politiques RLS créées' as message;

-- ================================================================
-- ÉTAPE 6 : VÉRIFICATION COMPLÈTE
-- ================================================================

SELECT '📊 VÉRIFICATION FINALE' as titre;

-- 1. Vérifier le bucket
SELECT 
  '1. Bucket registres' as check_item,
  CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'registres')
    THEN '✅ Existe'
    ELSE '❌ N''existe pas'
  END as status;

-- 2. Vérifier les politiques
SELECT 
  '2. Politiques RLS' as check_item,
  COUNT(*)::text || ' politiques créées' as status
FROM pg_policies
WHERE tablename = 'objects' 
  AND policyname LIKE '%registres%';

-- 3. Vérifier la fonction
SELECT 
  '3. Fonction is_admin_user' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'is_admin_user'
  )
    THEN '✅ Existe'
    ELSE '❌ N''existe pas'
  END as status;

-- 4. Lister tous les admins (admin_profiles)
SELECT 
  '4. Admins (admin_profiles)' as check_item,
  COUNT(*)::text || ' admin(s): ' || COALESCE(STRING_AGG(ap.user_id::text, ', '), 'aucun') as status
FROM admin_profiles ap;

-- 5. Lister tous les admins (business_profiles.is_admin)
SELECT 
  '5. Admins (business_profiles)' as check_item,
  COUNT(*)::text || ' admin(s): ' || COALESCE(STRING_AGG(email, ', '), 'aucun') as status
FROM business_profiles
WHERE is_admin = true;

-- 6. Lister TOUS les admins (combinés)
SELECT 
  '📋 LISTE COMPLÈTE DES ADMINS' as titre;

SELECT DISTINCT
  COALESCE(bp.email, 'Email non défini') as email,
  COALESCE(bp.contact_name, 'Nom non défini') as nom,
  CASE 
    WHEN ap.user_id IS NOT NULL THEN 'admin_profiles'
    WHEN bp.is_admin = true THEN 'business_profiles.is_admin'
    ELSE 'inconnu'
  END as source
FROM auth.users u
LEFT JOIN business_profiles bp ON bp.user_id = u.id
LEFT JOIN admin_profiles ap ON ap.user_id = u.id
WHERE ap.user_id IS NOT NULL OR bp.is_admin = true;

-- ================================================================
-- ÉTAPE 7 : INSTRUCTIONS FINALES
-- ================================================================

SELECT '🎉 SCRIPT TERMINÉ !' as message;
SELECT '' as separator;
SELECT '📋 PROCHAINES ÉTAPES :' as titre;
SELECT '1. Si vous voyez votre email dans la liste des admins ci-dessus ✅' as etape;
SELECT '2. Déconnectez-vous et reconnectez-vous' as etape;
SELECT '3. Testez l''upload de documents dans l''interface admin' as etape;
SELECT '4. Si ça ne fonctionne pas encore, exécutez ADD_ADMIN.sql pour vous ajouter' as etape;

