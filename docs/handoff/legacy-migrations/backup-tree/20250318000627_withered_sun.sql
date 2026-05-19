/*
  # Ajout des types de profils utilisateurs

  1. Modifications
    - Ajout du type énuméré `profile_type` pour distinguer les différents types d'utilisateurs
    - Modification de la table `business_profiles` pour inclure le type de profil
    - Ajout du champ `onboarding_completed` pour gérer l'état de l'onboarding
    - Mise à jour des contraintes et validations

  2. Sécurité
    - Maintien des politiques RLS existantes
*/

-- Création du type énuméré pour les types de profils
CREATE TYPE profile_type AS ENUM (
  'advertiser',        -- Annonceur
  'individual_owner',  -- Propriétaire individuel
  'fleet_owner'       -- Propriétaire de parc
);

-- Ajout de la colonne profile_type à la table business_profiles
ALTER TABLE business_profiles
ADD COLUMN profile_type profile_type NOT NULL DEFAULT 'advertiser';

-- Ajout de la colonne onboarding_completed à la table business_profiles
ALTER TABLE business_profiles
ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;

-- Mise à jour du profil admin existant
UPDATE business_profiles
SET profile_type = 'advertiser'
WHERE is_admin = true;