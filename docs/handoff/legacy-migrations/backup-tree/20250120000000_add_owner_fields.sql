-- Migration: Add agent_toodooh and number_of_screens fields to business_profiles
-- These fields are for individual owners and fleet owners only

-- Add agent_toodooh field (text field for free text)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS agent_toodooh TEXT;

-- Add number_of_screens field (integer field for number of screens)
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS number_of_screens INTEGER;

-- Add a check constraint to ensure number_of_screens is positive if provided
ALTER TABLE business_profiles
ADD CONSTRAINT check_positive_screens 
CHECK (number_of_screens IS NULL OR number_of_screens > 0);

-- Add comment to document the fields
COMMENT ON COLUMN business_profiles.agent_toodooh IS 'Agent Toodooh - champ de saisie libre pour les propriétaires (individuel et parc)';
COMMENT ON COLUMN business_profiles.number_of_screens IS 'Nombre d''écrans - champ numérique pour les propriétaires (individuel et parc)';































