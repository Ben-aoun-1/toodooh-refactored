-- Données de test : remplit UNIQUEMENT les localités qui n'ont encore AUCUNE ligne
-- dans `location_affluence_schedule`, parmi celles référencées par au moins un écran
-- (`screens.location_id`), quel que soit le statut de l'écran.
--
-- Utilisation : SQL Editor Supabase → coller → Exécuter.
-- Vérification : le SELECT final liste nb_creneaux (attendu 168) et total impressions.

BEGIN;

WITH targets AS (
  SELECT DISTINCT s.location_id AS id
  FROM public.screens s
  WHERE s.location_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.location_affluence_schedule las
      WHERE las.location_id = s.location_id
    )
),
slots AS (
  SELECT
    t.id AS location_id,
    d.day_of_week,
    h.hour,
    100 AS estimated_impressions
  FROM targets t
  CROSS JOIN generate_series(1, 7) AS d(day_of_week)
  CROSS JOIN generate_series(0, 23) AS h(hour)
)
INSERT INTO public.location_affluence_schedule (
  location_id,
  day_of_week,
  hour,
  estimated_impressions,
  updated_at
)
SELECT location_id, day_of_week, hour, estimated_impressions, now()
FROM slots
ON CONFLICT (location_id, day_of_week, hour)
DO UPDATE SET
  estimated_impressions = EXCLUDED.estimated_impressions,
  updated_at = EXCLUDED.updated_at;

COMMIT;

-- Contrôle : chaque localité touchée doit avoir 168 créneaux et total = 100 * 168 = 16800
SELECT
  l.id AS location_id,
  l.name,
  COUNT(las.id) AS nb_creneaux,
  COALESCE(SUM(las.estimated_impressions), 0) AS total_impressions_grille
FROM public.locations l
JOIN public.location_affluence_schedule las ON las.location_id = l.id
WHERE EXISTS (
  SELECT 1 FROM public.screens s WHERE s.location_id = l.id AND s.location_id IS NOT NULL
)
GROUP BY l.id, l.name
HAVING COUNT(las.id) > 0
ORDER BY l.name;
