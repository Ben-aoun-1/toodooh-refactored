-- Ajustements RLS pour la table campaign_hourly_location_plan
-- Objectifs:
-- 1) permettre le recalcul déclenché depuis une approbation propriétaire
-- 2) durcir les checks annonceur (location doit appartenir au ciblage campagne)

-- Remplacer la policy INSERT annonceur avec un check strict campagne+localité.
DROP POLICY IF EXISTS "Users can insert hourly plan for their campaigns"
  ON campaign_hourly_location_plan;
CREATE POLICY "Users can insert hourly plan for their campaigns"
  ON campaign_hourly_location_plan FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = campaign_hourly_location_plan.campaign_id
        AND c.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM campaign_locations cl
      WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
        AND cl.location_id = campaign_hourly_location_plan.location_id
    )
  );

-- Remplacer la policy UPDATE annonceur avec USING + WITH CHECK stricts.
DROP POLICY IF EXISTS "Users can update hourly plan for their campaigns"
  ON campaign_hourly_location_plan;
CREATE POLICY "Users can update hourly plan for their campaigns"
  ON campaign_hourly_location_plan FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = campaign_hourly_location_plan.campaign_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = campaign_hourly_location_plan.campaign_id
        AND c.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM campaign_locations cl
      WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
        AND cl.location_id = campaign_hourly_location_plan.location_id
    )
  );

-- Permettre les écritures système déclenchées par un propriétaire impliqué dans la campagne.
-- Note: ce droit sert au recalcul global du plan (delete + insert) au moment des approvals.
DROP POLICY IF EXISTS "Owners can write hourly plan for approved campaigns"
  ON campaign_hourly_location_plan;
CREATE POLICY "Owners can write hourly plan for approved campaigns"
  ON campaign_hourly_location_plan FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM campaign_screens cs
      JOIN screens s ON s.id = cs.screen_id
      WHERE cs.campaign_id = campaign_hourly_location_plan.campaign_id
        AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM campaign_screens cs
      JOIN screens s ON s.id = cs.screen_id
      WHERE cs.campaign_id = campaign_hourly_location_plan.campaign_id
        AND s.owner_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM campaign_locations cl
      WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
        AND cl.location_id = campaign_hourly_location_plan.location_id
    )
  );
