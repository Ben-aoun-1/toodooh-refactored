ALTER TABLE "creatives" ADD COLUMN "file_hash" text;--> statement-breakpoint
CREATE INDEX "creatives_advertiser_file_hash_idx" ON "creatives" USING btree ("advertiser_id","file_hash");