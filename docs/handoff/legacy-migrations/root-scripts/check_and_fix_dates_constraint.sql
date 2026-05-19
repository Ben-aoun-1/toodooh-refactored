-- Script pour vérifier et corriger la contrainte valid_dates

-- 1. Vérifier les contraintes actuelles sur special_events
SELECT
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'special_events'
AND tc.constraint_type = 'CHECK';

-- 2. Supprimer l'ancienne contrainte si elle est trop stricte
ALTER TABLE special_events 
DROP CONSTRAINT IF EXISTS valid_dates;

-- 3. Recréer la contrainte avec >= au lieu de > pour permettre même jour
-- Cela permet des événements qui commencent et finissent le même jour
ALTER TABLE special_events
ADD CONSTRAINT valid_dates CHECK (end_date >= start_date);

-- 4. Test: Vérifier qu'on peut insérer un événement sur la même journée
/*
INSERT INTO special_events (
    id,
    name,
    event_type,
    start_date,
    end_date,
    location,
    city,
    created_by
) VALUES (
    gen_random_uuid(),
    'Test Événement Même Jour',
    'concert',
    '2025-07-15 18:00:00+00',
    '2025-07-15 23:00:00+00',
    'Test Venue',
    'Paris',
    (SELECT id FROM admin_profiles WHERE role = 'superadmin' LIMIT 1)
);

-- Nettoyer le test
DELETE FROM special_events WHERE name = 'Test Événement Même Jour';
*/

-- 5. Afficher les contraintes après modification
SELECT
    constraint_name,
    check_clause
FROM information_schema.check_constraints
WHERE constraint_name LIKE '%valid_dates%';












































