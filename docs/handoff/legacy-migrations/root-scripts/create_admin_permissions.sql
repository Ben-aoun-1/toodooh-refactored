-- Créer les permissions Supabase pour les admins

-- 1. Activer RLS sur les tables si ce n'est pas déjà fait
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

-- 2. Créer une politique pour permettre aux admins de lire tous les business_profiles
CREATE POLICY "Admins can read all business profiles" ON business_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_profiles 
    WHERE admin_profiles.user_id = auth.uid() 
    AND admin_profiles.is_active = true
  )
);

-- 3. Créer une politique pour permettre aux admins de modifier les business_profiles
CREATE POLICY "Admins can update business profiles" ON business_profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_profiles 
    WHERE admin_profiles.user_id = auth.uid() 
    AND admin_profiles.is_active = true
  )
);

-- 4. Créer une politique pour permettre aux admins de lire les admin_profiles
CREATE POLICY "Admins can read admin profiles" ON admin_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_profiles ap
    WHERE ap.user_id = auth.uid() 
    AND ap.is_active = true
  )
);

-- 5. Créer une politique pour permettre aux Super Admins de créer des admin_profiles
CREATE POLICY "Super admins can create admin profiles" ON admin_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM admin_profiles 
    WHERE admin_profiles.user_id = auth.uid() 
    AND admin_profiles.is_active = true
    AND admin_profiles.role = 'superadmin'
  )
);

-- 6. Créer une politique pour permettre aux Super Admins de modifier les admin_profiles
CREATE POLICY "Super admins can update admin profiles" ON admin_profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_profiles 
    WHERE admin_profiles.user_id = auth.uid() 
    AND admin_profiles.is_active = true
    AND admin_profiles.role = 'superadmin'
  )
);

-- 7. Vérifier les politiques créées
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename IN ('business_profiles', 'admin_profiles')
ORDER BY tablename, policyname;












































