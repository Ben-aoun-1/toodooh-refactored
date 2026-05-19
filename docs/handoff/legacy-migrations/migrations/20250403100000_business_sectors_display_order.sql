-- Ordre d'affichage aligné sur la base ; secteur par défaut pour les agences
ALTER TABLE business_sectors ADD COLUMN IF NOT EXISTS display_order integer;

INSERT INTO business_sectors (name, display_order) VALUES ('Agence de Publicité', 0)
ON CONFLICT (name) DO UPDATE SET display_order = EXCLUDED.display_order;

UPDATE business_sectors SET display_order = 1 WHERE name = 'Agriculture et agroalimentaire';
UPDATE business_sectors SET display_order = 2 WHERE name = 'Automobile et mobilité';
UPDATE business_sectors SET display_order = 3 WHERE name = 'Banque, assurance et finance';
UPDATE business_sectors SET display_order = 4 WHERE name = 'Bâtiment, construction et immobilier';
UPDATE business_sectors SET display_order = 5 WHERE name = 'Beauté, bien-être et cosmétique';
UPDATE business_sectors SET display_order = 6 WHERE name = 'Commerce, retail et distribution';
UPDATE business_sectors SET display_order = 7 WHERE name = 'Communication, marketing, média et publicité';
UPDATE business_sectors SET display_order = 8 WHERE name = 'Conseil et services aux entreprises';
UPDATE business_sectors SET display_order = 9 WHERE name = 'Culture, divertissement et création';
UPDATE business_sectors SET display_order = 10 WHERE name = 'Éducation et formation';
UPDATE business_sectors SET display_order = 11 WHERE name = 'Énergie, environnement et développement durable';
UPDATE business_sectors SET display_order = 12 WHERE name = 'Hôtellerie, restauration et cafés';
UPDATE business_sectors SET display_order = 13 WHERE name = 'Industrie et fabrication';
UPDATE business_sectors SET display_order = 14 WHERE name = 'Informatique, technologie et télécommunications';
UPDATE business_sectors SET display_order = 15 WHERE name = 'Logistique, transport et livraison';
UPDATE business_sectors SET display_order = 16 WHERE name = 'Mode, textile et accessoires';
UPDATE business_sectors SET display_order = 17 WHERE name = 'Maison, décoration et ameublement';
UPDATE business_sectors SET display_order = 18 WHERE name = 'Santé, médical et pharmacie';
UPDATE business_sectors SET display_order = 19 WHERE name = 'Secteur public, institutions et collectivités';
UPDATE business_sectors SET display_order = 20 WHERE name = 'Services juridiques, comptables et administratifs';
UPDATE business_sectors SET display_order = 21 WHERE name = 'Sport, fitness et loisirs';
UPDATE business_sectors SET display_order = 22 WHERE name = 'Tourisme, voyage et événementiel';
UPDATE business_sectors SET display_order = 23 WHERE name = 'Associations, ONG et organisations internationales';
UPDATE business_sectors SET display_order = 24 WHERE name = 'Autre';
