CREATE TYPE "public"."dispatch_acceptation" AS ENUM('ACCEPTE', 'REFUSE');--> statement-breakpoint
CREATE TABLE "campaign_dispatch_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"ii_potentiel" integer NOT NULL,
	"r_i" integer NOT NULL,
	"revenu_previsionnel" numeric(14, 4) NOT NULL,
	"statut_acceptation" "dispatch_acceptation" DEFAULT 'ACCEPTE' NOT NULL,
	"creneaux" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_dispatch_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"i_cible" integer NOT NULL,
	"cpm" numeric(10, 3) NOT NULL,
	"s_spot_seconds" integer NOT NULL,
	"t_tier_coef" numeric(4, 3) NOT NULL,
	"seuil_diffusable" integer NOT NULL,
	"s_min" numeric(14, 4) NOT NULL,
	"g_jour" numeric(14, 4) NOT NULL,
	"f_max_seconds" integer NOT NULL,
	"r_min_efficace" integer NOT NULL,
	"couvert" integer NOT NULL,
	"n_min" integer NOT NULL,
	"n_max" integer NOT NULL,
	"n_retenus" integer NOT NULL,
	"is_partial" boolean DEFAULT false NOT NULL,
	"is_too_thin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"seuil_diffusable" integer NOT NULL,
	"g_mois" numeric(12, 2) NOT NULL,
	"jours_actifs" integer NOT NULL,
	"r_min_efficace" integer NOT NULL,
	"f_max_seconds" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_dispatch_allocation" ADD CONSTRAINT "campaign_dispatch_allocation_plan_id_campaign_dispatch_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."campaign_dispatch_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_dispatch_allocation" ADD CONSTRAINT "campaign_dispatch_allocation_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_dispatch_plan" ADD CONSTRAINT "campaign_dispatch_plan_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_dispatch_allocation_plan_sh_uq" ON "campaign_dispatch_allocation" USING btree ("plan_id","screenhost_id");--> statement-breakpoint
CREATE INDEX "campaign_dispatch_allocation_plan_id_idx" ON "campaign_dispatch_allocation" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "campaign_dispatch_allocation_screenhost_id_idx" ON "campaign_dispatch_allocation" USING btree ("screenhost_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_dispatch_plan_campaign_uq" ON "campaign_dispatch_plan" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_config_singleton_uq" ON "dispatch_config" USING btree ("singleton");--> statement-breakpoint
INSERT INTO "dispatch_config" ("seuil_diffusable", "g_mois", "jours_actifs", "r_min_efficace", "f_max_seconds") VALUES (1000, 100.00, 30, 2, 300);