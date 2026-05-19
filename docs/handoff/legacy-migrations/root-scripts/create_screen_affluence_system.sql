-- Script pour créer le système de données d'affluence des écrans
-- Date: 2025-01-30

-- 1. Créer la table pour les données d'affluence des écrans
CREATE TABLE IF NOT EXISTS screen_affluence_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    in_count INTEGER DEFAULT 0,
    out_count INTEGER DEFAULT 0,
    passby_count INTEGER DEFAULT 0,
    turnback_count INTEGER DEFAULT 0,
    avg_stay_time INTEGER DEFAULT 0, -- en millisecondes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Contraintes
    CONSTRAINT valid_time_range CHECK (end_time > start_time),
    CONSTRAINT valid_counts CHECK (
        in_count >= 0 AND 
        out_count >= 0 AND 
        passby_count >= 0 AND 
        turnback_count >= 0 AND 
        avg_stay_time >= 0
    )
);

-- 2. Créer un index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_screen_affluence_screen_id ON screen_affluence_data(screen_id);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_time ON screen_affluence_data(time);
CREATE INDEX IF NOT EXISTS idx_screen_affluence_date ON screen_affluence_data(DATE(time));

-- 3. Créer une vue pour les statistiques d'affluence par écran
CREATE OR REPLACE VIEW screen_affluence_stats AS
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
    MAX(sad.time) as last_measurement,
    MIN(sad.time) as first_measurement
FROM screens s
LEFT JOIN screen_affluence_data sad ON s.id = sad.screen_id
WHERE s.status = 'active'
GROUP BY s.id, s.name, s.location, s.screen_type;

-- 4. Créer une fonction pour calculer les impressions estimées
CREATE OR REPLACE FUNCTION calculate_estimated_impressions(
    p_screen_id UUID,
    p_duration_hours INTEGER DEFAULT 1
) RETURNS INTEGER AS $$
DECLARE
    avg_passby INTEGER;
    avg_turnback INTEGER;
    estimated_impressions INTEGER;
BEGIN
    -- Récupérer les moyennes des 7 derniers jours
    SELECT 
        COALESCE(AVG(passby_count), 0),
        COALESCE(AVG(turnback_count), 0)
    INTO avg_passby, avg_turnback
    FROM screen_affluence_data
    WHERE screen_id = p_screen_id
    AND time >= NOW() - INTERVAL '7 days';
    
    -- Calculer les impressions estimées
    -- Formule: (passby + turnback) * durée en heures
    estimated_impressions := (avg_passby + avg_turnback) * p_duration_hours;
    
    RETURN GREATEST(estimated_impressions, 0);
END;
$$ LANGUAGE plpgsql;

-- 5. RLS Policies pour la sécurité
ALTER TABLE screen_affluence_data ENABLE ROW LEVEL SECURITY;

-- Politique pour les propriétaires d'écrans
CREATE POLICY "Propriétaires peuvent voir leurs données d'affluence" ON screen_affluence_data
    FOR SELECT USING (
        screen_id IN (
            SELECT id FROM screens WHERE owner_id = auth.uid()
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

-- 6. Insérer des données de test pour les écrans existants
-- D'abord, vérifions quels écrans existent
DO $$
DECLARE
    screen_record RECORD;
    i INTEGER;
    base_time TIMESTAMP WITH TIME ZONE;
    measurement_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Récupérer tous les écrans actifs
    FOR screen_record IN 
        SELECT id, name, location FROM screens WHERE status = 'active' LIMIT 2
    LOOP
        RAISE NOTICE 'Ajout de données de test pour l''écran: % (%)', screen_record.name, screen_record.id;
        
        -- Générer des données pour les 7 derniers jours
        FOR i IN 0..6 LOOP
            base_time := NOW() - (i || ' days')::INTERVAL;
            
            -- Générer 12 mesures par jour (toutes les 2 heures)
            FOR j IN 0..11 LOOP
                measurement_time := base_time + (j * 2 || ' hours')::INTERVAL;
                
                INSERT INTO screen_affluence_data (
                    screen_id,
                    start_time,
                    end_time,
                    time,
                    in_count,
                    out_count,
                    passby_count,
                    turnback_count,
                    avg_stay_time
                ) VALUES (
                    screen_record.id,
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
                    END
                );
            END LOOP;
        END LOOP;
        
        RAISE NOTICE 'Données ajoutées pour l''écran: %', screen_record.name;
    END LOOP;
    
    RAISE NOTICE 'Insertion des données de test terminée !';
END $$;

-- 7. Vérifier les données insérées
SELECT 
    s.name as screen_name,
    s.location,
    COUNT(sad.id) as total_measurements,
    AVG(sad.passby_count) as avg_passby,
    AVG(sad.turnback_count) as avg_turnback,
    AVG(sad.avg_stay_time) as avg_stay_time_ms,
    MIN(sad.time) as first_measurement,
    MAX(sad.time) as last_measurement
FROM screens s
JOIN screen_affluence_data sad ON s.id = sad.screen_id
WHERE s.status = 'active'
GROUP BY s.id, s.name, s.location
ORDER BY s.name;

-- 8. Tester la fonction de calcul d'impressions
SELECT 
    s.name as screen_name,
    calculate_estimated_impressions(s.id, 1) as impressions_1h,
    calculate_estimated_impressions(s.id, 8) as impressions_8h,
    calculate_estimated_impressions(s.id, 24) as impressions_24h
FROM screens s
WHERE s.status = 'active'
ORDER BY s.name;

-- 9. Afficher les statistiques d'affluence
SELECT * FROM screen_affluence_stats ORDER BY screen_name;












































