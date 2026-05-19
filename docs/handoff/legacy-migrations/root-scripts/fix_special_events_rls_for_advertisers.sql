-- Permettre aux annonceurs de voir les événements spéciaux actifs
-- Cela leur permettra de voir les événements durant la planification de campagne

-- 1. Supprimer l'ancienne politique restrictive si elle existe
DROP POLICY IF EXISTS "Only super admins can manage events" ON special_events;

-- 2. Créer une politique pour les super admins (gestion complète)
CREATE POLICY "Super admins can manage all events"
    ON special_events FOR ALL
    USING (EXISTS (
        SELECT 1 FROM admin_profiles 
        WHERE admin_profiles.user_id = auth.uid() 
        AND admin_profiles.role = 'superadmin'
        AND admin_profiles.is_active = true
    ));

-- 3. Créer une politique pour les annonceurs (lecture seule des événements actifs)
CREATE POLICY "Advertisers can view active events"
    ON special_events FOR SELECT
    USING (
        is_active = true
        AND auth.uid() IS NOT NULL
    );

-- 4. Vérification
SELECT 'Politiques RLS créées avec succès' as status;

-- Afficher les politiques actuelles
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'special_events';











































