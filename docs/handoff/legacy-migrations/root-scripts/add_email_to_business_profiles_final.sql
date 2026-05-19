/*
  Ajouter la colonne email à business_profiles et la remplir depuis auth.users
  
  Solution définitive pour afficher les emails dans l'admin sans compromettre la sécurité
*/

-- ================================================================
-- ÉTAPE 1 : AJOUTER LA COLONNE EMAIL
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS email text;

SELECT '✅ Étape 1 : Colonne email ajoutée à business_profiles' as message;

-- ================================================================
-- ÉTAPE 2 : REMPLIR LES EMAILS EXISTANTS DEPUIS AUTH.USERS
-- ================================================================

UPDATE business_profiles bp
SET email = au.email
FROM auth.users au
WHERE bp.user_id = au.id
  AND bp.email IS NULL;

SELECT '✅ Étape 2 : Emails existants mis à jour' as message;

-- ================================================================
-- ÉTAPE 3 : CRÉER UN TRIGGER POUR AUTO-REMPLIR L'EMAIL
-- ================================================================

-- Fonction qui remplit automatiquement l'email depuis auth.users
CREATE OR REPLACE FUNCTION fill_business_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Si l'email n'est pas fourni, le récupérer depuis auth.users
  IF NEW.email IS NULL THEN
    SELECT email INTO NEW.email
    FROM auth.users
    WHERE id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Supprimer le trigger s'il existe déjà
DROP TRIGGER IF EXISTS trg_fill_business_profile_email ON business_profiles;

-- Créer le trigger
CREATE TRIGGER trg_fill_business_profile_email
  BEFORE INSERT OR UPDATE ON business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION fill_business_profile_email();

SELECT '✅ Étape 3 : Trigger créé pour auto-remplir l''email' as message;

-- ================================================================
-- ÉTAPE 4 : VÉRIFICATION
-- ================================================================

SELECT 
  '4. Vérification' as etape,
  COUNT(*) as total_profils,
  COUNT(email) as profils_avec_email,
  COUNT(*) - COUNT(email) as profils_sans_email
FROM business_profiles;

-- Afficher quelques exemples
SELECT 
  id,
  user_id,
  email,
  contact_name,
  profile_type
FROM business_profiles
ORDER BY created_at DESC
LIMIT 10;

SELECT '🎉 SCRIPT TERMINÉ ! Les emails devraient maintenant apparaître dans l''admin.' as message;

