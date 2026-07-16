-- E1 (VF) — the attention index T by spot duration (≤10s/≤20s/≤30s), canonical 0,60/0,70/0,80.
-- Plain additive ADD COLUMN with defaults — the enum-swap pattern is N/A here.
ALTER TABLE "dispatch_config" ADD COLUMN "t_10s" numeric(4, 2) DEFAULT '0.60' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "t_20s" numeric(4, 2) DEFAULT '0.70' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "t_30s" numeric(4, 2) DEFAULT '0.80' NOT NULL;