-- Corrige les doublons business_profiles par user_id (cause fréquente de PGRST116).
-- Garde la ligne la plus récente par user_id, supprime les autres.
-- Puis ajoute un index unique pour empêcher la réapparition.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    user_id,
    created_at,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.business_profiles
  WHERE user_id IS NOT NULL
),
to_delete AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
DELETE FROM public.business_profiles bp
USING to_delete d
WHERE bp.id = d.id;

COMMIT;

-- Empêche les doublons futurs sur user_id (tout en autorisant NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_profiles_user_id
  ON public.business_profiles(user_id)
  WHERE user_id IS NOT NULL;

-- Contrôle final
SELECT
  user_id,
  count(*) AS cnt
FROM public.business_profiles
WHERE user_id IS NOT NULL
GROUP BY user_id
HAVING count(*) > 1;

