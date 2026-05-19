-- Script pour corriger le problème des profils business lors de l'inscription
-- À exécuter dans l'interface SQL de Supabase

-- 1. Créer la fonction RPC pour créer des profils business
CREATE OR REPLACE FUNCTION create_business_profile(
  p_user_id UUID,
  p_business_name TEXT,
  p_tax_number TEXT,
  p_business_sector_id UUID,
  p_business_type business_type,
  p_profile_type profile_type,
  p_contact_name TEXT,
  p_contact_phone TEXT,
  p_street_address TEXT,
  p_city TEXT,
  p_postal_code TEXT,
  p_governorate_id UUID,
  p_terms_accepted BOOLEAN,
  p_terms_accepted_at TIMESTAMPTZ,
  p_verification_status verification_status DEFAULT 'pending',
  p_onboarding_completed BOOLEAN DEFAULT false,
  p_is_admin BOOLEAN DEFAULT false
)
RETURNS UUID
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  -- Validation des données d'entrée
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;
  
  IF p_business_name IS NULL OR p_business_name = '' THEN
    RAISE EXCEPTION 'business_name cannot be null or empty';
  END IF;
  
  IF p_tax_number IS NULL OR p_tax_number = '' THEN
    RAISE EXCEPTION 'tax_number cannot be null or empty';
  END IF;
  
  IF p_contact_name IS NULL OR p_contact_name = '' THEN
    RAISE EXCEPTION 'contact_name cannot be null or empty';
  END IF;
  
  IF p_contact_phone IS NULL OR p_contact_phone = '' THEN
    RAISE EXCEPTION 'contact_phone cannot be null or empty';
  END IF;
  
  IF p_street_address IS NULL OR p_street_address = '' THEN
    RAISE EXCEPTION 'street_address cannot be null or empty';
  END IF;
  
  IF p_city IS NULL OR p_city = '' THEN
    RAISE EXCEPTION 'city cannot be null or empty';
  END IF;
  
  IF p_postal_code IS NULL OR p_postal_code = '' THEN
    RAISE EXCEPTION 'postal_code cannot be null or empty';
  END IF;
  
  IF p_terms_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'terms must be accepted';
  END IF;
  
  -- Vérifier que l'utilisateur existe
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User does not exist';
  END IF;
  
  -- Vérifier que le profil n'existe pas déjà
  IF EXISTS (SELECT 1 FROM business_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Business profile already exists for this user';
  END IF;
  
  -- Vérifier que le numéro de taxe n'est pas déjà utilisé
  IF EXISTS (SELECT 1 FROM business_profiles WHERE tax_number = p_tax_number) THEN
    RAISE EXCEPTION 'Tax number already exists';
  END IF;
  
  -- Insérer le profil
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
    p_tax_number,
    p_business_sector_id,
    p_business_type,
    p_profile_type,
    p_contact_name,
    p_contact_phone,
    p_street_address,
    p_city,
    p_postal_code,
    p_governorate_id,
    p_terms_accepted,
    p_terms_accepted_at,
    p_verification_status,
    p_onboarding_completed,
    p_is_admin
  )
  RETURNING id INTO v_profile_id;
  
  RETURN v_profile_id;
END;
$$;

-- 2. Créer la fonction pour créer un profil par défaut
CREATE OR REPLACE FUNCTION create_default_business_profile(
  p_user_id UUID,
  p_email TEXT
)
RETURNS UUID
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id UUID;
  v_business_name TEXT;
  v_contact_name TEXT;
BEGIN
  -- Générer des noms par défaut basés sur l'email
  v_business_name := COALESCE(split_part(p_email, '@', 1), 'Utilisateur') || ' Entreprise';
  v_contact_name := COALESCE(split_part(p_email, '@', 1), 'Utilisateur');
  
  -- Vérifier que l'utilisateur existe
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User does not exist';
  END IF;
  
  -- Vérifier que le profil n'existe pas déjà
  IF EXISTS (SELECT 1 FROM business_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Business profile already exists for this user';
  END IF;
  
  -- Insérer le profil par défaut
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
    v_business_name,
    'TEMP-' || extract(epoch from now()) || '-' || substr(p_user_id::text, 1, 8),
    NULL,
    'local',
    'advertiser',
    v_contact_name,
    '+21600000000',
    'Adresse à compléter',
    'Ville à compléter',
    '0000',
    NULL,
    true,
    now(),
    'pending',
    false,
    false
  )
  RETURNING id INTO v_profile_id;
  
  RETURN v_profile_id;
END;
$$;

-- 3. Donner les permissions d'exécution
GRANT EXECUTE ON FUNCTION create_business_profile(
  UUID, TEXT, TEXT, UUID, business_type, profile_type, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN, TIMESTAMPTZ, verification_status, BOOLEAN, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION create_default_business_profile(UUID, TEXT) TO authenticated;

-- 4. Corriger les politiques RLS
-- Supprimer toutes les anciennes politiques
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Création de profil lors de l'inscription" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view all business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Users can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can insert own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent voir tous les profils" ON business_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent mettre à jour les statuts de vérification" ON business_profiles;

-- Créer de nouvelles politiques simplifiées
CREATE POLICY "Users can view own business profile"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own business profile"
  ON business_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own business profile"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own business profile"
  ON business_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Politiques pour les administrateurs
CREATE POLICY "Admins can view all business profiles"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM business_profiles bp
      WHERE bp.user_id = auth.uid() AND bp.is_admin = true
    )
  );

CREATE POLICY "Admins can update all business profiles"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM business_profiles bp
      WHERE bp.user_id = auth.uid() AND bp.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_profiles bp
      WHERE bp.user_id = auth.uid() AND bp.is_admin = true
    )
  );

-- Politique pour permettre la création de profils lors de l'inscription
CREATE POLICY "Allow profile creation during signup"
  ON business_profiles FOR INSERT
  TO anon
  WITH CHECK (true);

-- 5. Vérifier que les politiques sont bien appliquées
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd, 
  qual, 
  with_check 
FROM pg_policies 
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- 6. Vérifier les utilisateurs sans profil
SELECT 
  u.id,
  u.email,
  u.created_at,
  CASE WHEN bp.user_id IS NULL THEN 'Sans profil' ELSE 'Avec profil' END as status
FROM auth.users u
LEFT JOIN business_profiles bp ON u.id = bp.user_id
WHERE u.email_confirmed_at IS NOT NULL
ORDER BY u.created_at DESC; 