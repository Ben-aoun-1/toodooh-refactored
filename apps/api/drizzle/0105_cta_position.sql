-- Mariem 04/11/2026 (Foot point 1, operator ruling 2A) — where the spot's QR card sits: one of
-- the four corners, chosen by the advertiser and changeable by the admin at the spot's
-- validation (the logo's place varies from spot to spot). NULL = bottom-left, the card's
-- historical place (QR-CTA2).
ALTER TABLE "campaigns" ADD COLUMN "cta_position" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cta_position_valid" CHECK ("cta_position" IS NULL OR "cta_position" IN ('bottom_left', 'bottom_right', 'top_left', 'top_right'));
