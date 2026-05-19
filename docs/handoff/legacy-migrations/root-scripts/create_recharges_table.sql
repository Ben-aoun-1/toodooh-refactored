-- =====================================================
-- CRÉATION DE LA TABLE RECHARGES
-- =====================================================

-- Créer la table recharges si elle n'existe pas
CREATE TABLE IF NOT EXISTS recharges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'card' CHECK (payment_method IN ('card', 'bank', 'cash')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('completed', 'pending', 'failed', 'cancelled')),
  reference TEXT UNIQUE,
  description TEXT,
  transaction_id TEXT,
  validated_by UUID REFERENCES admin_profiles(id),
  validated_at TIMESTAMPTZ,
  validation_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_recharges_user_id ON recharges(user_id);
CREATE INDEX IF NOT EXISTS idx_recharges_status ON recharges(status);
CREATE INDEX IF NOT EXISTS idx_recharges_created_at ON recharges(created_at DESC);

-- Fonction pour générer une référence unique
CREATE OR REPLACE FUNCTION generate_recharge_reference()
RETURNS TEXT AS $$
DECLARE
  ref TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    -- Format: RCH-YYYY-NNNNNN
    ref := 'RCH-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(FLOOR(RANDOM() * 999999)::TEXT, 6, '0');
    
    -- Vérifier si la référence existe déjà
    SELECT EXISTS(SELECT 1 FROM recharges WHERE reference = ref) INTO exists;
    
    -- Si elle n'existe pas, sortir de la boucle
    EXIT WHEN NOT exists;
  END LOOP;
  
  RETURN ref;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour générer automatiquement la référence
CREATE OR REPLACE FUNCTION set_recharge_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference IS NULL THEN
    NEW.reference := generate_recharge_reference();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_recharge_reference
  BEFORE INSERT ON recharges
  FOR EACH ROW
  EXECUTE FUNCTION set_recharge_reference();

-- RLS (Row Level Security)
ALTER TABLE recharges ENABLE ROW LEVEL SECURITY;

-- Les utilisateurs peuvent voir leurs propres recharges
CREATE POLICY "Users can view their own recharges"
  ON recharges
  FOR SELECT
  USING (auth.uid() = user_id);

-- Les utilisateurs peuvent créer leurs propres recharges
CREATE POLICY "Users can create their own recharges"
  ON recharges
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Les admins peuvent voir toutes les recharges
CREATE POLICY "Admins can view all recharges"
  ON recharges
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Les admins peuvent modifier toutes les recharges (pour validation)
CREATE POLICY "Admins can update all recharges"
  ON recharges
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Vue pour les statistiques de recharges
CREATE OR REPLACE VIEW recharges_stats AS
SELECT 
  user_id,
  COUNT(*) as total_recharges,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
  COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total_amount,
  COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) as pending_amount,
  COALESCE(AVG(amount) FILTER (WHERE status = 'completed'), 0) as avg_amount
FROM recharges
GROUP BY user_id;

-- Permissions
GRANT SELECT ON recharges_stats TO authenticated;

-- Test
SELECT '✅ Table recharges créée avec succès' as status;



