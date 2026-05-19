-- =====================================================
-- API externe UPSERT_LOCATION_AFFLUENCE_SCHEDULE (Data API / RPC)
-- Mise à jour ou insertion de l'affluence par localité (jour + heure)
-- =====================================================
--
-- SECURITY DEFINER : les INSERT/UPDATE dans location_affluence_schedule s'exécutent avec les droits
-- du propriétaire de la fonction (rôle migration / postgres), pas ceux du JWT appelant — la RLS
-- appliquée aux clients REST ne bloque pas cet upsert. Les policies "lecture annonceur" (FOR SELECT)
-- sont sans effet sur cette RPC.

-- RPC upsert_location_affluence_schedule(api_key, slots)
-- slots = JSON array of { location_id, day_of_week, hour, estimated_impressions }
-- Si (location_id, day_of_week, hour) existe → UPDATE estimated_impressions
-- Sinon → INSERT
CREATE OR REPLACE FUNCTION upsert_location_affluence_schedule(api_key text, slots jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
DECLARE
  v_api_key text := upsert_location_affluence_schedule.api_key;
  v_slots jsonb := upsert_location_affluence_schedule.slots;
  v_key_valid boolean;
  v_slot jsonb;
  v_location_id uuid;
  v_day int;
  v_hour int;
  v_impressions int;
  v_location_exists boolean;
  v_affected int := 0;
  v_idx int;
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

  -- 2. Valider que slots est un tableau non vide
  IF v_slots IS NULL OR jsonb_typeof(v_slots) <> 'array' OR jsonb_array_length(v_slots) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'slots doit être un tableau non vide', 'code', 400);
  END IF;

  -- 3. Valider chaque slot et effectuer l'upsert
  FOR v_idx IN 0 .. (jsonb_array_length(v_slots) - 1) LOOP
    v_slot := v_slots->v_idx;

    v_location_id := (v_slot->>'location_id')::uuid;
    v_day := (v_slot->>'day_of_week')::int;
    v_hour := (v_slot->>'hour')::int;
    v_impressions := (v_slot->>'estimated_impressions')::int;

    IF v_location_id IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'location_id invalide (slot ' || (v_idx + 1) || ')', 'code', 400);
    END IF;
    IF v_day IS NULL OR v_day < 1 OR v_day > 7 THEN
      RETURN json_build_object('success', false, 'error', 'day_of_week invalide (1-7, slot ' || (v_idx + 1) || ')', 'code', 400);
    END IF;
    IF v_hour IS NULL OR v_hour < 0 OR v_hour > 23 THEN
      RETURN json_build_object('success', false, 'error', 'hour invalide (0-23, slot ' || (v_idx + 1) || ')', 'code', 400);
    END IF;
    IF v_impressions IS NULL OR v_impressions < 0 THEN
      RETURN json_build_object('success', false, 'error', 'estimated_impressions invalide (>= 0, slot ' || (v_idx + 1) || ')', 'code', 400);
    END IF;

    -- Vérifier que la localité existe
    SELECT EXISTS (SELECT 1 FROM locations WHERE id = v_location_id) INTO v_location_exists;
    IF NOT v_location_exists THEN
      RETURN json_build_object('success', false, 'error', 'Localité non trouvée (location_id slot ' || (v_idx + 1) || ')', 'code', 404);
    END IF;

    INSERT INTO location_affluence_schedule (location_id, day_of_week, hour, estimated_impressions, updated_at)
    VALUES (v_location_id, v_day, v_hour, v_impressions, NOW())
    ON CONFLICT (location_id, day_of_week, hour)
    DO UPDATE SET
      estimated_impressions = EXCLUDED.estimated_impressions,
      updated_at = NOW();

    v_affected := v_affected + 1;
  END LOOP;

  RETURN json_build_object('success', true, 'affected_rows', v_affected);
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

-- Permissions
GRANT EXECUTE ON FUNCTION upsert_location_affluence_schedule(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION upsert_location_affluence_schedule(text, jsonb) TO authenticated;
