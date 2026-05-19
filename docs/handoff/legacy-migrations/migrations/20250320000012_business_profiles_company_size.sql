-- Taille de l'entreprise pour l'espace annonceur (ex: 1-5, 6-10)
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS company_size text;
