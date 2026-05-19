-- Activation de RLS sur les tables nécessaires pour l'application mobile
-- Ce script active RLS si ce n'est pas déjà fait

-- 1. Activer RLS sur toutes les tables critiques
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_affluence_config ENABLE ROW LEVEL SECURITY;

-- 2. Vérifier que RLS est bien activé
SELECT 
  '✅ RLS activé sur toutes les tables' as message;

SELECT 
  tablename,
  CASE 
    WHEN rowsecurity THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé'
  END as status
FROM pg_tables 
WHERE tablename IN (
  'business_profiles',
  'screens', 
  'campaign_screens',
  'advertising_campaigns',
  'videos',
  'screen_affluence_config'
)
ORDER BY tablename;































