/*
  Fix des politiques RLS pour le bucket 'registres'
  
  Problème: Les utilisateurs ne peuvent pas uploader de documents pendant l'inscription
  car les politiques RLS du bucket sont trop restrictives.
  
  Solution: Permettre aux utilisateurs authentifiés d'uploader leurs propres documents
*/

-- ================================================================
-- 1. SUPPRIMER LES ANCIENNES POLITIQUES
-- ================================================================

DROP POLICY IF EXISTS "Utilisateurs peuvent uploader leurs propres documents" ON storage.objects;
DROP POLICY IF EXISTS "Utilisateurs peuvent lire leurs propres documents" ON storage.objects;
DROP POLICY IF EXISTS "Utilisateurs peuvent mettre à jour leurs propres documents" ON storage.objects;
DROP POLICY IF EXISTS "Utilisateurs peuvent supprimer leurs propres documents" ON storage.objects;

-- ================================================================
-- 2. CRÉER LES NOUVELLES POLITIQUES POUR LE BUCKET 'registres'
-- ================================================================

-- INSERT: Permettre aux utilisateurs authentifiés d'uploader
-- Les fichiers commencent par 'cin_' ou 'rne_' suivi de leur user_id
CREATE POLICY "Les utilisateurs peuvent uploader leurs documents dans registres"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'registres' AND
  (
    -- Fichiers CIN: cin_{user_id}_timestamp.ext
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    -- Fichiers RNE: rne_{user_id}_timestamp.ext
    (name LIKE 'rne_' || auth.uid()::text || '%')
  )
);

-- SELECT: Permettre aux utilisateurs de lire leurs propres documents
CREATE POLICY "Les utilisateurs peuvent lire leurs documents dans registres"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'registres' AND
  (
    -- Fichiers CIN: cin_{user_id}_timestamp.ext
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    -- Fichiers RNE: rne_{user_id}_timestamp.ext
    (name LIKE 'rne_' || auth.uid()::text || '%')
  )
);

-- UPDATE: Permettre aux utilisateurs de mettre à jour leurs documents
CREATE POLICY "Les utilisateurs peuvent MAJ leurs documents dans registres"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'registres' AND
  (
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    (name LIKE 'rne_' || auth.uid()::text || '%')
  )
)
WITH CHECK (
  bucket_id = 'registres' AND
  (
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    (name LIKE 'rne_' || auth.uid()::text || '%')
  )
);

-- DELETE: Permettre aux utilisateurs de supprimer leurs documents
CREATE POLICY "Les utilisateurs peuvent supprimer leurs documents dans registres"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'registres' AND
  (
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    (name LIKE 'rne_' || auth.uid()::text || '%')
  )
);

-- ================================================================
-- 3. POLITIQUES POUR LES ADMINS
-- ================================================================

-- Les admins peuvent tout voir et gérer dans le bucket registres
CREATE POLICY "Les admins peuvent tout faire dans registres"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'registres' AND
  EXISTS (
    SELECT 1 FROM business_profiles
    WHERE user_id = auth.uid() AND is_admin = true
  )
)
WITH CHECK (
  bucket_id = 'registres' AND
  EXISTS (
    SELECT 1 FROM business_profiles
    WHERE user_id = auth.uid() AND is_admin = true
  )
);

-- ================================================================
-- VÉRIFICATION
-- ================================================================

-- Lister toutes les politiques du bucket registres
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'objects' 
  AND policyname LIKE '%registres%'
ORDER BY policyname;

SELECT '✅ Politiques RLS du bucket registres configurées avec succès !' as message;

