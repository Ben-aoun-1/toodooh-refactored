-- Vérifier si la colonne email existe dans business_profiles
-- et l'ajouter si elle n'existe pas

-- Ajouter la colonne 'email' si elle n'existe pas
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Créer un index sur la colonne 'email' pour des requêtes plus rapides
CREATE INDEX IF NOT EXISTS idx_business_profiles_email ON business_profiles(email);

-- Optionnel: Mettre à jour les emails existants depuis auth.users
-- (Cette requête nécessite des permissions spéciales et peut ne pas fonctionner)
-- UPDATE business_profiles 
-- SET email = auth.users.email 
-- FROM auth.users 
-- WHERE business_profiles.user_id = auth.users.id;

-- Vérifier la structure de la table après modification
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'business_profiles' 
ORDER BY ordinal_position;












































