-- =====================================================
-- APIs externes GETLOCALITE et CREATELOCALITE (Data API / RPC)
-- Table des clés API + deux fonctions RPC pour système externe
-- =====================================================

-- Extension pour hasher les clés API (sha256)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Table des clés API externes
CREATE TABLE IF NOT EXISTS external_api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_api_keys_key_hash ON external_api_keys(key_hash);

-- Exemple : insérer une clé de test (hash de 'test-api-key-change-me')
-- En prod, générer le hash avec : SELECT encode(digest('VOTRE_CLE_SECRETE', 'sha256'), 'hex');
INSERT INTO external_api_keys (key_hash, name, active)
VALUES (
  encode(digest('test-api-key-change-me', 'sha256'), 'hex'),
  'Clé de test Postman',
  true
)
ON CONFLICT (key_hash) DO NOTHING;

-- 2. RPC getlocalite(api_key, email) : liste localités + écrans du propriétaire
CREATE OR REPLACE FUNCTION getlocalite(api_key text, email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_api_key text := getlocalite.api_key;
  v_email_param text := getlocalite.email;
  v_key_valid boolean;
  v_user_id uuid;
  v_email text;
  v_owner json;
  v_locations json;
BEGIN
  -- 1. Vérifier la clé API
  SELECT EXISTS (
    SELECT 1 FROM external_api_keys
    WHERE key_hash = encode(digest(v_api_key, 'sha256'), 'hex')
      AND active = true
  ) INTO v_key_valid;

  IF NOT v_key_valid OR v_api_key IS NULL OR trim(v_api_key) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized', 'code', 401);
  END IF;

  -- 2. Valider l'email
  IF v_email_param IS NULL OR trim(v_email_param) = '' OR v_email_param !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN json_build_object('success', false, 'error', 'Email invalide', 'code', 400);
  END IF;

  -- 3. Résoudre l'utilisateur par email
  SELECT u.id, u.email INTO v_user_id, v_email
  FROM auth.users u
  WHERE u.email = trim(v_email_param)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Propriétaire non trouvé', 'code', 404);
  END IF;

  -- 4. Construire l'objet owner (profil business + email)
  SELECT json_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'business_name', COALESCE(bp.business_name, ''),
    'contact_name', COALESCE(bp.contact_name, ''),
    'contact_phone', COALESCE(bp.contact_phone, ''),
    'city', COALESCE(bp.city, '')
  ) INTO v_owner
  FROM business_profiles bp
  WHERE bp.user_id = v_user_id
  LIMIT 1;

  IF v_owner IS NULL THEN
    v_owner := json_build_object(
      'user_id', v_user_id,
      'email', v_email,
      'business_name', '',
      'contact_name', '',
      'contact_phone', '',
      'city', ''
    );
  END IF;

  -- 5. Construire la liste des localités avec leurs écrans
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', loc.id,
        'name', loc.name,
        'screens', (
          SELECT COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name)), '[]'::json)
          FROM screens s
          WHERE s.location_id = loc.id
        )
      )
      ORDER BY loc.name
    ),
    '[]'::json
  ) INTO v_locations
  FROM locations loc
  WHERE loc.owner_id = v_user_id;

  IF v_locations IS NULL THEN
    v_locations := '[]'::json;
  END IF;

  RETURN json_build_object(
    'success', true,
    'owner', v_owner,
    'locations', v_locations
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Erreur interne',
      'code', 500,
      'details', SQLERRM
    );
END;
$$;

-- 3. RPC createlocalite(api_key, email, name) : créer une localité pour le propriétaire
CREATE OR REPLACE FUNCTION createlocalite(api_key text, email text, name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_api_key text := createlocalite.api_key;
  v_email_param text := createlocalite.email;
  v_name_param text := createlocalite.name;
  v_key_valid boolean;
  v_user_id uuid;
  v_name_trim text;
  v_location_id uuid;
BEGIN
  -- 1. Vérifier la clé API
  SELECT EXISTS (
    SELECT 1 FROM external_api_keys
    WHERE key_hash = encode(digest(v_api_key, 'sha256'), 'hex')
      AND active = true
  ) INTO v_key_valid;

  IF NOT v_key_valid OR v_api_key IS NULL OR trim(v_api_key) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized', 'code', 401);
  END IF;

  -- 2. Valider email
  IF v_email_param IS NULL OR trim(v_email_param) = '' OR v_email_param !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN json_build_object('success', false, 'error', 'Email invalide', 'code', 400);
  END IF;

  -- 3. Valider name
  v_name_trim := trim(v_name_param);
  IF v_name_trim IS NULL OR v_name_trim = '' THEN
    RETURN json_build_object('success', false, 'error', 'Nom de localité invalide', 'code', 400);
  END IF;

  -- 4. Résoudre l'utilisateur par email
  SELECT u.id INTO v_user_id
  FROM auth.users u
  WHERE u.email = trim(v_email_param)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Propriétaire non trouvé', 'code', 404);
  END IF;

  -- 5. Insérer la localité (SECURITY DEFINER contourne RLS)
  INSERT INTO locations (owner_id, name)
  VALUES (v_user_id, v_name_trim)
  RETURNING id INTO v_location_id;

  RETURN json_build_object('success', true, 'location_id', v_location_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Localité déjà existante', 'code', 409);
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Erreur interne',
      'code', 500,
      'details', SQLERRM
    );
END;
$$;

-- Permissions d'exécution (anon peut appeler ces RPC ; la sécurité est dans la clé api_key)
GRANT EXECUTE ON FUNCTION getlocalite(text, text) TO anon;
GRANT EXECUTE ON FUNCTION getlocalite(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION createlocalite(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION createlocalite(text, text, text) TO authenticated;
