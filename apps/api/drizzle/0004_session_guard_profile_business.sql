ALTER TABLE "users" RENAME COLUMN "name" TO "contact_name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_news_updates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_reminders_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_promotions_offers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tax_number_valid" CHECK ("users"."tax_number" ~ '^[A-Za-z0-9/]{7,20}$');