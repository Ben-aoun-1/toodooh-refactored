/*
  # Ajout du champ onboarding_completed

  1. Modifications
    - Ajout de la colonne `onboarding_completed` à la table `business_profiles`
    - Valeur par défaut : false (pour déclencher l'onboarding)

  2. Sécurité
    - Maintien des politiques RLS existantes
*/

-- Ajout de la colonne onboarding_completed à la table business_profiles
ALTER TABLE business_profiles
ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;

-- Mettre à jour les profils existants pour qu'ils aient l'onboarding à faire
UPDATE business_profiles
SET onboarding_completed = false
WHERE onboarding_completed IS NULL; 