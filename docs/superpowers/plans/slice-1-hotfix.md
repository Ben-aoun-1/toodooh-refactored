# Slice-1 Hotfix — Implementation Plan

**Status:** DRAFT — held for architect ratification of the five-commit factoring. **No code yet.**
**Design authority:** `docs/handoff/slice-1-bugfix-discovery.md` (the 2026-06-04 Kais QA sweep).
**Branch:** `hotfix/slice-1`, forked off prod **`626cd71`** (NOT main). Own deploy line.
**Region:** apps/web + apps/api + (VPS `.env`, manual).
**Date:** 2026-06-04.

---

## §0 — Pre-flight (CF-10)

- Branch `hotfix/slice-1` created off `626cd71a62f737c0f4f47978e63191381fc03a4a` (confirmed `git rev-parse HEAD`).
- Prod deploys `626cd71` (pinned in discovery by api-src hash). Main (`c7594d5`) is **un-deployable** for slice-1 fixes — it carries the slice-2 zones cutover. This hotfix is therefore its own deploy line off prod; main is reconciled later (§5 forward-port).
- **CI baselines on this line** (from `.github/workflows/{ci,deploy}.yml` @ 626cd71): typecheck baseline **33**, lint baseline **0**. The executor re-runs `pnpm typecheck / lint / test` at the start and records the live floor before C1.
- Node 20 PATH prefix mandatory for every commit (husky engine gate). apps/api tests need Postgres + the full env block (`local-migrate-needs-full-env-block`).
- **Prod file-shape fact (drives everything below):** slice-2 EXTRACTED the shared `apps/web/src/features/profile/components/ProfileSettings.tsx` (+1360 on main) out of `OwnerSettings.tsx` (−1752) and `UserProfile.tsx` (−1327). **On this branch (`626cd71`) `ProfileSettings.tsx` does NOT exist and there is no `features/profile/` dir.** The Documents-légaux UI and the password-rule labels live **inline** in `OwnerSettings.tsx` (owner) and `UserProfile.tsx` (advertiser). Every fix below is scoped to **prod's** file shape; main's discovery line numbers do **not** apply.

---

## §1 — Scope: the five land-now fixes

Land-now set (this plan): **#3a** storage endpoint-split, **#3b** optimistic-state, **#5** password→10, **#7** dashboard category, **#8a** per-step validation.

**Excluded — deferred, gated on Kais (no commits, see §8):** #4 (multi-file CIN/RNE — contradicts the Figma maquette), #6 (CGU pop-up — content not in repo), #8b (surfacing duplicate-email — conflicts with the documented anti-enumeration stance).

Commit factoring (5 commits; order is independent — each ends green on its own; sequence chosen so the deploy-critical storage fix lands first):

| Commit | Fix | Region | Risk |
|---|---|---|---|
| **C1** | #3a storage endpoint-split + boot ensure-bucket | apps/api (+ VPS `.env`) | medium (deploy-critical) |
| **C2** | #3b optimistic "Enregistré" state | apps/web (2 files) | low |
| **C3** | #5 password → 10 + consolidation | apps/web + apps/api | low (mechanical, wide) |
| **C4** | #7 owner-dashboard category audience | apps/web (1 file) | low |
| **C5** | #8a per-step wizard validation (tax_number) | apps/web (1 file) | low |

No sub-splits proposed. C1 carries its own storage-integration test in the same commit (TDD — test lands with code). C3 is wide (9 sites) but mechanical, so it stays one logical change ("lower the password floor to 10").

---

## §2 — Conventions for every commit

- Ends green: `pnpm typecheck` (≤ baseline 33), `pnpm lint` (0), `pnpm test`, `pnpm build`. Never commit red; revert + ask on a gate failure.
- TS strict — no `any` / `@ts-ignore` / `@ts-expect-error`. No `console.*` (pino). No `window.location.reload`. No `localStorage` outside Zustand persist. Tailwind only; brand token, no hex.
- Conventional Commits; one logical change; **no `Co-Authored-By` trailer**. Node 20 PATH.
- lint-staged runs raw eslint on staged files — do not stage a file carrying a baseline-tolerated error alongside (`lint-staged-baseline-blocker`); never `--no-verify`.
- Per-commit ratify-then-push: each commit CF-9-halts LOCAL+unpushed; push only on explicit per-commit ratify (the plan doc itself is the exception — §6 push policy).

---

## §3 — Prod-shape ↔ main touched-file map

Only **5** of the files these fixes touch differ between `626cd71` and main; the rest are byte-identical (clean cherry-pick). `git diff --stat 626cd71..c7594d5`:

| File | 626cd71→main churn | Touched by | Forward-port |
|---|---|---|---|
| `apps/web/.../advertiser/pages/UserProfile.tsx` | −1327 (extracted) | #3b, #5 | **conflict — re-apply to ProfileSettings.tsx** |
| `apps/web/.../screenhost/pages/OwnerSettings.tsx` | −1752 (extracted) | #3b, #5 | **conflict — re-apply to ProfileSettings.tsx** |
| `apps/web/.../screenhost/pages/OwnerDashboard.tsx` | 71 ± (modified) | #7 | light (category block intact on both) |
| `apps/api/src/storage/s3-storage.ts` | +66 (zones method) | #3a | light (additive, separable region) |
| `apps/api/src/storage/provider.ts` | +4 (interface +1 method) | #3a | light |
| **all other touched files** | **unchanged** | #5, #8a, #3a env | **clean** |

"All other" = `SignUpForm.tsx`, `SignUp.tsx`, `auth/utils/password.ts`, `auth/components/UpdatePasswordForm.tsx`, `auth/utils/password.test.ts`, `apps/api/src/{auth/auth.ts,routes/signup.ts,routes/password.ts,env.ts,validation/tax-number.ts,validation/phone.ts}`, `apps/api/scripts/create-admin.ts`, `infra/docker-compose.prod.yml`.

---

## §4 — The five commits

### C1 — #3a: storage endpoint-split + boot ensure-bucket  *(apps/api; deploy-critical)*

**Why.** Root cause (discovery §3): `STORAGE_ENDPOINT=http://too-dooh.com` is used for BOTH the api's server-side SDK calls AND presigned-URL host. The api's own `PutObject` to that public domain hits the legacy OVH host (DNS not flipped) → 301 → `UnknownError` → 502. Internal `minio:9000` works. The bucket `storage` does not exist yet.

**Change.**
1. `apps/api/src/env.ts` (after line 33, the STORAGE block): add `STORAGE_PUBLIC_ENDPOINT: z.url().optional()` — the browser-facing host used ONLY to sign presigned URLs. When unset (dev/test), presign falls back to `STORAGE_ENDPOINT` (single-host behavior preserved). Keep `STORAGE_ENDPOINT` as the internal-ops endpoint.
2. `apps/api/src/storage/s3-storage.ts`:
   - `fromEnv()` builds the existing `S3Client` from `STORAGE_ENDPOINT` (used by `upload`/`ensureBucket`/`delete`/`HeadBucket`/`CreateBucket`/the `GetObject` SDK call). Build a **second** `S3Client` (`presignClient`) pointed at `STORAGE_PUBLIC_ENDPOINT ?? STORAGE_ENDPOINT`, used ONLY inside `getPresignedUrl()` — signing is offline, no network, so the public client never connects from the api.
   - `getPresignedUrl()` (currently `:80–95`) switches to `presignClient`.
   - All other methods keep the internal client.
   - **Boot ensure-bucket:** export an idempotent init (reuse the memoized `ensureBucket()` `:48–58`) and call it once at server start (`apps/api/src/server.ts`, after the storage import / before listen). Memoized → safe; creates `storage` on first boot.
3. **VPS `.env` (manual deploy step, deploy-owned, NOT in git):** set `STORAGE_ENDPOINT=http://minio:9000` and `STORAGE_PUBLIC_ENDPOINT=http://too-dooh.com`. Compose is **untouched** (`api` uses `env_file: [.env]`, compose line 47).

**Test (same commit).** Extend `apps/api/tests/` storage coverage: presign uses the public endpoint host while upload/head target the internal endpoint; ensure-bucket is idempotent (second call no-ops). Use the CI MinIO at `localhost:9000` (single-host: public falls back to internal, both assertions still hold).

**Caveat to surface (see §6).** This makes UPLOAD work on deploy. Document DOWNLOAD (presigned GET) stays broken until 1h-flip, because the public host `too-dooh.com` still resolves to the legacy OVH server. Expected + gated, per architect ruling.

**File:line (prod):** `env.ts:29–33`; `s3-storage.ts:36–45` (`fromEnv`), `:80–95` (`getPresignedUrl`), `:48–58` (`ensureBucket`); `server.ts` (boot call site).

### C2 — #3b: optimistic "Enregistré" driven off server state  *(apps/web; 2 inline files)*

**Why.** The green-check "Enregistré" row is gated on `documentFile` (local, set at file-pick), and the upload `catch` never clears it → a failed upload leaves a permanent "saved" row while the error toasts (discovery §3b).

**Change — two inline implementations (no shared component on prod):**
- `apps/web/src/features/advertiser/pages/UserProfile.tsx`: state `documentFile` `:106`; handler `:305–316` (`uploadDocument.mutateAsync` `:311`, `setDocumentFile(null)` `:312` only on success, `catch` toast `:315`); render gate `(profile.documents?.registration || documentFile)` `:856`, "Document enregistré" sub-line `:871`.
- `apps/web/src/features/screenhost/pages/OwnerSettings.tsx`: state `:136`; handler `:387–403` (success clear `:400`, `catch` `:403`); render gate uses `documentFile`; literal **"Enregistré"** at `:1149` AND `:1297` (CIN + RNE rows).

**Fix shape (both files):** gate the green-check **"Enregistré"** label on the **server-confirmed** value only (`profile.documents?.registration` / `.cin`), never `|| documentFile`. A freshly-picked `documentFile` may still render a *pending/selected* affordance, but not the saved badge. In each `catch`, add `setDocumentFile(null)` so a failed upload clears the optimistic row and the error surfaces cleanly. `documentRegistered`/server state is already React-Query-invalidated on success, so the badge stays correct after a real save.

### C3 — #5: password floor 12 → 10 + consolidation  *(apps/web + apps/api)*

**Why.** Lower the minimum to 10 everywhere. No single source of truth — 9 production sites + tests (discovery §5). On prod the two profile labels live in different files than on main.

**Change — route through the existing constant where one exists, edit hardcodes:**
- FE constant (single FE SoT): `apps/web/src/features/auth/utils/password.ts:6` → `PASSWORD_MIN_LENGTH = 10` (drives `passwordChecks` `:17`, SignUpForm/UpdatePasswordForm/the inline profile checks, and `UpdatePasswordForm.tsx:110` interpolated label — all auto-update).
- Hardcoded FR display strings (bypass the constant) → "Minimum 10 caractères": `SignUpForm.tsx:843`, `UserProfile.tsx:1214`, `OwnerSettings.tsx:1655`.
- Backend (4 independent hardcodes, no shared const): `apps/api/src/auth/auth.ts:101` `minPasswordLength: 10`; `apps/api/src/routes/signup.ts:22`, `routes/password.ts:13`, `:17` → `.min(10, 'Password must be at least 10 characters')`.
- Tests: `apps/web/src/features/auth/utils/password.test.ts:7` assert `toBe(10)`; the 11-char boundary case `:18–20` → re-target to a 9-rejects/10-accepts boundary. Backend `password.test.ts:158/211`, `signup.test.ts:144` use a 5-char payload (still pass at 10) — update the stale "< 12" describe text.

**RULING (locked, do NOT change):** `apps/api/scripts/create-admin.ts:18` `MIN_PASSWORD_LEN = 12` **STAYS at 12** — deliberate privileged-account floor. Add/keep a one-line comment marking it intentional and decoupled from the user floor. (#5 is about user passwords only.)

### C4 — #7: owner-dashboard category resolved against owner audience  *(apps/web; 1 file)*

**Why.** Ruled a BUG (discovery §7). Category is an owner account property (`users.business_sector_id`, `audience='owner'`) but the dashboard resolves it against the `?audience=advertiser` list → never matches → `—`.

**Change.** `apps/web/src/features/screenhost/pages/OwnerDashboard.tsx`: import `useSectors` `:24`, used `:87`; `businessSectorName` memo `:121–123`; render `:454/:460`. Mirror the sibling owner-first pattern from `OwnerSettings.tsx`: add `useOwnerBusinessSectors()` (`?audience=owner`) and resolve `business_sector_id` against owner sectors first, advertiser list as fallback. The "Aucun établissement" empty-state (`useScreens()`) is correct and untouched.

### C5 — #8a: per-step wizard validation (tax_number)  *(apps/web; 1 file)*

**Why.** tax_number (step 2) is presence-checked only; format lives on the backend, so a malformed value only 400s at final submit — Kais's screenshot (discovery §8). Replicate the praised phone template for tax_number.

**Change.** `apps/web/src/features/auth/components/SignUpForm.tsx` (unchanged vs main — clean forward-port):
- Add a pure validator `isValidTaxNumber` mirroring backend `apps/api/src/validation/tax-number.ts:9` (`/^[A-Za-z0-9/]{7,20}$/`), beside `isValidTunisiaPhone` `:268`.
- Wire it into `canGoNext()` step 2 (currently presence-only `:340`/`:348`) so "Suivant" disables until format-valid.
- Add an `onBlur` inline error on both tax_number inputs (individual-owner `:919–927`, others `:1046–1054`), mirroring the phone onBlur `:728–730`/error `:734`.
- **Scope note:** format pre-validation only. Uniqueness (`TAX_NUMBER_TAKEN` 409) still can't be pre-checked (no endpoint) and remains a submit-time error — same as email. #8b (duplicate-email) is excluded (§8).

---

## §5 — Forward-port risk (per fix → main reconciliation)

| Fix | Prod files | Slice-2 refactored them? | Cherry-pick verdict |
|---|---|---|---|
| **C1 #3a** | `s3-storage.ts`, `provider.ts`, `env.ts`, `server.ts` | s3-storage/provider yes (+zones method, additive); env/server no | **light conflict** — endpoint-split touches `fromEnv`/imports/class-fields adjacent to the added `ensureZonesPublicRead`; resolvable by hand. env/server clean. |
| **C2 #3b** | `UserProfile.tsx`, `OwnerSettings.tsx` | **yes — both gutted into `ProfileSettings.tsx`** | **conflict — re-apply.** Cherry-pick will not apply. Re-implement once in main's consolidated `ProfileSettings.tsx` (single site vs two on prod — actually cleaner on main). |
| **C3 #5** | constant/backend/SignUpForm/tests + `UserProfile.tsx`+`OwnerSettings.tsx` labels | constant/backend/SignUpForm/tests **no**; the 2 profile labels **yes** | **mostly clean.** All but the two profile labels cherry-pick clean; the `UserProfile:1214`/`OwnerSettings:1655` label edits relocate to `ProfileSettings.tsx:1267` on main. |
| **C4 #7** | `OwnerDashboard.tsx` | yes (71 ±) — but the category block survived on main (same bug present) | **light** — the fix is needed on main too; minor context conflict from unrelated churn, category lines intact. |
| **C5 #8a** | `SignUpForm.tsx` (+ `tax-number.ts` read) | **no — identical on both** | **clean.** Cherry-picks without conflict. |

**Reconciliation cost summary:** C5 clean; C1/C3/C4 light/mechanical; **C2 is the only hostile one** (full re-apply, because slice-2 extracted the files out from under it) — but the destination is a single consolidated component, so the re-applied fix is smaller. Plan the main reconciliation as: cherry-pick C5+C4+C3-core+C1 (resolve light conflicts), then hand-port C2 + the two C3 labels into `ProfileSettings.tsx`.

---

## §6 — Deploy & the downloads-until-flip caveat

**How `hotfix/slice-1` reaches prod.** Same pipeline as `Deploy` (`workflow_dispatch`), but the workflow checks out the triggering ref — so it must run against `hotfix/slice-1` (or the branch is tagged `v*`). Rebuild is from api-src (the api image rebuilds on `compose up -d --build`); the web build is reassembled into the webroot. Manual, gated, not auto-on-push. **Before** the deploy, the deploy-owned `/srv/toodooh/.env` must be edited (C1 ops step): `STORAGE_ENDPOINT=http://minio:9000`, `STORAGE_PUBLIC_ENDPOINT=http://too-dooh.com`.

**Caveat to surface for Kais (expected/gated, NOT a regression):** after this hotfix, **document UPLOAD works** (api→`minio:9000` internal). **Document DOWNLOAD/preview stays broken until 1h-flip** — presigned GET URLs carry host `too-dooh.com`, which still resolves to the legacy OVH server until the production A-record is flipped to `54.38.26.121`. So Kais can upload CIN/RNE and the row will save correctly (C2), but viewing an uploaded doc will fail until the DNS cutover. (A pre-flip workaround exists — set `STORAGE_PUBLIC_ENDPOINT` to the raw VPS IP so the browser hits the VPS directly — but it puts an IP in URLs and is dropped at flip; flagged in §9, architect to rule. Default per current ruling: leave downloads gated on the flip.)

---

## §7 — Per-commit verification gates

Each commit, before its CF-9 halt:
- `pnpm typecheck` ≤ 33 · `pnpm lint` 0 · `pnpm test` green · `pnpm build` ok.
- C1: the new storage test asserts internal-vs-public endpoint routing + idempotent ensure-bucket; api tests run under the full env block + Postgres + CI MinIO.
- C2: manual reasoning trace — failed upload clears `documentFile` and shows no "Enregistré"; successful upload shows the badge from server state. (Node-only tests; no RTL on this line.)
- C3: `password.test.ts` asserts the 10 floor + the 9/10 boundary; grep-verify zero remaining "12 caractères"/`min(12`/`minPasswordLength: 12` in user-facing code (create-admin.ts intentionally retains 12).
- C4: category renders the owner sector name for an owner whose `business_sector_id` is `audience='owner'`.
- C5: "Suivant" disabled on malformed tax_number; inline error on blur; no final-step 400 for a format-valid value.
- Working tree clean except the committed change.

---

## §8 — Deferred (gated on Kais — no commits this line)

- **#4 multi-file CIN/RNE** — the Figma maquette is affirmatively single-file; schema is one-to-one; API replaces. One→many is a real migration (new table + unique keys + insert/list/DELETE routes + `File[]` frontend). **Confirm intent before building.**
- **#6 CGU pop-up** — dead `<a href="/terms">` (`SignUpForm.tsx:1611`/`:1835`), no settings-area link. Content lives only as OVH PDFs (`annonceur.pdf`, `plateforme.pdf`) — **not in the repo or VPS**. Needs content sourced + format decided (PDF-in-Drawer vs extracted HTML) + per-profile selection.
- **#8b duplicate-email** — no availability endpoint **by design** (anti-enumeration; duplicate signup returns generic 201). Surfacing it conflicts with a documented security stance. **Ruling required**, not a gap to fill.

---

## §9 — Halt flags / open questions for ratification

1. **C2 is the only hostile forward-port** (slice-2 gutted `UserProfile.tsx`/`OwnerSettings.tsx` into `ProfileSettings.tsx`). Accept the re-apply-to-main plan in §5, or prefer authoring #3b directly on main first and back-porting to the hotfix? (Recommend: fix on the hotfix line for the prod deploy, re-apply to main at reconciliation.)
2. **#3a env-var shape** — proposed `STORAGE_PUBLIC_ENDPOINT` (optional, falls back to `STORAGE_ENDPOINT`). Confirm the name and the fallback semantics before C1. The `.env` edit is deploy-owned/manual — confirm who lands it on the VPS.
3. **Downloads-until-flip** — confirm the default (gated on 1h-flip, §6) vs the IP-host workaround for pre-flip document preview. Current ruling taken as: gated.
4. **C3 `create-admin.ts` stays 12** — confirmed in-plan per the ruling; flagging only so it's explicitly ratified (no silent 12 left behind elsewhere).
5. No fix that can't be factored cleanly within its own commit was found; the only cross-cutting risk is forward-port (§5), not the hotfix-line commits themselves.

**STOP after this plan — architect ratifies the factoring before any code commit.**
