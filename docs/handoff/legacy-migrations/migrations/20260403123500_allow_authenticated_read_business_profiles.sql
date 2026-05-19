-- Permet l'affichage des logos annonceurs dans les vues propriétaire.
-- Certains environnements ont une policy SELECT trop restrictive (profil personnel uniquement).

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read basic business profiles" ON public.business_profiles;

CREATE POLICY "Authenticated can read basic business profiles"
  ON public.business_profiles
  FOR SELECT
  TO authenticated
  USING (true);
