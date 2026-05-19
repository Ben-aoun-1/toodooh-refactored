-- Liste unique d'objectifs "Prise de rendez-vous" pour tous les profils
CREATE TABLE IF NOT EXISTS appointment_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0)
);

ALTER TABLE appointment_objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read appointment objectives" ON appointment_objectives;
CREATE POLICY "Authenticated can read appointment objectives"
  ON appointment_objectives FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO appointment_objectives (label, display_order) VALUES
  ('Renseignements', 1),
  ('Inscription', 2),
  ('Diffusion', 3),
  ('Ciblage', 4),
  ('Budget', 5),
  ('Accompagnement', 6),
  ('Support', 7),
  ('Facturation', 8),
  ('Autre', 9)
ON CONFLICT (label) DO UPDATE
SET display_order = EXCLUDED.display_order;
