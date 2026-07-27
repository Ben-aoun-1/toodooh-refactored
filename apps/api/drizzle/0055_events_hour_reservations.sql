CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_key" text,
	"type" text DEFAULT 'sport' NOT NULL,
	"category" text,
	"kickoff_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"annule" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'official' NOT NULL,
	"suggested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_type_sport" CHECK ("events"."type" = 'sport'),
	CONSTRAINT "events_ends_after_kickoff" CHECK ("events"."ends_at" > "events"."kickoff_at"),
	CONSTRAINT "events_source_valid" CHECK ("events"."source" in ('official', 'suggested'))
);
--> statement-breakpoint
CREATE TABLE "hour_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"day" date NOT NULL,
	"hour" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hour_reservations_cell_uq" UNIQUE("screenhost_id","day","hour","event_id"),
	CONSTRAINT "hour_reservations_hour_range" CHECK ("hour_reservations"."hour" >= 0 and "hour_reservations"."hour" <= 23)
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_suggested_by_users_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hour_reservations" ADD CONSTRAINT "hour_reservations_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hour_reservations" ADD CONSTRAINT "hour_reservations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_kickoff_at_idx" ON "events" USING btree ("kickoff_at");