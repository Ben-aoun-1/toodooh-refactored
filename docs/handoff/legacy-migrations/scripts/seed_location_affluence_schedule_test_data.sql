-- Seed de test pour `location_affluence_schedule`
-- Objectif :
-- - générer 7 x 24 créneaux pour chaque localité ayant au moins un écran actif
-- - produire des volumes réalistes pour tester la création de campagnes
-- - rester deterministic-ish pour éviter des valeurs totalement aléatoires à chaque run
--
-- Utilisation :
-- 1. Ouvrir le SQL Editor Supabase
-- 2. Coller ce script
-- 3. Exécuter
--
-- Remarques :
-- - Le script fait un UPSERT : si un créneau existe déjà, il est mis à jour.
-- - Il ne touche qu'aux localités liées à au moins un écran actif.
-- - Les volumes augmentent avec le nombre d'écrans de la localité.

BEGIN;

-- Optionnel : décommenter si tu veux repartir de zéro sur toutes les localités ayant au moins un écran actif.
-- DELETE FROM location_affluence_schedule
-- WHERE location_id IN (
--   SELECT DISTINCT l.id
--   FROM locations l
--   JOIN screens s ON s.location_id = l.id
--   WHERE s.status = 'active'
-- );

WITH active_locations AS (
  SELECT
    l.id AS location_id,
    l.name AS location_name,
    COUNT(s.id)::int AS screen_count
  FROM locations l
  JOIN screens s
    ON s.location_id = l.id
   AND s.status = 'active'
  GROUP BY l.id, l.name
),
hour_grid AS (
  SELECT
    al.location_id,
    al.location_name,
    al.screen_count,
    d.day_of_week,
    h.hour
  FROM active_locations al
  CROSS JOIN generate_series(1, 7) AS d(day_of_week)
  CROSS JOIN generate_series(0, 23) AS h(hour)
),
computed_slots AS (
  SELECT
    hg.location_id,
    hg.day_of_week,
    hg.hour,
    GREATEST(
      0,
      ROUND(
        (
          CASE
            -- Lundi -> Vendredi
            WHEN hg.day_of_week BETWEEN 1 AND 5 THEN
              CASE
                WHEN hg.hour BETWEEN 0 AND 5 THEN 6
                WHEN hg.hour = 6 THEN 15
                WHEN hg.hour BETWEEN 7 AND 9 THEN 45
                WHEN hg.hour BETWEEN 10 AND 11 THEN 70
                WHEN hg.hour BETWEEN 12 AND 14 THEN 110
                WHEN hg.hour BETWEEN 15 AND 17 THEN 85
                WHEN hg.hour BETWEEN 18 AND 20 THEN 130
                WHEN hg.hour BETWEEN 21 AND 22 THEN 60
                ELSE 18
              END

            -- Samedi
            WHEN hg.day_of_week = 6 THEN
              CASE
                WHEN hg.hour BETWEEN 0 AND 7 THEN 8
                WHEN hg.hour BETWEEN 8 AND 10 THEN 35
                WHEN hg.hour BETWEEN 11 AND 13 THEN 90
                WHEN hg.hour BETWEEN 14 AND 18 THEN 125
                WHEN hg.hour BETWEEN 19 AND 22 THEN 95
                ELSE 20
              END

            -- Dimanche
            ELSE
              CASE
                WHEN hg.hour BETWEEN 0 AND 8 THEN 7
                WHEN hg.hour BETWEEN 9 AND 11 THEN 28
                WHEN hg.hour BETWEEN 12 AND 14 THEN 65
                WHEN hg.hour BETWEEN 15 AND 18 THEN 92
                WHEN hg.hour BETWEEN 19 AND 21 THEN 78
                ELSE 16
              END
          END
        )
        -- Plus il y a d'écrans dans la localité, plus le volume est fort.
        * (0.85 + hg.screen_count * 0.35)
        -- Petite variation déterministe par localité/jour/heure pour éviter des profils trop plats.
        * (
          0.88 + (
            (ABS(HASHTEXT(hg.location_id::text || '-' || hg.day_of_week::text || '-' || hg.hour::text)) % 25)::numeric
            / 100
          )
        )
      )
    )::int AS estimated_impressions
  FROM hour_grid hg
)
INSERT INTO location_affluence_schedule (
  location_id,
  day_of_week,
  hour,
  estimated_impressions,
  updated_at
)
SELECT
  location_id,
  day_of_week,
  hour,
  estimated_impressions,
  NOW()
FROM computed_slots
ON CONFLICT (location_id, day_of_week, hour)
DO UPDATE SET
  estimated_impressions = EXCLUDED.estimated_impressions,
  updated_at = NOW();

COMMIT;

-- Contrôle rapide après injection
SELECT
  l.id,
  l.name,
  COUNT(las.id) AS nb_slots,
  COALESCE(SUM(las.estimated_impressions), 0) AS total_impressions_week
FROM locations l
LEFT JOIN location_affluence_schedule las
  ON las.location_id = l.id
WHERE EXISTS (
  SELECT 1
  FROM screens s
  WHERE s.location_id = l.id
    AND s.status = 'active'
)
GROUP BY l.id, l.name
ORDER BY l.name;
