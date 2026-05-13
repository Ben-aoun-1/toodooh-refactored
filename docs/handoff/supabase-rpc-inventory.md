# Supabase RPC inventory (extract the SQL before Phase 1)

`supabase.rpc('<name>')` calls invoke a Postgres function that lives **only in the Supabase
project's database**, not in this repo. Before the Phase 1 backend migration (off Supabase onto
self-hosted Postgres), the SQL definition of each must be exported from the live DB (`pg_dump`
the function, or copy it from the Supabase dashboard's SQL editor) and committed somewhere under
`infra/` so the logic isn't lost when the project leaves Supabase.

This started as the Step-4 DOOH discovery (just `update_expired_campaigns`). The list below is
now the **complete inventory** based on a repo-wide sweep (`grep -rn "\.rpc(" apps/web/src`). It
covers every `supabase.rpc(...)` reachable from the frontend; RPCs that exist only inside RLS
policies / triggers and never surface to the frontend will need a separate "what runs in the DB"
audit (see `docs/handoff/02-migration-notes.md`). Refresh with the same grep whenever a new RPC
lands. Extraction status is **pending** for everything — we do not currently have service-role
access to dump the live DB.

## Known RPCs

| Function | First call site | What it appears to do | SQL extracted? |
|---|---|---|---|
| `update_expired_campaigns` | `services/campaign.service.ts:1115` | bulk-transitions campaigns whose end date has passed to a terminal status — server-side housekeeping, not on the pricing path | ☐ pending |
| `get_user_balance` | `services/balance.service.ts:28` | returns the wallet balance for a given user (also used by `admin-recharges.service.ts:247`) | ☐ pending |
| `check_campaign_balance` | `services/balance.service.ts:119` | server-side check that a user's wallet has enough TND to launch a campaign | ☐ pending |
| `calculate_campaign_cost` | `services/balance.service.ts:157` | server-side cost computation for a campaign (legacy pricing model — pre-v3.0) | ☐ pending |
| `create_business_profile` | `services/auth.service.ts:656` | creates the `business_profiles` row at signup (atomic with auth-user creation) | ☐ pending |
| `check_signup_conflicts_secure` | `services/auth.service.ts:212` | pre-signup check for duplicate email / phone against existing business_profiles | ☐ pending |
| `validate_signup_profile_type` | `services/auth.service.ts:332` | pre-signup allow-list check for `profile_type` against the DB enum / check constraint (the caller tolerates a `PGRST202` "function does not exist" for backwards-compat) | ☐ pending |
| `get_user_invoices_with_monthly` | `pages/MyInvoices.tsx:32` | returns a user's invoices list together with monthly aggregates | ☐ pending |
| `check_unavailability_status` | `services/screens.service.ts:528` | server-side sync of screen unavailability/maintenance status | ☐ pending |
| `link_campaign_to_event` | `pages/NewCampaign.tsx:3648` | links an event-campaign to its `special_events` row at creation | ☐ pending |
| `get_featured_events` | `services/events.service.ts:10` | returns the curated list of featured upcoming events | ☐ pending |
| `get_all_events` | `services/events.service.ts:29` | paginated list of all events (parallel with `get_all_events_count`) | ☐ pending |
| `get_all_events_count` | `services/events.service.ts:30` | total event count for the `get_all_events` pagination | ☐ pending |
| `get_my_event_campaigns_events` | `services/events.service.ts:47` | returns the events backing the current user's event-campaigns | ☐ pending |
| `get_my_event_campaign_links` | `services/events.service.ts:67` | returns the campaign↔event link rows for the current user | ☐ pending |
| `get_campaigns_using_video` | `services/admin-video.service.ts:83` | lists campaigns that reference a given video (admin video-management view) | ☐ pending |
| `get_video_validation_stats` | `services/admin-video.service.ts:469` | admin stats for video validation queue | ☐ pending |
| `get_events_stats` | `services/admin-events.service.ts:172` | admin stats on the events table | ☐ pending |
| `get_campaigns_global_stats` | `services/admin-campaign-monitoring.service.ts:21` | global campaign stats for the admin monitoring view | ☐ pending |
| `get_campaigns_with_screens` | `services/admin-campaign-monitoring.service.ts:84` | campaigns joined with their screens (admin monitoring) | ☐ pending |
| `get_campaigns_by_status` | `services/admin-campaign-monitoring.service.ts:194` | admin: campaigns filtered by status | ☐ pending |
| `get_campaigns_by_category` | `services/admin-campaign-monitoring.service.ts:224` | admin: campaigns grouped by category | ☐ pending |
| `get_top_advertisers` | `services/admin-campaign-monitoring.service.ts:267` | admin: top advertisers ranked by some campaign metric (limit param) | ☐ pending |
| `get_most_used_screens` | `services/admin-campaign-monitoring.service.ts:288` | admin: most-used screens across campaigns | ☐ pending |
| `get_platform_global_stats` | `services/platform-stats.service.ts:19` | platform-wide global stats (admin dashboard) | ☐ pending |
| `get_platform_revenue_stats` | `services/platform-stats.service.ts:91` | platform-wide revenue summary | ☐ pending |
| `get_screens_occupancy_rate` | `services/platform-stats.service.ts:139` | platform-wide screen occupancy rate | ☐ pending |
| `get_campaigns_performance` | `services/platform-stats.service.ts:179` | platform-wide campaign performance summary | ☐ pending |
| `get_top_performing_screens` | `services/platform-stats.service.ts:233` | platform-wide top-performing screens (limit param) | ☐ pending |
| `get_recent_platform_activity` | `services/platform-stats.service.ts:294` | recent platform activity feed (limit param) | ☐ pending |

## Notes

- The inventory above is the **complete frontend-reachable RPC set** as of this commit. It
  covers admin-side stats / monitoring, balance / pricing, auth / signup, events, video, and
  housekeeping. Any new `.rpc(...)` call surfaced after this commit must be appended here.
- RPCs that exist **only** inside RLS policies, triggers, or other DB-internal contexts will not
  appear in this grep and need a separate sweep against the live DB before Phase 1 — see
  `docs/handoff/02-migration-notes.md` for the broader "what does the DB do that the frontend
  can't see" agenda.
- A few of these are pricing-adjacent (`calculate_campaign_cost`, `check_campaign_balance`,
  `get_user_balance`) and intersect with the v3.0 wiring constraints documented in
  `docs/handoff/v3-data-requirements.md` "Wiring constraints (Phase 1)" — extracting their SQL
  early helps validate that the Phase 1 backend matches today's debit semantics.
