-- Corriger les politiques RLS pour permettre aux admins de supprimer des utilisateurs

-- 1. Supprimer l'ancienne politique de suppression si elle existe
DROP POLICY IF EXISTS "Les admins peuvent supprimer tous les profils" ON business_profiles;
DROP POLICY IF EXISTS "Supprimer son propre profil" ON business_profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON business_profiles;

-- 2. Créer une nouvelle politique de suppression pour les admins
CREATE POLICY "Les admins peuvent supprimer tous les profils" ON business_profiles
FOR DELETE TO authenticated
USING (
  is_admin_user(auth.uid())
);

-- 3. Vérifier que la fonction is_admin_user existe et fonctionne
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' 
      AND p.proname = 'is_admin_user'
    )
    THEN '✅ Fonction is_admin_user existe'
    ELSE '❌ Fonction is_admin_user manquante - exécutez SOLUTION_FINALE_ADMIN_UPLOAD.sql'
  END as status;

-- 4. Afficher les nouvelles politiques
SELECT 
  '✅ Nouvelles politiques RLS pour DELETE:' as message;

SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'business_profiles' AND cmd = 'DELETE';
































