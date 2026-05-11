# Migration Source Inventory & Hostage Status

This document tracks **every artifact** related to TOODOOH that I've discovered on disk, on remote infrastructure, or in the previous developer's control. It distinguishes what's mine, what's contested, and what's missing. Update this doc whenever new artifacts surface.

The hostage framing is intentional. The previous developer is hostile; treating each artifact as either "controlled by me" or "controlled by them" makes the operational risk visible.

---

## 1. Frontend application

| Item | Location | Control | Status |
|---|---|---|---|
| Current platform frontend (React/Vite/TS) | `~/Desktop/toodooh-web/` (local) | ✅ Mine | Read-only source; imported into `apps/web/` of new monorepo |
| Public mirror of same | `github.com/toodooh-source/toodooh` | ✅ Mine | 4 commits in 36 minutes — original dev used zips as version control; no real history. Public; benign. |
| Historical snapshots inside the source repo | `~/Desktop/toodooh-web/*.zip` (5 zips) | ✅ Mine | `src.zip`, `src1810.zip`, `src22102025.zip`, `src 06122025.zip`, `src_sauv 26092025 sans admin.zip`. Useful for diffing if needed; **not copied into new monorepo**. |
| New monorepo | `~/Desktop/toodooh-platform/` (local) + GitHub (private) | ✅ Mine | Where all work happens. |

**Action items:** none. Frontend source is fully mine.

---

## 2. Backend (Supabase) — the actual hostage

| Item | Location | Control | Status |
|---|---|---|---|
| Live Supabase project | Hosted on Supabase, project ref `kbtwttvpowcrutxvmfue` | ❌ **Theirs** | Anon-key access only. No admin console, no service-role key, no project-owner login. |
| Anon key | In `apps/web/.env` (not committed) | ✅ Mine (but rotatable by them) | Functional. They can rotate it the moment they realize I'm migrating. |
| Schema (migrations) | `~/Desktop/toodooh-web/supabase/migrations/` — 75 files | ✅ Mine (file copy) | Local copy. **Does not match live DB** — see below. |
| Critical root-level SQL not in migrations | `~/Desktop/toodooh-web/*.sql` — ~10 files | ✅ Mine (file copy) | Includes `admin_database_queries.sql` (which defines `admin_profiles`!), `create_balance_system.sql`, `create_recharges_table.sql`, `create_platform_stats_functions.sql`, `configure_media_bucket_policies.sql`. **`supabase db reset` will NOT reproduce prod.** |
| `auth.users` data + business_profiles + admin_profiles | Live Supabase only | ❌ **Theirs** | Reachable via anon key + RLS for own row; full table requires admin. **Password hashes are not extractable.** |
| All other table data (screens, locations, campaigns, recharges, videos, etc.) | Live Supabase | ⚠️ Partial | Anon key + RLS allows reading my own rows; broader extraction depends on what RLS permits per table. **NOT YET EXTRACTED.** |
| Storage buckets: `campaign-videos`, `event-images`, `business-logos`, etc. | Live Supabase storage | ⚠️ Partial | `event-images` is fully public (security hole). Signed URLs may be retrievable via anon. **NOT YET EXTRACTED.** |
| `SECURITY DEFINER` RPC definitions | Inferable from frontend `.rpc()` calls + the root SQL files | ⚠️ Partial | Some are in `create_platform_stats_functions.sql` (file we have); others may exist only in the live DB. Need to enumerate via `pg_proc` if possible. |

**Open holes in the live backend** (cannot fix without admin access; fixed automatically by Phase 1 cutover):
- `create_business_profile(p_is_admin BOOLEAN)` — anyone signing up can self-promote to admin
- `business_profiles` UPDATE policy lacks column whitelist — users can set their own `is_admin = true`
- `event-images` bucket is fully public on INSERT
- Password reset redirect allowlist on Supabase still includes `itstrategix.tn` (the code-side fix in commit `854f112` doesn't reach this)

### Critical unfinished task — data extraction (Phase 0, blocking)

**This was identified as Phase 0 of the migration and has NOT been executed.** Until it is, the migration is one access-revocation away from data loss.

What needs to happen, in order, while access still works:

1. **Audit existing admin accounts** for unauthorized promotions via the `p_is_admin` hole. Query for `is_admin = true` rows and validate provenance against known team members.
2. **Pull every row from every readable table** via the anon key + RLS. Write a paginating script. Save dumps as JSON or CSV, stored in a location TOODOOH owns (not in the same GitHub org as the public mirror).
3. **Pull every storage object** I have access to — `campaign-videos`, `event-images`, anything else readable. Iterate the relevant DB tables for object keys, fetch each.
4. **Pull schema introspection** I can read — `information_schema`, `pg_catalog`, function bodies via `pg_proc` if not restricted. Cross-reference against the local migration files to find drift.
5. **Pull user emails** (without hashes — hashes require service_role). On cutover every user will need to reset their password; I at least need the email list.
6. **Run extraction daily** until cutover. The dataset isn't static.

**None of this is done yet.** Should happen before Phase 1 (backend build) starts, not during it.

---

## 3. Android TV Player APK

| Item | Location | Control | Status |
|---|---|---|---|
| Compiled `.apk` binary | `~/Desktop/code hebergement 090526/www/apk/toodooh.apk` (~83 MB) | ✅ Mine (file copy) | Publicly downloadable from the OVH host. Works. |
| **APK source code (Kotlin/Java/Android Studio project)** | **Unknown** | ❓ **Possibly theirs** | I said "I have everything" but the previous assistant explicitly asked if I have the APK source separate from the binary. **Not yet answered.** |
| Google Play Store developer account | Google Play Console | ❓ Likely **theirs** | If the APK was published, it's under whoever's developer account. Probably the previous developer. |
| APK's network/auth configuration | Inside the compiled binary | ⚠️ Reverse-engineerable | If source is gone, decompiling for the Supabase URL/key and the endpoint list is doable but unpleasant. |

**Action items:**
1. **Confirm whether the APK source exists in my possession.** If yes: where? If no: budget for a full APK rewrite against the new `player-api` contract.
2. **Verify control of the Play Store account.** If the previous developer owns it, that's another piece to extract (or, more likely, abandon — TOODOOH can publish a new APK under a new account, and the old one becomes unmaintained).

---

## 4. Hosting / infrastructure

| Item | Location | Control | Status |
|---|---|---|---|
| OVH hosting account | OVH | ❓ Unknown | Snapshot exists at `~/Desktop/code hebergement 090526/`. Account ownership unconfirmed. |
| Hosting snapshot (filesystem) | `~/Desktop/code hebergement 090526/` (~153 MB) | ✅ Mine (file copy) | Contains: deployed web app build (`www/app/`), marketing landing site (`www/index.html`), the APK, IQOS microsite (unrelated), legal PDFs, `.htaccess` + `.ovhconfig`, old deploy backups (`OLD*` dirs — 85%+ of the size, noise). |
| `.htaccess` SPA fallback config | Inside hosting snapshot | ✅ Mine (file copy) | Trivial — `RewriteRule . /index.html [L]`. Becomes `try_files $uri /index.html` in nginx. **Will be reconstructed in Phase 1**, not copied. |
| Production domain (`toodooh.tn` or whatever) | DNS registrar | ❓ Unknown | If the previous developer registered it or has admin access, that's another hostage point. **Check before going public with the migration.** |
| Email / Google Workspace | Unknown | ❓ Unknown | Auth email From-address goes through *something*. If it's `noreply@itstrategix.tn`, that's the previous developer's domain. Check Supabase Auth settings (if I can see them via anon — probably not). |
| `itstrategix.tn` domain | Owned by the previous developer | ❌ **Theirs** | Hardcoded in `auth.service.ts` as the password-reset redirect. **Already fixed in code** (commit `854f112` replaces with env-driven `getAppUrl()`). Supabase-side allowlist still references it — see section 2. |

**Action items:**
1. **Confirm who owns the production domain.** This is the single highest-leverage piece of infrastructure to verify control of.
2. **Confirm OVH account ownership.** If it's the previous developer's account, lock down the hosting migration to a new provider (Hetzner is the planned target).
3. **Confirm email/SMTP origin.** Any "From: noreply@itstrategix.tn" in transactional emails is a problem.

---

## 5. Marketing landing site

| Item | Location | Control | Status |
|---|---|---|---|
| Compiled landing site build | `~/Desktop/code hebergement 090526/www/index.html` + `www/assets/` | ✅ Mine (file copy) | Separate small Vite build (~320 KB). "TOODOOH - Simplifiez votre quotidien". |
| Landing site source code | **Unknown** | ❓ **Possibly theirs** | Not in `toodooh-web/`. Not anywhere I've located. Could be on the previous developer's machine, on Bolt.new, on an old laptop, or actually gone. |

**Action items:**
1. **Locate the landing site source.** Check Bolt.new history, GitHub orgs I haven't explored, old machines.
2. **If unrecoverable:** the build is technically reverse-engineerable (HTML is readable, JS is minified but extractable), but cleaner to just rewrite the marketing site from scratch. Low priority — not blocking platform migration.
3. **Verify whether the landing site auth flow points at the live Supabase project.** If yes, it has the same `itstrategix.tn` redirect issue. If it just links to `/app`, no auth-related risk.

---

## 6. Documentation / project artifacts

| Item | Location | Control | Status |
|---|---|---|---|
| French-language fix notes (95 markdown files) | `~/Desktop/toodooh-web/docs/` | ✅ Mine (file copy) | Files like `AUTHENTICATION_FIX_SUMMARY.md`, `CORRECTION_BUSINESS_PROFILES.md`, `DEBUG_DECONNEXION.md`. **Not copied into the new monorepo** — they document a patch-on-patch culture that we're explicitly walking away from. Useful as historical reference only. |
| Original audit document | `01-initial-audit.md` in this handoff folder | ✅ Mine | The audit I wrote and pasted into the previous conversation, before any cleanup work started. Verbatim. |
| Previous-developer `CLAUDE.md` | `~/Desktop/toodooh-web/CLAUDE.md` | ✅ Mine | Older copy of an engineering-rules doc. Nothing substantive in it. Not copied into new monorepo. |
| Existing test files (4) | `~/Desktop/toodooh-web/src/services/__tests__/` | ✅ Mine (file copy) | Inside the imported frontend. 22 passing tests + 1 pre-existing import-time failure. The tests cover the DOOH calculation engine — the real IP. |

---

## 7. Unrelated artifacts (excluded from migration)

In the hosting snapshot but not part of TOODOOH:

| Item | Location | Status |
|---|---|---|
| IQOS store-locator microsite | `~/Desktop/code hebergement 090526/www/iqos/` | Excluded — unrelated CRA project |
| Legal PDFs | `~/Desktop/code hebergement 090526/www/*.pdf` | Reference only — `Mentions légales`, `Politique de remboursement`, `Modalités tarifaires`, `annonceur.pdf`, `plateforme.pdf` |
| `OLD*` / dated backup dirs in hosting snapshot | various | Excluded — ~85% of snapshot size; stale deploys, no value |

---

## 8. Hostage extraction sequence (the operational plan)

This isn't the technical migration plan — it's the *order in which control transfers from the previous developer to me*. Each step closes one door.

**Phase -1 — Silence (ongoing).**
- No rotated keys, no public migration announcements, no schema changes, no LinkedIn posts about the new architecture
- Until extraction is complete, the previous developer must not know migration is happening

**Phase 0 — Extract everything (BLOCKING, unstarted).**
- Pull all Supabase data accessible via anon key (see section 2 action items)
- Confirm APK source location (see section 3)
- Confirm domain, OVH, email ownership (see section 4)
- Confirm landing site source location (see section 5)
- This should be done **before any line of backend code is written**, not in parallel with it

**Phase 0.5 — Legal cover.**
- Get a lawyer to send a formal handover-demand letter to the previous developer
- Letter requests: Supabase project ownership, all source code (including APK), domain registrar access, email/DNS, Play Store account, any third-party accounts created on TOODOOH's behalf
- Whether or not the developer complies, the letter creates a paper trail
- This protects against post-migration retaliation (data leak, DMCA claims, screen-partner outreach)

**Phase 1 — Build the parallel stack.**
- Set up `apps/api`, `apps/player-api`, Docker Compose infra, MinIO, Better-auth
- Restore extracted Supabase data into the new Postgres
- Rebuild SECURITY DEFINER RPCs as Node middleware
- Collapse dual identity model (`auth.users` + `admin_profiles` siblings → one `users` table with role enum)
- Nothing user-facing yet; shadow infrastructure only

**Phase 2 — Cut the APK over first.**
- Update APK config to point at `player-api`
- Roll out to one screen, watch for 48 hours, expand
- Lowest-risk piece to migrate (small fixed number of devices, manual update possible)
- The previous developer expects to see web traffic shifts first if they're watching; player traffic is the least obvious

**Phase 3 — Cut the web app over.**
- Update DNS to point at the new stack (assumes I control the domain — see section 4)
- Send global email 48 hours prior: "We're upgrading our authentication system, you'll be asked to reset your password on next login"
- Force password reset on first login post-cutover (we cannot transfer Supabase password hashes without service-role)
- Most users won't read the email but it provides cover

**Phase 4 — Lock down.**
- New keys, new tokens, revoke everything from the old system
- Change all email From-addresses off any previous-developer-controlled domain
- Update apex domain MX records if email was on their infrastructure
- New private GitHub org if anything is currently shared

**Phase 5 — Public.**
- LinkedIn announcement, customer comms, the works
- By this point migration is irreversible

---

## 9. Update log

Whenever a new artifact surfaces or a status changes, append an entry. This is the long-term record.

- **(date of next update)** — first update entry goes here

---

End of migration notes.
