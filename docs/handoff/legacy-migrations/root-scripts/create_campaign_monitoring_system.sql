-- =====================================================
-- SYSTÈME DE MONITORING DES CAMPAGNES POUR SUPER ADMIN
-- =====================================================

-- Fonction pour récupérer les statistiques globales des campagnes
CREATE OR REPLACE FUNCTION get_campaigns_global_stats()
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_campaigns', COUNT(*),
    'active_campaigns', COUNT(*) FILTER (WHERE status = 'active'),
    'pending_campaigns', COUNT(*) FILTER (WHERE status = 'pending'),
    'completed_campaigns', COUNT(*) FILTER (WHERE status = 'completed'),
    'paused_campaigns', COUNT(*) FILTER (WHERE status = 'paused'),
    'total_budget', COALESCE(SUM(budget), 0),
    'active_budget', COALESCE(SUM(budget) FILTER (WHERE status = 'active'), 0),
    'total_views', COALESCE(SUM(views), 0),
    'avg_budget', COALESCE(AVG(budget), 0)
  )
  INTO result
  FROM campaigns;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour récupérer les campagnes avec leurs annonceurs et écrans associés
CREATE OR REPLACE FUNCTION get_campaigns_with_screens()
RETURNS TABLE (
  campaign_id uuid,
  campaign_name text,
  advertiser_id uuid,
  advertiser_name text,
  advertiser_email text,
  client_id uuid,
  client_name text,
  category text,
  status text,
  budget numeric,
  views integer,
  start_date timestamptz,
  end_date timestamptz,
  content_validation_status text,
  video_url text,
  video_filename text,
  screens_count integer,
  screens_list json,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS campaign_id,
    c.name AS campaign_name,
    c.user_id AS advertiser_id,
    COALESCE(bp.business_name, bp.contact_name, 'N/A') AS advertiser_name,
    au.email AS advertiser_email,
    c.client_id,
    cl.name AS client_name,
    c.category,
    c.status,
    c.budget,
    c.views,
    c.start_date,
    c.end_date,
    c.content_validation_status,
    v.url AS video_url,
    v.filename AS video_filename,
    COALESCE(
      (SELECT COUNT(*)::integer 
       FROM campaign_locations cl2 
       WHERE cl2.campaign_id = c.id), 
      0
    ) AS screens_count,
    COALESCE(
      (SELECT json_agg(
        json_build_object(
          'location_id', cl2.id,
          'screen_id', s.id,
          'screen_name', s.name,
          'screen_address', s.address,
          'screen_city', s.city,
          'screen_status', s.status,
          'owner_name', COALESCE(bp_owner.business_name, bp_owner.contact_name, 'N/A')
        )
       )
       FROM campaign_locations cl2
       LEFT JOIN screens s ON cl2.screen_id = s.id
       LEFT JOIN business_profiles bp_owner ON s.owner_id = bp_owner.user_id
       WHERE cl2.campaign_id = c.id
      ),
      '[]'::json
    ) AS screens_list,
    c.created_at
  FROM campaigns c
  LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
  LEFT JOIN auth.users au ON c.user_id = au.id
  LEFT JOIN clients cl ON c.client_id = cl.id
  LEFT JOIN videos v ON c.video_id = v.id
  ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour récupérer les campagnes par statut
CREATE OR REPLACE FUNCTION get_campaigns_by_status(p_status text)
RETURNS TABLE (
  campaign_id uuid,
  campaign_name text,
  advertiser_name text,
  client_name text,
  category text,
  status text,
  budget numeric,
  views integer,
  start_date timestamptz,
  end_date timestamptz,
  screens_count integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS campaign_id,
    c.name AS campaign_name,
    COALESCE(bp.business_name, bp.contact_name, 'N/A') AS advertiser_name,
    cl.name AS client_name,
    c.category,
    c.status,
    c.budget,
    c.views,
    c.start_date,
    c.end_date,
    COALESCE(
      (SELECT COUNT(*)::integer 
       FROM campaign_locations cl2 
       WHERE cl2.campaign_id = c.id), 
      0
    ) AS screens_count
  FROM campaigns c
  LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
  LEFT JOIN clients cl ON c.client_id = cl.id
  WHERE c.status = p_status
  ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour récupérer les campagnes par catégorie
CREATE OR REPLACE FUNCTION get_campaigns_by_category()
RETURNS TABLE (
  category text,
  count bigint,
  total_budget numeric,
  total_views bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.category,
    COUNT(*) AS count,
    COALESCE(SUM(c.budget), 0) AS total_budget,
    COALESCE(SUM(c.views), 0)::bigint AS total_views
  FROM campaigns c
  GROUP BY c.category
  ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour récupérer les top annonceurs par nombre de campagnes
CREATE OR REPLACE FUNCTION get_top_advertisers(limit_count integer DEFAULT 10)
RETURNS TABLE (
  advertiser_id uuid,
  advertiser_name text,
  campaigns_count bigint,
  total_budget numeric,
  total_views bigint,
  active_campaigns bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.user_id AS advertiser_id,
    COALESCE(bp.business_name, bp.contact_name, 'N/A') AS advertiser_name,
    COUNT(*) AS campaigns_count,
    COALESCE(SUM(c.budget), 0) AS total_budget,
    COALESCE(SUM(c.views), 0)::bigint AS total_views,
    COUNT(*) FILTER (WHERE c.status = 'active') AS active_campaigns
  FROM campaigns c
  LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
  GROUP BY c.user_id, bp.business_name, bp.contact_name
  ORDER BY campaigns_count DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour récupérer les écrans les plus utilisés dans les campagnes
CREATE OR REPLACE FUNCTION get_most_used_screens(limit_count integer DEFAULT 10)
RETURNS TABLE (
  screen_id uuid,
  screen_name text,
  screen_address text,
  screen_city text,
  campaigns_count bigint,
  owner_name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS screen_id,
    s.name AS screen_name,
    s.address AS screen_address,
    s.city AS screen_city,
    COUNT(cl.id) AS campaigns_count,
    COALESCE(bp.business_name, bp.contact_name, 'N/A') AS owner_name
  FROM screens s
  LEFT JOIN campaign_locations cl ON s.id = cl.screen_id
  LEFT JOIN business_profiles bp ON s.owner_id = bp.user_id
  WHERE cl.id IS NOT NULL
  GROUP BY s.id, s.name, s.address, s.city, bp.business_name, bp.contact_name
  ORDER BY campaigns_count DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Vue pour le monitoring des campagnes (alternative à la fonction)
CREATE OR REPLACE VIEW admin_campaigns_monitoring AS
SELECT 
  c.id AS campaign_id,
  c.name AS campaign_name,
  c.user_id AS advertiser_id,
  COALESCE(bp.business_name, bp.contact_name, 'N/A') AS advertiser_name,
  c.client_id,
  cl.name AS client_name,
  c.category,
  c.status,
  c.budget,
  c.views,
  c.start_date,
  c.end_date,
  c.content_validation_status,
  v.url AS video_url,
  v.filename AS video_filename,
  COALESCE(
    (SELECT COUNT(*)::integer 
     FROM campaign_locations cl2 
     WHERE cl2.campaign_id = c.id), 
    0
  ) AS screens_count,
  c.created_at
FROM campaigns c
LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
LEFT JOIN clients cl ON c.client_id = cl.id
LEFT JOIN videos v ON c.video_id = v.id
ORDER BY c.created_at DESC;

-- Accorder les permissions à l'admin
GRANT EXECUTE ON FUNCTION get_campaigns_global_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_campaigns_with_screens() TO authenticated;
GRANT EXECUTE ON FUNCTION get_campaigns_by_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_campaigns_by_category() TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_advertisers(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_most_used_screens(integer) TO authenticated;
GRANT SELECT ON admin_campaigns_monitoring TO authenticated;

-- Test des fonctions
-- SELECT * FROM get_campaigns_global_stats();
-- SELECT * FROM get_campaigns_with_screens();
-- SELECT * FROM get_campaigns_by_status('active');
-- SELECT * FROM get_campaigns_by_category();
-- SELECT * FROM get_top_advertisers(5);
-- SELECT * FROM get_most_used_screens(5);
-- SELECT * FROM admin_campaigns_monitoring;

