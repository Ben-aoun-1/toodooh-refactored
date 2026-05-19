/*
  Script pour ajouter la colonne zone (secteur/zone géographique) 
  à la table business_profiles pour les propriétaires
  
  La colonne zone est optionnelle car elle concerne uniquement les propriétaires
  (individual_owner et fleet_owner), pas les annonceurs.
*/

-- Ajouter la colonne zone à la table business_profiles
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS zone text;

-- Commentaire sur la colonne
COMMENT ON COLUMN business_profiles.zone IS 'Zone géographique pour les propriétaires (ex: La Marsa, Centre Ville Tunis, etc.)';

-- Vérifier que la colonne a été ajoutée
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'business_profiles' AND column_name = 'zone';





