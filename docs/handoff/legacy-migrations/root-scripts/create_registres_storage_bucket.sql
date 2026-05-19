-- Script pour créer le bucket de stockage pour les registres de commerce
-- À exécuter dans l'éditeur SQL de Supabase

-- 1. Créer le bucket "registres" s'il n'existe pas
INSERT INTO storage.buckets (id, name, public)
VALUES ('registres', 'registres', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Configurer les politiques RLS pour le bucket "registres"

-- Policy 1: Les utilisateurs authentifiés peuvent uploader leur propre registre
-- Format du nom: {user_id}_{timestamp}.{extension}
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

-- 3. Vérifier que le bucket a été créé
SELECT 
  id,
  name,
  public,
  created_at
FROM storage.buckets
WHERE id = 'registres';

-- 4. Vérifier les policies
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND policyname LIKE '%registration%';

-- NOTE IMPORTANTE :
-- Le chemin des fichiers uploadés sera : registres/{user_id}_{timestamp}.{extension}
-- Exemple : registres/550e8400-e29b-41d4-a716-446655440000_1710234567890.pdf

