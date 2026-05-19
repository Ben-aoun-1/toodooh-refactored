-- =====================================================
-- SYSTÈME DE FACTURATION AUTOMATIQUE
-- =====================================================

-- Fonction pour générer un numéro de facture unique
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
  num TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    -- Format: INV-YYYY-NNNNNN
    num := 'INV-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(FLOOR(RANDOM() * 999999)::TEXT, 6, '0');
    
    -- Vérifier si le numéro existe déjà
    SELECT EXISTS(SELECT 1 FROM factures WHERE numero = num) INTO exists;
    
    -- Si il n'existe pas, sortir de la boucle
    EXIT WHEN NOT exists;
  END LOOP;
  
  RETURN num;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour générer une facture pour une campagne
CREATE OR REPLACE FUNCTION generate_invoice_for_campaign(p_campaign_id UUID)
RETURNS UUID AS $$
DECLARE
  v_campaign RECORD;
  v_invoice_id UUID;
  v_invoice_number TEXT;
BEGIN
  -- Récupérer les infos de la campagne
  SELECT 
    c.id,
    c.user_id,
    c.name,
    c.budget,
    c.start_date,
    c.end_date,
    c.status
  INTO v_campaign
  FROM campaigns c
  WHERE c.id = p_campaign_id;

  -- Vérifier que la campagne existe
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_id;
  END IF;

  -- Vérifier qu'une facture n'existe pas déjà pour cette campagne
  IF EXISTS(SELECT 1 FROM factures WHERE campaign_id = p_campaign_id) THEN
    RAISE NOTICE 'Invoice already exists for campaign %', p_campaign_id;
    SELECT id INTO v_invoice_id FROM factures WHERE campaign_id = p_campaign_id LIMIT 1;
    RETURN v_invoice_id;
  END IF;

  -- Générer le numéro de facture
  v_invoice_number := generate_invoice_number();

  -- Créer la facture
  INSERT INTO factures (
    numero,
    user_id,
    campaign_id,
    montant,
    statut,
    date_emission,
    date_echeance,
    description
  ) VALUES (
    v_invoice_number,
    v_campaign.user_id,
    v_campaign.id,
    v_campaign.budget,
    'en_attente', -- Statut initial
    NOW(),
    NOW() + INTERVAL '30 days', -- Échéance à 30 jours
    'Facture pour la campagne: ' || v_campaign.name
  )
  RETURNING id INTO v_invoice_id;

  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction trigger pour générer automatiquement une facture quand une campagne devient active
CREATE OR REPLACE FUNCTION auto_generate_invoice_on_campaign_active()
RETURNS TRIGGER AS $$
BEGIN
  -- Si la campagne passe à 'active' et n'avait pas ce statut avant
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
    -- Générer une facture
    BEGIN
      PERFORM generate_invoice_for_campaign(NEW.id);
      RAISE NOTICE 'Invoice generated for campaign %', NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to generate invoice for campaign %: %', NEW.id, SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger
DROP TRIGGER IF EXISTS trigger_auto_generate_invoice ON campaigns;
CREATE TRIGGER trigger_auto_generate_invoice
  AFTER INSERT OR UPDATE OF status ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_invoice_on_campaign_active();

-- Ajouter la colonne campaign_id à factures si elle n'existe pas
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'factures' AND column_name = 'campaign_id'
  ) THEN
    ALTER TABLE factures ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
    CREATE INDEX idx_factures_campaign_id ON factures(campaign_id);
  END IF;
END $$;

-- Vue pour les factures avec informations de campagne
CREATE OR REPLACE VIEW factures_with_campaigns AS
SELECT 
  f.id,
  f.numero,
  f.user_id,
  f.campaign_id,
  f.montant,
  f.statut,
  f.date_emission,
  f.date_echeance,
  f.description,
  f.created_at,
  c.name AS campaign_name,
  c.status AS campaign_status,
  cl.name AS client_name
FROM factures f
LEFT JOIN campaigns c ON f.campaign_id = c.id
LEFT JOIN clients cl ON c.client_id = cl.id;

-- Permissions
GRANT SELECT ON factures_with_campaigns TO authenticated;
GRANT EXECUTE ON FUNCTION generate_invoice_for_campaign(UUID) TO authenticated;

-- Générer des factures pour toutes les campagnes actives qui n'en ont pas
DO $$
DECLARE
  campaign_record RECORD;
BEGIN
  FOR campaign_record IN 
    SELECT id, name FROM campaigns 
    WHERE status = 'active' 
    AND id NOT IN (SELECT campaign_id FROM factures WHERE campaign_id IS NOT NULL)
  LOOP
    BEGIN
      PERFORM generate_invoice_for_campaign(campaign_record.id);
      RAISE NOTICE 'Generated invoice for campaign: %', campaign_record.name;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not generate invoice for campaign %: %', campaign_record.name, SQLERRM;
    END;
  END LOOP;
END $$;

SELECT '✅ Système de facturation automatique créé avec succès' as status;













































