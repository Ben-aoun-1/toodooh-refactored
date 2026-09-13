-- SIM-0 (2026-09-13). The admin « Simulateur » registry: one row per sandbox DATABASE on the
-- same Postgres server (created + migrated by the api in the background, dropped on delete).
-- Lives in MAIN only; the sandboxes carry this table too (same migrations) but never a row.
CREATE TYPE "simulation_status" AS ENUM ('creating', 'ready', 'failed', 'deleting');
--> statement-breakpoint
CREATE TABLE "simulations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "db_name" text NOT NULL,
  "status" "simulation_status" DEFAULT 'creating' NOT NULL,
  "virtual_now" timestamp with time zone NOT NULL,
  "error" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "simulations_db_name_unique" UNIQUE("db_name")
);
--> statement-breakpoint
CREATE INDEX "simulations_status_idx" ON "simulations" ("status");
