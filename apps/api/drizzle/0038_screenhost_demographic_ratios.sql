ALTER TABLE "screenhosts" ADD COLUMN "gender_male_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "gender_female_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "age_17_30_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "age_31_45_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "age_46_60_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "age_60_plus_pct" numeric(5, 2);