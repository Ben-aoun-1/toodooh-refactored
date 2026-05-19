-- Lecture de la grille d'affluence par les annonceurs (planification campagne / moteur DOOH).
-- Aligné sur "Authenticated can view locations for campaign map" et la lecture des écrans.
-- GRANT : sans SELECT explicite, le rôle authenticated peut recevoir 0 ligne malgré la policy.
--
-- APIs externes : cette migration n'ajoute que FOR SELECT + GRANT SELECT (aucun blocage INSERT/UPDATE).
-- L'UPSERT via public.upsert_location_affluence_schedule (SECURITY DEFINER, migration 20250320000022)
-- continue d'écrire dans la table sans dépendre des policies de l'appelant anon/authenticated.

GRANT SELECT ON TABLE public.location_affluence_schedule TO authenticated;

DROP POLICY IF EXISTS "Authenticated can read location affluence for campaign planning"
  ON public.location_affluence_schedule;

CREATE POLICY "Authenticated can read location affluence for campaign planning"
  ON public.location_affluence_schedule
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
