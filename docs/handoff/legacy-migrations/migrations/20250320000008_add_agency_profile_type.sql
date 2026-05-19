-- Ajouter la valeur 'agency' à l'enum profile_type
ALTER TYPE profile_type ADD VALUE IF NOT EXISTS 'agency';

-- Mettre à jour le CHECK constraint sur auth.users.profile_type pour inclure 'agency'
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_profile_type_check;
ALTER TABLE auth.users ADD CONSTRAINT users_profile_type_check
  CHECK (profile_type IN ('advertiser', 'agency', 'individual_owner', 'fleet_owner'));
