-- Inscription : les visiteurs non connectés doivent pouvoir lire secteurs et gouvernorats
CREATE POLICY "Anon peut lire les secteurs (inscription)"
  ON business_sectors FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon peut lire les gouvernorats (inscription)"
  ON governorates FOR SELECT
  TO anon
  USING (true);
