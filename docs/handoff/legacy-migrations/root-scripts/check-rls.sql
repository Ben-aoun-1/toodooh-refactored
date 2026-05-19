-- Script pour vérifier et corriger les RLS policies
-- À exécuter dans Supabase Studio

-- 1. Vérifier les RLS policies actuelles
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'business_profiles';

-- 2. Vérifier si RLS est activé
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'business_profiles';

-- 3. Supprimer les anciennes policies problématiques (si nécessaire)
-- DROP POLICY IF EXISTS "Users can view own profile" ON business_profiles;
-- DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
-- DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;

-- 4. Créer des policies simples pour permettre l'accès
-- Policy pour SELECT (lecture)
CREATE POLICY IF NOT EXISTS "Enable read access for authenticated users" ON business_profiles
    FOR SELECT USING (auth.uid() = user_id);

-- Policy pour INSERT (création)
CREATE POLICY IF NOT EXISTS "Enable insert access for authenticated users" ON business_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy pour UPDATE (modification)
CREATE POLICY IF NOT EXISTS "Enable update access for authenticated users" ON business_profiles
    FOR UPDATE USING (auth.uid() = user_id);

-- Policy pour DELETE (suppression)
CREATE POLICY IF NOT EXISTS "Enable delete access for authenticated users" ON business_profiles
    FOR DELETE USING (auth.uid() = user_id);

-- 5. Vérifier que les policies ont été créées
SELECT 
    policyname,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'business_profiles';

-- 6. Test de lecture directe
SELECT 
    bp.id,
    bp.user_id,
    bp.contact_name,
    bp.business_name,
    bp.profile_type,
    u.email
FROM business_profiles bp
JOIN auth.users u ON bp.user_id = u.id
WHERE u.email = 'zsaidani1981@gmail.com'; 