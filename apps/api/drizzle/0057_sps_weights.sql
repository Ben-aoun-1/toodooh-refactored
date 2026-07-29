ALTER TABLE "dispatch_config" ADD COLUMN "sps_weight_acceptation" numeric(5, 2) DEFAULT '40' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "sps_weight_respect_evenements" numeric(5, 2) DEFAULT '30' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "sps_weight_activite" numeric(5, 2) DEFAULT '20' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "sps_weight_remplissage" numeric(5, 2) DEFAULT '10' NOT NULL;