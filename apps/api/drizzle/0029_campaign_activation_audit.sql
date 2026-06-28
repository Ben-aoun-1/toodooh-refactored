ALTER TABLE "campaigns" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "activated_by" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;