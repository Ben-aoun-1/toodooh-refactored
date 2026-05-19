-- Ajouter le système de validation aux business_profiles
-- Exécutez ce script dans Supabase SQL Editor

-- 1. Ajouter la colonne status à business_profiles
ALTER TABLE business_profiles 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' 
CHECK (status IN ('pending', 'approved', 'rejected'));

-- 2. Ajouter la colonne validation_notes (optionnel)
ALTER TABLE business_profiles 
ADD COLUMN IF NOT EXISTS validation_notes TEXT;

-- 3. Ajouter la colonne validated_by (ID de l'admin qui a validé)
ALTER TABLE business_profiles 
ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES admin_profiles(id);

-- 4. Ajouter la colonne validated_at (date de validation)
ALTER TABLE business_profiles 
ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP WITH TIME ZONE;

-- 5. Ajouter la colonne updated_at si elle n'existe pas
ALTER TABLE business_profiles 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 6. Créer un index sur le status pour les performances
CREATE INDEX IF NOT EXISTS idx_business_profiles_status ON business_profiles(status);

-- 7. Créer un index sur validated_by
CREATE INDEX IF NOT EXISTS idx_business_profiles_validated_by ON business_profiles(validated_by);

-- 8. Mettre à jour les utilisateurs existants (optionnel - mettre tous en 'approved' par défaut)
-- UPDATE business_profiles SET status = 'approved' WHERE status = 'pending';

-- 9. Vérifier la structure de la table
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'business_profiles' 
ORDER BY ordinal_position;












































