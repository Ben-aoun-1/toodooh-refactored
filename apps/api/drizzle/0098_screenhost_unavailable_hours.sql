-- HOUR-UNAV1 — partial unavailability by the hour (operator rulings 2026-10-27). One row per
-- unavailable clock hour, dated on the calendar day the hour falls on. Whole days stay in
-- screenhost_unavailability (unchanged); readers merge both (lib/unavailable-hours.ts).
CREATE TABLE "screenhost_unavailable_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL REFERENCES "screenhosts"("id") ON DELETE CASCADE,
	"day" date NOT NULL,
	"hour" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_unavailable_hours_hour_range" CHECK ("hour" >= 0 AND "hour" <= 23)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_unavailable_hours_cell_uq" ON "screenhost_unavailable_hours" ("screenhost_id", "day", "hour");
