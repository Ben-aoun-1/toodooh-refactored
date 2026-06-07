CREATE TABLE "agent_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"agent_code_used" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_referrals_referred_user_id_unique" UNIQUE("referred_user_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "agent_referrals" ADD CONSTRAINT "agent_referrals_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_referrals" ADD CONSTRAINT "agent_referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_referrals_agent_user_id_idx" ON "agent_referrals" USING btree ("agent_user_id");--> statement-breakpoint
-- Hand-appended backfill (same convention as 0003's seeds): issue a code for every
-- pre-existing agent user so no agent lacks one. Deterministic per-id value (hex,
-- 8 chars) — distinct from runtime codes, which use the unambiguous alphabet in
-- lib/agent-code.ts. ON CONFLICT DO NOTHING keeps this idempotent if re-applied.
-- role is compared as ::text (not the enum literal): the screenhost_agent/
-- screencast_agent values were added in 0007 via ALTER TYPE ADD VALUE, and on a
-- fresh 0000→0010 apply they are not yet committed when this runs, so referencing
-- them as the enum type trips Postgres' check_safe_enum_use. The text cast sidesteps
-- that and is equivalent on an already-migrated prod DB.
INSERT INTO "agents" ("user_id", "code")
SELECT "id", upper(substr(md5("id"::text), 1, 8))
FROM "users"
WHERE "role"::text IN ('screenhost_agent', 'screencast_agent')
ON CONFLICT ("user_id") DO NOTHING;