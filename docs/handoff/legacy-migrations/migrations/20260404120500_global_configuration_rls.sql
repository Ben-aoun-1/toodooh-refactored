-- RLS + seed de secours pour max_spots_per_hour (idempotent si une ancienne version de 20260404120000 a déjà été appliquée)



INSERT INTO global_configuration (key, value_text, value_type, description)

VALUES

  (

    'max_spots_per_hour',

    '10',

    'integer',

    'Nombre maximal de spots (emplacements) planifiables par heure sur une tranche, avant application du taux facturable.'

  )

ON CONFLICT (key) DO NOTHING;



ALTER TABLE global_configuration ENABLE ROW LEVEL SECURITY;



DROP POLICY IF EXISTS "Authenticated can read global configuration" ON global_configuration;

CREATE POLICY "Authenticated can read global configuration"

  ON global_configuration

  FOR SELECT

  TO authenticated

  USING (true);



DROP POLICY IF EXISTS "Admins can update global configuration" ON global_configuration;

CREATE POLICY "Admins can update global configuration"

  ON global_configuration

  FOR UPDATE

  TO authenticated

  USING (

    EXISTS (

      SELECT 1

      FROM public.business_profiles bp

      WHERE bp.user_id = auth.uid()

        AND bp.is_admin = true

    )

  )

  WITH CHECK (

    EXISTS (

      SELECT 1

      FROM public.business_profiles bp

      WHERE bp.user_id = auth.uid()

        AND bp.is_admin = true

    )

  );


