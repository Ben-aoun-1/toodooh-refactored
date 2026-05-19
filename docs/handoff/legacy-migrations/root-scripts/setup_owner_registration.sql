/*
  ================================================================
  SCRIPT CONSOLIDÉ - SETUP INSCRIPTION PROPRIÉTAIRES
  ================================================================
  
  Ce script regroupe toutes les modifications nécessaires pour
  le nouveau système d'inscription des propriétaires :
  
  1. Ajout des secteurs d'activité spécifiques aux propriétaires
  2. Ajout de la colonne zone (secteur géographique)
  3. Ajout de la colonne cin (numéro CIN)
  4. Ajout de la colonne cin_doc_url (document CIN)
  
  ⚠️ IMPORTANT: Après avoir exécuté ce script, exécutez aussi:
     - verify_and_fix_registres_bucket.sql (pour configurer les permissions d'upload)
  
  Date: 21 octobre 2025
  Phase: TEST (documents facultatifs)
  ================================================================
*/

-- ================================================================
-- 1. SECTEURS D'ACTIVITÉ POUR PROPRIÉTAIRES
-- ================================================================

INSERT INTO business_sectors (name) VALUES
  ('Cafés populaires'),
  ('Bars'),
  ('Restaurant'),
  ('Café étudiant'),
  ('Salon de thé'),
  ('Café gaming')
ON CONFLICT (name) DO NOTHING;

-- Vérifier que les secteurs ont été créés
SELECT id, name FROM business_sectors 
WHERE name IN ('Cafés populaires', 'Bars', 'Restaurant', 'Café étudiant', 'Salon de thé', 'Café gaming')
ORDER BY name;

-- ================================================================
-- 2. COLONNE ZONE (Secteur géographique)
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS zone text;

COMMENT ON COLUMN business_profiles.zone IS 'Zone géographique pour les propriétaires (ex: La Marsa, Centre Ville Tunis, etc.)';

-- ================================================================
-- 3. COLONNE CIN (Numéro CIN)
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS cin text;

COMMENT ON COLUMN business_profiles.cin IS 'Numéro de CIN (Carte d''Identité Nationale) pour les propriétaires individuels (8 chiffres)';

-- ================================================================
-- 4. COLONNE CIN_DOC_URL (Document CIN)
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS cin_doc_url text;

COMMENT ON COLUMN business_profiles.cin_doc_url IS 'URL du document CIN (Carte d''Identité Nationale) pour les propriétaires individuels';

-- ================================================================
-- VÉRIFICATION FINALE
-- ================================================================

-- Afficher toutes les nouvelles colonnes ajoutées
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'business_profiles' 
  AND column_name IN ('zone', 'cin', 'cin_doc_url')
ORDER BY column_name;

-- Compter les secteurs pour propriétaires
SELECT COUNT(*) as nb_secteurs_proprietaires
FROM business_sectors
WHERE name IN ('Cafés populaires', 'Bars', 'Restaurant', 'Café étudiant', 'Salon de thé', 'Café gaming');

-- ================================================================
-- FIN DU SCRIPT
-- ================================================================

SELECT '✅ Setup inscription propriétaires terminé avec succès !' as message;

