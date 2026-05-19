-- Permettre aux admins/superadmins de gérer l'affluence des localités
-- (lecture déjà accordée via GRANT + policies existantes).
-- Conserve la policy propriétaire existante.

DROP POLICY IF EXISTS "Admins can manage all location affluence schedules" ON public.location_affluence_schedule;

CREATE POLICY "Admins can manage all location affluence schedules"
  ON public.location_affluence_schedule
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles ap
      WHERE ap.user_id = auth.uid()
        AND ap.role IN ('superadmin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles ap
      WHERE ap.user_id = auth.uid()
        AND ap.role IN ('superadmin', 'admin')
    )
  );
