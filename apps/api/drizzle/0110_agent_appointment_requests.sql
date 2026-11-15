-- Mariem 12/11/2026 (Agent Screenhost spec VF §13, Agent Screencaster spec VF §9) — an agent asks
-- one of his affiliates for a rendez-vous himself. The same table carries both directions:
-- initiated_by says who asked. An agent's request has a quarter-hour (minute), a place and one of
-- the spec's four subjects (free text, the admin-managed objectives stay the affiliate's reasons).
-- The affiliate's counter-proposal uses proposed_day / proposed_hour / proposed_minute.
ALTER TABLE "agent_appointments" ADD COLUMN "initiated_by" text NOT NULL DEFAULT 'affilie';
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD COLUMN "minute" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD COLUMN "proposed_minute" integer;
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD COLUMN "place" text;
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD COLUMN "subject" text;
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_initiated_by" CHECK ("initiated_by" in ('affilie', 'agent'));
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_minute" CHECK ("minute" in (0, 15, 30, 45) AND ("proposed_minute" IS NULL OR "proposed_minute" in (0, 15, 30, 45)));
--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_place" CHECK ("place" IS NULL OR "place" in ('sur_place', 'telephone', 'visio'));
