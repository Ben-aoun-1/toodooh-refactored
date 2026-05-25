# Phase 1e (Part A) — Commit 2: signup-grows

**Date:** 2026-05-25 · **Phase:** 1e (backend prerequisites) · **Commit:** 2 of Part A
**Branch:** main · **Entry HEAD:** `7a71eb3` (Commit 1) · **Node:** 20.20.2 (PATH prefix)
**Status:** DRAFT — held for architect approval. The §2 inventory surfaces **3 corrections to the
pre-disposed list** (wifi, agent naming, contact_name wire) + a terms-shape recommendation — all need
ratification before code (CF-22).

Goal: expand `POST /api/signup` to accept the full wizard profile, add the new columns, map
`profile_type→role(+business_type)`, and make `tax_number` optional — unblocking the Phase-1f wizard
repoint. Backend-only; real-Postgres integration rhythm.

---

## §0 — Pre-flight verification

- Tree clean at `7a71eb3`; Commit 1 CI-green.
- Floor entering: **apps/api 130 / root 290** (typecheck 51 / lint 1 / apps/web build 139.80 kB).
- Latest migration `0005`; this adds `0006`. No new env, no new deps (confirm lockfile untouched).
- Node 20 before any pnpm/git/drizzle.

## §1 — Locked constraints (architect)

- profile_type is a **non-privileged hint** → validated + mapped to role; role/status stay
  `input:false`/server-controlled (CF-24 class-b: validated-and-mapped, never trusted-as-sent).
- Owner-extras: **collect-and-ignore** (`.strip()`), no columns.
- tax_number: required → **optional** (column already nullable since Phase 1c; only the zod changes).
- Anti-enumeration 201-generic + tax_number 409 pre-check **preserved**.
- Two modeling principles for the audit: agent_code = **capture-irreversible-now** (distinct from
  collect-and-ignore); wifi_password = **intentionally-plaintext non-sensitive** (opposite of the
  account password).

## §2 — Inventory & CF-23 verification (THE load-bearing step)

Sources read (CF-23): `apps/web` `types/auth.ts` (`SignUpData` — the submission contract),
`SignUpForm.tsx` (the wizard bindings), `auth.service.ts` `signUp`; `apps/api` `signup.ts` (current),
`auth/auth.ts` (additionalFields), `db/schema.ts` (`users`), better-auth `sign-up.mjs`.

### §2.A — THE DISPOSITION TABLE (every `SignUpData` field)

| Wizard field (FE) | Current signup | Column (users) | Disposition |
|---|---|---|---|
| `email` | accepted | email | STORE (via signUpEmail) |
| `password` | accepted (min 12) | — (accounts) | AUTH (signUpEmail) |
| `business_name` | accepted | business_name | STORE (additionalField) |
| `tax_number` | accepted **required** | tax_number (nullable) | STORE — **required→OPTIONAL** |
| `contact_name` | accepted as **`name`** | contact_name | STORE — **wire rename `name`→`contact_name`** (CF-24 §7.4) |
| `contact_phone` | accepted | contact_phone | STORE (additionalField) |
| `business_sector_id` | **not accepted** | business_sector_id (FK) | **STORE (newly accepted)** |
| `business_type` | **not accepted** | business_type | **STORE** + MAP override (agency) |
| `profile_type` | **not accepted** | — | **MAP → role (+business_type=agency)** |
| `fonction` | not accepted | fonction | **STORE** |
| `street_address`/`city`/`postal_code`/`governorate_id` | not accepted | exist (Phase 1c) | **STORE** |
| `zone` | not accepted | zone | **STORE** |
| `agent_toodooh` | not accepted | **none** | **STORE-NEW → column `agent_code`** (see §2.B-2) |
| `terms_accepted` (bool) | not accepted | **none** | **STORE-NEW → `terms_accepted_at`** (shape §2.B-3) |
| `cin` (raw number) | not accepted | none (only cin_doc_url) | **IGNORE** (no column) |
| `formule` | not accepted | none | IGNORE (owner-extra) |
| `number_of_screens`/`number_of_rooms`/`company_size` | not accepted | none | IGNORE (owner-extras) |
| `fleet_establishments[]` | not accepted | none (locations deferred) | IGNORE (owner-extra) |
| `registration_doc`/`company_logo`/`bank_doc` (File) | n/a | doc-url cols | **N/A** — not in signup JSON; uploaded via `/api/profile/documents/:type` |
| **`wifi_ssid` / `wifi_password`** | n/a | **none** | **NOT IN WIZARD — see §2.B-1 (FLAG)** |

Strip-list (owner-extras + cin + formule): `cin, formule, number_of_screens, number_of_rooms,
company_size, fleet_establishments`. (Zod `.strip()` drops any unknown key anyway; these are the
known-collected-but-unmodeled ones.)

### §2.B — Findings to ratify (CF-22 — corrections to the pre-disposed list)

**1. `wifi_ssid`/`wifi_password` are NOT collected by the wizard.** Zero matches for `wifi`/`ssid` in
`SignUpForm.tsx` / `SignUpData`. The pre-disposed STORE-NEW assumed "the wizard collects venue WiFi"
— it does not, and Phase 1f (repoint of the *existing* wizard) won't add them either. So these columns
would be **null until a future wizard enhancement** (a screenhost/device slice), not Phase 1f.
**Decision needed:** (i) add the nullable columns now anyway (schema-ahead-of-FE, ready for the device
slice) — keep `disableOriginCheck`-style forward-provisioning; or (ii) **defer** wifi to the device/
owner slice that actually collects + consumes it. *Lean: defer — adding columns no producer fills for
several slices is dead schema; the device slice that adds the wizard fields should add its columns.
But it's your call (you may want the schema pinned now).* **If (i): the zod accepts them optional,
owner-only-by-convention, plaintext, with the non-sensitive code comment.**

**2. `agent_code` vs `agent_toodooh` naming.** The wizard field is **`agent_toodooh`** (label "CODE DE
VOTRE SCREENHOST/SCREENCAST AGENT", id `signup-agent-code`; type implied by `isOwner` — matches your
"type implied by role"). *Lean: accept the FE wire name **`agent_toodooh`** in the zod, persist to
column **`agent_code`** (CF-24 class-a — backend conforms to the FE wire name; the column name is
ours).* Confirm, or rename the FE field to `agent_code` in 1f instead.

**3. terms-acceptance shape.** The wizard sends **`terms_accepted: boolean` only** (no version);
legacy set `terms_accepted_at` server-side. *Recommendation: column **`terms_accepted_at
timestamptz NULLABLE`**, server-set to `now()` when `terms_accepted===true` at signup (presence =
accepted; mirrors legacy). No `terms_version` (the wizard captures none; add later only if a
versioning need is defined).* Ratify the shape.

### §2.C — Design: how role/profile get written (CF-23, the safety property)

- `role` is `input:false` → cannot be set via `signUpEmail` input. So mapping `profile_type→role`
  requires a **post-create write**.
- **The account-takeover risk is NOT real (verified in better-auth `sign-up.mjs:160-203`).** On a
  duplicate email with `requireEmailVerification:true`, better-auth returns a **synthetic user with a
  freshly-generated id that is never persisted** (anti-enumeration) — the real existing user is
  untouched. So a post-create `db.update(users).set({...}).where(eq(users.id, result.user.id))`
  **no-ops on duplicates** (synthetic id matches no row) and writes only on real signups. No need to
  distinguish duplicate-vs-real — the where-clause is self-guarding. (Collision of the synthetic id
  with a real id is random-uuid-negligible.)
- **Chosen persistence:** keep `signUpEmail` as-is (email/password + existing additionalFields
  name→contactName / businessName / contactPhone / taxNumber), then **one post-create
  `db.update`** keyed on `result.user.id` writing: `role` (mapped), `businessType` (wizard value, or
  `'agency'` when profile_type=agency), `businessSectorId`, `streetAddress`, `city`, `postalCode`,
  `governorateId`, `fonction`, `zone`, `agentCode`, `termsAcceptedAt` (+ wifi if §2.B-1=(i)). One
  uniform write, uniformly duplicate-safe. *Alternative (additionalFields for the profile cols + a
  role-only post-create update) is more atomic but couples ~10 fields into auth.ts; lean against.*
  **Atomicity note:** the post-create update is a second write after better-auth's sequential
  create+link (already non-atomic, Q4). If it fails: a rare 500 with an account-backed user holding
  default role + empty profile (re-fillable via PATCH /api/profile). Acceptable; documented.

### §2.D — profile_type → role map (inverse of `lib/profile-type.ts`, verified vs source)

Values (from `SignUpData`/`BusinessProfile`): `advertiser | agency | individual_owner | fleet_owner`.
```
advertiser       → role=advertiser
agency           → role=advertiser, business_type=agency   (agency is NOT a role — CF-24 §7.2)
individual_owner → role=individual_owner
fleet_owner      → role=fleet_owner
```
Add `fromProfileType(profile_type) → { role, businessTypeOverride? }` to `lib/profile-type.ts`
(alongside `toProfileType`); reuse the value set. An unknown profile_type → 400 INVALID_INPUT
(zod enum). status stays `pending` (untouched).

### §2.E — tax_number optional + the 409 pre-check
zod: `tax_number` → `.refine(validateTaxNumber).optional()` (accept omitted/empty for owners; the
FE's legacy `TEMP-…` fallback dies in 1f). **The 409 pre-check runs only when tax_number is present**
(`if (tax_number) { …unique-check… }`) — a null tax_number skips it (the nullable UNIQUE column allows
multiple nulls). Pass `taxNumber: tax_number ?? undefined` to signUpEmail.

### §2.F — CF-21 / CF-22
No new env (CF-21 clean). CF-22 watch: §2.B-1/2/3 + the `name`→`contact_name` wire change (ruled
CF-24 §7.4 but it alters the existing signup contract + signup.test — flag, not halt).

## §3 — Commit factoring (single commit)

| File | Change |
|---|---|
| `apps/api/src/db/schema.ts` | + `agentCode`, `termsAcceptedAt` (+ `wifiSsid`,`wifiPassword` if §2.B-1=(i)); modeling comments |
| `apps/api/drizzle/0006_*.sql` | clean ADD COLUMNs (hard-halt if generate emits anything else) |
| `apps/api/src/routes/signup.ts` | grow zod (full field set, contact_name, optional tax, profile_type enum, `.strip()`); profile_type→role map; post-create `db.update`; guarded tax pre-check |
| `apps/api/src/lib/profile-type.ts` | + `fromProfileType` (inverse map) |
| `apps/api/tests/signup.test.ts` | extend (cases in §4) — `name`→`contact_name` in existing payloads |
| `apps/api/tests/db.test.ts` | + assert new columns on the drizzle `users` schema |

## §4 — Per-commit verification gates

- **apps/api typecheck/lint** clean; **build** ok.
- **apps/api tests 130 → ~14x** (deliberate ratchet; §11 locks the count). New cases:
  1. full advertiser signup → 201; role=advertiser, business_type stored, profile cols stored,
     agent_code stored, terms_accepted_at set.
  2. full agency signup → role=advertiser + business_type=agency (the MAP override).
  3. full individual_owner / fleet_owner → role mapped; (wifi stored *iff* §2.B-1=(i)).
  4. owner-extras in body → `.strip()`'d (not stored / no error).
  5. tax_number omitted → 201 (optional); duplicate non-null tax → 409; null tax skips the pre-check.
  6. profile_type across all 4 values → correct role/business_type.
  7. role/status in body → ignored (input:false holds; row has defaults/mapped role, not injected).
  8. anti-enumeration: duplicate email (+ new tax) → 201 generic, exactly one row, **existing user's
     role/profile UNCHANGED** (the synthetic-id no-op — asserts §2.C safety).
  9. terms_accepted=false or omitted → terms_accepted_at null (+ whatever the ratified rule says).
- **Root vs `7a71eb3`:** typecheck 51 / lint 1 / apps/web 160 / build 139.80 — unchanged (backend-only).
- **Live (real Postgres):** migration 0006 applies on a fresh volume; new columns nullable.

## §5 — Standing operating procedure
Node-20 prefix; full env block for tsx/test ([[local-migrate-needs-full-env-block]]); drive
drizzle-kit non-interactively (ADD-only, no rename — the Commit-3 hazard doesn't recur); CF-7 push;
CI headSha verify; fix-forward if red.

## §6 — Hard-halt conditions
- drizzle 0006 emits anything but ADD COLUMN → halt.
- A profile_type value with no role mapping → halt.
- tax pre-check throws on null → halt (must skip null).
- The dup-email test shows the existing user's role/profile CHANGED → halt (the §2.C safety failed;
  re-examine the synthetic-id assumption — CF-23 two-layer).
- Any gate regresses vs `7a71eb3`.
- §2.B items unresolved at impl start → halt (they gate the schema + zod shape).

## §7 — Risk register
| Risk | Surfacing |
|---|---|
| post-create update writes the existing user on duplicate | §4 case 8 asserts the synthetic-id no-op empirically (CF-23 second layer) |
| wifi columns dead until a future slice | §2.B-1 — defer vs schema-ahead, architect rules |
| `name`→`contact_name` breaks existing signup callers | only caller is the FE (1f) + tests (updated here); ruled CF-24 §7.4 |
| post-create update non-atomic (partial profile on failure) | §2.C note; re-fillable via PATCH; 500 surfaced |
| business_sector_id/governorate_id FK violations at signup | zod accepts the uuid; FK enforced by PG → 500/400; reference-data GETs (next commit) feed valid ids; note as a known edge until then |

## §8 — Cross-references
Survey §3 (signup row) / §8. Contract §3.1 / §4.1 / §5.2 / §7.1-§7.2 (Option B, profile-type map,
tax nullable). Audit §13/§14/§15. Memory [[model-1-abandoned-option-b]],
[[extraction-without-rewrite-discipline]], [[node-20-required-for-commits]].

## §9 — Carry-forward methodology
CF-23 two-layer (better-auth synthetic-id source-read + the case-8 execution assertion). CF-24 (the
class-a wire maps: contact_name→name, agent_toodooh→agent_code; the class-b profile_type-as-hint).
CF-22 (the §2.B corrections surfaced, not silently applied). The two modeling principles
(capture-irreversible / intentionally-plaintext) → audit. New-feature test ratchet.

## §10 — Push policy + sequencing
Plan (2.0): CF-6, push immediately. Impl (2.1): CF-7 gate-sweep, CF-9 pause, push, CI watch. No
visual-QA (backend-only). No new deps → lockfile untouched (confirm).

## §11 — Exact file contents
Deferred to post-ratification: the schema columns (wifi in/out), the terms shape, and the
agent wire name are **pending §2.B rulings** — once ratified I finalize §11 (zod, the map, the
post-create update, 0006, the tests with the locked count) in the impl turn. Drafting concrete code
now would bake in unratified shapes. (This is the one section intentionally held to a contents-sketch
until the CF-9 rulings land — surfaced per CF-22.)

## §12 — Fire instruction
Ratify §2.B (wifi defer-vs-add · agent wire name · terms shape) + the §2.C design, then I finalize
§11 and implement.

---

**HALT — CF-9.** Disposition table above (§2.A). Three corrections to the pre-disposed list need your
ruling (§2.B): (1) **wifi is NOT in the wizard** — defer or schema-ahead? (2) **agent wire name** =
`agent_toodooh`→column `agent_code` — confirm? (3) **terms shape** = `terms_accepted_at` timestamp,
no version — ratify? Plus confirm (4) the **`name`→`contact_name`** wire rename lands here (CF-24
§7.4), and (5) the **post-create-update design** (§2.C, duplicate-safe via synthetic-id). No fields
found outside the pre-disposed list except the wifi *absence*. Await rulings before §11 + code.
