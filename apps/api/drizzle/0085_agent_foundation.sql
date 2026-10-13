-- AGT-1 — agent foundation (Youssef's agent specs v1.0, rulings 2026-10-13): the agent sheet,
-- its own lifecycle and commission rate, versioned CGE with an acceptance history, and RIB
-- deposits validated by the admin. Existing agents are already in use: they start 'actif'.
CREATE TYPE "public"."agent_account_status" AS ENUM('en_attente', 'actif', 'suspendu', 'cloture');--> statement-breakpoint
CREATE TYPE "public"."agent_rib_status" AS ENUM('en_attente', 'valide', 'refuse');--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "covered_zone" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "commission_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "account_status" "agent_account_status" DEFAULT 'en_attente' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "certified_at" date;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "info_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "origin_page" text;--> statement-breakpoint
CREATE TABLE "agent_profile_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile_changes" ADD CONSTRAINT "agent_profile_changes_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_profile_changes_agent_idx" ON "agent_profile_changes" USING btree ("agent_user_id","changed_at");--> statement-breakpoint
UPDATE "agents" SET "account_status" = 'actif';--> statement-breakpoint
CREATE TABLE "agent_cge_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_role" text NOT NULL,
	"version" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_cge_versions_agent_role" CHECK ("agent_cge_versions"."agent_role" IN ('screenhost_agent', 'screencast_agent'))
);
--> statement-breakpoint
CREATE TABLE "agent_cge_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"cge_version_id" uuid NOT NULL,
	"ip" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_rib_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "agent_rib_status" DEFAULT 'en_attente' NOT NULL,
	"refusal_reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_cge_versions" ADD CONSTRAINT "agent_cge_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cge_acceptances" ADD CONSTRAINT "agent_cge_acceptances_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cge_acceptances" ADD CONSTRAINT "agent_cge_acceptances_cge_version_id_agent_cge_versions_id_fk" FOREIGN KEY ("cge_version_id") REFERENCES "public"."agent_cge_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_rib_submissions" ADD CONSTRAINT "agent_rib_submissions_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_rib_submissions" ADD CONSTRAINT "agent_rib_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_cge_versions_role_version_uq" ON "agent_cge_versions" USING btree ("agent_role","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_cge_acceptances_agent_version_uq" ON "agent_cge_acceptances" USING btree ("agent_user_id","cge_version_id");--> statement-breakpoint
CREATE INDEX "agent_rib_submissions_agent_idx" ON "agent_rib_submissions" USING btree ("agent_user_id","submitted_at");
