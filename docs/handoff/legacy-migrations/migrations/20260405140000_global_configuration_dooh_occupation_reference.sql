-- Référence RPH pour le taux d’occupation par localité (moteur affluence localités).
INSERT INTO public.global_configuration (key, value_text, value_type, description)
VALUES (
  'dooh_occupation_reference_rph',
  '10',
  'numeric',
  'Valeur de référence (répétitions/heure concurrentes max par localité) pour ramener l’occupation à un taux 0..1 : min(1, maxRph / référence).'
)
ON CONFLICT (key) DO NOTHING;
