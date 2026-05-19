-- Script simple pour corriger les politiques RLS
-- À exécuter dans Supabase SQL Editor

-- 1. Désactiver RLS temporairement
ALTER TABLE business_profiles DISABLE ROW LEVEL SECURITY;

-- 2. Supprimer TOUTES les politiques (même celles qui n'existent pas)
DO $$ 
DECLARE
    policy_name TEXT;
BEGIN
    -- Supprimer toutes les politiques existantes
    FOR policy_name IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'business_profiles'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON business_profiles', policy_name);
    END LOOP;
END $$;

-- 3. Réactiver RLS
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- 4. Créer des politiques simples
CREATE POLICY "simple_select_policy"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "simple_insert_policy"
  ON business_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "simple_update_policy"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "simple_delete_policy"
  ON business_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Politique pour les utilisateurs anonymes (inscription)
CREATE POLICY "anon_insert_policy"
  ON business_profiles FOR INSERT
  TO anon
  WITH CHECK (true);

-- 6. Vérifier les politiques créées
SELECT 
  'Politiques créées:' as info,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- 7. Tester la lecture
SELECT 
  'Test de lecture:' as info,
  COUNT(*) as total_profiles
FROM business_profiles;
