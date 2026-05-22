CREATE TABLE "business_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"audience" text NOT NULL,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_sectors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "governorates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "governorates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "predefined_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"radius" integer DEFAULT 1000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_hot" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"country" text DEFAULT 'Tunisie' NOT NULL,
	"region" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predefined_zones_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "business_sector_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "street_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "governorate_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "registration_doc_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cin_doc_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_sector_id_business_sectors_id_fk" FOREIGN KEY ("business_sector_id") REFERENCES "public"."business_sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_business_sector_id_idx" ON "users" USING btree ("business_sector_id");--> statement-breakpoint
CREATE INDEX "users_governorate_id_idx" ON "users" USING btree ("governorate_id");--> statement-breakpoint
CREATE INDEX "users_onboarding_completed_idx" ON "users" USING btree ("onboarding_completed");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_postal_code_valid" CHECK ("users"."postal_code" ~ '^\d{4}$');--> statement-breakpoint
-- ── Seed data (hand-appended; drizzle-kit emits DDL only — Phase-1a CREATE
--    EXTENSION precedent). Verbatim from legacy SQL per CF-23; ON CONFLICT for
--    dev re-run idempotency. ──
INSERT INTO "governorates" ("name") VALUES
	('Tunis'),
	('Ariana'),
	('Ben Arous'),
	('Manouba'),
	('Nabeul'),
	('Zaghouan'),
	('Bizerte'),
	('Béja'),
	('Jendouba'),
	('Le Kef'),
	('Siliana'),
	('Sousse'),
	('Monastir'),
	('Mahdia'),
	('Sfax'),
	('Kairouan'),
	('Kasserine'),
	('Sidi Bouzid'),
	('Gabès'),
	('Medenine'),
	('Tataouine'),
	('Gafsa'),
	('Tozeur'),
	('Kebili')
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "business_sectors" ("name", "audience", "display_order") VALUES
	('Agence de Publicité', 'advertiser', 0),
	('Agriculture et agroalimentaire', 'advertiser', 1),
	('Automobile et mobilité', 'advertiser', 2),
	('Banque, assurance et finance', 'advertiser', 3),
	('Bâtiment, construction et immobilier', 'advertiser', 4),
	('Beauté, bien-être et cosmétique', 'advertiser', 5),
	('Commerce, retail et distribution', 'advertiser', 6),
	('Communication, marketing, média et publicité', 'advertiser', 7),
	('Conseil et services aux entreprises', 'advertiser', 8),
	('Culture, divertissement et création', 'advertiser', 9),
	('Éducation et formation', 'advertiser', 10),
	('Énergie, environnement et développement durable', 'advertiser', 11),
	('Hôtellerie, restauration et cafés', 'advertiser', 12),
	('Industrie et fabrication', 'advertiser', 13),
	('Informatique, technologie et télécommunications', 'advertiser', 14),
	('Logistique, transport et livraison', 'advertiser', 15),
	('Mode, textile et accessoires', 'advertiser', 16),
	('Maison, décoration et ameublement', 'advertiser', 17),
	('Santé, médical et pharmacie', 'advertiser', 18),
	('Secteur public, institutions et collectivités', 'advertiser', 19),
	('Services juridiques, comptables et administratifs', 'advertiser', 20),
	('Sport, fitness et loisirs', 'advertiser', 21),
	('Tourisme, voyage et événementiel', 'advertiser', 22),
	('Associations, ONG et organisations internationales', 'advertiser', 23),
	('Autre', 'advertiser', 24),
	('Restaurant', 'owner', 1),
	('Salon de the', 'owner', 2),
	('Cafe populaire', 'owner', 3),
	('Salle de sport', 'owner', 4)
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "predefined_zones" ("name", "description", "latitude", "longitude", "radius") VALUES
	('Ariana', 'Zone d''Ariana et ses environs', 36.8625, 10.1956, 5000),
	('Tunis Centre', 'Centre-ville de Tunis', 36.8065, 10.1815, 3000),
	('Lac', 'Zone du Lac de Tunis', 36.8381, 10.2417, 4000),
	('La Marsa', 'Zone de La Marsa', 36.8782, 10.3247, 4000),
	('Sidi Bou Said', 'Zone de Sidi Bou Said', 36.8687, 10.3417, 2000),
	('Carthage', 'Zone de Carthage', 36.8529, 10.3233, 3000),
	('Menzah', 'Zone de Menzah', 36.8500, 10.2000, 3000),
	('El Manar', 'Zone d''El Manar', 36.8300, 10.2200, 3000)
ON CONFLICT ("name") DO NOTHING;