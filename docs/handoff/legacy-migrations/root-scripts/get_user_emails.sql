-- Script pour récupérer les emails des utilisateurs depuis auth.users
-- et les mettre à jour dans business_profiles

-- 1. D'abord, ajouter la colonne email si elle n'existe pas
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 2. Créer une fonction pour récupérer l'email depuis auth.users
CREATE OR REPLACE FUNCTION get_user_email(user_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    user_email TEXT;
BEGIN
    -- Récupérer l'email depuis auth.users
    SELECT email INTO user_email 
    FROM auth.users 
    WHERE id = user_uuid;
    
    RETURN COALESCE(user_email, 'N/A');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Mettre à jour les emails dans business_profiles
UPDATE business_profiles 
SET email = get_user_email(user_id)
WHERE email IS NULL OR email = '';

-- 4. Créer un index sur la colonne email
CREATE INDEX IF NOT EXISTS idx_business_profiles_email ON business_profiles(email);

-- 5. Vérifier les résultats
SELECT 
    bp.id,
    bp.user_id,
    bp.business_name,
    bp.email,
    bp.contact_name
FROM business_profiles bp
ORDER BY bp.created_at DESC
LIMIT 10;

-- 6. Vérifier la structure de la table
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'business_profiles' 
AND column_name = 'email';












































