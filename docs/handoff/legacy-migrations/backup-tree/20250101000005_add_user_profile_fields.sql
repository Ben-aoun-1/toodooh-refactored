-- Migration pour ajouter raison_social et profile_type à auth.users
-- Date: 2025-01-01

-- 1. Ajouter les colonnes à la table auth.users
ALTER TABLE auth.users 
ADD COLUMN IF NOT EXISTS raison_social TEXT,
ADD COLUMN IF NOT EXISTS profile_type TEXT CHECK (profile_type IN ('advertiser', 'individual_owner', 'fleet_owner'));

-- 2. Créer un index sur profile_type pour les performances
CREATE INDEX IF NOT EXISTS idx_users_profile_type ON auth.users(profile_type);

-- 3. Mettre à jour les utilisateurs existants avec les données de business_profiles
UPDATE auth.users 
SET 
    raison_social = bp.contact_name,
    profile_type = bp.profile_type
FROM business_profiles bp 
WHERE auth.users.id = bp.user_id 
AND auth.users.raison_social IS NULL;

-- 4. Pour les utilisateurs sans profil, définir des valeurs par défaut
UPDATE auth.users 
SET 
    raison_social = COALESCE(raison_social, split_part(email, '@', 1)),
    profile_type = COALESCE(profile_type, 'advertiser')
WHERE raison_social IS NULL OR profile_type IS NULL;

-- 5. Vérifier le résultat
SELECT 
    id,
    email,
    raison_social,
    profile_type,
    created_at
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 10; 