-- Migration pour ajouter la politique INSERT manquante sur screen_configurations
-- Cette politique permet aux propriétaires d'écrans de créer des configurations pour leurs écrans

-- Supprimer la politique si elle existe déjà (pour éviter les erreurs de duplication)
DROP POLICY IF EXISTS "Users can insert configs for their screens" ON screen_configurations;

-- Ajouter la politique INSERT pour screen_configurations
CREATE POLICY "Users can insert configs for their screens" ON screen_configurations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM screens 
            WHERE screens.id = screen_configurations.screen_id 
            AND screens.owner_id = auth.uid()
        )
    );

