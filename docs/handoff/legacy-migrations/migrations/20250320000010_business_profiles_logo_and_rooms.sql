-- Colonnes optionnelles pour la page Paramètres (Entreprise)
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS number_of_rooms integer;
