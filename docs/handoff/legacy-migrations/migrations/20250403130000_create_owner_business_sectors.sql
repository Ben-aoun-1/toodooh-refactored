-- Table dédiée aux secteurs propriétaires (individuel + parc), avec ordre d'affichage
CREATE TABLE IF NOT EXISTS owner_business_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_sector_id uuid NOT NULL UNIQUE REFERENCES business_sectors(id) ON DELETE CASCADE,
  name text NOT NULL UNIQUE,
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0)
);

ALTER TABLE owner_business_sectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read owner business sectors" ON owner_business_sectors;
CREATE POLICY "Authenticated can read owner business sectors"
  ON owner_business_sectors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anon can read owner business sectors" ON owner_business_sectors;
CREATE POLICY "Anon can read owner business sectors"
  ON owner_business_sectors FOR SELECT
  TO anon
  USING (true);

WITH owner_input(name, display_order) AS (
  VALUES
    ('Restaurant', 1),
    ('Salon de the', 2),
    ('Cafe populaire', 3),
    ('Salle de sport', 4)
)
INSERT INTO business_sectors (name)
SELECT name FROM owner_input
ON CONFLICT (name) DO NOTHING;

WITH owner_input(name, display_order) AS (
  VALUES
    ('Restaurant', 1),
    ('Salon de the', 2),
    ('Cafe populaire', 3),
    ('Salle de sport', 4)
)
INSERT INTO owner_business_sectors (business_sector_id, name, display_order)
SELECT bs.id, oi.name, oi.display_order
FROM owner_input oi
JOIN business_sectors bs ON bs.name = oi.name
ON CONFLICT (business_sector_id) DO UPDATE
SET name = EXCLUDED.name,
    display_order = EXCLUDED.display_order;
