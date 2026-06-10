ALTER TABLE "users" ADD COLUMN "bank_account_holder" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bank_rib" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bank_iban" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bank_doc_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bank_details_updated_at" timestamp with time zone;