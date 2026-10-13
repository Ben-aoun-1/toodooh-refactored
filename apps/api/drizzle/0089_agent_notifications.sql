-- AGT-6 — agent notifications (agent specs v1.0 §8): the email double's timestamp (every
-- notification that exists before this lane counts as already sent, so the deploy emails
-- nothing old) and the hub's « Actualité Toodooh » posts.
ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "notifications" SET "emailed_at" = now();--> statement-breakpoint
CREATE TABLE "agent_news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_news_audience" CHECK ("agent_news"."audience" in ('all', 'screencast_agent', 'screenhost_agent'))
);
--> statement-breakpoint
ALTER TABLE "agent_news" ADD CONSTRAINT "agent_news_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
