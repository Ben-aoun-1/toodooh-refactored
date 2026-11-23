-- Mariem 17/11/2026 — « Réseau Screenhosts » : a Screencaster removes venues from HIS network
-- (« Ne plus diffuser dans ces établissements ») and can put them back at any time. A row is one
-- exclusion period: open while "reintegrated_at" is NULL. Rows are kept (history) because a
-- campaign already validated keeps the list in force when it was submitted: the engine reads the
-- periods that cover the campaign's "submitted_at" (lib/caster-exclusions.ts).
CREATE TABLE IF NOT EXISTS "caster_venue_exclusions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "advertiser_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "screenhost_id" uuid NOT NULL REFERENCES "screenhosts"("id") ON DELETE CASCADE,
  "excluded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reintegrated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caster_venue_exclusions_open_uq" ON "caster_venue_exclusions" ("advertiser_id", "screenhost_id") WHERE "reintegrated_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caster_venue_exclusions_advertiser_idx" ON "caster_venue_exclusions" ("advertiser_id");
