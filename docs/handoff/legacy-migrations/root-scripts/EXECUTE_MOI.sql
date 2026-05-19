/*
  ================================================================
  SCRIPT COMPLET - À EXÉCUTER EN PREMIER
  ================================================================
  
  Ce script résout 2 problèmes:
  1. Régression: Les utilisateurs non validés avaient accès → CORRIGÉ dans le code
  2. Upload: Les documents n'étaient pas uploadés → CORRIGÉ par ce script SQL
  
  Exécutez ce script dans Supabase SQL Editor
  ================================================================
*/

-- ================================================================
-- PARTIE 1: SETUP INSCRIPTION PROPRIÉTAIRES
-- ================================================================

-- 1. Secteurs d'activité pour propriétaires
INSERT INTO business_sectors (name) VALUES
  ('Cafés populaires'),
  ('Bars'),
  ('Restaurant'),
  ('Café étudiant'),
  ('Salon de thé'),
  ('Café gaming')
ON CONFLICT (name) DO NOTHING;

-- 2. Colonnes pour propriétaires
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS zone text;

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS cin text;

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS cin_doc_url text;

-- Commentaires
COMMENT ON COLUMN business_profiles.zone IS 'Zone géographique pour les propriétaires';
COMMENT ON COLUMN business_profiles.cin IS 'Numéro CIN (8 chiffres) pour les propriétaires individuels';
COMMENT ON COLUMN business_profiles.cin_doc_url IS 'URL du document CIN pour les propriétaires individuels';

-- ================================================================
-- PARTIE 2: FIX BUCKET REGISTRES (CRITIQUE POUR L'UPLOAD)
-- ================================================================

-- Créer le bucket s'il n'existe pas
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'registres') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'registres',
      'registres',
      false,
      5242880,
      ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']::text[]
    );
    RAISE NOTICE '✅ Bucket registres créé';
  END IF;
END $$;

-- Supprimer les anciennes politiques
DROP POLICY IF EXISTS "Les utilisateurs peuvent uploader leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent MAJ leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs documents dans registres" ON storage.objects;
DROP POLICY IF EXISTS "Les admins peuvent tout faire dans registres" ON storage.objects;

-- Créer les nouvelles politiques
CREATE POLICY "Les utilisateurs peuvent uploader leurs documents dans registres"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'registres' AND
  (
    (name LIKE 'cin_' || auth.uid()::text || '%') OR
    (name LIKE 'rne_' || auth.uid()::text || '%') OR
    (name LIKE auth.uid()::text || '%')
  )
);

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

CREATE POLICY "Les utilisateurs peuvent MAJ leurs documents dans registres"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'registres' AND (name LIKE 'cin_' || auth.uid()::text || '%' OR name LIKE 'rne_' || auth.uid()::text || '%' OR name LIKE auth.uid()::text || '%'))
WITH CHECK (bucket_id = 'registres' AND (name LIKE 'cin_' || auth.uid()::text || '%' OR name LIKE 'rne_' || auth.uid()::text || '%' OR name LIKE auth.uid()::text || '%'));

CREATE POLICY "Les utilisateurs peuvent supprimer leurs documents dans registres"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'registres' AND (name LIKE 'cin_' || auth.uid()::text || '%' OR name LIKE 'rne_' || auth.uid()::text || '%' OR name LIKE auth.uid()::text || '%'));

CREATE POLICY "Les admins peuvent tout faire dans registres"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'registres' AND EXISTS (SELECT 1 FROM business_profiles WHERE user_id = auth.uid() AND is_admin = true))
WITH CHECK (bucket_id = 'registres' AND EXISTS (SELECT 1 FROM business_profiles WHERE user_id = auth.uid() AND is_admin = true));

-- ================================================================
-- VÉRIFICATIONS
-- ================================================================

SELECT '✅ SETUP TERMINÉ AVEC SUCCÈS !' as message;
SELECT COUNT(*) as nb_secteurs_proprietaires FROM business_sectors WHERE name IN ('Cafés populaires', 'Bars', 'Restaurant', 'Café étudiant', 'Salon de thé', 'Café gaming');
SELECT column_name FROM information_schema.columns WHERE table_name = 'business_profiles' AND column_name IN ('zone', 'cin', 'cin_doc_url');
SELECT COUNT(*) as nb_policies_registres FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE '%registres%';

