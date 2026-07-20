ALTER TABLE "recharges" ADD COLUMN "document_key" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "document_mime" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "document_uploaded_at" timestamp with time zone;