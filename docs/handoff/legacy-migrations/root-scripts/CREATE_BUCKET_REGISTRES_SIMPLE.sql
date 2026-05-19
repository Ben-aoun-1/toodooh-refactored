-- ============================================
-- SCRIPT SIMPLE : Créer le bucket "registres"
-- ============================================
-- Ce script crée TOUT ce qui est nécessaire pour le stockage des registres de commerce

-- 1️⃣ CRÉER LE BUCKET
-- Note : Si vous voyez "duplicate key value violates unique constraint", c'est que le bucket existe déjà
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('registres', 'registres', false, 10485760)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760;

-- Vérifier que le bucket est créé
SELECT 
  id,
  name,
  public,
  file_size_limit,
  created_at,
  '✅ BUCKET CRÉÉ' as statut
FROM storage.buckets
WHERE id = 'registres';

-- Résultat attendu :
-- id: registres
-- name: registres  
-- public: false (IMPORTANT : pas public !)
-- file_size_limit: 10485760 (10 MB)

-- 2️⃣ CRÉER LES POLICIES RLS
-- Supprimer les anciennes si elles existent
DROP POLICY IF EXISTS "Users can upload their own registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Super admins can read all registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own registration documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own registration documents" ON storage.objects;

-- Créer les nouvelles policies
CREATE POLICY "Users can upload their own registration documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'registres' AND name LIKE auth.uid()::text || '_%');

CREATE POLICY "Users can read their own registration documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'registres' AND name LIKE auth.uid()::text || '_%');

CREATE POLICY "Super admins can read all registration documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'registres'
  AND EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE admin_profiles.user_id = auth.uid()
    AND admin_profiles.role = 'superadmin'
    AND admin_profiles.is_active = true
  )
);

CREATE POLICY "Users can update their own registration documents"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'registres' AND name LIKE auth.uid()::text || '_%');

CREATE POLICY "Users can delete their own registration documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'registres' AND name LIKE auth.uid()::text || '_%');

-- 3️⃣ VÉRIFIER QUE TOUT EST CRÉÉ
SELECT 
  policyname,
  cmd as "Type (INSERT/SELECT/UPDATE/DELETE)",
  '✅ POLICY CRÉÉE' as statut
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND policyname LIKE '%registration%'
ORDER BY cmd;

-- Résultat attendu : 5 lignes
-- DELETE | ✅ POLICY CRÉÉE
-- INSERT | ✅ POLICY CRÉÉE
-- SELECT | ✅ POLICY CRÉÉE (user)
-- SELECT | ✅ POLICY CRÉÉE (admin)
-- UPDATE | ✅ POLICY CRÉÉE

-- ============================================
-- 🎉 TERMINÉ !
-- ============================================
-- Vous pouvez maintenant :
-- 1. Recharger votre application (Ctrl+R)
-- 2. Uploader un registre de commerce
-- 3. Le fichier sera stocké dans le bucket "registres"
-- ============================================











































