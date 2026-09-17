-- CPM-1 (user rule, 2026-09-17). An admin CPM change (PATCH /api/admin/dispatch-config,
-- standard_cpm_tnd / event_cpm_tnd) applies ONLY to campaigns created from that moment on. Every
-- campaign that already exists — draft, pending, in the cart, upcoming, active, completed, event
-- positioning — keeps the CPM in effect WHEN IT WAS CREATED, even if a draft is edited afterwards.
-- A replay (« Rejouer ») is a NEW campaign and takes the CPM in effect at replay time.
--
-- BOTH rates are snapshotted because a draft's campaign_type is still editable: the row prices at
-- event_cpm_tnd when its type is 'event', else at standard_cpm_tnd (lib/dispatch/config.ts).
--
-- WHY A FUNCTION DEFAULT. A column default that calls a function is evaluated at INSERT time, so
-- every insert path — the advertiser create, the replay, the event positioning, the simulator
-- sandboxes (migrated with these same files) and every test fixture — captures the CPM in effect
-- at creation with no per-site code, and none of them can forget it. The functions read the
-- dispatch_config singleton exactly as getDispatchConfig does (the one row, LIMIT 1) and fall back
-- to DISPATCH_CONFIG_DEFAULTS (lib/dispatch/thresholds.ts: 15 / 15) when no row exists. STABLE: one
-- read per statement. The table is schema-qualified so a search_path change cannot redirect them.
--
-- THE BACKFILL (the history that exists):
--   1. every row ← today's config (a draft or pending campaign has no CPM history in the
--      database — see the restore-script note below);
--   2. a classic campaign WITH a frozen plan ← plan.cpm, the CPM its activation actually priced
--      at, on the rate its type priced at ('event' type → event_cpm_tnd, else standard_cpm_tnd);
--   3. an event positioning WITH allocations ← the plain ratio round(Σ montant × 1000 ÷
--      Σ impressions_total, 3) over its allocation rows (operator ruling 2B, 2026-09-17), when that
--      Σ is > 0; otherwise it keeps today's config. The fill charges montant = chargeable × CPM and
--      the last bloc's overshoot is free, so an overshooting positioning reads slightly below the
--      CPM it was dispatched at — accepted: prod's two positionings both read exactly 15.000.
--
-- Classic campaigns without a plan that were created under an EARLIER config are NOT re-dated
-- here (no CPM history exists in the database): scripts/cpm1-restore-creation-cpm.ts applies the
-- operator-confirmed rate to them after this migration (ruling 1A, dry-run by default).
CREATE OR REPLACE FUNCTION public.current_standard_cpm_tnd() RETURNS numeric(10, 3)
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      (SELECT "standard_cpm_tnd" FROM "public"."dispatch_config" LIMIT 1),
      15.000
    )::numeric(10, 3)
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_event_cpm_tnd() RETURNS numeric(10, 3)
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      (SELECT "event_cpm_tnd" FROM "public"."dispatch_config" LIMIT 1),
      15.000
    )::numeric(10, 3)
  $$;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "standard_cpm_tnd" numeric(10, 3);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "event_cpm_tnd" numeric(10, 3);
--> statement-breakpoint
UPDATE "campaigns"
SET "standard_cpm_tnd" = public.current_standard_cpm_tnd(),
    "event_cpm_tnd" = public.current_event_cpm_tnd();
--> statement-breakpoint
UPDATE "campaigns" AS c
SET "standard_cpm_tnd" = CASE WHEN c."campaign_type" = 'event' THEN c."standard_cpm_tnd" ELSE p."cpm" END,
    "event_cpm_tnd" = CASE WHEN c."campaign_type" = 'event' THEN p."cpm" ELSE c."event_cpm_tnd" END
FROM "campaign_dispatch_plan" AS p
WHERE p."campaign_id" = c."id" AND c."event_id" IS NULL;
--> statement-breakpoint
UPDATE "campaigns" AS c
SET "event_cpm_tnd" = p."ratio"
FROM (
  SELECT
    ea."campaign_id",
    round(sum(ea."montant_tnd") * 1000 / sum(ea."impressions_total"), 3) AS "ratio"
  FROM "event_allocations" AS ea
  GROUP BY ea."campaign_id"
  HAVING sum(ea."impressions_total") > 0
) AS p
WHERE p."campaign_id" = c."id" AND c."event_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "standard_cpm_tnd" SET DEFAULT public.current_standard_cpm_tnd();
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "event_cpm_tnd" SET DEFAULT public.current_event_cpm_tnd();
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "standard_cpm_tnd" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "event_cpm_tnd" SET NOT NULL;
