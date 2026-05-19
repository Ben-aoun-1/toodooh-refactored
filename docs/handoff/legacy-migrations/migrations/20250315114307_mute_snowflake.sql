/*
  # Configuration des administrateurs

  1. Modifications
    - Ajout du champ `is_admin` à la table `business_profiles`
    - Création d'un compte administrateur par défaut via les fonctions d'administration
    - Ajout de politiques RLS pour les administrateurs

  2. Sécurité
    - Seuls les administrateurs peuvent voir tous les profils
    - Les administrateurs peuvent gérer les statuts de vérification
*/

-- Ajout du champ is_admin
ALTER TABLE business_profiles
ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- Création d'un compte administrateur par défaut
DO $$
DECLARE
  admin_uid UUID;
BEGIN
  -- Créer l'utilisateur via la fonction d'administration
  SELECT id INTO admin_uid FROM auth.users
  WHERE email = 'admin@leviosa.tn';

  IF admin_uid IS NULL THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'admin@leviosa.tn',
      crypt('Admin123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"name":"Administrateur"}',
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
    RETURNING id INTO admin_uid;
  END IF;

  -- Créer le profil administrateur
  INSERT INTO business_profiles (
    user_id,
    business_name,
    tax_number,
    business_type,
    contact_name,
    contact_phone,
    street_address,
    city,
    postal_code,
    terms_accepted,
    terms_accepted_at,
    verification_status,
    is_admin
  )
  SELECT
    admin_uid,
    'Leviosa Administration',
    '000000000',
    'agency',
    'Administrateur',
    '+21612345678',
    'Avenue Habib Bourguiba',
    'Tunis',
    '1001',
    true,
    now(),
    'verified',
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM business_profiles WHERE user_id = admin_uid
  );
END $$;

-- Mise à jour des politiques RLS pour les administrateurs
CREATE POLICY "Les administrateurs peuvent voir tous les profils"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (
    (auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE is_admin = true
    ))
  );

CREATE POLICY "Les administrateurs peuvent mettre à jour les statuts de vérification"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE is_admin = true
    ))
  )
  WITH CHECK (
    (auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE is_admin = true
    ))
  );

-- Mise à jour des politiques RLS pour les campagnes
CREATE POLICY "Les administrateurs peuvent voir toutes les campagnes"
  ON campaigns FOR SELECT
  TO authenticated
  USING (
    (auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE is_admin = true
    ))
  );

CREATE POLICY "Les administrateurs peuvent mettre à jour les campagnes"
  ON campaigns FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE is_admin = true
    ))
  )
  WITH CHECK (
    (auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE is_admin = true
    ))
  );