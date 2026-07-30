CREATE TABLE "event_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"respecte" boolean NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_attestations_event_screenhost_uq" UNIQUE("event_id","screenhost_id")
);
--> statement-breakpoint
ALTER TABLE "event_attestations" ADD CONSTRAINT "event_attestations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attestations" ADD CONSTRAINT "event_attestations_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attestations" ADD CONSTRAINT "event_attestations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_attestations_event_id_idx" ON "event_attestations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_attestations_screenhost_id_idx" ON "event_attestations" USING btree ("screenhost_id");