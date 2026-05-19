-- Planification horaire officielle (post-curseur) par campagne/localité.
-- Source de vérité pour l'occupation future.

CREATE TABLE IF NOT EXISTS campaign_hourly_location_plan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  diffusion_date DATE NOT NULL,
  diffusion_hour SMALLINT NOT NULL CHECK (diffusion_hour BETWEEN 0 AND 23),
  planned_repetitions_per_hour INTEGER NOT NULL DEFAULT 0 CHECK (planned_repetitions_per_hour >= 0),
  planned_impressions INTEGER NOT NULL DEFAULT 0 CHECK (planned_impressions >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, location_id, diffusion_date, diffusion_hour)
);

COMMENT ON TABLE campaign_hourly_location_plan IS
  'Plan final horaire post-curseur (une ligne par campagne/localité/date/heure).';

CREATE INDEX IF NOT EXISTS idx_chlp_campaign_id
  ON campaign_hourly_location_plan(campaign_id);

CREATE INDEX IF NOT EXISTS idx_chlp_location_date_hour
  ON campaign_hourly_location_plan(location_id, diffusion_date, diffusion_hour);

CREATE INDEX IF NOT EXISTS idx_chlp_date_hour
  ON campaign_hourly_location_plan(diffusion_date, diffusion_hour);

DROP TRIGGER IF EXISTS update_campaign_hourly_location_plan_updated_at
  ON campaign_hourly_location_plan;

CREATE TRIGGER update_campaign_hourly_location_plan_updated_at
  BEFORE UPDATE ON campaign_hourly_location_plan
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE campaign_hourly_location_plan ENABLE ROW LEVEL SECURITY;

-- Annonceur: gérer le plan de ses campagnes.
DROP POLICY IF EXISTS "Users can view hourly plan for their campaigns"
  ON campaign_hourly_location_plan;
CREATE POLICY "Users can view hourly plan for their campaigns"
  ON campaign_hourly_location_plan FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = campaign_hourly_location_plan.campaign_id
        AND c.user_id = auth.uid()
    )
  );

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
  );

DROP POLICY IF EXISTS "Users can delete hourly plan for their campaigns"
  ON campaign_hourly_location_plan;
CREATE POLICY "Users can delete hourly plan for their campaigns"
  ON campaign_hourly_location_plan FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = campaign_hourly_location_plan.campaign_id
        AND c.user_id = auth.uid()
    )
  );

-- Propriétaire: lecture des lignes liées à ses localités (via ses écrans).
DROP POLICY IF EXISTS "Owners can view hourly plan for their locations"
  ON campaign_hourly_location_plan;
CREATE POLICY "Owners can view hourly plan for their locations"
  ON campaign_hourly_location_plan FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM screens s
      WHERE s.location_id = campaign_hourly_location_plan.location_id
        AND s.owner_id = auth.uid()
    )
  );
