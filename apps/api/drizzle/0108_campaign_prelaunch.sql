-- Mariem 13/11/2026 (« Changements à livrer avant le test », point 2) + operator 2026-11-14
-- (« each screenhost has their own start hour ») — the pre-launch steps of a classic tours
-- campaign run PER HOST, at the campaign's start date and that venue's opening hour
-- (lib/campaign-prelaunch.ts): start − 6 h locks the Host's proposal, start − 5 min freezes it.
-- late_proposal = a Host proposed after its own lock (a pre-launch redispatch): only the freeze
-- withdraws it. prelaunch_frozen_at = the campaign's price recalculated once no Host is pending.
ALTER TABLE "campaign_dispatch_allocation" ADD COLUMN "late_proposal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "prelaunch_frozen_at" timestamp with time zone;
