CREATE TABLE "screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screens_screenhost_id_idx" ON "screens" USING btree ("screenhost_id");--> statement-breakpoint
-- BACKFILL (MAP M1 commit 2): already-APPROVED owners' screenhosts get their screens rows
-- now, exactly as the admin-approve hook generates them from this commit on: screen_count
-- rows per screenhost, named "Écran 1..N". The NOT EXISTS guard makes a partial re-run
-- idempotent (a screenhost that already has ANY screens is left alone — same rule as the
-- hook). screen_count <= 0 generates nothing (generate_series is empty).
INSERT INTO "screens" ("screenhost_id", "name")
SELECT s."id", 'Écran ' || gs.n
FROM "screenhosts" s
JOIN "users" u ON u."id" = s."owner_id"
CROSS JOIN LATERAL generate_series(1, s."screen_count") AS gs(n)
WHERE u."status" = 'approved'
  AND u."role" IN ('individual_owner', 'fleet_owner')
  AND NOT EXISTS (SELECT 1 FROM "screens" sc WHERE sc."screenhost_id" = s."id");
