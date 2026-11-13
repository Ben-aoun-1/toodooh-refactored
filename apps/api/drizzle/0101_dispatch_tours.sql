-- DISP-TOURS (Mariem, 03/11/2026) — a standard campaign's plan says which engine froze it: 'v1'
-- (every existing plan: one SPS-ordered venue at a time, a uniform r_i on every opening hour) or
-- 'tours' (the 2 peak hours of each weekday, tour after tour). The tours plan also stores its
-- exact price (Σ qualified impressions × CPM ÷ 1000, the amount the launch engages) and the
-- snapshot the admin fiche shows (parameters, per-venue tours, week grid, engine journal).
ALTER TABLE "campaign_dispatch_plan" ADD COLUMN "engine" text NOT NULL DEFAULT 'v1';
--> statement-breakpoint
ALTER TABLE "campaign_dispatch_plan" ADD COLUMN "price_tnd" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "campaign_dispatch_plan" ADD COLUMN "detail" jsonb;
--> statement-breakpoint
ALTER TABLE "campaign_dispatch_plan" ADD CONSTRAINT "campaign_dispatch_plan_engine_chk" CHECK ("engine" IN ('v1', 'tours'));
