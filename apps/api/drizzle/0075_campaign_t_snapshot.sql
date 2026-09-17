-- CPM-2 (operator ruling 4A, 2026-09-17). The attention index T is frozen per campaign at
-- CREATION, exactly like CPM-1 froze the CPM (0074). An admin T change (PATCH
-- /api/admin/dispatch-config, t_10s / t_20s / t_30s) applies ONLY to campaigns created from that
-- moment on. Every campaign that already exists — draft, pending, in the cart, upcoming, active,
-- completed, event positioning — keeps the T tiers in effect WHEN IT WAS CREATED, even if a draft
-- is edited afterwards. A replay (« Rejouer ») is a NEW campaign and takes the T in effect then.
--
-- ALL THREE tiers are snapshotted because a draft's spot (and so its duration S) is still
-- editable: the row prices at tForDuration(S, its own tiers) (lib/dispatch/config.ts
-- campaignTTiers). numeric(4,3) — the precision of campaign_dispatch_plan.t_tier_coef — so a
-- plan's frozen T is kept exactly.
--
-- WHY A FUNCTION DEFAULT. A column default that calls a function is evaluated at INSERT time, so
-- every insert path — the advertiser create, the replay, the event positioning, the simulator
-- sandboxes (migrated with these same files) and every test fixture — captures the T in effect at
-- creation with no per-site code, and none of them can forget it. The functions read the
-- dispatch_config singleton exactly as getDispatchConfig does (the one row, LIMIT 1) and fall back
-- to DISPATCH_CONFIG_DEFAULTS (lib/dispatch/thresholds.ts: 0.60 / 0.70 / 0.80) when no row exists.
-- STABLE: one read per statement. The table is schema-qualified so a search_path change cannot
-- redirect them.
--
-- THE BACKFILL (the history that exists):
--   1. every row ← today's config (the database holds no T history);
--   2. a campaign WITH a frozen plan ← plan.t_tier_coef, the T its activation actually used, on
--      the ONE tier its plan's s_spot_seconds falls in (S ≤ 10 → t_10s, S ≤ 20 → t_20s, else
--      t_30s — tForDuration's buckets); its other two tiers keep today's config. Event
--      positionings never have a plan and keep today's config.
-- Production needs no restore script: at this deploy prod's config is 0.60 / 0.70 / 0.80 and every
-- prod plan's t_tier_coef equals the config tier for its S.
--
-- F (f_max_seconds) stays LIVE (out of scope by ruling): only T is frozen here.
CREATE OR REPLACE FUNCTION public.current_t_10s() RETURNS numeric(4, 3)
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      (SELECT "t_10s" FROM "public"."dispatch_config" LIMIT 1),
      0.600
    )::numeric(4, 3)
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_t_20s() RETURNS numeric(4, 3)
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      (SELECT "t_20s" FROM "public"."dispatch_config" LIMIT 1),
      0.700
    )::numeric(4, 3)
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_t_30s() RETURNS numeric(4, 3)
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      (SELECT "t_30s" FROM "public"."dispatch_config" LIMIT 1),
      0.800
    )::numeric(4, 3)
  $$;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "t_10s" numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "t_20s" numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "t_30s" numeric(4, 3);
--> statement-breakpoint
UPDATE "campaigns"
SET "t_10s" = public.current_t_10s(),
    "t_20s" = public.current_t_20s(),
    "t_30s" = public.current_t_30s();
--> statement-breakpoint
UPDATE "campaigns" AS c
SET "t_10s" = CASE WHEN p."s_spot_seconds" <= 10 THEN p."t_tier_coef" ELSE c."t_10s" END,
    "t_20s" = CASE
      WHEN p."s_spot_seconds" > 10 AND p."s_spot_seconds" <= 20 THEN p."t_tier_coef"
      ELSE c."t_20s"
    END,
    "t_30s" = CASE WHEN p."s_spot_seconds" > 20 THEN p."t_tier_coef" ELSE c."t_30s" END
FROM "campaign_dispatch_plan" AS p
WHERE p."campaign_id" = c."id";
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "t_10s" SET DEFAULT public.current_t_10s();
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "t_20s" SET DEFAULT public.current_t_20s();
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "t_30s" SET DEFAULT public.current_t_30s();
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "t_10s" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "t_20s" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "t_30s" SET NOT NULL;
