CREATE TABLE "event_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"blocs" jsonb NOT NULL,
	"impressions_total" integer NOT NULL,
	"montant_tnd" numeric(12, 3) NOT NULL,
	"statut" text DEFAULT 'EN_ATTENTE' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_allocations_campaign_screenhost_uq" UNIQUE("campaign_id","screenhost_id"),
	CONSTRAINT "event_allocations_statut_valid" CHECK ("event_allocations"."statut" in ('EN_ATTENTE', 'ACCEPTE', 'REFUSE'))
);
--> statement-breakpoint
ALTER TABLE "event_allocations" ADD CONSTRAINT "event_allocations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_allocations" ADD CONSTRAINT "event_allocations_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_allocations_campaign_id_idx" ON "event_allocations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "event_allocations_screenhost_id_idx" ON "event_allocations" USING btree ("screenhost_id");--> statement-breakpoint
CREATE INDEX "event_allocations_statut_idx" ON "event_allocations" USING btree ("statut");