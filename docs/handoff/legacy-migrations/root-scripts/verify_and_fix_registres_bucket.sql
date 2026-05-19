/*
  Vérification et configuration complète du bucket 'registres'
  
  1. Vérifier si le bucket existe
  2. Le créer s'il n'existe pas
  3. Configurer les politiques RLS
*/

-- ================================================================
-- 1. VÉRIFIER / CRÉER LE BUCKET
-- ================================================================

-- Vérifier si le bucket existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'registres'
  ) THEN
    -- Créer le bucket s'il n'existe pas
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'registres',
      'registres',
      false, -- Bucket privé
      5242880, -- 5 MB en bytes
      ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']::text[]
    );
    
    RAISE NOTICE '✅ Bucket registres créé avec succès';
  ELSE
    RAISE NOTICE 'ℹ️ Le bucket registres existe déjà';
  END IF;
END $$;

-- ================================================================
-- 2. SUPPRIMER LES ANCIENNES POLITIQUES
-- ================================================================

DROP POLICY IF EXISTS "Les utilisateurs peuvent uploader leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent MAJ leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les admins peuvent tout faire dans registres" ON storage.objects;

-- Supprimer aussi d'éventuelles anciennes politiques
DROP POLICY IF EXISTS "Utilisateurs peuvent uploader leurs propres documents" ON storage.objects;
DROP POLICY IF EXISTS "Utilisateurs peuvent lire leurs propres documents" ON storage.objects;

-- ================================================================
-- 3. CRÉER LES NOUVELLES POLITIQUES
-- ================================================================

-- INSERT: Permettre aux utilisateurs authentifiés d'uploader leurs documents
CREATE POLICY "Les utilisateurs peuvent uploader leurs documents dans registres"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'registres' AND
  (
    -- Fichiers CIN: cin_{user_id}_timestamp.ext
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    -- Fichiers RNE: rne_{user_id}_timestamp.ext  
    (name LIKE 'rne_' || auth.uid()::text || '%') OR
    -- Ancien format (compatibilité): {user_id}_timestamp.ext
    (name LIKE auth.uid()::text || '%')
  )
);

-- SELECT: Permettre aux utilisateurs de lire leurs documents
CREATE POLICY "Les utilisateurs peuvent lire leurs documents dans registres"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'registres' AND
  (
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    (name LIKE 'rne_' || auth.uid()::text || '%') OR
    (name LIKE auth.uid()::text || '%')
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
    (name LIKE 'rne_' || auth.uid()::text || '%') OR
    (name LIKE auth.uid()::text || '%')
  )
)
WITH CHECK (
  bucket_id = 'registres' AND
  (
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    (name LIKE 'rne_' || auth.uid()::text || '%') OR
    (name LIKE auth.uid()::text || '%')
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
    (name LIKE 'rne_' || auth.uid()::text || '%') OR
    (name LIKE auth.uid()::text || '%')
  )
);

-- ================================================================
-- 4. POLITIQUES POUR LES ADMINS (accès complet)
-- ================================================================

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

-- Vérifier le bucket
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'registres';

-- Lister toutes les politiques du bucket registres
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'objects' 
  AND (
    policyname LIKE '%registres%' OR
    qual::text LIKE '%registres%'
  )
ORDER BY policyname;

SELECT '✅ Configuration du bucket registres terminée avec succès !' as message;

