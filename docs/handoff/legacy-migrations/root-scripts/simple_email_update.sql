-- Script simple pour ajouter la colonne email et la remplir

-- 1. Ajouter la colonne email si elle n'existe pas
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 2. Créer une fonction SQL pour récupérer l'email depuis auth.users
CREATE OR REPLACE FUNCTION get_user_email_from_auth(user_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    user_email TEXT;
BEGIN
    -- Cette fonction nécessite des permissions spéciales
    -- Elle peut ne pas fonctionner selon la configuration RLS
    SELECT email INTO user_email 
    FROM auth.users 
    WHERE id = user_uuid;
    
    RETURN COALESCE(user_email, 'N/A');
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'N/A';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Mettre à jour les emails (peut ne pas fonctionner selon les permissions)
UPDATE business_profiles 
SET email = get_user_email_from_auth(user_id)
WHERE email IS NULL OR email = '';

-- 4. Alternative: Mettre à jour manuellement avec des emails d'exemple
-- Décommentez et modifiez selon vos besoins
/*
UPDATE business_profiles 
SET email = 'user' || id || '@example.com'
WHERE email IS NULL OR email = '';
*/

-- 5. Vérifier les résultats
SELECT 
    id,
    user_id,
    business_name,
    email,
    contact_name
FROM business_profiles
ORDER BY created_at DESC
LIMIT 5;

-- 6. Vérifier la structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'business_profiles' 
AND column_name = 'email';












































