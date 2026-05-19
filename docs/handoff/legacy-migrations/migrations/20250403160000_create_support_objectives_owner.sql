-- Objectifs de la popup support pour les propriétaires (individuel + parc)
CREATE TABLE IF NOT EXISTS support_objectives_owner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0)
);

ALTER TABLE support_objectives_owner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read support objectives owner" ON support_objectives_owner;
CREATE POLICY "Authenticated can read support objectives owner"
  ON support_objectives_owner FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO support_objectives_owner (label, display_order) VALUES
  ('Connexion', 1),
  ('Inscription', 2),
  ('Compte', 3),
  ('Campagne', 4),
  ('Diffusion', 5),
  ('Paiement', 6),
  ('Facturation', 7),
  ('Équipement', 8),
  ('Installation', 9),
  ('Performance', 10),
  ('Bug technique', 11),
  ('Question générale', 12),
  ('Autre', 13)
ON CONFLICT (label) DO UPDATE
SET display_order = EXCLUDED.display_order;
