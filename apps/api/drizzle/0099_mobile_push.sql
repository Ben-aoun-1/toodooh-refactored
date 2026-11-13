-- MOBILE-1 — the screenhost phone app (toodooh-mobile). A phone's Expo push token rides its own
-- device session (cleared on logout; unique, so a reinstalled/reassigned phone never receives
-- another account's pushes), and the push outbox stamps each notification it handled. Existing
-- notifications are stamped now so the outbox never replays history to a newly registered phone.
ALTER TABLE "device_sessions" ADD COLUMN "push_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "device_sessions_push_token_uq" ON "device_sessions" USING btree ("push_token");--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "notifications" SET "pushed_at" = "created_at";
