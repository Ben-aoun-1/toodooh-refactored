-- Mariem 13/11/2026 (« Changements à livrer avant le test », point 2) — the pre-launch steps of a
-- classic tours campaign (lib/campaign-prelaunch.ts): prelaunch_locked_at = the start − 6 h lock
-- (the Hosts that did not answer removed, their share redispatched, new Hosts first);
-- prelaunch_frozen_at = the start − 5 min freeze (the last redispatch, onto the accepted Hosts
-- only, and the recalculated price). Each stamp makes its step run once.
ALTER TABLE "campaigns" ADD COLUMN "prelaunch_locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "prelaunch_frozen_at" timestamp with time zone;
