-- Corriger les politiques RLS pour permettre aux admins d'accéder à tous les business_profiles

-- 1. Supprimer l'ancienne politique SELECT restrictive
DROP POLICY IF EXISTS "simple_select_policy" ON business_profiles;

-- 2. Créer une nouvelle politique SELECT qui permet aux admins de voir tous les business_profiles
CREATE POLICY "admin_select_policy" ON business_profiles
FOR SELECT
TO authenticated
USING (
  -- Soit l'utilisateur peut voir ses propres données
  auth.uid() = user_id
  OR
  -- Soit l'utilisateur est un admin actif
  EXISTS (
    SELECT 1 FROM admin_profiles 
    WHERE admin_profiles.user_id = auth.uid() 
    AND admin_profiles.is_active = true
  )
);

-- 3. Créer une politique UPDATE pour les admins
DROP POLICY IF EXISTS "simple_update_policy" ON business_profiles;

CREATE POLICY "admin_update_policy" ON business_profiles
FOR UPDATE
TO authenticated
USING (
  -- Soit l'utilisateur peut modifier ses propres données
  auth.uid() = user_id
  OR
  -- Soit l'utilisateur est un admin actif
  EXISTS (
    SELECT 1 FROM admin_profiles 
    WHERE admin_profiles.user_id = auth.uid() 
    AND admin_profiles.is_active = true
  )
);

-- 4. Vérifier les nouvelles politiques
SELECT 
    policyname,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'business_profiles'
ORDER BY policyname;












































