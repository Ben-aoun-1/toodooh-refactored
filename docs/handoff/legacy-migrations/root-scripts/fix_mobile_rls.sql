-- Correction des politiques RLS pour l'application mobile
-- Ce script s'assure que toutes les permissions nécessaires sont en place

-- 1. Supprimer les anciennes politiques pour éviter les conflits
DROP POLICY IF EXISTS "Les propriétaires peuvent voir leurs écrans" ON screens;
DROP POLICY IF EXISTS "Les propriétaires peuvent créer leurs écrans" ON screens;
DROP POLICY IF EXISTS "Les propriétaires peuvent modifier leurs écrans" ON screens;
DROP POLICY IF EXISTS "Les propriétaires peuvent voir leurs profils" ON business_profiles;
DROP POLICY IF EXISTS "Tous peuvent voir les campagnes actives" ON advertising_campaigns;
DROP POLICY IF EXISTS "Tous peuvent voir les vidéos des campagnes" ON videos;
DROP POLICY IF EXISTS "Tous peuvent voir les écrans de campagnes" ON campaign_screens;
DROP POLICY IF EXISTS "Les propriétaires peuvent voir leur config affluence" ON screen_affluence_config;

-- 2. Politiques pour business_profiles (lecture pour les propriétaires)
CREATE POLICY "Les propriétaires peuvent voir leurs profils" ON business_profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id 
  OR 
  is_admin_user(auth.uid())
);

-- 3. Politiques pour screens (CRUD pour les propriétaires)
CREATE POLICY "Les propriétaires peuvent voir leurs écrans" ON screens
FOR SELECT TO authenticated
USING (
  auth.uid() = owner_id 
  OR 
  is_admin_user(auth.uid())
);

CREATE POLICY "Les propriétaires peuvent créer leurs écrans" ON screens
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_id
);

CREATE POLICY "Les propriétaires peuvent modifier leurs écrans" ON screens
FOR UPDATE TO authenticated
USING (
  auth.uid() = owner_id
)
WITH CHECK (
  auth.uid() = owner_id
);

-- 4. Politiques pour advertising_campaigns (lecture pour tous les utilisateurs authentifiés)
CREATE POLICY "Tous peuvent voir les campagnes actives" ON advertising_campaigns
FOR SELECT TO authenticated
USING (
  status = 'active' 
  AND 
  content_validation_status = 'approved'
  AND 
  NOW() BETWEEN start_date AND end_date
);

-- 5. Politiques pour videos (lecture pour tous les utilisateurs authentifiés)
CREATE POLICY "Tous peuvent voir les vidéos des campagnes" ON videos
FOR SELECT TO authenticated
USING (true);

-- 6. Politiques pour campaign_screens (lecture pour tous les utilisateurs authentifiés)
CREATE POLICY "Tous peuvent voir les écrans de campagnes" ON campaign_screens
FOR SELECT TO authenticated
USING (true);

-- 7. Politiques pour screen_affluence_config (lecture pour les propriétaires)
CREATE POLICY "Les propriétaires peuvent voir leur config affluence" ON screen_affluence_config
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM screens s 
    WHERE s.id = screen_affluence_config.screen_id 
    AND s.owner_id = auth.uid()
  )
  OR 
  is_admin_user(auth.uid())
);

-- 8. Vérifier que toutes les fonctions mobiles existent
DO $$
BEGIN
  -- Vérifier authenticate_screen_owner
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'authenticate_screen_owner'
  ) THEN
    RAISE EXCEPTION 'Fonction authenticate_screen_owner manquante - Exécutez create_mobile_apis.sql';
  END IF;

  -- Vérifier create_screen_from_mobile
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'create_screen_from_mobile'
  ) THEN
    RAISE EXCEPTION 'Fonction create_screen_from_mobile manquante - Exécutez create_mobile_apis.sql';
  END IF;

  -- Vérifier get_screen_campaign_videos
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_screen_campaign_videos'
  ) THEN
    RAISE EXCEPTION 'Fonction get_screen_campaign_videos manquante - Exécutez create_mobile_apis.sql';
  END IF;

  -- Vérifier update_screen_status
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_screen_status'
  ) THEN
    RAISE EXCEPTION 'Fonction update_screen_status manquante - Exécutez create_mobile_apis.sql';
  END IF;

  -- Vérifier get_screen_info
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_screen_info'
  ) THEN
    RAISE EXCEPTION 'Fonction get_screen_info manquante - Exécutez create_mobile_apis.sql';
  END IF;

  -- Vérifier is_admin_user
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'is_admin_user'
  ) THEN
    RAISE EXCEPTION 'Fonction is_admin_user manquante - Exécutez SOLUTION_FINALE_ADMIN_UPLOAD.sql';
  END IF;

  RAISE NOTICE '✅ Toutes les fonctions mobiles sont présentes';
END $$;

-- 9. Afficher le résumé des politiques créées
SELECT 
  '✅ Politiques RLS pour l''application mobile configurées' as message;

SELECT 
  tablename,
  cmd,
  COUNT(*) as policy_count
FROM pg_policies 
WHERE tablename IN (
  'business_profiles',
  'screens', 
  'campaign_screens',
  'advertising_campaigns',
  'videos',
  'screen_affluence_config'
)
GROUP BY tablename, cmd
ORDER BY tablename, cmd;

-- 10. Test final - Vérifier que RLS est activé
SELECT 
  '🔍 Vérification finale RLS:' as check_section;

SELECT 
  tablename,
  CASE 
    WHEN rowsecurity THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé - ACTIVATION REQUISE'
  END as status
FROM pg_tables 
WHERE tablename IN (
  'business_profiles',
  'screens', 
  'campaign_screens',
  'advertising_campaigns',
  'videos',
  'screen_affluence_config'
)
ORDER BY tablename;































