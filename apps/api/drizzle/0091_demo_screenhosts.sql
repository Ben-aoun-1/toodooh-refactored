-- DEMO-2 — demo screenhosts (operator 2026-10-13, rulings A A): venues created by the admin for
-- demo screencasters only — no owner, no screen, a random audience grid. Every non-demo reader
-- skips them (lib/demo.ts).
ALTER TABLE "screenhosts" ADD COLUMN "demo_only" boolean DEFAULT false NOT NULL;
