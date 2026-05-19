-- =====================================================
-- LOCALITÉS : table locations, lien screens, affluence par heure×jour, campaign_locations
-- Une localité regroupe plusieurs écrans ; affluence et calcul CPM sont par localité.
-- =====================================================

-- 1. Table locations (localités)
CREATE TABLE IF NOT EXISTS locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  coordinates POINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_owner_id ON locations(owner_id);
CREATE INDEX IF NOT EXISTS idx_locations_coordinates ON locations USING GIST(coordinates);

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own locations"
  ON locations FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can insert their own locations"
  ON locations FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own locations"
  ON locations FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete their own locations"
  ON locations FOR DELETE USING (auth.uid() = owner_id);

-- 2. Lier les écrans aux localités
ALTER TABLE screens ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_screens_location_id ON screens(location_id);

-- 3. Affluence par localité, par heure (0-23) et par jour (1=Lundi … 7=Dimanche)
CREATE TABLE IF NOT EXISTS location_affluence_schedule (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  estimated_impressions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(location_id, day_of_week, hour)
);

CREATE INDEX IF NOT EXISTS idx_location_affluence_schedule_location_id ON location_affluence_schedule(location_id);

ALTER TABLE location_affluence_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage affluence for their locations"
  ON location_affluence_schedule FOR ALL
  USING (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_affluence_schedule.location_id AND l.owner_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_affluence_schedule.location_id AND l.owner_id = auth.uid())
  );

-- 4. Ciblage campagne par localité
-- Remplace l'ancienne table campaign_locations (latitude/longitude/radius) par (campaign_id, location_id)
DROP TABLE IF EXISTS campaign_locations CASCADE;
CREATE TABLE campaign_locations (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (campaign_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_locations_campaign_id ON campaign_locations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_locations_location_id ON campaign_locations(location_id);

ALTER TABLE campaign_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view campaign_locations for their campaigns"
  ON campaign_locations FOR SELECT
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_locations.campaign_id AND c.user_id = auth.uid()));

CREATE POLICY "Users can insert campaign_locations for their campaigns"
  ON campaign_locations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_locations.campaign_id AND c.user_id = auth.uid()));

CREATE POLICY "Users can delete campaign_locations for their campaigns"
  ON campaign_locations FOR DELETE
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_locations.campaign_id AND c.user_id = auth.uid()));

-- 5. Fonction calculate_campaign_cost basée sur localités + grille affluence (avec fallback écrans)
CREATE OR REPLACE FUNCTION calculate_campaign_cost(p_campaign_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  c RECORD;
  total_impressions BIGINT := 0;
  cpm NUMERIC := 2.5;
BEGIN
  SELECT start_date, end_date, budget INTO c
  FROM campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Calcul par campaign_locations + location_affluence_schedule (une localité = une audience)
  IF EXISTS (SELECT 1 FROM campaign_locations WHERE campaign_id = p_campaign_id LIMIT 1) THEN
    SELECT COALESCE(SUM(las.estimated_impressions), 0)::BIGINT INTO total_impressions
    FROM campaign_locations cl
    JOIN campaigns c2 ON c2.id = cl.campaign_id
    CROSS JOIN LATERAL generate_series(c2.start_date::date, c2.end_date::date, '1 day'::interval) AS g(d)
    CROSS JOIN LATERAL generate_series(0, 23) AS hr(h)
    JOIN location_affluence_schedule las ON las.location_id = cl.location_id
      AND las.day_of_week = EXTRACT(ISODOW FROM (g.d)::date)::INT
      AND las.hour = hr.h
    WHERE cl.campaign_id = p_campaign_id;
    IF total_impressions > 0 THEN
      RETURN (total_impressions / 1000.0) * cpm;
    END IF;
  END IF;

  -- Fallback : campagnes sans campaign_locations (ancien calcul par écrans)
  SELECT COALESCE(SUM(sac.estimated_impressions_per_hour * 24 * (EXTRACT(DAY FROM (c2.end_date - c2.start_date))::INTEGER + 1)), 0)::BIGINT
  INTO total_impressions
  FROM campaigns c2
  LEFT JOIN campaign_screens cs ON cs.campaign_id = c2.id
  LEFT JOIN screen_affluence_config sac ON sac.screen_id = cs.screen_id
  WHERE c2.id = p_campaign_id
  GROUP BY c2.id, c2.start_date, c2.end_date;

  IF total_impressions > 0 THEN
    RETURN (total_impressions / 1000.0) * cpm;
  END IF;

  RETURN COALESCE(c.budget, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE locations IS 'Localités (lieux) regroupant plusieurs écrans ; une localité = une audience pour affluence et CPM';
COMMENT ON TABLE location_affluence_schedule IS 'Affluence par localité, par jour (1-7 Lun-Dim) et par heure (0-23)';
COMMENT ON TABLE campaign_locations IS 'Ciblage campagne par localité ; les écrans sont dérivés via screens.location_id';
