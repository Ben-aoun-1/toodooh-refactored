-- OPS-FULL1 (operator 22/11) — a positioning the operator counts as FULLY AIRED for its
-- Screencaster (lib/delivery-override.ts): the settlement line is moved to the full booked value
-- and this column carries what the proofs cannot say (plays, hours, an uploaded report) plus the
-- settlement figures it replaced, so the real result can be restored. NULL = the real result.
-- The Screenhost side (payouts, reversements, proofs, reliability score) is never touched.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "delivery_override" jsonb;
