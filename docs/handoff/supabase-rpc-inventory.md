# Supabase RPC inventory (extract the SQL before Phase 1)

`supabase.rpc('<name>')` calls invoke a Postgres function that lives **only in the Supabase
project's database**, not in this repo. Before the Phase 1 backend migration (off Supabase onto
self-hosted Postgres), the SQL definition of each must be exported from the live DB (`pg_dump`
the function, or copy it from the Supabase dashboard's SQL editor) and committed somewhere under
`infra/` so the logic isn't lost when the project leaves Supabase.

This started as the Step-4 DOOH discovery; extend it whenever a new `supabase.rpc(...)` surfaces
(`grep -rn "\.rpc(" apps/web/src` to refresh).

## Known RPCs

| Function | Called from | What it appears to do | SQL extracted? |
|---|---|---|---|
| `update_expired_campaigns` | `apps/web/src/services/campaign.service.ts` (≈ line 1116) | bulk-transitions campaigns whose end date has passed to a terminal status (`completed`?) — server-side housekeeping, not part of the pricing path | ☐ — needs export from the live DB |

## Notes

- This is the only `supabase.rpc(...)` found during the Step-4 DOOH work. A repo-wide sweep for
  other RPCs (and for Postgres functions referenced by RLS policies / triggers, which are even
  less visible from the frontend) should be part of Phase 1's "what does the DB do that the
  frontend can't see" inventory — see also `docs/handoff/02-migration-notes.md`.
