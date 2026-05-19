/*
  # Système d'authentification B2B

  1. Nouvelles Tables
    - `business_profiles`
      - Informations de l'entreprise
      - Documents légaux
      - Statut de vérification
    - `business_sectors`
      - Liste des secteurs d'activité
    - `governorates`
      - Liste des gouvernorats

  2. Sécurité
    - RLS activé sur toutes les tables
    - Politiques pour contrôler l'accès aux données
*/

-- Types énumérés
CREATE TYPE business_type AS ENUM (
  'local',
  'national',
  'agency',
  'event_organizer'
);

CREATE TYPE verification_status AS ENUM (
  'pending',
  'verified',
  'rejected'
);

-- Table des secteurs d'activité
CREATE TABLE business_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

-- Table des gouvernorats
CREATE TABLE governorates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

-- Table des profils d'entreprise
CREATE TABLE business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Informations entreprise
  business_name text NOT NULL,
  tax_number text NOT NULL UNIQUE,
  business_sector_id uuid REFERENCES business_sectors(id),
  business_type business_type NOT NULL,
  -- Informations responsable
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  -- Adresse
  street_address text NOT NULL,
  city text NOT NULL,
  postal_code text NOT NULL,
  governorate_id uuid REFERENCES governorates(id),
  -- Documents et vérification
  registration_doc_url text,
  verification_status verification_status DEFAULT 'pending',
  terms_accepted boolean NOT NULL DEFAULT false,
  terms_accepted_at timestamptz,
  -- Métadonnées
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Contraintes
  CONSTRAINT valid_phone CHECK (contact_phone ~ '^\+[1-9]\d{1,14}$'),
  CONSTRAINT valid_postal_code CHECK (postal_code ~ '^\d{4}$'),
  CONSTRAINT terms_must_be_accepted CHECK (terms_accepted = true)
);

-- Activation RLS
ALTER TABLE business_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE governorates ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- Politiques RLS
CREATE POLICY "Tout le monde peut lire les secteurs d'activité"
  ON business_sectors FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Tout le monde peut lire les gouvernorats"
  ON governorates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Les utilisateurs peuvent lire leur profil"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent créer leur profil"
  ON business_profiles FOR INSERT
  TO authenticated, anon
  WITH CHECK (auth.uid() = user_id OR user_id IS NOT NULL);

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur profil"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Données initiales
INSERT INTO business_sectors (name) VALUES
  ('Commerce'),
  ('Services'),
  ('Industrie'),
  ('Technologies'),
  ('Tourisme'),
  ('Agriculture'),
  ('Construction'),
  ('Transport'),
  ('Éducation'),
  ('Santé');

INSERT INTO governorates (name) VALUES
  ('Tunis'),
  ('Ariana'),
  ('Ben Arous'),
  ('Manouba'),
  ('Nabeul'),
  ('Zaghouan'),
  ('Bizerte'),
  ('Béja'),
  ('Jendouba'),
  ('Le Kef'),
  ('Siliana'),
  ('Sousse'),
  ('Monastir'),
  ('Mahdia'),
  ('Sfax'),
  ('Kairouan'),
  ('Kasserine'),
  ('Sidi Bouzid'),
  ('Gabès'),
  ('Medenine'),
  ('Tataouine'),
  ('Gafsa'),
  ('Tozeur'),
  ('Kebili');

-- Triggers pour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();