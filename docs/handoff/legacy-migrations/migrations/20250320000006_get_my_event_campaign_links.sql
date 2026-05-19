-- RPC : pour chaque événement sur lequel l'annonceur a une campagne, retourne (event_id, campaign_id).
CREATE OR REPLACE FUNCTION get_my_event_campaign_links()
RETURNS TABLE(event_id uuid, campaign_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ec.event_id, ec.campaign_id
  FROM event_campaigns ec
  INNER JOIN campaigns c ON c.id = ec.campaign_id AND c.user_id = auth.uid()
  UNION
  SELECT c.event_id, c.id
  FROM campaigns c
  WHERE c.user_id = auth.uid() AND c.event_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION get_my_event_campaign_links() TO authenticated;
