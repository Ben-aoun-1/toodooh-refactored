/*
  Script pour ajouter la colonne cin_doc_url
  à la table business_profiles pour stocker le document CIN
  
  Cette colonne est optionnelle car elle concerne uniquement les propriétaires individuels
*/

-- Ajouter la colonne cin_doc_url à la table business_profiles
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS cin_doc_url text;

-- Commentaire sur la colonne
COMMENT ON COLUMN business_profiles.cin_doc_url IS 'URL du document CIN (Carte d''Identité Nationale) pour les propriétaires individuels';

-- Vérifier que la colonne a été ajoutée
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'business_profiles' AND column_name = 'cin_doc_url';

