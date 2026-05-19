-- RPC pour lier une campagne à un événement (côté annonceur).
-- Évite les échecs d'insertion dus à la RLS sur event_campaigns.
-- Vérifie que la campagne appartient à l'utilisateur connecté.

CREATE OR REPLACE FUNCTION link_campaign_to_event(p_campaign_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;
  -- Vérifier que la campagne appartient à l'utilisateur
  IF NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = p_campaign_id AND c.user_id = auth.uid()) THEN
    RETURN false;
  END IF;
  INSERT INTO event_campaigns (event_id, campaign_id, linked_by)
  VALUES (p_event_id, p_campaign_id, auth.uid());
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN true;
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION link_campaign_to_event(uuid, uuid) TO authenticated;
