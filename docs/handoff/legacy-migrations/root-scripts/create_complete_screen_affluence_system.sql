-- Script complet pour créer le système de données d'affluence des écrans
-- Date: 2025-01-30
-- Basé sur les spécifications détaillées du système de comptage

-- 1. Table principale pour les données d'affluence des écrans
CREATE TABLE IF NOT EXISTS screen_affluence_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- 1. Identification et statut de l'écran
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    sn VARCHAR(100) NOT NULL, -- Numéro de série unique du capteur/écran
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL, -- Horodatage d'envoi
    hw_platform VARCHAR(100), -- Modèle matériel
    sw_release VARCHAR(50), -- Version logicielle
    ip_address INET, -- Adresse IP locale
    mac_address MACADDR, -- Adresse MAC
    connection_type VARCHAR(20) DEFAULT 'wifi' CHECK (connection_type IN ('wired', 'wifi')), -- Type de connexion
    wifi_ssid VARCHAR(100), -- Identifiant réseau WiFi
    ip_address_method VARCHAR(20) DEFAULT 'dhcp' CHECK (ip_address_method IN ('dhcp', 'static')), -- DHCP ou statique
    host_name VARCHAR(100), -- Nom d'hôte
    time_zone VARCHAR(50) DEFAULT 'Africa/Tunis', -- Fuseau horaire
    upload_interval INTEGER DEFAULT 300, -- Fréquence d'envoi des données (en secondes)
    data_mode VARCHAR(20) DEFAULT 'add' CHECK (data_mode IN ('add', 'total')), -- Mode de transmission
    last_heartbeat_time TIMESTAMP WITH TIME ZONE, -- Date du dernier signal "vivant"
    
    -- 2. Données d'affluence (comptage global)
    start_time TIMESTAMP WITH TIME ZONE NOT NULL, -- Début de la période de mesure
    end_time TIMESTAMP WITH TIME ZONE NOT NULL, -- Fin de la période de mesure
    time TIMESTAMP WITH TIME ZONE NOT NULL, -- Heure d'envoi
    in_count INTEGER DEFAULT 0, -- Nombre d'entrées détectées
    out_count INTEGER DEFAULT 0, -- Nombre de sorties détectées
    passby_count INTEGER DEFAULT 0, -- Nombre de passants devant l'écran
    turnback_count INTEGER DEFAULT 0, -- Nombre de personnes qui se retournent
    avg_stay_time INTEGER DEFAULT 0, -- Temps moyen de présence (en millisecondes)
    
    -- 3. Données détaillées par personne (JSONB pour flexibilité)
    attributes JSONB DEFAULT '[]'::jsonb, -- Liste d'événements individuels détectés
    
    -- 4. Données REID (appariement entrée/sortie)
    global_id VARCHAR(100), -- Identifiant global unique de la personne
    dwell_time INTEGER, -- Temps réel passé devant l'écran
    enter_camera_sn VARCHAR(100), -- Caméra d'entrée
    leave_camera_sn VARCHAR(100), -- Caméra de sortie
    enter_timestamp TIMESTAMP WITH TIME ZONE, -- Horodatage d'entrée
    leave_timestamp TIMESTAMP WITH TIME ZONE, -- Horodatage de sortie
    enter_image_path TEXT, -- Chemin d'image d'entrée
    leave_image_path TEXT, -- Chemin d'image de sortie
    
    -- 5. Données de dé-duplication (multi-caméras)
    deduped_count INTEGER DEFAULT 0, -- Nombre de détections dédupliquées
    duplicate_total INTEGER DEFAULT 0, -- Total de doublons détectés
    original_enter_count INTEGER DEFAULT 0, -- Nombre d'entrées originales
    records JSONB DEFAULT '[]'::jsonb, -- Détails des doublons
    
    -- 6. Métadonnées
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Contraintes
    CONSTRAINT valid_time_range CHECK (end_time > start_time),
    CONSTRAINT valid_counts CHECK (
        in_count >= 0 AND 
        out_count >= 0 AND 
        passby_count >= 0 AND 
        turnback_count >= 0 AND 
        avg_stay_time >= 0 AND
        deduped_count >= 0 AND
        duplicate_total >= 0 AND
        original_enter_count >= 0
    )
);

-- 2. Table pour les données historiques (jusqu'à 90 jours)
CREATE TABLE IF NOT EXISTS screen_affluence_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    data_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    data_end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    total_entries INTEGER DEFAULT 0,
    total_exits INTEGER DEFAULT 0,
    total_passby INTEGER DEFAULT 0,
    total_turnback INTEGER DEFAULT 0,
    avg_dwell_time INTEGER DEFAULT 0,
    peak_hour INTEGER, -- Heure de pointe (0-23)
    peak_count INTEGER, -- Nombre de personnes à l'heure de pointe
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_history_range CHECK (data_end_time > data_start_time),
    CONSTRAINT valid_peak_hour CHECK (peak_hour >= 0 AND peak_hour <= 23)
);

-- 3. Index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_screen_affluence_screen_id ON screen_affluence_data(screen_id);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_timestamp ON screen_affluence_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_time_range ON screen_affluence_data(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_sn ON screen_affluence_data(sn);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_global_id ON screen_affluence_data(global_id);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_history_screen_id ON screen_affluence_history(screen_id);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_history_date_range ON screen_affluence_history(data_start_time, data_end_time);

-- 4. Vue pour les statistiques d'affluence par écran
DROP VIEW IF EXISTS screen_affluence_stats;
CREATE VIEW screen_affluence_stats AS
SELECT 
    s.id as screen_id,
    s.name as screen_name,
    s.location,
    s.screen_type,
    COUNT(sad.id) as total_measurements,
    AVG(sad.in_count) as avg_in_count,
    AVG(sad.out_count) as avg_out_count,
    AVG(sad.passby_count) as avg_passby_count,
    AVG(sad.turnback_count) as avg_turnback_count,
    AVG(sad.avg_stay_time) as avg_stay_time_ms,
    MAX(sad.timestamp) as last_measurement,
    MIN(sad.timestamp) as first_measurement,
    MAX(sad.last_heartbeat_time) as last_heartbeat,
    COUNT(DISTINCT sad.sn) as unique_sensors
FROM screens s
LEFT JOIN screen_affluence_data sad ON s.id = sad.screen_id
WHERE s.status = 'active'
GROUP BY s.id, s.name, s.location, s.screen_type;

-- 5. Fonction pour calculer les impressions estimées avec données détaillées
CREATE OR REPLACE FUNCTION calculate_estimated_impressions_detailed(
    p_screen_id UUID,
    p_duration_hours INTEGER DEFAULT 1
) RETURNS TABLE(
    total_impressions INTEGER,
    avg_passby_per_hour NUMERIC,
    avg_turnback_per_hour NUMERIC,
    avg_dwell_time_ms NUMERIC,
    peak_hour INTEGER,
    peak_count INTEGER
) AS $$
DECLARE
    avg_passby NUMERIC;
    avg_turnback NUMERIC;
    avg_dwell NUMERIC;
    peak_h INTEGER;
    peak_c INTEGER;
    total_imp INTEGER;
BEGIN
    -- Récupérer les moyennes des 7 derniers jours
    SELECT 
        COALESCE(AVG(passby_count), 0),
        COALESCE(AVG(turnback_count), 0),
        COALESCE(AVG(avg_stay_time), 0),
        EXTRACT(HOUR FROM timestamp) as hour,
        SUM(passby_count + turnback_count) as hourly_count
    INTO avg_passby, avg_turnback, avg_dwell, peak_h, peak_c
    FROM screen_affluence_data
    WHERE screen_id = p_screen_id
    AND timestamp >= NOW() - INTERVAL '7 days'
    GROUP BY EXTRACT(HOUR FROM timestamp)
    ORDER BY hourly_count DESC
    LIMIT 1;
    
    -- Calculer les impressions estimées
    total_imp := (avg_passby + avg_turnback) * p_duration_hours;
    
    RETURN QUERY SELECT 
        GREATEST(total_imp::INTEGER, 0),
        avg_passby,
        avg_turnback,
        avg_dwell,
        COALESCE(peak_h::INTEGER, 12),
        COALESCE(peak_c::INTEGER, 0);
END;
$$ LANGUAGE plpgsql;

-- 6. Fonction pour insérer des données d'affluence avec validation
CREATE OR REPLACE FUNCTION insert_affluence_data(
    p_screen_id UUID,
    p_sn VARCHAR(100),
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE,
    p_in_count INTEGER,
    p_out_count INTEGER,
    p_passby_count INTEGER,
    p_turnback_count INTEGER,
    p_avg_stay_time INTEGER,
    p_attributes JSONB DEFAULT '[]'::jsonb,
    p_global_id VARCHAR(100) DEFAULT NULL,
    p_dwell_time INTEGER DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    new_id UUID;
BEGIN
    -- Validation des données
    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'end_time must be greater than start_time';
    END IF;
    
    IF p_in_count < 0 OR p_out_count < 0 OR p_passby_count < 0 OR p_turnback_count < 0 OR p_avg_stay_time < 0 THEN
        RAISE EXCEPTION 'All counts must be non-negative';
    END IF;
    
    -- Insertion des données
    INSERT INTO screen_affluence_data (
        screen_id, sn, start_time, end_time, time,
        in_count, out_count, passby_count, turnback_count, avg_stay_time,
        attributes, global_id, dwell_time, timestamp, last_heartbeat_time
    ) VALUES (
        p_screen_id, p_sn, p_start_time, p_end_time, NOW(),
        p_in_count, p_out_count, p_passby_count, p_turnback_count, p_avg_stay_time,
        p_attributes, p_global_id, p_dwell_time, NOW(), NOW()
    ) RETURNING id INTO new_id;
    
    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- 7. RLS Policies pour la sécurité
ALTER TABLE screen_affluence_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_affluence_history ENABLE ROW LEVEL SECURITY;

-- Supprimer les politiques existantes si elles existent
DROP POLICY IF EXISTS "Propriétaires peuvent voir leurs données d'affluence" ON screen_affluence_data;
DROP POLICY IF EXISTS "Propriétaires peuvent voir leur historique d'affluence" ON screen_affluence_history;
DROP POLICY IF EXISTS "Admins peuvent voir toutes les données d'affluence" ON screen_affluence_data;
DROP POLICY IF EXISTS "Admins peuvent voir tout l'historique d'affluence" ON screen_affluence_history;

-- Politique pour les propriétaires d'écrans
CREATE POLICY "Propriétaires peuvent voir leurs données d'affluence" ON screen_affluence_data
    FOR SELECT USING (
        screen_id IN (
            SELECT s.id FROM screens s
            JOIN business_profiles bp ON s.owner_id = bp.id
            WHERE bp.user_id = auth.uid()
        )
    );

CREATE POLICY "Propriétaires peuvent voir leur historique d'affluence" ON screen_affluence_history
    FOR SELECT USING (
        screen_id IN (
            SELECT s.id FROM screens s
            JOIN business_profiles bp ON s.owner_id = bp.id
            WHERE bp.user_id = auth.uid()
        )
    );

-- Politique pour les administrateurs
CREATE POLICY "Admins peuvent voir toutes les données d'affluence" ON screen_affluence_data
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins peuvent voir tout l'historique d'affluence" ON screen_affluence_history
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- 8. Insérer des données de test réalistes pour les écrans existants
DO $$
DECLARE
    screen_record RECORD;
    i INTEGER;
    j INTEGER;
    base_time TIMESTAMP WITH TIME ZONE;
    measurement_time TIMESTAMP WITH TIME ZONE;
    sensor_sn VARCHAR(100);
    attributes_data JSONB;
BEGIN
    -- Récupérer tous les écrans actifs
    FOR screen_record IN 
        SELECT id, name, location FROM screens WHERE status = 'active' LIMIT 2
    LOOP
        RAISE NOTICE 'Ajout de données de test pour l''écran: % (%)', screen_record.name, screen_record.id;
        
        -- Générer un numéro de série unique pour le capteur
        sensor_sn := 'SENSOR_' || SUBSTRING(screen_record.id::text, 1, 8) || '_' || EXTRACT(EPOCH FROM NOW())::INTEGER;
        
        -- Générer des données pour les 7 derniers jours
        FOR i IN 0..6 LOOP
            base_time := NOW() - (i || ' days')::INTERVAL;
            
            -- Générer 12 mesures par jour (toutes les 2 heures)
            FOR j IN 0..11 LOOP
                measurement_time := base_time + (j * 2 || ' hours')::INTERVAL;
                
                -- Générer des attributs détaillés (exemple)
                attributes_data := jsonb_build_array(
                    jsonb_build_object(
                        'personId', 'P_' || (j * 10 + 1),
                        'eventType', 0,
                        'timeStamp', measurement_time,
                        'stayTime', 45000 + (random() * 15000),
                        'age', CASE (random() * 5)::INTEGER
                            WHEN 0 THEN '<10'
                            WHEN 1 THEN '10-16'
                            WHEN 2 THEN '17-30'
                            WHEN 3 THEN '31-45'
                            WHEN 4 THEN '46-60'
                            ELSE '>60'
                        END,
                        'gender', (random() * 2)::INTEGER,
                        'height', 150 + (random() * 50),
                        'wheelchair', (random() > 0.95)::INTEGER,
                        'workcard', (random() > 0.8)::INTEGER
                    ),
                    jsonb_build_object(
                        'personId', 'P_' || (j * 10 + 2),
                        'eventType', 2,
                        'timeStamp', measurement_time + INTERVAL '30 minutes',
                        'stayTime', 30000 + (random() * 10000),
                        'age', CASE (random() * 5)::INTEGER
                            WHEN 0 THEN '<10'
                            WHEN 1 THEN '10-16'
                            WHEN 2 THEN '17-30'
                            WHEN 3 THEN '31-45'
                            WHEN 4 THEN '46-60'
                            ELSE '>60'
                        END,
                        'gender', (random() * 2)::INTEGER,
                        'height', 150 + (random() * 50),
                        'wheelchair', (random() > 0.95)::INTEGER,
                        'workcard', (random() > 0.8)::INTEGER
                    )
                );
                
                -- Insérer les données d'affluence
                INSERT INTO screen_affluence_data (
                    screen_id, sn, timestamp, hw_platform, sw_release,
                    ip_address, mac_address, connection_type, wifi_ssid,
                    ip_address_method, host_name, time_zone, upload_interval,
                    data_mode, last_heartbeat_time,
                    start_time, end_time, time,
                    in_count, out_count, passby_count, turnback_count, avg_stay_time,
                    attributes, global_id, dwell_time,
                    deduped_count, duplicate_total, original_enter_count, records
                ) VALUES (
                    screen_record.id,
                    sensor_sn,
                    measurement_time,
                    'SmartSensor Pro v2.1',
                    '1.4.2',
                    ('192.168.1.' || (100 + j)::TEXT)::INET,
                    MACADDR '00:1B:44:11:3A:B7',
                    'wifi',
                    'TooDooh_Network_' || j,
                    'dhcp',
                    'sensor-' || SUBSTRING(screen_record.id::text, 1, 8),
                    'Africa/Tunis',
                    300,
                    'add',
                    measurement_time,
                    measurement_time,
                    measurement_time + INTERVAL '2 hours',
                    measurement_time,
                    -- Données réalistes basées sur l'heure et le jour
                    CASE 
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 7 AND 9 THEN 45 + (random() * 20)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 12 AND 14 THEN 60 + (random() * 30)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 17 AND 19 THEN 55 + (random() * 25)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 20 AND 22 THEN 35 + (random() * 15)::INTEGER
                        ELSE 15 + (random() * 10)::INTEGER
                    END,
                    CASE 
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 7 AND 9 THEN 40 + (random() * 15)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 12 AND 14 THEN 55 + (random() * 25)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 17 AND 19 THEN 50 + (random() * 20)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 20 AND 22 THEN 30 + (random() * 10)::INTEGER
                        ELSE 12 + (random() * 8)::INTEGER
                    END,
                    CASE 
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 7 AND 9 THEN 120 + (random() * 50)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 12 AND 14 THEN 150 + (random() * 70)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 17 AND 19 THEN 140 + (random() * 60)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 20 AND 22 THEN 80 + (random() * 40)::INTEGER
                        ELSE 40 + (random() * 20)::INTEGER
                    END,
                    CASE 
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 7 AND 9 THEN 25 + (random() * 15)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 12 AND 14 THEN 35 + (random() * 20)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 17 AND 19 THEN 30 + (random() * 18)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 20 AND 22 THEN 20 + (random() * 10)::INTEGER
                        ELSE 8 + (random() * 5)::INTEGER
                    END,
                    CASE 
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 7 AND 9 THEN 45000 + (random() * 15000)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 12 AND 14 THEN 60000 + (random() * 20000)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 17 AND 19 THEN 55000 + (random() * 18000)::INTEGER
                        WHEN EXTRACT(HOUR FROM measurement_time) BETWEEN 20 AND 22 THEN 35000 + (random() * 10000)::INTEGER
                        ELSE 20000 + (random() * 8000)::INTEGER
                    END,
                    attributes_data,
                    'GLOBAL_' || (j * 10 + 1),
                    45000 + (random() * 15000)::INTEGER,
                    2 + (random() * 3)::INTEGER,
                    1 + (random() * 2)::INTEGER,
                    40 + (random() * 20)::INTEGER,
                    jsonb_build_array(
                        jsonb_build_object(
                            'globalID', 'GLOBAL_' || (j * 10 + 1),
                            'cameras', ARRAY[sensor_sn],
                            'timestamps', ARRAY[measurement_time]
                        )
                    )
                );
            END LOOP;
        END LOOP;
        
        RAISE NOTICE 'Données ajoutées pour l''écran: %', screen_record.name;
    END LOOP;
    
    RAISE NOTICE 'Insertion des données de test terminée !';
END $$;

-- 9. Vérifier les données insérées
SELECT 
    s.name as screen_name,
    s.location,
    COUNT(sad.id) as total_measurements,
    COUNT(DISTINCT sad.sn) as unique_sensors,
    AVG(sad.passby_count) as avg_passby,
    AVG(sad.turnback_count) as avg_turnback,
    AVG(sad.avg_stay_time) as avg_stay_time_ms,
    MIN(sad.timestamp) as first_measurement,
    MAX(sad.timestamp) as last_measurement,
    MAX(sad.last_heartbeat_time) as last_heartbeat
FROM screens s
JOIN screen_affluence_data sad ON s.id = sad.screen_id
WHERE s.status = 'active'
GROUP BY s.id, s.name, s.location
ORDER BY s.name;

-- 10. Tester la fonction de calcul d'impressions détaillées
SELECT 
    s.name as screen_name,
    (calculate_estimated_impressions_detailed(s.id, 1)).*
FROM screens s
WHERE s.status = 'active'
ORDER BY s.name;

-- 11. Afficher les statistiques d'affluence
SELECT * FROM screen_affluence_stats ORDER BY screen_name;

-- 12. Exemple de requête pour les données détaillées par personne
SELECT 
    s.name as screen_name,
    sad.sn as sensor_sn,
    sad.timestamp,
    sad.attributes->0->>'personId' as person_id,
    sad.attributes->0->>'age' as age_group,
    sad.attributes->0->>'gender' as gender,
    sad.attributes->0->>'stayTime' as stay_time_ms
FROM screens s
JOIN screen_affluence_data sad ON s.id = sad.screen_id
WHERE s.status = 'active'
AND sad.attributes != '[]'::jsonb
ORDER BY sad.timestamp DESC
LIMIT 10;
