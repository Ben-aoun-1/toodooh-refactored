-- Backfill des comptes auth sans ligne business_profiles.
-- Objectif: rendre visibles dans /admin-users les comptes déjà créés.
--
-- Ce script:
-- 1) détecte les users auth sans business_profile
-- 2) crée un profil "pending" cohérent avec le schéma actuel
-- 3) évite les doublons (ON CONFLICT user_id DO NOTHING)
--
-- Exécution recommandée: Supabase SQL editor (rôle admin/service).

DO $$
DECLARE
  has_email boolean;
  has_zone boolean;
  has_cin boolean;
  has_formule boolean;
  has_agent_toodooh boolean;
  has_number_of_screens boolean;
  has_number_of_rooms boolean;
  has_company_size boolean;
  has_is_active boolean;
  has_onboarding_completed boolean;
  has_is_admin boolean;
  has_status boolean;
  has_verification_status boolean;
  has_terms_accepted boolean;
  has_terms_accepted_at boolean;
  has_registration_doc_url boolean;
  has_registration_doc_path boolean;
  has_cin_doc_url boolean;
  has_business_sector_id boolean;
  has_governorate_id boolean;
  has_business_type boolean;
  has_profile_type boolean;

  cols text[] := ARRAY['user_id', 'business_name', 'tax_number', 'contact_name', 'contact_phone', 'street_address', 'city', 'postal_code'];
  vals text[] := ARRAY[
    'm.user_id',
    'm.business_name',
    'm.tax_number',
    'm.contact_name',
    'm.contact_phone',
    quote_literal('Adresse à compléter'),
    quote_literal('Ville à compléter'),
    quote_literal('0000')
  ];

  sql text;
  inserted_count integer := 0;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'email') INTO has_email;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'zone') INTO has_zone;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'cin') INTO has_cin;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'formule') INTO has_formule;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'agent_toodooh') INTO has_agent_toodooh;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'number_of_screens') INTO has_number_of_screens;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'number_of_rooms') INTO has_number_of_rooms;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'company_size') INTO has_company_size;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'is_active') INTO has_is_active;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'onboarding_completed') INTO has_onboarding_completed;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'is_admin') INTO has_is_admin;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'status') INTO has_status;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'verification_status') INTO has_verification_status;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'terms_accepted') INTO has_terms_accepted;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'terms_accepted_at') INTO has_terms_accepted_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'registration_doc_url') INTO has_registration_doc_url;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'registration_doc_path') INTO has_registration_doc_path;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'cin_doc_url') INTO has_cin_doc_url;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'business_sector_id') INTO has_business_sector_id;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'governorate_id') INTO has_governorate_id;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'business_type') INTO has_business_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'profile_type') INTO has_profile_type;

  IF has_email THEN
    cols := array_append(cols, 'email');
    vals := array_append(vals, 'm.email');
  END IF;
  IF has_business_sector_id THEN
    cols := array_append(cols, 'business_sector_id');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_governorate_id THEN
    cols := array_append(cols, 'governorate_id');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_business_type THEN
    cols := array_append(cols, 'business_type');
    vals := array_append(vals, quote_literal('local') || '::business_type');
  END IF;
  IF has_profile_type THEN
    cols := array_append(cols, 'profile_type');
    vals := array_append(vals, 'm.profile_type');
  END IF;
  IF has_terms_accepted THEN
    cols := array_append(cols, 'terms_accepted');
    vals := array_append(vals, 'true');
  END IF;
  IF has_terms_accepted_at THEN
    cols := array_append(cols, 'terms_accepted_at');
    vals := array_append(vals, 'now()');
  END IF;
  IF has_verification_status THEN
    cols := array_append(cols, 'verification_status');
    vals := array_append(vals, quote_literal('pending') || '::verification_status');
  END IF;
  IF has_status THEN
    cols := array_append(cols, 'status');
    vals := array_append(vals, quote_literal('pending'));
  END IF;
  IF has_onboarding_completed THEN
    cols := array_append(cols, 'onboarding_completed');
    vals := array_append(vals, 'false');
  END IF;
  IF has_is_admin THEN
    cols := array_append(cols, 'is_admin');
    vals := array_append(vals, 'false');
  END IF;
  IF has_is_active THEN
    cols := array_append(cols, 'is_active');
    vals := array_append(vals, 'true');
  END IF;
  IF has_zone THEN
    cols := array_append(cols, 'zone');
    vals := array_append(vals, quote_literal(''));
  END IF;
  IF has_cin THEN
    cols := array_append(cols, 'cin');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_formule THEN
    cols := array_append(cols, 'formule');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_agent_toodooh THEN
    cols := array_append(cols, 'agent_toodooh');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_number_of_screens THEN
    cols := array_append(cols, 'number_of_screens');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_number_of_rooms THEN
    cols := array_append(cols, 'number_of_rooms');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_company_size THEN
    cols := array_append(cols, 'company_size');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_registration_doc_url THEN
    cols := array_append(cols, 'registration_doc_url');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_registration_doc_path THEN
    cols := array_append(cols, 'registration_doc_path');
    vals := array_append(vals, 'NULL');
  END IF;
  IF has_cin_doc_url THEN
    cols := array_append(cols, 'cin_doc_url');
    vals := array_append(vals, 'NULL');
  END IF;

  sql := format($f$
    WITH missing AS (
      SELECT
        u.id AS user_id,
        u.email,
        COALESCE(
          NULLIF(trim(u.raw_user_meta_data->>'business_name'), ''),
          NULLIF(trim(split_part(u.email, '@', 1)), ''),
          'Compte'
        ) AS business_name,
        'TEMP-BF-' || substr(replace(u.id::text, '-', ''), 1, 8) || '-' || extract(epoch FROM now())::bigint AS tax_number,
        COALESCE(
          NULLIF(trim(
            concat_ws(' ',
              NULLIF(u.raw_user_meta_data->>'first_name', ''),
              NULLIF(u.raw_user_meta_data->>'last_name', '')
            )
          ), ''),
          NULLIF(trim(split_part(u.email, '@', 1)), ''),
          'Contact'
        ) AS contact_name,
        CASE
          WHEN (u.raw_user_meta_data->>'contact_phone') ~ '^\+[1-9]\d{1,14}$'
            THEN u.raw_user_meta_data->>'contact_phone'
          ELSE '+21600000000'
        END AS contact_phone,
        CASE
          WHEN COALESCE(u.raw_user_meta_data->>'profile_type', u.raw_app_meta_data->>'profile_type') IN ('advertiser', 'individual_owner', 'fleet_owner')
            THEN COALESCE(u.raw_user_meta_data->>'profile_type', u.raw_app_meta_data->>'profile_type')::profile_type
          ELSE 'advertiser'::profile_type
        END AS profile_type
      FROM auth.users u
      LEFT JOIN public.business_profiles bp ON bp.user_id = u.id
      WHERE bp.user_id IS NULL
    )
    INSERT INTO public.business_profiles (%s)
    SELECT %s
    FROM missing m
  $f$, array_to_string(cols, ', '), array_to_string(vals, ', '));

  EXECUTE sql;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RAISE NOTICE 'Backfill terminé. Profils insérés: %', inserted_count;
END $$;

-- Vérification finale
SELECT
  (SELECT count(*) FROM auth.users u LEFT JOIN public.business_profiles bp ON bp.user_id = u.id WHERE bp.user_id IS NULL) AS users_sans_profile,
  (SELECT count(*) FROM public.business_profiles) AS total_business_profiles;

