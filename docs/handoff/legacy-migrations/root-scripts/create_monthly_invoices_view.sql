-- =====================================================
-- FACTURES DYNAMIQUES MENSUELLES DU MOIS PRÉCÉDENT (M-1)
-- Mode prépayé : les factures sont émises APRÈS le débit du solde
-- Le statut est "payee" car le montant a déjà été débité
-- =====================================================

-- Fonction pour générer un numéro de facture mensuelle dynamique
CREATE OR REPLACE FUNCTION generate_monthly_invoice_number(p_month DATE)
RETURNS TEXT AS $$
BEGIN
  -- Format: INV-M-YYYY-MM pour une facture mensuelle unique
  RETURN 'INV-M-' || TO_CHAR(p_month, 'YYYY-MM');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Fonction pour obtenir la facture mensuelle consolidée du mois précédent
-- Cette fonction regroupe TOUS les débits effectués pendant M-1 en une seule facture
CREATE OR REPLACE FUNCTION get_monthly_invoice_last_month(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  numero TEXT,
  user_id UUID,
  montant NUMERIC,
  statut TEXT,
  date_emission DATE,
  date_echeance DATE,
  description TEXT,
  campaign_name TEXT,
  client_name TEXT,
  is_dynamic BOOLEAN,
  campaigns_count INTEGER,
  campaigns_list TEXT
) AS $$
DECLARE
  last_month_start DATE;
  last_month_end DATE;
  current_month_start DATE;
  total_amount NUMERIC;
  campaigns_count INTEGER;
  campaigns_list TEXT;
BEGIN
  -- Calculer les dates: premier et dernier jour du mois précédent
  current_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  last_month_start := (current_month_start - INTERVAL '1 month')::DATE;
  last_month_end := (current_month_start - INTERVAL '1 day')::DATE;
  
  -- Calculer le montant total et la liste des campagnes débitées pendant M-1
  -- En mode prépayé, le débit se fait quand la campagne devient "active"
  -- On considère que le débit a lieu quand start_date est dans M-1
  SELECT 
    COALESCE(SUM(c.budget), 0),
    COUNT(c.id),
    STRING_AGG(c.name, ', ' ORDER BY c.start_date)
  INTO total_amount, campaigns_count, campaigns_list
  FROM campaigns c
  WHERE c.user_id = p_user_id
  AND c.status IN ('active', 'completed')
  -- Campagnes dont le start_date est dans M-1 (le débit se fait quand la campagne devient active)
  AND DATE_TRUNC('month', c.start_date)::DATE = last_month_start
  -- Exclure les campagnes qui ont déjà une facture individuelle dans la table factures
  -- Vérifier d'abord si la colonne campaign_id existe
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'campaign_id'
  ) 
  OR 
  (EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'campaign_id'
  ) 
  AND NOT EXISTS (
    SELECT 1 FROM factures f 
    WHERE f.campaign_id = c.id
  ));
  
  -- Si aucun débit n'a été effectué, retourner une ligne vide
  IF total_amount IS NULL OR total_amount = 0 OR campaigns_count = 0 THEN
    RETURN;
  END IF;
  
  -- Retourner la facture mensuelle consolidée
  -- IMPORTANT: En mode prépayé, les factures sont générées APRÈS le débit, donc elles sont "payee"
  RETURN QUERY
  SELECT 
    gen_random_uuid() as id,
    NULL::UUID as campaign_id, -- Pas de campagne spécifique car c'est une facture consolidée
    generate_monthly_invoice_number(last_month_start) as numero,
    p_user_id,
    total_amount as montant,
    'payee'::TEXT as statut, -- En mode prépayé, facture = déjà payée (montant débité)
    current_month_start as date_emission, -- Date d'émission = premier jour du mois actuel (après le débit de M-1)
    (current_month_start + INTERVAL '30 days')::DATE as date_echeance,
    ('Facture mensuelle - ' || TO_CHAR(last_month_start, 'Mon YYYY') || 
     ' - ' || campaigns_count::TEXT || ' campagne' || CASE WHEN campaigns_count > 1 THEN 's' ELSE '' END ||
     ' : ' || campaigns_list) as description,
    ('Facture mensuelle ' || TO_CHAR(last_month_start, 'Mon YYYY')) as campaign_name,
    NULL::TEXT as client_name, -- Pas de client spécifique car consolidé
    true as is_dynamic,
    campaigns_count,
    campaigns_list;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fonction RPC pour récupérer les factures d'un utilisateur (existantes + facture mensuelle M-1)
CREATE OR REPLACE FUNCTION get_user_invoices_with_monthly(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  numero TEXT,
  user_id UUID,
  montant NUMERIC,
  statut TEXT,
  date_emission DATE,
  date_echeance DATE,
  description TEXT,
  created_at TIMESTAMPTZ,
  campaign_name TEXT,
  campaign_status TEXT,
  client_name TEXT,
  is_dynamic BOOLEAN,
  pdf_url TEXT
) AS $$
DECLARE
  last_month_start DATE;
  current_month_start DATE;
  has_campaign_id_column BOOLEAN;
  has_date_emission_column BOOLEAN;
  has_date_echeance_column BOOLEAN;
  has_description_column BOOLEAN;
  has_created_at_column BOOLEAN;
  has_pdf_url_column BOOLEAN;
BEGIN
  -- Calculer le mois précédent pour vérifier si une facture mensuelle existe déjà
  current_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  last_month_start := (current_month_start - INTERVAL '1 month')::DATE;
  
  -- Vérifier quelles colonnes existent dans la table factures
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'campaign_id'
  ) INTO has_campaign_id_column;
  
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'date_emission'
  ) INTO has_date_emission_column;
  
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'date_echeance'
  ) INTO has_date_echeance_column;
  
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'description'
  ) INTO has_description_column;
  
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'created_at'
  ) INTO has_created_at_column;
  
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'factures' 
    AND column_name = 'pdf_url'
  ) INTO has_pdf_url_column;
  
  -- Construire et exécuter la requête SQL dynamiquement selon quelles colonnes existent
  IF has_campaign_id_column AND has_date_emission_column AND has_date_echeance_column AND has_description_column AND has_created_at_column THEN
    -- Version complète avec toutes les colonnes
    RETURN QUERY
    (
      SELECT 
        f.id,
        f.campaign_id,
        f.numero,
        f.user_id,
        f.montant,
        f.statut,
        f.date_emission::DATE,
        f.date_echeance::DATE,
        f.description,
        f.created_at,
        c.name AS campaign_name,
        c.status::TEXT AS campaign_status,
        cl.name AS client_name,
        false::BOOLEAN as is_dynamic,
        COALESCE(f.pdf_url, NULL::TEXT) as pdf_url
      FROM factures f
      LEFT JOIN campaigns c ON f.campaign_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE f.user_id = p_user_id
      
      UNION ALL
      
      -- Factures mensuelles dynamiques
      SELECT 
        m.id,
        m.campaign_id,
        m.numero,
        m.user_id,
        m.montant,
        m.statut,
        m.date_emission,
        m.date_echeance,
        m.description,
        NOW() as created_at,
        m.campaign_name,
        NULL::TEXT as campaign_status,
        m.client_name,
        true::BOOLEAN as is_dynamic,
        NULL::TEXT as pdf_url
      FROM get_monthly_invoice_last_month(p_user_id) m
      WHERE NOT (has_date_emission_column) OR NOT EXISTS (
        SELECT 1 FROM factures f 
        WHERE f.user_id = p_user_id
        AND f.numero LIKE 'INV-M-%'
        AND (NOT has_date_emission_column OR (f.date_emission::DATE >= last_month_start AND f.date_emission::DATE < current_month_start))
      )
    )
    ORDER BY date_emission DESC NULLS LAST, created_at DESC;
  ELSE
    -- Version simplifiée sans les colonnes optionnelles
    RETURN QUERY
    (
      SELECT 
        f.id,
        NULL::UUID as campaign_id,
        f.numero,
        f.user_id,
        f.montant,
        f.statut,
        NULL::DATE as date_emission,
        NULL::DATE as date_echeance,
        NULL::TEXT as description,
        NOW() as created_at,
        NULL::TEXT AS campaign_name,
        NULL::TEXT AS campaign_status,
        NULL::TEXT AS client_name,
        false::BOOLEAN as is_dynamic,
        NULL::TEXT as pdf_url
      FROM factures f
      WHERE f.user_id = p_user_id
      
      UNION ALL
      
      -- Factures mensuelles dynamiques
      SELECT 
        m.id,
        m.campaign_id,
        m.numero,
        m.user_id,
        m.montant,
        m.statut,
        m.date_emission,
        m.date_echeance,
        m.description,
        NOW() as created_at,
        m.campaign_name,
        NULL::TEXT as campaign_status,
        m.client_name,
        true::BOOLEAN as is_dynamic,
        NULL::TEXT as pdf_url
      FROM get_monthly_invoice_last_month(p_user_id) m
    )
    ORDER BY date_emission DESC NULLS LAST, created_at DESC;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Créer la vue factures_with_campaigns (version simplifiée qui fonctionne avec ou sans colonnes optionnelles)
DO $$
DECLARE
  has_campaign_id BOOLEAN;
  has_date_emission BOOLEAN;
  has_date_echeance BOOLEAN;
  has_description BOOLEAN;
  has_created_at BOOLEAN;
  has_pdf_url BOOLEAN;
  sql_query TEXT;
BEGIN
  -- Vérifier quelles colonnes existent
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'factures' AND column_name = 'campaign_id'
  ) INTO has_campaign_id;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'factures' AND column_name = 'date_emission'
  ) INTO has_date_emission;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'factures' AND column_name = 'date_echeance'
  ) INTO has_date_echeance;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'factures' AND column_name = 'description'
  ) INTO has_description;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'factures' AND column_name = 'created_at'
  ) INTO has_created_at;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'factures' AND column_name = 'pdf_url'
  ) INTO has_pdf_url;
  
  -- Construire la requête SQL dynamiquement
  sql_query := 'CREATE OR REPLACE VIEW factures_with_campaigns AS SELECT f.id, f.numero, f.user_id, ';
  
  IF has_campaign_id THEN
    sql_query := sql_query || 'f.campaign_id, ';
  ELSE
    sql_query := sql_query || 'NULL::UUID as campaign_id, ';
  END IF;
  
  sql_query := sql_query || 'f.montant, f.statut, ';
  
  IF has_date_emission THEN
    sql_query := sql_query || 'f.date_emission, ';
  ELSE
    sql_query := sql_query || 'NULL::DATE as date_emission, ';
  END IF;
  
  IF has_date_echeance THEN
    sql_query := sql_query || 'f.date_echeance, ';
  ELSE
    sql_query := sql_query || 'NULL::DATE as date_echeance, ';
  END IF;
  
  IF has_description THEN
    sql_query := sql_query || 'f.description, ';
  ELSE
    sql_query := sql_query || 'NULL::TEXT as description, ';
  END IF;
  
  IF has_created_at THEN
    sql_query := sql_query || 'f.created_at, ';
  ELSE
    sql_query := sql_query || 'NOW() as created_at, ';
  END IF;
  
  IF has_campaign_id THEN
    sql_query := sql_query || 'c.name AS campaign_name, c.status::TEXT AS campaign_status, cl.name AS client_name FROM factures f LEFT JOIN campaigns c ON f.campaign_id = c.id LEFT JOIN clients cl ON c.client_id = cl.id;';
  ELSE
    sql_query := sql_query || 'NULL::TEXT AS campaign_name, NULL::TEXT AS campaign_status, NULL::TEXT AS client_name FROM factures f;';
  END IF;
  
  EXECUTE sql_query;
  RAISE NOTICE 'Vue factures_with_campaigns créée avec colonnes détectées dynamiquement';
END $$;

-- Permissions
GRANT SELECT ON factures_with_campaigns TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_invoices_with_monthly(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_monthly_invoice_last_month(UUID) TO authenticated;

SELECT '✅ Vue et fonctions pour factures mensuelles créées avec succès' as status;
