CREATE TABLE "device_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"device_type" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_sessions_access_token_hash_uq" ON "device_sessions" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "device_sessions_refresh_token_hash_uq" ON "device_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "device_sessions_user_id_idx" ON "device_sessions" USING btree ("user_id");