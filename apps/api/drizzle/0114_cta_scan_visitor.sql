-- QR-SCAN1 (operator 16/11, rulings A A A) — « personnes uniques » on the QR scans. A scan keeps
-- an opaque per-day visitor key: HMAC(AUTH_SECRET, Tunis day | IP | browser), never the IP itself.
-- It changes every day, so a person is counted once per day and cannot be followed across days.
-- Rows scanned before this migration have none (each counts as one person).
ALTER TABLE "cta_scans" ADD COLUMN "visitor_hash" text;
