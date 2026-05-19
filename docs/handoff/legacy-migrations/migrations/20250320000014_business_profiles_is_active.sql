-- Désactivation de compte (suppression = désactivation)
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN business_profiles.is_active IS 'Si false, le compte est désactivé (équivalent « supprimer le compte »).';
