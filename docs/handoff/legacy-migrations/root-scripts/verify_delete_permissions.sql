-- Script pour vérifier les permissions de suppression sur le bucket "registres"

-- 1. Vérifier que le bucket existe
SELECT 
  id,
  name,
  public,
  '✅ Bucket existe' as statut
FROM storage.buckets
WHERE id = 'registres';

-- 2. Vérifier la policy DELETE
SELECT 
  policyname,
  cmd,
  roles,
  qual as "Condition USING",
  with_check as "Condition WITH CHECK",
  '✅ Policy DELETE existe' as statut
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND cmd = 'DELETE'
AND policyname LIKE '%registration%';

-- Devrait retourner :
-- policyname: Users can delete their own registration documents
-- cmd: DELETE
-- roles: {authenticated}
-- Condition: bucket_id = 'registres' AND name LIKE auth.uid()::text || '_%'

-- 3. Vérifier tous les fichiers dans le bucket
SELECT 
  name,
  owner,
  created_at,
  bucket_id
FROM storage.objects
WHERE bucket_id = 'registres'
ORDER BY created_at DESC;

-- 4. Tester si un utilisateur spécifique peut supprimer ses fichiers
-- ⚠️ REMPLACEZ 'VOTRE_USER_ID' par votre ID utilisateur

/*
-- Voir vos fichiers
SELECT 
  name,
  owner,
  created_at,
  CASE 
    WHEN name LIKE 'VOTRE_USER_ID_%' THEN '✅ Votre fichier - Devrait pouvoir supprimer'
    ELSE '❌ Pas votre fichier'
  END as permission
FROM storage.objects
WHERE bucket_id = 'registres';
*/

-- 5. Si la policy DELETE n'existe pas, la créer
-- ⚠️ DÉCOMMENTEZ POUR CRÉER LA POLICY

/*
DROP POLICY IF EXISTS "Users can delete their own registration documents" ON storage.objects;

CREATE POLICY "Users can delete their own registration documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'registres' 
  AND name LIKE auth.uid()::text || '_%'
);

-- Vérifier que c'est créé
SELECT 
  policyname,
  cmd,
  '✅ Policy DELETE créée' as statut
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND policyname = 'Users can delete their own registration documents';
*/

-- 6. BONUS : Supprimer manuellement un fichier spécifique (admin seulement)
-- ⚠️ À utiliser UNIQUEMENT si vraiment nécessaire

/*
DELETE FROM storage.objects
WHERE bucket_id = 'registres'
AND name = 'FILENAME_ICI.pdf';
*/











































