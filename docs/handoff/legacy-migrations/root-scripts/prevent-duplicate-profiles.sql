-- Script pour empêcher les profils multiples avec le même email
-- À exécuter dans Supabase SQL Editor

-- 1. Ajouter une contrainte unique sur user_id dans business_profiles
-- (Un utilisateur ne peut avoir qu'un seul profil business)
ALTER TABLE business_profiles 
ADD CONSTRAINT unique_user_business_profile 
UNIQUE (user_id);

-- 2. Vérifier la contrainte
SELECT 
  'Contraintes sur business_profiles:' as info,
  conname as constraint_name,
  contype as constraint_type
FROM pg_constraint 
WHERE conrelid = 'business_profiles'::regclass
AND conname = 'unique_user_business_profile';

-- 3. Créer une fonction pour gérer la création de profils
CREATE OR REPLACE FUNCTION create_business_profile_safe(
  p_user_id UUID,
  p_business_name TEXT,
  p_profile_type TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_street_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  profile_id UUID;
BEGIN
  -- Vérifier si un profil existe déjà
  IF EXISTS (SELECT 1 FROM business_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Un profil business existe déjà pour cet utilisateur';
  END IF;
  
  -- Créer le profil
  INSERT INTO business_profiles (
    user_id,
    business_name,
    tax_number,
    business_sector_id,
    business_type,
    profile_type,
    contact_name,
    contact_phone,
    street_address,
    city,
    postal_code,
    governorate_id,
    terms_accepted,
    terms_accepted_at,
    verification_status,
    onboarding_completed,
    is_admin
  ) VALUES (
    p_user_id,
    p_business_name,
    'AUTO-' || EXTRACT(EPOCH FROM NOW())::TEXT,
    NULL,
    'local',
    p_profile_type,
    p_contact_name,
    p_contact_phone,
    p_street_address,
    p_city,
    p_postal_code,
    NULL,
    true,
    now(),
    'pending',
    false,
    false
  ) RETURNING id INTO profile_id;
  
  RETURN profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Créer une fonction pour mettre à jour le profil existant
CREATE OR REPLACE FUNCTION update_business_profile_safe(
  p_user_id UUID,
  p_business_name TEXT DEFAULT NULL,
  p_profile_type TEXT DEFAULT NULL,
  p_contact_name TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_street_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  -- Vérifier si un profil existe
  IF NOT EXISTS (SELECT 1 FROM business_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Aucun profil business trouvé pour cet utilisateur';
  END IF;
  
  -- Mettre à jour le profil
  UPDATE business_profiles 
  SET 
    business_name = COALESCE(p_business_name, business_name),
    profile_type = COALESCE(p_profile_type, profile_type),
    contact_name = COALESCE(p_contact_name, contact_name),
    contact_phone = COALESCE(p_contact_phone, contact_phone),
    street_address = COALESCE(p_street_address, street_address),
    city = COALESCE(p_city, city),
    postal_code = COALESCE(p_postal_code, postal_code),
    updated_at = now()
  WHERE user_id = p_user_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Créer une fonction pour obtenir ou créer un profil
CREATE OR REPLACE FUNCTION get_or_create_business_profile(
  p_user_id UUID,
  p_business_name TEXT,
  p_profile_type TEXT,
  p_contact_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  profile_id UUID;
BEGIN
  -- Essayer de récupérer le profil existant
  SELECT id INTO profile_id 
  FROM business_profiles 
  WHERE user_id = p_user_id;
  
  -- Si le profil existe, le retourner
  IF profile_id IS NOT NULL THEN
    RETURN profile_id;
  END IF;
  
  -- Sinon, créer un nouveau profil
  SELECT create_business_profile_safe(
    p_user_id,
    p_business_name,
    p_profile_type,
    p_contact_name
  ) INTO profile_id;
  
  RETURN profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Tester les fonctions
SELECT 
  'Fonctions créées:' as info,
  proname as function_name,
  prokind as function_type
FROM pg_proc 
WHERE proname IN (
  'create_business_profile_safe',
  'update_business_profile_safe', 
  'get_or_create_business_profile'
);

-- 7. Vérifier les contraintes
SELECT 
  'Contraintes finales:' as info,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'business_profiles'::regclass;
