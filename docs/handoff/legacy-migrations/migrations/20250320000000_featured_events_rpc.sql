-- RPC pour récupérer les événements mis en avant (dashboard annonceur)
-- Utilise SECURITY DEFINER pour lire special_events même si l'utilisateur n'a pas SELECT dessus.

CREATE OR REPLACE FUNCTION get_featured_events(p_limit int DEFAULT 3)
RETURNS SETOF special_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.special_events
  WHERE is_featured = true
    AND is_active = true
    AND end_date >= now()
  ORDER BY start_date ASC
  LIMIT p_limit;
$$;

-- Autoriser les utilisateurs authentifiés à appeler la fonction
GRANT EXECUTE ON FUNCTION get_featured_events(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_featured_events(int) TO anon;
