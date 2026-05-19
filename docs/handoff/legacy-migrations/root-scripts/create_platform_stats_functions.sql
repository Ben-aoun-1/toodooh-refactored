-- Fonctions SQL pour les statistiques consolidées de la plateforme (Super Admin Dashboard)

-- 1. Fonction pour obtenir les statistiques globales de la plateforme
CREATE OR REPLACE FUNCTION get_platform_global_stats()
RETURNS TABLE (
    -- Utilisateurs
    total_users BIGINT,
    pending_users BIGINT,
    approved_users BIGINT,
    owners_count BIGINT,
    advertisers_count BIGINT,
    
    -- Écrans
    total_screens BIGINT,
    active_screens BIGINT,
    inactive_screens BIGINT,
    online_screens BIGINT,
    
    -- Campagnes
    total_campaigns BIGINT,
    active_campaigns BIGINT,
    pending_campaigns BIGINT,
    
    -- Vidéos
    total_videos BIGINT,
    pending_videos BIGINT,
    approved_videos BIGINT,
    
    -- Événements
    total_events BIGINT,
    active_events BIGINT,
    upcoming_events BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        -- Utilisateurs
        (SELECT COUNT(*) FROM business_profiles)::BIGINT as total_users,
        (SELECT COUNT(*) FROM business_profiles WHERE status = 'pending')::BIGINT as pending_users,
        (SELECT COUNT(*) FROM business_profiles WHERE status = 'approved')::BIGINT as approved_users,
        (SELECT COUNT(*) FROM business_profiles WHERE profile_type IN ('individual_owner', 'fleet_owner'))::BIGINT as owners_count,
        (SELECT COUNT(*) FROM business_profiles WHERE profile_type = 'advertiser')::BIGINT as advertisers_count,
        
        -- Écrans
        (SELECT COUNT(*) FROM screens)::BIGINT as total_screens,
        (SELECT COUNT(*) FROM screens WHERE status = 'active')::BIGINT as active_screens,
        (SELECT COUNT(*) FROM screens WHERE status = 'inactive')::BIGINT as inactive_screens,
        (SELECT COUNT(*) FROM screens WHERE is_online = true)::BIGINT as online_screens,
        
        -- Campagnes
        (SELECT COUNT(*) FROM campaigns)::BIGINT as total_campaigns,
        (SELECT COUNT(*) FROM campaigns WHERE status = 'active')::BIGINT as active_campaigns,
        (SELECT COUNT(*) FROM campaigns WHERE status = 'pending')::BIGINT as pending_campaigns,
        
        -- Vidéos
        (SELECT COUNT(*) FROM videos)::BIGINT as total_videos,
        (SELECT COUNT(*) FROM videos WHERE validation_status = 'pending')::BIGINT as pending_videos,
        (SELECT COUNT(*) FROM videos WHERE validation_status = 'approved')::BIGINT as approved_videos,
        
        -- Événements
        (SELECT COUNT(*) FROM special_events)::BIGINT as total_events,
        (SELECT COUNT(*) FROM special_events WHERE is_active = true)::BIGINT as active_events,
        (SELECT COUNT(*) FROM special_events WHERE start_date > NOW())::BIGINT as upcoming_events;
END;
$$ LANGUAGE plpgsql;

-- 2. Fonction pour obtenir les statistiques de revenus globaux
CREATE OR REPLACE FUNCTION get_platform_revenue_stats()
RETURNS TABLE (
    total_revenue DECIMAL(10,2),
    monthly_revenue DECIMAL(10,2),
    daily_revenue DECIMAL(10,2),
    average_revenue_per_screen DECIMAL(10,2),
    revenue_growth_rate DECIMAL(5,2),
    total_campaigns_budget DECIMAL(10,2)
) AS $$
DECLARE
    total_screens_count INTEGER;
    previous_month_revenue DECIMAL(10,2);
BEGIN
    -- Compter le nombre total d'écrans
    SELECT COUNT(*) INTO total_screens_count FROM screens;
    
    RETURN QUERY
    SELECT
        -- Revenu total de tous les écrans
        COALESCE(SUM(s.total_revenue), 0)::DECIMAL(10,2) as total_revenue,
        
        -- Revenu mensuel
        COALESCE(SUM(s.monthly_revenue), 0)::DECIMAL(10,2) as monthly_revenue,
        
        -- Revenu quotidien (estimation basée sur le mensuel)
        COALESCE(SUM(s.monthly_revenue) / 30, 0)::DECIMAL(10,2) as daily_revenue,
        
        -- Moyenne par écran
        CASE 
            WHEN total_screens_count > 0 THEN COALESCE(SUM(s.total_revenue) / total_screens_count, 0)
            ELSE 0
        END::DECIMAL(10,2) as average_revenue_per_screen,
        
        -- Taux de croissance (simulation - à remplacer par vraies données historiques)
        12.5::DECIMAL(5,2) as revenue_growth_rate,
        
        -- Budget total des campagnes
        (SELECT COALESCE(SUM(budget), 0) FROM campaigns WHERE status IN ('active', 'pending'))::DECIMAL(10,2) as total_campaigns_budget
    FROM screens s;
END;
$$ LANGUAGE plpgsql;

-- 3. Fonction pour obtenir le taux d'occupation des écrans
CREATE OR REPLACE FUNCTION get_screens_occupancy_rate()
RETURNS TABLE (
    total_screens BIGINT,
    screens_with_campaigns BIGINT,
    occupancy_rate DECIMAL(5,2),
    available_screens BIGINT,
    average_uptime DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM screens)::BIGINT as total_screens,
        
        -- Écrans liés à au moins une campagne active
        (SELECT COUNT(DISTINCT s.id) 
         FROM screens s
         INNER JOIN campaigns c ON c.status = 'active'
         -- Ajouter ici la logique de liaison écran-campagne si elle existe
        )::BIGINT as screens_with_campaigns,
        
        -- Taux d'occupation
        CASE 
            WHEN (SELECT COUNT(*) FROM screens) > 0 THEN
                ((SELECT COUNT(*) FROM screens WHERE status = 'active')::DECIMAL / 
                 (SELECT COUNT(*) FROM screens)::DECIMAL * 100)
            ELSE 0
        END::DECIMAL(5,2) as occupancy_rate,
        
        -- Écrans disponibles
        (SELECT COUNT(*) FROM screens WHERE status = 'active' AND is_online = true)::BIGINT as available_screens,
        
        -- Uptime moyen (basé sur screen_statistics)
        COALESCE(
            (SELECT AVG(uptime_percentage) 
             FROM screen_statistics 
             WHERE date >= CURRENT_DATE - INTERVAL '30 days'),
            100
        )::DECIMAL(5,2) as average_uptime;
END;
$$ LANGUAGE plpgsql;

-- 4. Fonction pour obtenir les performances des campagnes
CREATE OR REPLACE FUNCTION get_campaigns_performance()
RETURNS TABLE (
    total_campaigns BIGINT,
    active_campaigns BIGINT,
    total_views BIGINT,
    total_budget DECIMAL(10,2),
    average_budget DECIMAL(10,2),
    campaigns_by_status JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_campaigns,
        COUNT(*) FILTER (WHERE status = 'active')::BIGINT as active_campaigns,
        COALESCE(SUM(views), 0)::BIGINT as total_views,
        COALESCE(SUM(budget), 0)::DECIMAL(10,2) as total_budget,
        COALESCE(AVG(budget), 0)::DECIMAL(10,2) as average_budget,
        jsonb_build_object(
            'draft', COUNT(*) FILTER (WHERE status = 'draft'),
            'pending', COUNT(*) FILTER (WHERE status = 'pending'),
            'active', COUNT(*) FILTER (WHERE status = 'active'),
            'paused', COUNT(*) FILTER (WHERE status = 'paused'),
            'completed', COUNT(*) FILTER (WHERE status = 'completed'),
            'rejected', COUNT(*) FILTER (WHERE status = 'rejected')
        ) as campaigns_by_status
    FROM campaigns;
END;
$$ LANGUAGE plpgsql;

-- 5. Fonction pour obtenir les top écrans (les plus rentables)
CREATE OR REPLACE FUNCTION get_top_performing_screens(limit_count INTEGER DEFAULT 5)
RETURNS TABLE (
    screen_id UUID,
    screen_name VARCHAR(255),
    location VARCHAR(500),
    total_revenue DECIMAL(10,2),
    monthly_revenue DECIMAL(10,2),
    owner_business_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id as screen_id,
        s.name as screen_name,
        s.location,
        s.total_revenue,
        s.monthly_revenue,
        bp.business_name as owner_business_name
    FROM screens s
    LEFT JOIN business_profiles bp ON s.owner_id = bp.user_id
    ORDER BY s.total_revenue DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 6. Fonction pour obtenir l'activité récente (dernières actions)
CREATE OR REPLACE FUNCTION get_recent_platform_activity(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    activity_date TIMESTAMPTZ,
    activity_type VARCHAR(50),
    description TEXT,
    user_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    -- Nouvelles inscriptions
    SELECT
        bp.created_at as activity_date,
        'new_user'::VARCHAR(50) as activity_type,
        'Nouvelle inscription: ' || bp.business_name as description,
        bp.contact_name as user_name
    FROM business_profiles bp
    ORDER BY bp.created_at DESC
    LIMIT limit_count;
    
    -- TODO: Ajouter d'autres types d'activités (campagnes créées, vidéos validées, etc.)
END;
$$ LANGUAGE plpgsql;

-- 7. Tester les fonctions
SELECT '=== Statistiques Globales ===' as section;
SELECT * FROM get_platform_global_stats();

SELECT '=== Statistiques Revenus ===' as section;
SELECT * FROM get_platform_revenue_stats();

SELECT '=== Taux d''Occupation ===' as section;
SELECT * FROM get_screens_occupancy_rate();

SELECT '=== Performances Campagnes ===' as section;
SELECT * FROM get_campaigns_performance();

SELECT '=== Top 5 Écrans ===' as section;
SELECT * FROM get_top_performing_screens(5);












































