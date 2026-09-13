-- SIM-1 (2026-09-13). The generated world's METADATA — both objects live in MAIN only (a sandbox
-- carries the same schema because sandboxes run the same migrations, but never a row):
--   simulations.world  — the seed, the knobs and the counts of the world generated in the sandbox.
--   simulation_actors  — per-actor BEHAVIOUR (an owner's acceptance rate and response delay, a
--                        screen's offline probability). Deliberately NOT in the sandbox: a sandbox
--                        must stay prod-shaped, so simulator metadata never touches its tables.
--                        entity_id is a row id in ANOTHER database — no foreign key by design.
ALTER TABLE "simulations" ADD COLUMN "world" jsonb;
--> statement-breakpoint
CREATE TYPE "simulation_actor_kind" AS ENUM ('owner', 'screen', 'advertiser');
--> statement-breakpoint
CREATE TABLE "simulation_actors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "simulation_id" uuid NOT NULL REFERENCES "simulations"("id") ON DELETE CASCADE,
  "kind" "simulation_actor_kind" NOT NULL,
  "entity_id" uuid NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "simulation_actors_entity_unique" UNIQUE("simulation_id","entity_id")
);
--> statement-breakpoint
CREATE INDEX "simulation_actors_simulation_idx" ON "simulation_actors" ("simulation_id");
