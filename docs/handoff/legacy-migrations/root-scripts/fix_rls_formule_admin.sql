/*
  FIX RLS : Permettre aux admins de voir la colonne formule
  
  Le problème : Les politiques RLS empêchent peut-être les admins de voir la colonne formule
*/

-- ================================================================
-- ETAPE 1 : VERIFIER LES POLITIQUES RLS ACTUELLES
-- ================================================================

-- Voir toutes les politiques RLS pour business_profiles
SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'business_profiles';

-- ================================================================
-- ETAPE 2 : VERIFIER LA FONCTION is_admin_user
-- ================================================================

-- Vérifier si la fonction is_admin_user existe
SELECT 
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines 
WHERE routine_name = 'is_admin_user';

-- ================================================================
-- ETAPE 3 : CREER OU RECREER LA POLITIQUE POUR LES ADMINS
-- ================================================================

-- Supprimer les anciennes politiques pour les admins
DROP POLICY IF EXISTS "Les admins peuvent voir tous les profils" ON business_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON business_profiles;
DROP POLICY IF EXISTS "Admin full access" ON business_profiles;

-- Créer une nouvelle politique pour les admins
CREATE POLICY "Les admins peuvent voir tous les profils" ON business_profiles
FOR SELECT TO authenticated
USING (
  -- Les utilisateurs peuvent voir leur propre profil
  auth.uid() = user_id 
  OR 
  -- Les admins peuvent voir tous les profils
  is_admin_user(auth.uid())
);

-- ================================================================
-- ETAPE 4 : VERIFIER QUE LA COLONNE formule EXISTE
-- ================================================================

SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'business_profiles'
  AND column_name = 'formule';

-- ================================================================
-- ETAPE 5 : TESTER L'ACCES ADMIN
-- ================================================================

-- Vérifier qu'un admin peut voir les formules
-- (Remplacez 'ADMIN_USER_ID' par un vrai ID d'admin)
/*
SELECT 
  id,
  contact_name,
  profile_type,
  formule,
  created_at
FROM business_profiles
WHERE profile_type IN ('individual_owner', 'fleet_owner')
LIMIT 5;
*/

SELECT 'Verification RLS terminee. Testez maintenant laffichage dans ladmin.' as message;
