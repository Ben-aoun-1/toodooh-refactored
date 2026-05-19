-- 🔧 Script rapide pour corriger la policy DELETE

-- 1. Vérifier si la policy DELETE existe
SELECT 
  policyname,
  cmd,
  '✅ Policy existe' as statut
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND cmd = 'DELETE'
AND policyname LIKE '%registration%';

-- Si AUCUN résultat → La policy DELETE n'existe pas !

-- 2. Supprimer et recréer la policy DELETE
DROP POLICY IF EXISTS "Users can delete their own registration documents" ON storage.objects;

CREATE POLICY "Users can delete their own registration documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'registres' 
  AND name LIKE auth.uid()::text || '_%'
);

-- 3. Vérifier que c'est créé
SELECT 
  policyname,
  cmd,
  '✅ Policy DELETE créée' as statut
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND cmd = 'DELETE'
AND policyname = 'Users can delete their own registration documents';

-- Devrait retourner 1 ligne avec ✅ Policy DELETE créée











































