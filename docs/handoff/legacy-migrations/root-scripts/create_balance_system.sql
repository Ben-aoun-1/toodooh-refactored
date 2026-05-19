-- =====================================================
-- SYSTÈME DE GESTION DU SOLDE ET VÉRIFICATION CAMPAGNE
-- =====================================================

-- 1. Créer une fonction pour calculer le solde disponible d'un utilisateur
CREATE OR REPLACE FUNCTION get_user_balance(p_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  total_recharges NUMERIC;
  total_spent NUMERIC;
  balance NUMERIC;
BEGIN
  -- Calculer le total des recharges validées
  SELECT COALESCE(SUM(amount), 0)
  INTO total_recharges
  FROM recharges
  WHERE user_id = p_user_id
  AND status = 'completed';
  
  -- Calculer le total dépensé (campagnes actives, completed, ou en cours)
  SELECT COALESCE(SUM(budget), 0)
  INTO total_spent
  FROM campaigns
  WHERE user_id = p_user_id
  AND status IN ('active', 'completed');
  
  -- Calculer le solde disponible
  balance := total_recharges - total_spent;
  
  RETURN balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Créer une fonction pour calculer le coût total d'une campagne
CREATE OR REPLACE FUNCTION calculate_campaign_cost(
  p_campaign_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
  campaign_budget NUMERIC;
  campaign_duration INTEGER;
  screens_count INTEGER;
  total_impressions BIGINT;
  cpm NUMERIC := 2.5; -- CPM fixe à 2.5 TND
  total_cost NUMERIC;
BEGIN
  -- Récupérer les infos de la campagne
  SELECT 
    budget,
    EXTRACT(DAY FROM (end_date - start_date))::INTEGER + 1,
    COUNT(cs.screen_id),
    COALESCE(SUM(sac.estimated_impressions_per_hour * 24 * EXTRACT(DAY FROM (c.end_date - c.start_date))::INTEGER), 0)
  INTO 
    campaign_budget,
    campaign_duration,
    screens_count,
    total_impressions
  FROM campaigns c
  LEFT JOIN campaign_screens cs ON cs.campaign_id = c.id
  LEFT JOIN screen_affluence_config sac ON sac.screen_id = cs.screen_id
  WHERE c.id = p_campaign_id
  GROUP BY c.id, c.budget, c.start_date, c.end_date;
  
  -- Calculer le coût basé sur les impressions et le CPM
  -- Formule: (Nb impressions / 1000) * CPM
  IF total_impressions > 0 THEN
    total_cost := (total_impressions / 1000.0) * cpm;
  ELSE
    -- Si pas d'impressions estimées, utiliser le budget défini
    total_cost := COALESCE(campaign_budget, 0);
  END IF;
  
  RETURN total_cost;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Créer une fonction pour vérifier si l'utilisateur a assez de solde
CREATE OR REPLACE FUNCTION check_sufficient_balance(
  p_user_id UUID,
  p_campaign_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  user_balance NUMERIC;
  campaign_cost NUMERIC;
BEGIN
  -- Récupérer le solde disponible
  user_balance := get_user_balance(p_user_id);
  
  -- Récupérer le coût de la campagne
  campaign_cost := calculate_campaign_cost(p_campaign_id);
  
  -- Vérifier si le solde est suffisant
  RETURN user_balance >= campaign_cost;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Créer un trigger pour vérifier le solde avant activation/soumission
CREATE OR REPLACE FUNCTION verify_balance_before_campaign_activation()
RETURNS TRIGGER AS $$
DECLARE
  has_sufficient_balance BOOLEAN;
  user_balance NUMERIC;
  campaign_cost NUMERIC;
BEGIN
  -- Si le statut passe à 'pending' ou 'active'
  IF (OLD.status IS DISTINCT FROM NEW.status) 
     AND NEW.status IN ('pending', 'active') THEN
    
    -- Vérifier le solde
    has_sufficient_balance := check_sufficient_balance(NEW.user_id, NEW.id);
    
    IF NOT has_sufficient_balance THEN
      -- Récupérer les détails pour le message d'erreur
      user_balance := get_user_balance(NEW.user_id);
      campaign_cost := calculate_campaign_cost(NEW.id);
      
      -- Forcer le statut à rester 'draft'
      NEW.status := 'draft';
      
      -- Ajouter une note de validation
      NEW.validation_notes := FORMAT(
        'Solde insuffisant. Solde disponible: %.2f TND, Coût de la campagne: %.2f TND. Veuillez recharger votre compte.',
        user_balance,
        campaign_cost
      );
      
      RAISE NOTICE 'Solde insuffisant pour l''utilisateur %. Solde: % TND, Coût requis: % TND',
        NEW.user_id, user_balance, campaign_cost;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Supprimer le trigger s'il existe déjà
DROP TRIGGER IF EXISTS trigger_verify_balance_before_activation ON campaigns;

-- Créer le trigger
CREATE TRIGGER trigger_verify_balance_before_activation
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION verify_balance_before_campaign_activation();

-- 5. Créer une vue pour les informations de balance utilisateur
CREATE OR REPLACE VIEW user_balance_info AS
SELECT 
  u.id as user_id,
  bp.business_name,
  bp.contact_name,
  bp.email,
  get_user_balance(u.id) as available_balance,
  COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'completed'), 0) as total_recharged,
  COALESCE(SUM(c.budget) FILTER (WHERE c.status IN ('active', 'completed')), 0) as total_spent,
  COUNT(c.id) FILTER (WHERE c.status = 'draft') as draft_campaigns_count,
  COUNT(c.id) FILTER (WHERE c.status = 'active') as active_campaigns_count
FROM auth.users u
LEFT JOIN business_profiles bp ON bp.user_id = u.id
LEFT JOIN recharges r ON r.user_id = u.id
LEFT JOIN campaigns c ON c.user_id = u.id
GROUP BY u.id, bp.business_name, bp.contact_name, bp.email;

-- Permissions
GRANT EXECUTE ON FUNCTION get_user_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_campaign_cost(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_sufficient_balance(UUID, UUID) TO authenticated;
GRANT SELECT ON user_balance_info TO authenticated;

-- 6. Créer une fonction RPC pour vérifier le solde côté client
CREATE OR REPLACE FUNCTION check_campaign_balance(p_campaign_id UUID)
RETURNS JSON AS $$
DECLARE
  campaign_record RECORD;
  user_balance NUMERIC;
  campaign_cost NUMERIC;
  has_balance BOOLEAN;
  result JSON;
BEGIN
  -- Récupérer la campagne
  SELECT user_id INTO campaign_record
  FROM campaigns
  WHERE id = p_campaign_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Campagne non trouvée'
    );
  END IF;
  
  -- Calculer le solde et le coût
  user_balance := get_user_balance(campaign_record.user_id);
  campaign_cost := calculate_campaign_cost(p_campaign_id);
  has_balance := user_balance >= campaign_cost;
  
  -- Construire le résultat
  result := json_build_object(
    'success', true,
    'has_sufficient_balance', has_balance,
    'available_balance', user_balance,
    'campaign_cost', campaign_cost,
    'balance_after', user_balance - campaign_cost,
    'message', CASE 
      WHEN has_balance THEN 'Solde suffisant pour activer la campagne'
      ELSE FORMAT('Solde insuffisant. Il vous manque %.2f TND', campaign_cost - user_balance)
    END
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_campaign_balance(UUID) TO authenticated;

-- Test
SELECT '✅ Système de gestion du solde créé avec succès' as status;

-- Exemple de test
SELECT 
  '📊 Balance Info' as info,
  * 
FROM user_balance_info 
LIMIT 5;













































