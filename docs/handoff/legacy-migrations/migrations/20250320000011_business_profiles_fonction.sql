-- Champ fonction (poste du responsable) pour la page Paramètres > Responsable
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS fonction text;
