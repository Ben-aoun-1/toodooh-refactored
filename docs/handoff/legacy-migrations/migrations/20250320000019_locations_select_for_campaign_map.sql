-- Permettre à tout utilisateur authentifié de voir les localités (carte de ciblage campagne).
-- Sans cela, l'annonceur ne voit aucune localité sur la carte car RLS limite à owner_id.
CREATE POLICY "Authenticated can view locations for campaign map"
  ON locations FOR SELECT
  TO authenticated
  USING (true);

-- Permettre de compter les écrans par localité pour la carte (sinon screen_count = 0 pour les localités des autres).
CREATE POLICY "Authenticated can view screens location_id for campaign map"
  ON screens FOR SELECT
  TO authenticated
  USING (true);
