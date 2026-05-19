-- Fonction pour récupérer le profil business par email
CREATE OR REPLACE FUNCTION get_business_profile_by_email(user_email TEXT)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  business_name TEXT,
  tax_number TEXT,
  business_sector_id INTEGER,
  business_type TEXT,
  profile_type TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  street_address TEXT,
  city TEXT,
  postal_code TEXT,
  governorate_id INTEGER,
  terms_accepted BOOLEAN,
  terms_accepted_at TIMESTAMPTZ,
  verification_status TEXT,
  onboarding_completed BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) 
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bp.id,
    bp.user_id,
    bp.business_name,
    bp.tax_number,
    bp.business_sector_id,
    bp.business_type,
    bp.profile_type,
    bp.contact_name,
    bp.contact_phone,
    bp.street_address,
    bp.city,
    bp.postal_code,
    bp.governorate_id,
    bp.terms_accepted,
    bp.terms_accepted_at,
    bp.verification_status,
    bp.onboarding_completed,
    bp.created_at,
    bp.updated_at
  FROM business_profiles bp
  INNER JOIN auth.users au ON bp.user_id = au.id
  WHERE au.email = user_email;
END;
$$;

-- Donner les permissions d'exécution à tous les utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION get_business_profile_by_email(TEXT) TO authenticated; 