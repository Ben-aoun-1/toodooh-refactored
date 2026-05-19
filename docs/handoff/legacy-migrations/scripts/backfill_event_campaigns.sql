-- =============================================================================
-- Script à exécuter dans Supabase (SQL Editor) pour que vos campagnes
-- de type événement apparaissent dans "Mes événements" sur la page Événements.
-- =============================================================================

-- 1) Ajouter la colonne event_id sur campaigns si elle n'existe pas
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES special_events(id) ON DELETE SET NULL;

-- 2) Lier les campagnes dont le nom est "Campagne - {nom de l'événement}"
--    à l'événement correspondant (même nom)
UPDATE campaigns c
SET event_id = (
  SELECT se.id
  FROM special_events se
  WHERE se.name = TRIM(SUBSTRING(c.name FROM 13))
  LIMIT 1
)
WHERE c.name LIKE 'Campagne - %'
  AND c.event_id IS NULL;

-- 3) Créer les lignes manquantes dans event_campaigns pour ces campagnes
--    (évite tout problème d'affichage côté RPC)
INSERT INTO event_campaigns (event_id, campaign_id, linked_by)
SELECT c.event_id, c.id, c.user_id
FROM campaigns c
WHERE c.event_id IS NOT NULL
  AND c.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM event_campaigns ec
    WHERE ec.campaign_id = c.id AND ec.event_id = c.event_id
  )
ON CONFLICT (event_id, campaign_id) DO NOTHING;
