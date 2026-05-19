-- Retrait de la policy lecture annonceur sur screen_affluence_config (plus utilisée par l’estimation nouvelle campagne).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'screen_affluence_config'
  ) THEN
    DROP POLICY IF EXISTS "Authenticated can read screen affluence config for campaign planning"
      ON public.screen_affluence_config;
  END IF;
END $$;
