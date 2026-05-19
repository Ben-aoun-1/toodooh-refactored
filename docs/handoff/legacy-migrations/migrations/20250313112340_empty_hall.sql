/*
  # Schéma initial pour l'application de gestion de campagnes publicitaires

  1. Nouvelles Tables
    - `clients`
      - `id` (uuid, clé primaire)
      - `name` (text, nom du client)
      - `contact_email` (text, email de contact)
      - `contact_phone` (text, téléphone)
      - `address` (text, adresse)
      - `created_at` (timestamp)
      - `user_id` (uuid, référence vers l'utilisateur propriétaire)

    - `campaigns`
      - `id` (uuid, clé primaire)
      - `name` (text, nom de la campagne)
      - `client_id` (uuid, référence vers le client)
      - `category` (text, catégorie de diffusion)
      - `start_date` (timestamp, début de la campagne)
      - `end_date` (timestamp, fin de la campagne)
      - `status` (text, statut de la campagne)
      - `budget` (numeric, budget de la campagne)
      - `views` (integer, nombre de vues)
      - `created_at` (timestamp)
      - `user_id` (uuid, référence vers l'utilisateur propriétaire)

    - `campaign_media`
      - `id` (uuid, clé primaire)
      - `campaign_id` (uuid, référence vers la campagne)
      - `url` (text, URL de la vidéo)
      - `filename` (text, nom du fichier)
      - `created_at` (timestamp)

    - `campaign_locations`
      - `id` (uuid, clé primaire)
      - `campaign_id` (uuid, référence vers la campagne)
      - `latitude` (numeric, latitude du centre)
      - `longitude` (numeric, longitude du centre)
      - `radius` (numeric, rayon en mètres)
      - `created_at` (timestamp)

  2. Sécurité
    - Activation RLS sur toutes les tables
    - Politiques pour permettre aux utilisateurs de gérer leurs propres données
    - Politiques spéciales pour les administrateurs
*/

-- Création des types énumérés
CREATE TYPE campaign_status AS ENUM (
  'draft',
  'pending',
  'active',
  'paused',
  'completed',
  'rejected'
);

CREATE TYPE campaign_category AS ENUM (
  'commercial',
  'cultural',
  'promotional',
  'institutional'
);

-- Table des clients
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text,
  contact_phone text,
  address text,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT valid_email CHECK (contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Table des campagnes
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  category campaign_category NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  status campaign_status NOT NULL DEFAULT 'draft',
  budget numeric(10,2) NOT NULL DEFAULT 0,
  views integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT valid_dates CHECK (end_date > start_date),
  CONSTRAINT valid_budget CHECK (budget >= 0)
);

-- Table des médias des campagnes
CREATE TABLE campaign_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  url text NOT NULL,
  filename text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Table des localisations des campagnes
CREATE TABLE campaign_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  radius numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT valid_longitude CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT valid_radius CHECK (radius > 0)
);

-- Activation de la Row Level Security
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_locations ENABLE ROW LEVEL SECURITY;

-- Politiques RLS pour les clients
CREATE POLICY "Users can view their own clients"
  ON clients FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own clients"
  ON clients FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Politiques RLS pour les campagnes
CREATE POLICY "Users can view their own campaigns"
  ON campaigns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own campaigns"
  ON campaigns FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON campaigns FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON campaigns FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Politiques RLS pour les médias
CREATE POLICY "Users can view campaign media"
  ON campaign_media FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_media.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert campaign media"
  ON campaign_media FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_media.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete campaign media"
  ON campaign_media FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_media.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

-- Politiques RLS pour les localisations
CREATE POLICY "Users can view campaign locations"
  ON campaign_locations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_locations.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert campaign locations"
  ON campaign_locations FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_locations.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update campaign locations"
  ON campaign_locations FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_locations.campaign_id
    AND campaigns.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_locations.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete campaign locations"
  ON campaign_locations FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_locations.campaign_id
    AND campaigns.user_id = auth.uid()
  ));

-- Index pour améliorer les performances
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_client_id ON campaigns(client_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_campaign_media_campaign_id ON campaign_media(campaign_id);
CREATE INDEX idx_campaign_locations_campaign_id ON campaign_locations(campaign_id);