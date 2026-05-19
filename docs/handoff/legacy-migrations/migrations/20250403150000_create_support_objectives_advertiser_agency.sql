-- Objectifs de la popup support pour annonceur + agence
CREATE TABLE IF NOT EXISTS support_objectives_advertiser_agency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0)
);

ALTER TABLE support_objectives_advertiser_agency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read support objectives advertiser agency" ON support_objectives_advertiser_agency;
CREATE POLICY "Authenticated can read support objectives advertiser agency"
  ON support_objectives_advertiser_agency FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO support_objectives_advertiser_agency (label, display_order) VALUES
  ('Connexion', 1),
  ('Inscription', 2),
  ('Compte', 3),
  ('Campagne', 4),
  ('Paiement', 5),
  ('Facturation', 6),
  ('Performance', 7),
  ('Bug technique', 8),
  ('Question générale', 9),
  ('Autre', 10)
ON CONFLICT (label) DO UPDATE
SET display_order = EXCLUDED.display_order;
