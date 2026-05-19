-- Migration pour créer les tables de gestion des écrans
-- Date: 2025-01-01

-- Table des écrans
CREATE TABLE IF NOT EXISTS screens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    location VARCHAR(500) NOT NULL,
    address TEXT,
    coordinates POINT, -- Pour la géolocalisation
    screen_type VARCHAR(50) DEFAULT 'led' CHECK (screen_type IN ('led', 'lcd', 'projector', 'other')),
    resolution_width INTEGER,
    resolution_height INTEGER,
    screen_size_inches DECIMAL(5,2),
    orientation VARCHAR(20) DEFAULT 'landscape' CHECK (orientation IN ('landscape', 'portrait', 'square')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'unavailable')),
    is_online BOOLEAN DEFAULT true,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    installation_date DATE,
    warranty_expiry_date DATE,
    monthly_revenue DECIMAL(10,2) DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    loyalty_points INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des périodes d'indisponibilité
CREATE TABLE IF NOT EXISTS screen_unavailability_periods (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Contraintes pour éviter les chevauchements
    CONSTRAINT no_overlapping_periods UNIQUE (screen_id, start_date, end_date, start_time, end_time),
    CONSTRAINT valid_date_range CHECK (end_date >= start_date),
    CONSTRAINT valid_time_range CHECK (
        (start_date < end_date) OR 
        (start_date = end_date AND start_time < end_time)
    )
);

-- Table des configurations d'écrans
CREATE TABLE IF NOT EXISTS screen_configurations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    brightness_level INTEGER DEFAULT 100 CHECK (brightness_level BETWEEN 0 AND 100),
    volume_level INTEGER DEFAULT 50 CHECK (volume_level BETWEEN 0 AND 100),
    auto_brightness BOOLEAN DEFAULT true,
    auto_volume BOOLEAN DEFAULT true,
    timezone VARCHAR(50) DEFAULT 'Africa/Tunis',
    language VARCHAR(10) DEFAULT 'fr',
    refresh_rate INTEGER DEFAULT 60, -- Hz
    power_schedule JSONB, -- Horaires d'allumage/extinction
    maintenance_mode BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(screen_id)
);

-- Table des statistiques d'écrans
CREATE TABLE IF NOT EXISTS screen_statistics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    date DATE NOT NULL,
    total_playtime_minutes INTEGER DEFAULT 0,
    total_campaigns_played INTEGER DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    uptime_percentage DECIMAL(5,2) DEFAULT 100,
    error_count INTEGER DEFAULT 0,
    maintenance_duration_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(screen_id, date)
);

-- Table des alertes d'écrans
CREATE TABLE IF NOT EXISTS screen_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('offline', 'maintenance', 'error', 'low_brightness', 'high_temperature', 'network_issue')),
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des logs d'activité des écrans
CREATE TABLE IF NOT EXISTS screen_activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_screens_owner_id ON screens(owner_id);
CREATE INDEX IF NOT EXISTS idx_screens_status ON screens(status);
CREATE INDEX IF NOT EXISTS idx_screens_location ON screens USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx_unavailability_screen_id ON screen_unavailability_periods(screen_id);
CREATE INDEX IF NOT EXISTS idx_unavailability_dates ON screen_unavailability_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_unavailability_status ON screen_unavailability_periods(status);
CREATE INDEX IF NOT EXISTS idx_statistics_screen_date ON screen_statistics(screen_id, date);
CREATE INDEX IF NOT EXISTS idx_alerts_screen_id ON screen_alerts(screen_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON screen_alerts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_activity_logs_screen_id ON screen_activity_logs(screen_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON screen_activity_logs(created_at);

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at
CREATE TRIGGER update_screens_updated_at BEFORE UPDATE ON screens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_unavailability_updated_at BEFORE UPDATE ON screen_unavailability_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configurations_updated_at BEFORE UPDATE ON screen_configurations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fonction pour vérifier et mettre à jour les statuts d'indisponibilité
CREATE OR REPLACE FUNCTION check_unavailability_status()
RETURNS void AS $$
BEGIN
    -- Marquer les périodes expirées comme terminées
    UPDATE screen_unavailability_periods 
    SET status = 'completed', updated_at = NOW()
    WHERE status IN ('pending', 'active') 
    AND (end_date < CURRENT_DATE OR (end_date = CURRENT_DATE AND end_time < CURRENT_TIME));
    
    -- Marquer les périodes en cours comme actives
    UPDATE screen_unavailability_periods 
    SET status = 'active', updated_at = NOW()
    WHERE status = 'pending'
    AND start_date <= CURRENT_DATE 
    AND end_date >= CURRENT_DATE
    AND start_time <= CURRENT_TIME 
    AND end_time > CURRENT_TIME;
    
    -- Mettre à jour le statut des écrans
    UPDATE screens 
    SET status = 'unavailable', updated_at = NOW()
    WHERE id IN (
        SELECT DISTINCT screen_id 
        FROM screen_unavailability_periods 
        WHERE status = 'active'
    );
    
    -- Remettre les écrans en actif s'ils n'ont plus de périodes actives
    UPDATE screens 
    SET status = 'active', updated_at = NOW()
    WHERE status = 'unavailable'
    AND id NOT IN (
        SELECT DISTINCT screen_id 
        FROM screen_unavailability_periods 
        WHERE status = 'active'
    );
END;
$$ LANGUAGE plpgsql;

-- Fonction pour créer un écran avec sa configuration par défaut
CREATE OR REPLACE FUNCTION create_screen_with_config(
    p_owner_id UUID,
    p_name VARCHAR(255),
    p_location VARCHAR(500),
    p_address TEXT DEFAULT NULL,
    p_screen_type VARCHAR(50) DEFAULT 'led',
    p_resolution_width INTEGER DEFAULT 1920,
    p_resolution_height INTEGER DEFAULT 1080,
    p_screen_size_inches DECIMAL(5,2) DEFAULT 55.0
)
RETURNS UUID AS $$
DECLARE
    v_screen_id UUID;
BEGIN
    -- Créer l'écran
    INSERT INTO screens (
        owner_id, name, location, address, screen_type, 
        resolution_width, resolution_height, screen_size_inches
    ) VALUES (
        p_owner_id, p_name, p_location, p_address, p_screen_type,
        p_resolution_width, p_resolution_height, p_screen_size_inches
    ) RETURNING id INTO v_screen_id;
    
    -- Créer la configuration par défaut
    INSERT INTO screen_configurations (screen_id) VALUES (v_screen_id);
    
    -- Créer les statistiques pour aujourd'hui
    INSERT INTO screen_statistics (screen_id, date) VALUES (v_screen_id, CURRENT_DATE);
    
    RETURN v_screen_id;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies pour screens
ALTER TABLE screens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own screens" ON screens
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own screens" ON screens
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own screens" ON screens
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own screens" ON screens
    FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies pour screen_unavailability_periods
ALTER TABLE screen_unavailability_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view unavailability for their screens" ON screen_unavailability_periods
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_unavailability_periods.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert unavailability for their screens" ON screen_unavailability_periods
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_unavailability_periods.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can update unavailability for their screens" ON screen_unavailability_periods
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_unavailability_periods.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete unavailability for their screens" ON screen_unavailability_periods
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_unavailability_periods.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

-- RLS Policies pour les autres tables
ALTER TABLE screen_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_activity_logs ENABLE ROW LEVEL SECURITY;

-- Politiques pour screen_configurations
CREATE POLICY "Users can view configs for their screens" ON screen_configurations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_configurations.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can update configs for their screens" ON screen_configurations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_configurations.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

-- Politiques pour screen_statistics
CREATE POLICY "Users can view stats for their screens" ON screen_statistics
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_statistics.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

-- Politiques pour screen_alerts
CREATE POLICY "Users can view alerts for their screens" ON screen_alerts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_alerts.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can update alerts for their screens" ON screen_alerts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_alerts.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

-- Politiques pour screen_activity_logs
CREATE POLICY "Users can view logs for their screens" ON screen_activity_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_activity_logs.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

CREATE POLICY "System can insert logs" ON screen_activity_logs
    FOR INSERT WITH CHECK (true); 