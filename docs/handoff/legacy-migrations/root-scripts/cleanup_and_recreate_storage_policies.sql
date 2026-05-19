-- Script pour nettoyer et recréer les policies du bucket registres

-- 1. Supprimer toutes les anciennes policies (si elles existent)
DROP POLICY IF EXISTS "Users can upload their own registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Super admins can read all registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own registration documents" ON storage.objects;

-- 2. Recréer les policies avec les bons paramètres

-- Policy 1: Les utilisateurs authentifiés peuvent uploader leur propre registre
CREATE POLICY "Users can upload their own registration documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'registres' 
  AND name LIKE auth.uid()::text || '_%'
);

-- Policy 2: Les utilisateurs peuvent lire leur propre registre
CREATE POLICY "Users can read their own registration documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'registres' 
  AND name LIKE auth.uid()::text || '_%'
);

-- Policy 3: Les super admins peuvent lire tous les registres
CREATE POLICY "Super admins can read all registration documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'registres'
  AND EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE admin_profiles.user_id = auth.uid()
    AND admin_profiles.role = 'superadmin'
    AND admin_profiles.is_active = true
  )
);

-- Policy 4: Les utilisateurs peuvent mettre à jour leur propre registre
CREATE POLICY "Users can update their own registration documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'registres' 
  AND name LIKE auth.uid()::text || '_%'
);

-- Policy 5: Les utilisateurs peuvent supprimer leur propre registre
CREATE POLICY "Users can delete their own registration documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'registres' 
  AND name LIKE auth.uid()::text || '_%'
);

-- 3. Vérifier que tout est créé
SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND policyname LIKE '%registration%'
ORDER BY cmd;

-- Devrait retourner 5 lignes:
-- DELETE | {authenticated}
-- INSERT | {authenticated}  
-- SELECT | {authenticated} (user)
-- SELECT | {authenticated} (admin)
-- UPDATE | {authenticated}











































