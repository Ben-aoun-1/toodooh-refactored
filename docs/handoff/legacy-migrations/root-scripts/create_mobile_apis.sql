-- APIs pour l'application mobile des écrans publicitaires
-- Ces fonctions seront utilisées par l'app Android

-- 1. Fonction d'authentification pour les propriétaires d'écrans
CREATE OR REPLACE FUNCTION authenticate_screen_owner(
  email_param text,
  password_param text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_record record;
  profile_record record;
BEGIN
  -- Vérifier les credentials avec Supabase Auth
  -- Note: Cette fonction sera appelée après une authentification réussie côté client
  
  -- Récupérer le profil du propriétaire
  SELECT 
    bp.id,
    bp.user_id,
    bp.business_name,
    bp.contact_name,
    bp.email,
    bp.profile_type,
    bp.status,
    bp.verification_status
  INTO profile_record
  FROM business_profiles bp
  WHERE bp.email = email_param
    AND bp.profile_type IN ('individual_owner', 'fleet_owner')
    AND bp.status = 'approved'
    AND bp.verification_status = 'approved';
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Propriétaire non trouvé ou non approuvé'
    );
  END IF;
  
  -- Retourner les informations du propriétaire
  RETURN json_build_object(
    'success', true,
    'owner', json_build_object(
      'id', profile_record.id,
      'user_id', profile_record.user_id,
      'business_name', profile_record.business_name,
      'contact_name', profile_record.contact_name,
      'email', profile_record.email,
      'profile_type', profile_record.profile_type
    )
  );
END;
$$;

-- 2. Fonction pour créer un nouvel écran depuis l'app mobile
CREATE OR REPLACE FUNCTION create_screen_from_mobile(
  owner_id_param uuid,
  screen_name_param text,
  latitude_param numeric,
  longitude_param numeric,
  ip_address_param text,
  mac_address_param text,
  device_info_param text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_screen_id uuid;
  owner_profile record;
BEGIN
  -- Vérifier que le propriétaire existe et est approuvé
  SELECT id, business_name, contact_name
  INTO owner_profile
  FROM business_profiles
  WHERE user_id = owner_id_param
    AND profile_type IN ('individual_owner', 'fleet_owner')
    AND status = 'approved'
    AND verification_status = 'approved';
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Propriétaire non trouvé ou non approuvé'
    );
  END IF;
  
  -- Créer le nouvel écran
  INSERT INTO screens (
    name,
    owner_id,
    location,
    coordinates,
    screen_type,
    screen_size_inches,
    resolution_width,
    resolution_height,
    status,
    is_online,
    ip_address,
    mac_address,
    device_info,
    created_at,
    updated_at
  ) VALUES (
    screen_name_param,
    owner_id_param,
    'Adresse automatique', -- Sera géocodée plus tard
    point(longitude_param, latitude_param),
    'mobile_tablet',
    10, -- Taille par défaut pour tablette
    1920, -- Résolution par défaut
    1080,
    'active',
    true,
    ip_address_param,
    mac_address_param,
    device_info_param,
    NOW(),
    NOW()
  )
  RETURNING id INTO new_screen_id;
  
  -- Créer une configuration d'affluence par défaut
  INSERT INTO screen_affluence_config (
    screen_id,
    estimated_impressions_per_hour,
    peak_hours_start,
    peak_hours_end,
    created_at
  ) VALUES (
    new_screen_id,
    50, -- Valeur par défaut
    '08:00:00',
    '20:00:00',
    NOW()
  );
  
  RETURN json_build_object(
    'success', true,
    'screen_id', new_screen_id,
    'message', 'Écran créé avec succès'
  );
END;
$$;

-- 3. Fonction pour récupérer les vidéos à diffuser pour un écran
CREATE OR REPLACE FUNCTION get_screen_campaign_videos(
  screen_id_param uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  videos_result json;
BEGIN
  -- Récupérer les vidéos des campagnes actives pour cet écran
  SELECT json_agg(
    json_build_object(
      'video_id', v.id,
      'video_url', v.url,
      'filename', v.filename,
      'campaign_id', ac.id,
      'campaign_name', ac.name,
      'duration', v.duration_seconds,
      'order', cs.display_order
    )
  )
  INTO videos_result
  FROM campaign_screens cs
  JOIN advertising_campaigns ac ON cs.campaign_id = ac.id
  JOIN videos v ON ac.video_id = v.id
  WHERE cs.screen_id = screen_id_param
    AND ac.status = 'active'
    AND ac.content_validation_status = 'approved'
    AND NOW() BETWEEN ac.start_date AND ac.end_date
  ORDER BY cs.display_order;
  
  -- Si aucune vidéo trouvée, retourner une liste vide
  IF videos_result IS NULL THEN
    videos_result := '[]'::json;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'videos', videos_result,
    'count', json_array_length(videos_result)
  );
END;
$$;

-- 4. Fonction pour mettre à jour le statut de l'écran
CREATE OR REPLACE FUNCTION update_screen_status(
  screen_id_param uuid,
  is_online_param boolean,
  last_seen_param timestamp DEFAULT NOW()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Mettre à jour le statut de l'écran
  UPDATE screens
  SET 
    is_online = is_online_param,
    last_seen = last_seen_param,
    updated_at = NOW()
  WHERE id = screen_id_param;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Écran non trouvé'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Statut mis à jour avec succès'
  );
END;
$$;

-- 5. Fonction pour récupérer les informations d'un écran
CREATE OR REPLACE FUNCTION get_screen_info(
  screen_id_param uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  screen_info record;
BEGIN
  SELECT 
    s.id,
    s.name,
    s.owner_id,
    s.location,
    s.coordinates,
    s.screen_type,
    s.screen_size_inches,
    s.resolution_width,
    s.resolution_height,
    s.status,
    s.is_online,
    s.ip_address,
    s.mac_address,
    s.device_info,
    s.created_at,
    s.last_seen,
    bp.business_name,
    bp.contact_name
  INTO screen_info
  FROM screens s
  JOIN business_profiles bp ON s.owner_id = bp.user_id
  WHERE s.id = screen_id_param;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Écran non trouvé'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'screen', json_build_object(
      'id', screen_info.id,
      'name', screen_info.name,
      'owner_id', screen_info.owner_id,
      'location', screen_info.location,
      'coordinates', screen_info.coordinates,
      'screen_type', screen_info.screen_type,
      'screen_size_inches', screen_info.screen_size_inches,
      'resolution_width', screen_info.resolution_width,
      'resolution_height', screen_info.resolution_height,
      'status', screen_info.status,
      'is_online', screen_info.is_online,
      'ip_address', screen_info.ip_address,
      'mac_address', screen_info.mac_address,
      'device_info', screen_info.device_info,
      'created_at', screen_info.created_at,
      'last_seen', screen_info.last_seen,
      'owner_name', screen_info.business_name,
      'contact_name', screen_info.contact_name
    )
  );
END;
$$;

-- Afficher les fonctions créées
SELECT 
  '✅ APIs mobiles créées avec succès' as message;

SELECT 
  proname as function_name,
  'Fonction créée' as status
FROM pg_proc 
WHERE proname IN (
  'authenticate_screen_owner',
  'create_screen_from_mobile',
  'get_screen_campaign_videos',
  'update_screen_status',
  'get_screen_info'
)
ORDER BY proname;































