-- EVT-MIN1 (operator rulings 2026-10-05) — an event positioning's size in MINUTES (one minute = one
-- seat of a bloc's 5-minute pod at one venue). requested_budget is derived from it. NULL on classic
-- campaigns and on positionings dispatched before the minutes model (they keep EV4's whole-bloc
-- rules, ruling A1). No backfill.
ALTER TABLE "campaigns" ADD COLUMN "event_minutes" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_event_minutes_positive" CHECK ("campaigns"."event_minutes" IS NULL OR "campaigns"."event_minutes" >= 1);
