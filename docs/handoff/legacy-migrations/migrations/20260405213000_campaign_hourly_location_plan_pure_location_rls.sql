-- RLS 100% localité pour campaign_hourly_location_plan
-- Plus aucune dépendance aux screen_ids dans les policies.

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
      FROM campaign_locations cl
      JOIN locations l ON l.id = cl.location_id
      WHERE cl.campaign_id = campaign_hourly_location_plan.campaign_id
        AND cl.location_id = campaign_hourly_location_plan.location_id
        AND l.owner_id = auth.uid()
    )
  );
