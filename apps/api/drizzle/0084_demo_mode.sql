-- DEMO-1 — demo mode: admin-created demo screencasters whose campaigns air on the demo venues
-- after an admin-set delay, never pay a screenhost (lib/demo.ts).
ALTER TABLE "users" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "airs_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "airs_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "demo_delay_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
CREATE TABLE "demo_screenhosts" (
	"screenhost_id" uuid PRIMARY KEY NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_screenhosts" ADD CONSTRAINT "demo_screenhosts_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_screenhosts" ADD CONSTRAINT "demo_screenhosts_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
