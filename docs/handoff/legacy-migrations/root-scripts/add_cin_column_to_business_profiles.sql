/*
  Script pour ajouter la colonne cin (Carte d'Identité Nationale) 
  à la table business_profiles pour les propriétaires individuels
  
  La colonne cin est optionnelle car elle concerne uniquement les propriétaires individuels
  (individual_owner), pas les propriétaires de parc ni les annonceurs.
*/

-- Ajouter la colonne cin à la table business_profiles
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS cin text;

-- Commentaire sur la colonne
COMMENT ON COLUMN business_profiles.cin IS 'Numéro de CIN (Carte d''Identité Nationale) pour les propriétaires individuels (8 chiffres)';

-- Vérifier que la colonne a été ajoutée
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'business_profiles' AND column_name = 'cin';

