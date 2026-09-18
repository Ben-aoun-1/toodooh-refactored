-- CPM-3 (operator rulings 2026-09-18) — THE CPM BELONGS TO THE SCREENCASTER.
--
-- Until now the CPM was one global pair (dispatch_config) copied onto every campaign at INSERT
-- (0074). From here each screencaster (advertiser) has its OWN pair, set by an admin on
-- /admin-dispatch-config (PATCH /api/admin/screencasters/cpm), and:
--   • a DRAFT follows its screencaster: the admin change re-prices the screencaster's drafts in
--     the same transaction (lib/screencaster-cpm.ts), in the cart or not, event positionings too;
--   • a campaign CREATED after the change (the wizard, a positioning, a replay of a completed
--     campaign) captures the new CPM — the trigger below;
--   • pending, rejected, upcoming, active, completed keep the CPM they carry, and a boost keeps
--     the campaign's CPM (it prices at the frozen plan.cpm). Nothing here touches them.
-- The global dispatch_config CPM becomes the DEFAULT a new account starts at (the column default
-- below calls the 0074 functions); changing it never touches an existing screencaster.
--
-- Q1 (ruled): existing drafts are NOT re-priced here. The drafts CPM-1 restored to 15 on
-- 2026-09-17 keep 15 until their screencaster's first change on the new page.
--
-- WHY A TRIGGER (approach A, ruled). The CPM a campaign captures now depends on ANOTHER row (its
-- advertiser), which a column default cannot read. A BEFORE INSERT trigger can, and like 0074's
-- default it covers every insert path — routes, the simulator world writer, every test fixture —
-- with no per-site code. An explicit value still wins (COALESCE). NOT NULL is checked after
-- BEFORE triggers, so a campaign can never exist without a CPM.
ALTER TABLE "users" ADD COLUMN "cpm_standard_tnd" numeric(10, 3) DEFAULT public.current_standard_cpm_tnd() NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cpm_event_tnd" numeric(10, 3) DEFAULT public.current_event_cpm_tnd() NOT NULL;
--> statement-breakpoint
CREATE TABLE "screencaster_cpm_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict,
  "changed_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict,
  "old_standard_cpm_tnd" numeric(10, 3) NOT NULL,
  "new_standard_cpm_tnd" numeric(10, 3) NOT NULL,
  "old_event_cpm_tnd" numeric(10, 3) NOT NULL,
  "new_event_cpm_tnd" numeric(10, 3) NOT NULL,
  "drafts_repriced" integer NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "screencaster_cpm_changes_user_id_idx" ON "screencaster_cpm_changes" USING btree ("user_id", "changed_at");
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "standard_cpm_tnd" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "event_cpm_tnd" DROP DEFAULT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.campaigns_capture_screencaster_cpm() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    own_standard numeric(10, 3);
    own_event numeric(10, 3);
  BEGIN
    SELECT u.cpm_standard_tnd, u.cpm_event_tnd INTO own_standard, own_event
      FROM public.users u WHERE u.id = NEW.advertiser_id;
    NEW.standard_cpm_tnd := COALESCE(NEW.standard_cpm_tnd, own_standard, public.current_standard_cpm_tnd());
    NEW.event_cpm_tnd := COALESCE(NEW.event_cpm_tnd, own_event, public.current_event_cpm_tnd());
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER "campaigns_capture_screencaster_cpm" BEFORE INSERT ON "public"."campaigns"
  FOR EACH ROW EXECUTE FUNCTION public.campaigns_capture_screencaster_cpm();
