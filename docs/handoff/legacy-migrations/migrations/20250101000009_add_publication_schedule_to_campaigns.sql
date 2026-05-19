-- Migration pour ajouter la colonne publication_schedule à la table campaigns
-- Cette colonne stocke les informations de publication par heure de la vidéo de la campagne

-- Ajouter la colonne publication_schedule (JSONB) à la table campaigns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS publication_schedule JSONB;

-- Commentaire pour documenter la colonne
COMMENT ON COLUMN campaigns.publication_schedule IS 'Informations de publication par heure de la vidéo de la campagne, incluant publications_per_hour, total_impressions, impressions_per_hour, hours_per_day, total_days, total_screens, calculated_at';

