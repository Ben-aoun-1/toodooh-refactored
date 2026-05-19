-- Table de liaison campagne <-> événement (si pas déjà créée).
CREATE TABLE IF NOT EXISTS event_campaigns (
  event_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz DEFAULT now(),
  PRIMARY KEY (event_id, campaign_id)
);

-- RPC : événements sur lesquels l'annonceur connecté a lancé une campagne (event_campaigns).
-- SECURITY DEFINER pour lire special_events et event_campaigns.

CREATE OR REPLACE FUNCTION get_my_event_campaigns_events()
RETURNS SETOF special_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.*
  FROM special_events e
  WHERE e.id IN (
    SELECT DISTINCT ec.event_id
    FROM event_campaigns ec
    INNER JOIN campaigns c ON c.id = ec.campaign_id AND c.user_id = auth.uid()
  )
  ORDER BY e.start_date ASC;
$$;

GRANT EXECUTE ON FUNCTION get_my_event_campaigns_events() TO authenticated;
