-- Table des catégories par campagne (sélection multiple).
-- campaigns.category reste la catégorie "principale" (première sélectionnée) pour compatibilité.
CREATE TABLE IF NOT EXISTS campaign_categories (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  category campaign_category NOT NULL,
  PRIMARY KEY (campaign_id, category)
);

-- RLS : lecture/écriture pour le propriétaire de la campagne
ALTER TABLE campaign_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_categories_select ON campaign_categories
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_categories.campaign_id AND c.user_id = auth.uid())
  );

CREATE POLICY campaign_categories_insert ON campaign_categories
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_categories.campaign_id AND c.user_id = auth.uid())
  );

CREATE POLICY campaign_categories_delete ON campaign_categories
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_categories.campaign_id AND c.user_id = auth.uid())
  );

-- Backfill : une ligne par campagne existante avec sa catégorie actuelle
INSERT INTO campaign_categories (campaign_id, category)
SELECT id, category FROM campaigns
ON CONFLICT (campaign_id, category) DO NOTHING;
