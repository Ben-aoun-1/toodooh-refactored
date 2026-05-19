-- Réparation pour projets où 20260404230000 a été appliquée sans GRANT ni DROP IF EXISTS.
-- Idempotent : à exécuter une fois sur la base distante si `location_affluence_schedule` renvoie [] malgré des données.
-- Ne modifie pas les écritures : SELECT uniquement ; RPC upsert_location_affluence_schedule inchangée.

GRANT SELECT ON TABLE public.location_affluence_schedule TO authenticated;

DROP POLICY IF EXISTS "Authenticated can read location affluence for campaign planning"
  ON public.location_affluence_schedule;

CREATE POLICY "Authenticated can read location affluence for campaign planning"
  ON public.location_affluence_schedule
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
