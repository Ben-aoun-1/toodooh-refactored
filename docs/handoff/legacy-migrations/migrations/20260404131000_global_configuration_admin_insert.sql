-- INSERT réservé aux admins (upsert côté client / nouvelles clés)

DROP POLICY IF EXISTS "Admins can insert global configuration" ON global_configuration;

CREATE POLICY "Admins can insert global configuration"
  ON global_configuration
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.user_id = auth.uid()
        AND bp.is_admin = true
    )
  );
