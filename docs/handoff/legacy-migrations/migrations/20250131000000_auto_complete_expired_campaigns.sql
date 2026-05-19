-- Script pour mettre à jour automatiquement les campagnes expirées en "completed"
-- Date: 2025-01-31

-- 1. Créer une fonction pour mettre à jour les campagnes expirées
CREATE OR REPLACE FUNCTION update_expired_campaigns()
RETURNS void AS $$
BEGIN
  -- Mettre à jour les campagnes actives dont la date de fin est passée
  UPDATE campaigns
  SET status = 'completed'
  WHERE 
    status = 'active'
    AND end_date < NOW(); -- end_date est une TIMESTAMPTZ, donc compare date + heure
  
  -- Aussi mettre à jour les campagnes "paused" qui sont expirées
  UPDATE campaigns
  SET status = 'completed'
  WHERE 
    status = 'paused'
    AND end_date < NOW();
    
  -- Log du nombre de campagnes mises à jour (optionnel, pour debugging)
  IF FOUND THEN
    RAISE NOTICE 'Campagnes expirées mises à jour: %', ROW_COUNT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 2. Créer un trigger qui vérifie automatiquement à chaque UPDATE sur campaigns
-- Cela garantit que si une campagne est modifiée et que sa date de fin est passée, elle sera marquée comme complétée
CREATE OR REPLACE FUNCTION check_and_complete_expired_campaign()
RETURNS TRIGGER AS $$
BEGIN
  -- Si la campagne est active ou paused et que la date de fin est passée, la marquer comme completed
  IF NEW.status IN ('active', 'paused') AND NEW.end_date < NOW() THEN
    NEW.status := 'completed';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger BEFORE UPDATE
DROP TRIGGER IF EXISTS trigger_check_expired_campaign ON campaigns;
CREATE TRIGGER trigger_check_expired_campaign
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION check_and_complete_expired_campaign();

-- 3. Exécuter immédiatement pour mettre à jour les campagnes déjà expirées
SELECT update_expired_campaigns();

-- 4. Vérifier le résultat
SELECT 
  'Campagnes actives expirées' as info,
  COUNT(*) as count
FROM campaigns
WHERE status = 'active' AND end_date < NOW();

SELECT 
  'Campagnes complétées' as info,
  COUNT(*) as count
FROM campaigns
WHERE status = 'completed';

