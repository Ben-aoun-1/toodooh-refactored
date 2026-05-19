-- Stocker le chemin du fichier (bucket registres) pour générer des URLs signées à la demande.
-- Les URLs signées expirent (JWT exp) ; en gardant le path on recrée une URL fraîche à l'ouverture.

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS registration_doc_path text;

COMMENT ON COLUMN business_profiles.registration_doc_path IS 'Chemin du fichier dans le bucket registres (ex: rne_xxx_timestamp.pdf) pour créer une URL signée à la demande.';
