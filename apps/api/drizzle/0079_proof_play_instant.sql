-- PROOF-R1 (operator rulings 2026-09-24: R1 A, K1 A, K2 A) — PROOFS SURVIVE THE TV GOING OFFLINE.
--
-- The TV player dropped every proof it emitted while its socket was down (toodooh-streamer
-- ScreenWebSocketClient.send: « Tentative d'envoi sans connexion » → false), so every play aired
-- offline was unpaid to the owner and refunded to the advertiser. The player now keeps an outbox and
-- replays on reconnect; the server must (1) count a replayed proof ONCE and (2) credit it to the hour
-- it was PLAYED, not the hour it arrived.
--
-- play_id — the player's id for one play (uuid). A resend after a lost ack carries the same id, so
-- (screen, play_id, event) is unique; legacy players send none (NULL — never deduplicated, as before).
ALTER TABLE "proof_of_play" ADD COLUMN "play_id" uuid;
--> statement-breakpoint
-- played_at — the PLAY INSTANT: the player's timestamp when it falls within
-- [received_at − 24 h, received_at + 2 min] (lib/playout/proof-instant.ts), else received_at.
-- NULLABLE on purpose: legacy rows keep NULL and every reader buckets on
-- coalesce(played_at, received_at) (proofInstantSql) — their meaning is byte-unchanged, no backfill.
ALTER TABLE "proof_of_play" ADD COLUMN "played_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "proof_of_play_screen_play_event_uq" ON "proof_of_play" USING btree ("screen_id","play_id","event_type") WHERE "play_id" IS NOT NULL;
