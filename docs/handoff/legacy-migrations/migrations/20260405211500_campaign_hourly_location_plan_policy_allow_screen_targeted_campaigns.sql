-- Compatibilité RLS: autoriser les campagnes ciblées par écrans
-- (sans lignes campaign_locations) à écrire dans campaign_hourly_location_plan.

-- Helper logique: location autorisée si:
-- 1) présente dans campaign_locations, OU
-- 2) liée à un écran de la campagne via campaign_screens -> screens.location_id

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
    AND (
      EXISTS (
        SELECT 1
        FROM campaign_locations cl
        WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
          AND cl.location_id = campaign_hourly_location_plan.location_id
      )
      OR EXISTS (
        SELECT 1
        FROM campaign_screens cs
        JOIN screens s ON s.id = cs.screen_id
        WHERE cs.campaign_id = campaign_hourly_location_plan.campaign_id
          AND s.location_id = campaign_hourly_location_plan.location_id
      )
    )
  );

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
    AND (
      EXISTS (
        SELECT 1
        FROM campaign_locations cl
        WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
          AND cl.location_id = campaign_hourly_location_plan.location_id
      )
      OR EXISTS (
        SELECT 1
        FROM campaign_screens cs
        JOIN screens s ON s.id = cs.screen_id
        WHERE cs.campaign_id = campaign_hourly_location_plan.campaign_id
          AND s.location_id = campaign_hourly_location_plan.location_id
      )
    )
  );

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
    AND (
      EXISTS (
        SELECT 1
        FROM campaign_locations cl
        WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
          AND cl.location_id = campaign_hourly_location_plan.location_id
      )
      OR EXISTS (
        SELECT 1
        FROM campaign_screens cs
        JOIN screens s ON s.id = cs.screen_id
        WHERE cs.campaign_id = campaign_hourly_location_plan.campaign_id
          AND s.location_id = campaign_hourly_location_plan.location_id
      )
    )
  );
