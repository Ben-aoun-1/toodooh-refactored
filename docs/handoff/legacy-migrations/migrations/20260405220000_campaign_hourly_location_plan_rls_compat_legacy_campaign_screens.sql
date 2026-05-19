-- Compat RLS: certaines campagnes legacy n'ont pas campaign_locations mais ont campaign_screens.
-- On autorise alors location_id si dérivable depuis screens.location_id de la campagne.

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
      FROM locations l
      WHERE l.id = campaign_hourly_location_plan.location_id
        AND l.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM locations l
      WHERE l.id = campaign_hourly_location_plan.location_id
        AND l.owner_id = auth.uid()
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
