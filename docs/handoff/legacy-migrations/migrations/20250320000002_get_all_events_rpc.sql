-- RPC pour lister tous les événements (page Événements) avec pagination.
-- SECURITY DEFINER pour permettre aux annonceurs de lire la liste.

CREATE OR REPLACE FUNCTION get_all_events(p_limit int DEFAULT 9, p_offset int DEFAULT 0)
RETURNS SETOF special_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.special_events
  WHERE is_active = true
  ORDER BY start_date ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- Compte total pour la pagination
CREATE OR REPLACE FUNCTION get_all_events_count()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::bigint
  FROM public.special_events
  WHERE is_active = true;
$$;

GRANT EXECUTE ON FUNCTION get_all_events(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_events(int, int) TO anon;
GRANT EXECUTE ON FUNCTION get_all_events_count() TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_events_count() TO anon;
