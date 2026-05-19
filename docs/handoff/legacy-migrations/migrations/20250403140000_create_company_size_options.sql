-- Options "Taille de l'entreprise" pour annonceur/agence, ordonnées en base
CREATE TABLE IF NOT EXISTS company_size_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value text NOT NULL UNIQUE,
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0)
);

ALTER TABLE company_size_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read company size options" ON company_size_options;
CREATE POLICY "Authenticated can read company size options"
  ON company_size_options FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anon can read company size options" ON company_size_options;
CREATE POLICY "Anon can read company size options"
  ON company_size_options FOR SELECT
  TO anon
  USING (true);

INSERT INTO company_size_options (value, display_order) VALUES
  ('0 - 10', 1),
  ('10 - 50', 2),
  ('50 - 100', 3),
  ('100 - 500', 4),
  ('500 et plus', 5)
ON CONFLICT (value) DO UPDATE
SET display_order = EXCLUDED.display_order;
