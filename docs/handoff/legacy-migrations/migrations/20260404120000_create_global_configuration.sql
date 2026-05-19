-- Configuration globale métier (paramètres clé/valeur typés)

CREATE TABLE IF NOT EXISTS global_configuration (
  key text PRIMARY KEY,
  value_text text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('integer', 'numeric', 'boolean', 'json', 'text')),
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE global_configuration IS 'Paramètres métier globaux (lecture par l’application).';

INSERT INTO global_configuration (key, value_text, value_type, description)
VALUES
  ('video_max_duration_seconds', '30', 'integer', 'Durée maximale autorisée pour une vidéo (secondes).'),
  ('video_min_duration_seconds', '1', 'integer', 'Durée minimale autorisée pour une vidéo (secondes).'),
  ('video_default_duration_seconds', '15', 'integer', 'Durée utilisée si la durée réelle de la vidéo est absente (secondes).'),
  ('max_billable_spot_rate_per_hour', '0.30', 'numeric', 'Taux maximal de spots facturables par heure (0..1).'),
  ('standard_campaign_cpm_tnd', '2.5', 'numeric', 'CPM (TND) des campagnes standard.'),
  ('event_campaign_cpm_tnd', '2.5', 'numeric', 'CPM (TND) des campagnes événement.'),
  ('max_spots_per_hour', '10', 'integer', 'Nombre maximal de spots (emplacements) planifiables par heure sur une tranche, avant application du taux facturable.')
ON CONFLICT (key) DO NOTHING;
