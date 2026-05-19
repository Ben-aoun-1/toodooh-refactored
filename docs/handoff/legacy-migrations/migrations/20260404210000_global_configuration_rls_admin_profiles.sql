-- Aligne les policies admin sur le modèle réel du panneau (admin_profiles).
-- Prérequis : table public.admin_profiles avec au moins user_id uuid et is_active boolean.
-- Rétrocompat : les comptes encore marqués business_profiles.is_admin conservent l’accès.

DROP POLICY IF EXISTS "Admins can update global configuration" ON global_configuration;
DROP POLICY IF EXISTS "Admins can insert global configuration" ON global_configuration;

CREATE POLICY "Admins can update global configuration"
  ON global_configuration
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles ap
      WHERE ap.user_id = auth.uid()
        AND COALESCE(ap.is_active, true)
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.user_id = auth.uid()
        AND bp.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles ap
      WHERE ap.user_id = auth.uid()
        AND COALESCE(ap.is_active, true)
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.user_id = auth.uid()
        AND bp.is_admin = true
    )
  );

CREATE POLICY "Admins can insert global configuration"
  ON global_configuration
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles ap
      WHERE ap.user_id = auth.uid()
        AND COALESCE(ap.is_active, true)
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.user_id = auth.uid()
        AND bp.is_admin = true
    )
  );
