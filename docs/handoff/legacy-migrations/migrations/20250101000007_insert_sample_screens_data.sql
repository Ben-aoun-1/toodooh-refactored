-- Migration pour insérer des données d'exemple pour les écrans
-- Date: 2025-01-01

-- Insérer des écrans d'exemple pour les propriétaires existants
INSERT INTO screens (
    id, owner_id, name, location, address, coordinates, screen_type, 
    resolution_width, resolution_height, screen_size_inches, orientation,
    status, is_online, last_heartbeat, installation_date, warranty_expiry_date,
    monthly_revenue, total_revenue, loyalty_points
) VALUES 
-- Écrans pour le propriétaire individuel (user_id: 1)
(
    '550e8400-e29b-41d4-a716-446655440001',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1),
    'Écran Centre-ville',
    'Tunis, Avenue Habib Bourguiba',
    'Avenue Habib Bourguiba, 1000 Tunis',
    point(10.1815, 36.8065),
    'led',
    1920, 1080, 65.0, 'landscape',
    'active', true, NOW() - INTERVAL '5 minutes',
    '2024-01-01', '2027-01-01',
    1250.50, 15000.00, 150
),
(
    '550e8400-e29b-41d4-a716-446655440002',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1),
    'Écran Mall',
    'Tunis, Tunis City Mall',
    'Tunis City Mall, 1053 Tunis',
    point(10.1894, 36.8065),
    'lcd',
    3840, 2160, 75.0, 'landscape',
    'active', true, NOW() - INTERVAL '2 minutes',
    '2024-02-15', '2027-02-15',
    890.25, 12000.00, 120
),
(
    '550e8400-e29b-41d4-a716-446655440003',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1),
    'Écran Station',
    'Tunis, Gare Tunis-Marine',
    'Gare Tunis-Marine, 1000 Tunis',
    point(10.1815, 36.8065),
    'led',
    1920, 1080, 55.0, 'landscape',
    'maintenance', false, NOW() - INTERVAL '1 hour',
    '2024-03-01', '2027-03-01',
    0.00, 8000.00, 80
),
(
    '550e8400-e29b-41d4-a716-446655440004',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1),
    'Écran Université',
    'Tunis, Campus Universitaire',
    'Campus Universitaire, 2092 Tunis',
    point(10.1894, 36.8065),
    'lcd',
    1920, 1080, 50.0, 'portrait',
    'inactive', false, NOW() - INTERVAL '2 days',
    '2024-01-15', '2027-01-15',
    0.00, 5000.00, 50
),
(
    '550e8400-e29b-41d4-a716-446655440005',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1),
    'Écran Aéroport',
    'Tunis, Aéroport Tunis-Carthage',
    'Aéroport Tunis-Carthage, 1080 Tunis',
    point(10.2272, 36.8519),
    'led',
    2560, 1440, 85.0, 'landscape',
    'active', true, NOW() - INTERVAL '1 minute',
    '2024-04-01', '2027-04-01',
    2100.75, 25000.00, 250
),
(
    '550e8400-e29b-41d4-a716-446655440006',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1),
    'Écran Port',
    'Tunis, Port de Tunis',
    'Port de Tunis, 1000 Tunis',
    point(10.1815, 36.8065),
    'projector',
    1920, 1080, 120.0, 'landscape',
    'active', true, NOW() - INTERVAL '10 minutes',
    '2024-05-01', '2027-05-01',
    750.00, 9000.00, 90
);

-- Insérer des configurations pour chaque écran
INSERT INTO screen_configurations (
    screen_id, brightness_level, volume_level, auto_brightness, auto_volume,
    timezone, language, refresh_rate, power_schedule, maintenance_mode
) VALUES 
('550e8400-e29b-41d4-a716-446655440001', 85, 60, true, true, 'Africa/Tunis', 'fr', 60, 
 '{"monday": {"start": "06:00", "end": "23:00"}, "tuesday": {"start": "06:00", "end": "23:00"}, "wednesday": {"start": "06:00", "end": "23:00"}, "thursday": {"start": "06:00", "end": "23:00"}, "friday": {"start": "06:00", "end": "00:00"}, "saturday": {"start": "07:00", "end": "00:00"}, "sunday": {"start": "08:00", "end": "22:00"}}', false),
('550e8400-e29b-41d4-a716-446655440002', 90, 70, true, true, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "09:00", "end": "22:00"}, "tuesday": {"start": "09:00", "end": "22:00"}, "wednesday": {"start": "09:00", "end": "22:00"}, "thursday": {"start": "09:00", "end": "22:00"}, "friday": {"start": "09:00", "end": "23:00"}, "saturday": {"start": "10:00", "end": "23:00"}, "sunday": {"start": "10:00", "end": "21:00"}}', false),
('550e8400-e29b-41d4-a716-446655440003', 75, 50, false, false, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "05:00", "end": "23:00"}, "tuesday": {"start": "05:00", "end": "23:00"}, "wednesday": {"start": "05:00", "end": "23:00"}, "thursday": {"start": "05:00", "end": "23:00"}, "friday": {"start": "05:00", "end": "00:00"}, "saturday": {"start": "06:00", "end": "00:00"}, "sunday": {"start": "06:00", "end": "23:00"}}', true),
('550e8400-e29b-41d4-a716-446655440004', 80, 55, true, true, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "08:00", "end": "20:00"}, "tuesday": {"start": "08:00", "end": "20:00"}, "wednesday": {"start": "08:00", "end": "20:00"}, "thursday": {"start": "08:00", "end": "20:00"}, "friday": {"start": "08:00", "end": "18:00"}, "saturday": {"start": "09:00", "end": "16:00"}, "sunday": {"start": "09:00", "end": "16:00"}}', false),
('550e8400-e29b-41d4-a716-446655440005', 95, 80, true, true, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "04:00", "end": "00:00"}, "tuesday": {"start": "04:00", "end": "00:00"}, "wednesday": {"start": "04:00", "end": "00:00"}, "thursday": {"start": "04:00", "end": "00:00"}, "friday": {"start": "04:00", "end": "00:00"}, "saturday": {"start": "04:00", "end": "00:00"}, "sunday": {"start": "04:00", "end": "00:00"}}', false),
('550e8400-e29b-41d4-a716-446655440006', 70, 40, true, false, 'Africa/Tunis', 'fr', 60,
 '{"monday": {"start": "06:00", "end": "22:00"}, "tuesday": {"start": "06:00", "end": "22:00"}, "wednesday": {"start": "06:00", "end": "22:00"}, "thursday": {"start": "06:00", "end": "22:00"}, "friday": {"start": "06:00", "end": "23:00"}, "saturday": {"start": "07:00", "end": "23:00"}, "sunday": {"start": "07:00", "end": "22:00"}}', false);

-- Insérer des statistiques pour les 30 derniers jours
INSERT INTO screen_statistics (screen_id, date, total_playtime_minutes, total_campaigns_played, total_revenue, uptime_percentage, error_count, maintenance_duration_minutes)
SELECT 
    screen_id,
    generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, '1 day'::interval)::date as date,
    CASE 
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440001' THEN floor(random() * 1440 + 720)::integer -- 12-24h
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440002' THEN floor(random() * 780 + 390)::integer -- 6.5-13h
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440003' THEN floor(random() * 1080 + 540)::integer -- 9-18h
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440004' THEN floor(random() * 720 + 360)::integer -- 6-12h
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440005' THEN floor(random() * 1440 + 1200)::integer -- 20-24h
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440006' THEN floor(random() * 960 + 480)::integer -- 8-16h
    END as total_playtime_minutes,
    floor(random() * 50 + 10)::integer as total_campaigns_played,
    CASE 
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440001' THEN (random() * 50 + 30)::decimal(10,2)
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440002' THEN (random() * 35 + 20)::decimal(10,2)
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440003' THEN (random() * 40 + 25)::decimal(10,2)
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440004' THEN (random() * 25 + 15)::decimal(10,2)
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440005' THEN (random() * 80 + 50)::decimal(10,2)
        WHEN screen_id = '550e8400-e29b-41d4-a716-446655440006' THEN (random() * 30 + 20)::decimal(10,2)
    END as total_revenue,
    (random() * 10 + 90)::decimal(5,2) as uptime_percentage,
    floor(random() * 5)::integer as error_count,
    floor(random() * 120)::integer as maintenance_duration_minutes
FROM screen_configurations;

-- Insérer des périodes d'indisponibilité d'exemple
INSERT INTO screen_unavailability_periods (
    screen_id, start_date, end_date, start_time, end_time, reason, status, created_by
) VALUES 
-- Période en cours (maintenance)
(
    '550e8400-e29b-41d4-a716-446655440003',
    CURRENT_DATE,
    CURRENT_DATE,
    '08:00:00',
    '18:00:00',
    'Maintenance préventive - Remplacement du système de refroidissement',
    'active',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
-- Période programmée (événement spécial)
(
    '550e8400-e29b-41d4-a716-446655440001',
    CURRENT_DATE + INTERVAL '3 days',
    CURRENT_DATE + INTERVAL '3 days',
    '14:00:00',
    '22:00:00',
    'Événement spécial - Festival de la Médina',
    'pending',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
-- Période programmée (réparation)
(
    '550e8400-e29b-41d4-a716-446655440002',
    CURRENT_DATE + INTERVAL '7 days',
    CURRENT_DATE + INTERVAL '7 days',
    '09:00:00',
    '17:00:00',
    'Réparation technique - Remplacement d\'un module LED défectueux',
    'pending',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
-- Période terminée (maintenance passée)
(
    '550e8400-e29b-41d4-a716-446655440005',
    CURRENT_DATE - INTERVAL '2 days',
    CURRENT_DATE - INTERVAL '2 days',
    '06:00:00',
    '12:00:00',
    'Maintenance préventive - Nettoyage et vérification des connexions',
    'completed',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
);

-- Insérer des alertes d'exemple
INSERT INTO screen_alerts (
    screen_id, alert_type, severity, title, message, is_resolved, resolved_at
) VALUES 
-- Alerte critique (non résolue)
(
    '550e8400-e29b-41d4-a716-446655440003',
    'offline',
    'critical',
    'Écran Station hors ligne',
    'L\'écran Station n\'a pas envoyé de signal depuis plus d\'une heure. Vérification requise.',
    false,
    NULL
),
-- Alerte moyenne (résolue)
(
    '550e8400-e29b-41d4-a716-446655440002',
    'low_brightness',
    'medium',
    'Luminosité faible détectée',
    'La luminosité de l\'écran Mall est inférieure au seuil recommandé (70%).',
    true,
    NOW() - INTERVAL '2 hours'
),
-- Alerte faible (non résolue)
(
    '550e8400-e29b-41d4-a716-446655440001',
    'network_issue',
    'low',
    'Connexion réseau instable',
    'Connexion réseau intermittente détectée sur l\'écran Centre-ville.',
    false,
    NULL
),
-- Alerte haute (non résolue)
(
    '550e8400-e29b-41d4-a716-446655440005',
    'high_temperature',
    'high',
    'Température élevée détectée',
    'La température de l\'écran Aéroport dépasse le seuil de sécurité (45°C).',
    false,
    NULL
);

-- Insérer des logs d'activité d'exemple
INSERT INTO screen_activity_logs (
    screen_id, action, details, performed_by
) VALUES 
(
    '550e8400-e29b-41d4-a716-446655440001',
    'screen_created',
    '{"name": "Écran Centre-ville", "location": "Tunis, Avenue Habib Bourguiba"}',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
(
    '550e8400-e29b-41d4-a716-446655440001',
    'configuration_updated',
    '{"brightness_level": 85, "volume_level": 60}',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
(
    '550e8400-e29b-41d4-a716-446655440003',
    'maintenance_started',
    '{"reason": "Maintenance préventive - Remplacement du système de refroidissement", "duration": "8 hours"}',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
(
    '550e8400-e29b-41d4-a716-446655440002',
    'unavailability_scheduled',
    '{"start_date": "2025-01-04", "end_date": "2025-01-04", "reason": "Réparation technique"}',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
),
(
    '550e8400-e29b-41d4-a716-446655440005',
    'alert_resolved',
    '{"alert_type": "low_brightness", "resolution": "Ajustement automatique de la luminosité"}',
    (SELECT id FROM auth.users WHERE email = 'proprietaire@example.com' LIMIT 1)
);

-- Mettre à jour les revenus totaux des écrans basés sur les statistiques
UPDATE screens 
SET total_revenue = (
    SELECT COALESCE(SUM(total_revenue), 0)
    FROM screen_statistics 
    WHERE screen_statistics.screen_id = screens.id
),
monthly_revenue = (
    SELECT COALESCE(SUM(total_revenue), 0)
    FROM screen_statistics 
    WHERE screen_statistics.screen_id = screens.id
    AND screen_statistics.date >= CURRENT_DATE - INTERVAL '30 days'
)
WHERE id IN (
    SELECT DISTINCT screen_id 
    FROM screen_statistics
);

-- Mettre à jour les points de fidélité basés sur les revenus
UPDATE screens 
SET loyalty_points = FLOOR(total_revenue / 100)::integer
WHERE id IN (
    SELECT id FROM screens
); 