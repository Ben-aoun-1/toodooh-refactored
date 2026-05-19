-- Insertion d'écrans d'exemple pour tous les propriétaires de business_profiles
-- Date: 2025-01-01

-- 1. Insérer 3 écrans d'exemple par propriétaire
INSERT INTO screens (
    owner_id, name, location, address, coordinates, screen_type,
    resolution_width, resolution_height, screen_size_inches, orientation,
    status, is_online, last_heartbeat, installation_date, warranty_expiry_date,
    monthly_revenue, total_revenue, loyalty_points
)
SELECT
    bp.user_id,
    'Écran Centre-ville',
    'Tunis, Avenue Habib Bourguiba',
    'Avenue Habib Bourguiba, 1000 Tunis',
    point(10.1815, 36.8065),
    'led',
    1920, 1080, 65.0, 'landscape',
    'active', true, NOW() - INTERVAL '5 minutes',
    '2024-01-01', '2027-01-01',
    1250.50, 15000.00, 150
FROM business_profiles bp
WHERE bp.profile_type IN ('individual_owner', 'fleet_owner');

INSERT INTO screens (
    owner_id, name, location, address, coordinates, screen_type,
    resolution_width, resolution_height, screen_size_inches, orientation,
    status, is_online, last_heartbeat, installation_date, warranty_expiry_date,
    monthly_revenue, total_revenue, loyalty_points
)
SELECT
    bp.user_id,
    'Écran Mall',
    'Tunis, Tunis City Mall',
    'Tunis City Mall, 1053 Tunis',
    point(10.1894, 36.8065),
    'lcd',
    3840, 2160, 75.0, 'landscape',
    'active', true, NOW() - INTERVAL '2 minutes',
    '2024-02-15', '2027-02-15',
    890.25, 12000.00, 120
FROM business_profiles bp
WHERE bp.profile_type IN ('individual_owner', 'fleet_owner');

INSERT INTO screens (
    owner_id, name, location, address, coordinates, screen_type,
    resolution_width, resolution_height, screen_size_inches, orientation,
    status, is_online, last_heartbeat, installation_date, warranty_expiry_date,
    monthly_revenue, total_revenue, loyalty_points
)
SELECT
    bp.user_id,
    'Écran Université',
    'Tunis, Campus Universitaire',
    'Campus Universitaire, 2092 Tunis',
    point(10.1894, 36.8065),
    'lcd',
    1920, 1080, 50.0, 'portrait',
    'inactive', false, NOW() - INTERVAL '2 days',
    '2024-01-15', '2027-01-15',
    0.00, 5000.00, 50
FROM business_profiles bp
WHERE bp.profile_type IN ('individual_owner', 'fleet_owner');

-- 2. Configurations par défaut pour chaque écran
INSERT INTO screen_configurations (screen_id, brightness_level, volume_level, auto_brightness, auto_volume, timezone, language, refresh_rate, power_schedule, maintenance_mode)
SELECT s.id, 85, 60, true, true, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "06:00", "end": "23:00"}, "tuesday": {"start": "06:00", "end": "23:00"}, "wednesday": {"start": "06:00", "end": "23:00"}, "thursday": {"start": "06:00", "end": "23:00"}, "friday": {"start": "06:00", "end": "00:00"}, "saturday": {"start": "07:00", "end": "00:00"}, "sunday": {"start": "08:00", "end": "22:00"}}', false
FROM screens s
WHERE s.name = 'Écran Centre-ville';

INSERT INTO screen_configurations (screen_id, brightness_level, volume_level, auto_brightness, auto_volume, timezone, language, refresh_rate, power_schedule, maintenance_mode)
SELECT s.id, 90, 70, true, true, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "09:00", "end": "22:00"}, "tuesday": {"start": "09:00", "end": "22:00"}, "wednesday": {"start": "09:00", "end": "22:00"}, "thursday": {"start": "09:00", "end": "22:00"}, "friday": {"start": "09:00", "end": "23:00"}, "saturday": {"start": "10:00", "end": "23:00"}, "sunday": {"start": "10:00", "end": "21:00"}}', false
FROM screens s
WHERE s.name = 'Écran Mall';

INSERT INTO screen_configurations (screen_id, brightness_level, volume_level, auto_brightness, auto_volume, timezone, language, refresh_rate, power_schedule, maintenance_mode)
SELECT s.id, 80, 55, true, true, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "08:00", "end": "20:00"}, "tuesday": {"start": "08:00", "end": "20:00"}, "wednesday": {"start": "08:00", "end": "20:00"}, "thursday": {"start": "08:00", "end": "20:00"}, "friday": {"start": "08:00", "end": "18:00"}, "saturday": {"start": "09:00", "end": "16:00"}, "sunday": {"start": "09:00", "end": "16:00"}}', false
FROM screens s
WHERE s.name = 'Écran Université';

-- 3. Statistiques d'exemple pour chaque écran (1 jour)
INSERT INTO screen_statistics (screen_id, date, total_playtime_minutes, total_campaigns_played, total_revenue, uptime_percentage, error_count, maintenance_duration_minutes)
SELECT s.id, CURRENT_DATE, 1200, 25, 50.00, 98.5, 0, 0
FROM screens s;

-- 4. Périodes d'indisponibilité d'exemple
INSERT INTO screen_unavailability_periods (screen_id, start_date, end_date, start_time, end_time, reason, status, created_by)
SELECT s.id, CURRENT_DATE + INTERVAL '3 days', CURRENT_DATE + INTERVAL '3 days', '14:00:00', '22:00:00', 'Événement spécial - Festival de la Médina', 'pending', s.owner_id
FROM screens s WHERE s.name = 'Écran Centre-ville';

INSERT INTO screen_unavailability_periods (screen_id, start_date, end_date, start_time, end_time, reason, status, created_by)
SELECT s.id, CURRENT_DATE, CURRENT_DATE, '08:00:00', '18:00:00', 'Maintenance préventive - Remplacement du système de refroidissement', 'active', s.owner_id
FROM screens s WHERE s.name = 'Écran Université';

-- 5. Alertes d'exemple
INSERT INTO screen_alerts (screen_id, alert_type, severity, title, message, is_resolved)
SELECT s.id, 'offline', 'critical', 'Écran hors ligne', 'L''écran n''a pas envoyé de signal depuis plus d''une heure. Vérification requise.', false
FROM screens s WHERE s.name = 'Écran Université';

INSERT INTO screen_alerts (screen_id, alert_type, severity, title, message, is_resolved)
SELECT s.id, 'low_brightness', 'medium', 'Luminosité faible détectée', 'La luminosité de l''écran Mall est inférieure au seuil recommandé (70%).', true
FROM screens s WHERE s.name = 'Écran Mall';

-- 6. Logs d'activité d'exemple
INSERT INTO screen_activity_logs (screen_id, action, details, performed_by)
SELECT s.id, 'screen_created', jsonb_build_object('name', s.name, 'location', s.location), s.owner_id
FROM screens s; 