-- Système de validation simplifié: 1 campagne = 1 vidéo, 1 vidéo = plusieurs campagnes

-- 1. Créer la table videos (vidéos indépendantes réutilisables)
CREATE TABLE IF NOT EXISTS videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_size BIGINT,
    duration INTEGER,
    thumbnail_url TEXT,
    
    -- Validation
    validation_status VARCHAR(20) DEFAULT 'pending' CHECK (validation_status IN ('pending', 'approved', 'rejected')),
    validated_by UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
    validated_at TIMESTAMPTZ,
    validation_notes TEXT,
    
    -- Metadata
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_file_size CHECK (file_size > 0),
    CONSTRAINT valid_duration CHECK (duration > 0)
);

-- 2. Ajouter une colonne video_id à la table campaigns (1 campagne = 1 vidéo)
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES videos(id) ON DELETE SET NULL;

-- 3. Ajouter une colonne pour tracker le statut de validation du contenu
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS content_validation_status VARCHAR(20) DEFAULT 'pending' 
CHECK (content_validation_status IN ('pending', 'approved', 'rejected'));

-- 4. Créer des index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_videos_validation_status ON videos(validation_status);
CREATE INDEX IF NOT EXISTS idx_videos_uploaded_by ON videos(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_video_id ON campaigns(video_id);

-- 5. Créer une fonction pour mettre à jour automatiquement le statut des campagnes
CREATE OR REPLACE FUNCTION update_campaigns_on_video_validation()
RETURNS TRIGGER AS $$
BEGIN
    -- Mettre à jour toutes les campagnes utilisant cette vidéo
    UPDATE campaigns
    SET content_validation_status = NEW.validation_status
    WHERE video_id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Créer un trigger pour mettre à jour automatiquement le statut des campagnes
DROP TRIGGER IF EXISTS trigger_update_campaigns_validation ON videos;
CREATE TRIGGER trigger_update_campaigns_validation
    AFTER UPDATE OF validation_status ON videos
    FOR EACH ROW
    WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
    EXECUTE FUNCTION update_campaigns_on_video_validation();

-- 7. Activer RLS sur videos
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- 8. Politiques RLS pour videos (utilisateurs voient leurs propres vidéos)
CREATE POLICY "Users can view their own videos"
    ON videos FOR SELECT
    USING (uploaded_by = auth.uid());

CREATE POLICY "Users can insert their own videos"
    ON videos FOR INSERT
    WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can update their own videos"
    ON videos FOR UPDATE
    USING (uploaded_by = auth.uid());

-- 9. Politiques RLS pour videos (admins voient toutes les vidéos)
CREATE POLICY "Admins can view all videos"
    ON videos FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM admin_profiles 
        WHERE admin_profiles.user_id = auth.uid() 
        AND admin_profiles.is_active = true
    ));

CREATE POLICY "Admins can update all videos"
    ON videos FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM admin_profiles 
        WHERE admin_profiles.user_id = auth.uid() 
        AND admin_profiles.is_active = true
    ));

-- 10. Fonction helper pour obtenir les statistiques de validation
CREATE OR REPLACE FUNCTION get_video_validation_stats()
RETURNS TABLE (
    total_videos BIGINT,
    pending_videos BIGINT,
    approved_videos BIGINT,
    rejected_videos BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_videos,
        COUNT(*) FILTER (WHERE validation_status = 'pending') as pending_videos,
        COUNT(*) FILTER (WHERE validation_status = 'approved') as approved_videos,
        COUNT(*) FILTER (WHERE validation_status = 'rejected') as rejected_videos
    FROM videos;
END;
$$ LANGUAGE plpgsql;

-- 11. Fonction helper pour obtenir les campagnes utilisant une vidéo
CREATE OR REPLACE FUNCTION get_campaigns_using_video(video_uuid UUID)
RETURNS TABLE (
    campaign_id UUID,
    campaign_name TEXT,
    campaign_status TEXT,
    advertiser_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id as campaign_id,
        c.name as campaign_name,
        c.status::TEXT as campaign_status,
        bp.business_name as advertiser_name
    FROM campaigns c
    LEFT JOIN business_profiles bp ON c.user_id = bp.user_id
    WHERE c.video_id = video_uuid
    ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 12. Vue pour faciliter les requêtes admin
CREATE OR REPLACE VIEW admin_videos_view AS
SELECT
    v.id,
    v.filename,
    v.url,
    v.file_size,
    v.duration,
    v.thumbnail_url,
    v.validation_status,
    v.validated_at,
    v.validation_notes,
    v.created_at,
    v.updated_at,
    bp.business_name as uploaded_by_business,
    bp.contact_name as uploaded_by_contact,
    u.email as uploaded_by_email,
    admin_bp.first_name || ' ' || admin_bp.last_name as validated_by_admin,
    COUNT(DISTINCT c.id) as campaigns_count
FROM videos v
LEFT JOIN auth.users u ON v.uploaded_by = u.id
LEFT JOIN business_profiles bp ON v.uploaded_by = bp.user_id
LEFT JOIN admin_profiles admin_bp ON v.validated_by = admin_bp.id
LEFT JOIN campaigns c ON v.id = c.video_id
GROUP BY 
    v.id, v.filename, v.url, v.file_size, v.duration, v.thumbnail_url,
    v.validation_status, v.validated_at, v.validation_notes, v.created_at, v.updated_at,
    bp.business_name, bp.contact_name, u.email, admin_bp.first_name, admin_bp.last_name;

-- 13. Vérification de la structure créée
SELECT 'Vérification finale:' as info;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'videos'
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'campaigns' AND column_name IN ('video_id', 'content_validation_status');

SELECT * FROM get_video_validation_stats();
