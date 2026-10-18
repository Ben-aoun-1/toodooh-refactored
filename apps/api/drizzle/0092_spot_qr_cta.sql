-- QR-CTA1 — a spot's call to action (Youssef 2026-10-18). A screencaster may give a campaign a link
-- + a short message (≤ 20 characters); the server burns a QR code (pointing at the scan-counting
-- redirect /q/<code>) into a COPY of the spot, and the TV airs that copy. Per-account switch while
-- the feature is tested quietly (users.cta_enabled; demo accounts always have it).
ALTER TABLE "users" ADD COLUMN "cta_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_url" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_label" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_code" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_status" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_storage_key" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_source_creative_id" uuid;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_error" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cta_code_unique" UNIQUE ("cta_code");
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cta_status_check" CHECK ("cta_status" IS NULL OR "cta_status" IN ('pending', 'ready', 'failed'));
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cta_label_check" CHECK ("cta_label" IS NULL OR char_length("cta_label") <= 20);
--> statement-breakpoint
CREATE TABLE "cta_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cta_scans_campaign_scanned_idx" ON "cta_scans" ("campaign_id", "scanned_at");
