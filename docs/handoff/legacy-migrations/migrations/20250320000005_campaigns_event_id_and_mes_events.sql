-- Colonne event_id sur campaigns : permet d'afficher "Mes événements" même sans ligne dans event_campaigns.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES special_events(id) ON DELETE SET NULL;

-- Backfill : campagnes dont le nom est "Campagne - {nom événement}" → lier à l'événement correspondant.
UPDATE campaigns c
SET event_id = (
  SELECT se.id
  FROM special_events se
  WHERE se.name = TRIM(SUBSTRING(c.name FROM 13))
  LIMIT 1
)
WHERE c.name LIKE 'Campagne - %'
  AND c.event_id IS NULL;

-- RPC "Mes événements" : événements liés via event_campaigns OU via campaigns.event_id.
CREATE OR REPLACE FUNCTION get_my_event_campaigns_events()
RETURNS SETOF special_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.*
  FROM special_events e
  WHERE e.id IN (
    -- Liens explicites (table event_campaigns)
    SELECT DISTINCT ec.event_id
    FROM event_campaigns ec
    INNER JOIN campaigns c ON c.id = ec.campaign_id AND c.user_id = auth.uid()
    UNION
    -- Campagnes créées en mode événement (colonne event_id)
    SELECT DISTINCT c.event_id
    FROM campaigns c
    WHERE c.user_id = auth.uid() AND c.event_id IS NOT NULL
  )
  ORDER BY e.start_date ASC;
$$;

GRANT EXECUTE ON FUNCTION get_my_event_campaigns_events() TO authenticated;
