# Slice-1 Bugfix — Discovery Sweep (Kais QA, email 2026-06-04)

**Status:** read-only discovery. No code changes. This doc is the input the architect factors commits from.
**Date:** 2026-06-04.

---

## Pre-flight baseline (CF-10 re-baseline against reality)

| Axis | Value |
|---|---|
| Local branch | `main` |
| Local HEAD | `c7594d5` (`merge: reconcile slice-1 auth fixes … into the slice-2 line`) |
| Working tree | clean (only this doc added) |
| **Deployed (VPS) commit** | **`626cd71`** — pinned by api-src content hash (`find apps/api/src -type f \| sort \| xargs sha1sum \| sha1sum` = `4603a70c…`, matches `git archive 626cd71` exactly; HEAD `c7594d5` = `5594b5f…`, no match) |
| Deploy time | VPS source mtime `Jun 3 08:18` UTC; api container "Up 36 hours" |
| Deploy trigger | manual only (`workflow_dispatch` / `v*` tag) — no auto-deploy on push |

**Deployed-vs-main divergence.** Prod runs `626cd71`; main is `c7594d5`. The delta (`git diff 626cd71..c7594d5`) is the **entire slice-2 zones cutover** + frontend refactors:
- `apps/api/src/routes/predefined-zones.ts` (+287, new), `routes/index.ts` (+3), `tests/predefined-zones.test.ts`, `tests/storage.integration.test.ts`.
- `apps/api/src/storage/s3-storage.ts` (+66) and `provider.ts` (+4) — **additive only**: `ensureZonesPublicRead()` (a `zones/*` bucket-policy grant). The `upload()` / `getPresignedUrl()` methods are **byte-identical** between the two commits.
- Large web refactors (ProfileSettings extraction, CampaignDrawer, MyClients/UserProfile shrink, etc.).

**Consequence:** for every QA item below (#3–#8 are all auth/profile/documents/registration/password) the deployed code path is behaviourally identical to main. **Deploying main fixes none of these six items.** We fix against `626cd71`, and the fixes will apply cleanly to main.

---

## VPS environment snapshot (read-only)

- Host: OVH `54.38.26.121`. Containers (all up): `toodooh-nginx-1` (80/443), `toodooh-api-1` (4000, 36h), `toodooh-minio-1` (9000, healthy, 4d), `toodooh-postgres-1` (5432, healthy).
- `/srv/toodooh/.env`: `STORAGE_ENDPOINT=http://too-dooh.com`, `STORAGE_BUCKET=storage`, `WEB_ORIGIN=http://too-dooh.com` (HTTP, pre-TLS).
- nginx mounts the **HTTP-only** variant (`toodooh-http.conf`): `listen 80`, no http→https redirect, `/storage/` → `proxy_pass http://minio:9000` host-preserving (path-style SigV4 design is correct).
- MinIO `/data` is **empty — the `storage` bucket does not exist** (no upload ever succeeded).

---

## #3 — Upload failure "Le stockage du document a échoué" (Documents légaux)

### Upload lineage
- **Frontend:** `apps/web/src/features/profile/components/ProfileSettings.tsx` (Documents légaux panel, `entrepriseSub === 'documents'`, lines 986–1064). File input at `:998–1003` (single `<input type="file">`, **no `multiple`**). Mutation handler `handleUploadDocument` at `:441–460` → `onUploadDocument(documentFile)`.
- **API:** `POST /api/profile/documents/:type` in `apps/api/src/routes/profile-documents.ts` (`:38`). **API-proxied** upload (not browser-direct presign): Fastify buffers the multipart file (≤5 MB, `:25`/`:62`), then `storage.upload({ key: '<type>/<userId>', body, contentType })` (`:84–85`). On storage failure → **`502 STORAGE_ERROR`** "Document storage failed. Please retry." (`:86–92`) — this is Kais's "Le stockage du document a échoué". Column written only on success (`:94–97`), so no orphan keys; **no CORS surface** (server-side write).
- **Storage:** `apps/api/src/storage/s3-storage.ts` `S3Client` with `endpoint: env.STORAGE_ENDPOINT`, `forcePathStyle: true` (`:36–45`); `upload()` does `HeadBucket`→`CreateBucket` (ensureBucket) then `PutObjectCommand` (`:61–78`).

### Root cause (VPS repro + evidence) — **infrastructure / deploy-ordering, NOT application code**
Prod api logs (real failures, two distinct users — Kais's attempts):
```
module:"s3-storage" key:"cin/1ad93704-…" error:"UnknownError" msg:"storage upload failed"   (×2)
module:"s3-storage" key:"cin/041a9530-…" error:"UnknownError" msg:"storage upload failed"
```
Controlled repro from inside `toodooh-api-1`:
- `dns.lookup('too-dooh.com')` → **`5.135.23.164`** (the **legacy OVH Apache host**), NOT the VPS `54.38.26.121`. **The production A-record has not been flipped to the VPS (1h-flip pending).**
- Real `PutObject` to `STORAGE_ENDPOINT` (`http://too-dooh.com/storage/…`) → `status 301, server: Apache, location: https://too-dooh.com/…` (OVH's forced HTTP→HTTPS redirect). The AWS SDK can't parse the HTML 301 as an S3 response → throws **`name=Unknown, $metadata.httpStatusCode=301, message="UnknownError"`** — exactly the log line.
- Control: internal `http://minio:9000/minio/health/live` from the api container → **`200`** (storage itself is fine and reachable).

So: `STORAGE_ENDPOINT` points at the **public domain**, which resolves to the **old OVH server**, which 301-redirects → every S3 op fails. The MinIO config, the nginx `/storage` proxy, and the SigV4 path-style design are all correct; the only fault is the endpoint/DNS.

**Is there a code fix?** Not for the storage path — it's config. But the fix is *entangled* and not a one-liner:
- Naively setting `STORAGE_ENDPOINT=http://minio:9000` makes **uploads work** but **breaks document downloads**: `getPresignedUrl()` signs over the same endpoint host, so links become `http://minio:9000/…` (unreachable by the browser, and host-bound signature can't be string-swapped).
- The clean end-state is the post-flip world: once `too-dooh.com` A-record → `54.38.26.121`, the api's PUT to `http://too-dooh.com/storage/<key>` hairpins to the VPS nginx → minio, **and** presigned GET URLs (host `too-dooh.com`) work for the browser. No code change needed then.
- Pre-flip interim options (no DNS change): docker-compose `extra_hosts: too-dooh.com:<vps-ip>` so the api resolves the domain internally (fixes upload; document *download* presign still resolves to old OVH until flip), **or** split the S3 client into internal-ops-endpoint + public-presign-host (a real `s3-storage.ts` code change, not in main).

### #3b — Optimistic-state frontend bug (independent of the storage cause, real, fixable now)
`ProfileSettings.tsx:1007` gates the saved row on `documentRegistered || documentFile`. `documentFile` is set **at file-pick time** (`:1002`, before any request). On upload failure the `catch` at `:456` toasts "Erreur upload" but **does not clear `documentFile`** (the `setDocumentFile(null)` at `:453` is inside the `try`, after the `await`, so it is skipped on throw). Result: the green `<Check/>` + literal **"Enregistré"** row (`:1026–1027`) persists while the error toast fires — the label reflects local file-pick state, never the API outcome. `documentRegistered` itself is server-driven and correct; the bug is purely the `|| documentFile` branch.

---

## #4 — "Multiple files for CIN/RNE" — single-file by design (Figma-confirmed)

- **Uploader:** single-file by construction. `<input>` has no `multiple` (`ProfileSettings.tsx:998–1003`); state is `documentFile: File | null` (`:251`), one slot. Saved indicator is a boolean prop `documentRegistered` (`:85`).
- **Schema:** one-to-one. `apps/api/src/db/schema.ts:79–80` — `registrationDocUrl` (RNE) and `cinDocUrl` (CIN) are two `text` columns **on the `users` row** (hold the storage key, not a URL). No documents table.
- **API:** **replace**, not append. Stable key `${type}/${userId}` overwrites the same object (`profile-documents.ts:84`); write is `db.update(users).set(...)` (`:94–97`); multipart capped `files: 1` (`:25`).
- **Figma:** `~/Downloads/toodooh_figma/{screencast,screenhost}/Settings.png` — Documents légaux frame shows **one** dropzone ("Ajouter votre registre de commerce") and **exactly one** saved-file row ("Mon registre de commerce.pdf · 280 KB · ✓ Completed"). **The maquette is affirmatively single-file** (the code's "Enregistré" vs the design's "Completed" is a copy divergence only).

⚠️ **HALT — contradicts the design.** Multi-file per doc type is neither implemented nor intended per the maquette. Going one→many is a real migration (new `profile_documents` table + unique keys + insert-not-update + list/DELETE routes + frontend `File[]` + delete-button wiring — full touch-list in the agent report). **Confirm with Kais whether multi-file is genuinely wanted before building it**, per the Figma-consultation rule.

---

## #5 — Password min 12 → 10 (complete enumeration; gates triviality)

**No single source of truth.** 9 production sites + tests, across two unconnected layers (`packages/shared` does not exist):

| # | Site | file:line | Kind |
|---|---|---|---|
| 1 | Frontend constant (partial SoT) | `apps/web/src/features/auth/utils/password.ts:6` (`PASSWORD_MIN_LENGTH = 12`) | enforce |
| 2 | better-auth server floor | `apps/api/src/auth/auth.ts:101` (`minPasswordLength: 12`) | enforce |
| 3 | signup zod | `apps/api/src/routes/signup.ts:22` (`.min(12, …)`) | enforce |
| 4 | reset-password zod | `apps/api/src/routes/password.ts:13` | enforce |
| 5 | change-password zod | `apps/api/src/routes/password.ts:17` | enforce |
| 6 | SignUpForm helper text (hardcoded FR) | `apps/web/src/features/auth/components/SignUpForm.tsx:843` ("Minimum 12 caractères") | display |
| 7 | ProfileSettings rule label (hardcoded FR) | `apps/web/src/features/profile/components/ProfileSettings.tsx:1267` | display |
| 8 | UpdatePasswordForm label (interpolates #1) | `apps/web/src/features/auth/components/UpdatePasswordForm.tsx:110` | display |
| 9 | password.ts doc comment | `apps/web/src/features/auth/utils/password.ts:2` | display |

- Frontend `PASSWORD_MIN_LENGTH` drives SignUpForm/ProfileSettings/UpdatePasswordForm enforcement + #8's label, **but #6 and #7 are hardcoded strings that bypass it** — must edit manually.
- Backend has **4 independent hardcodes** (no shared const) — all must change.
- **Tests that will break at min 10:** `password.test.ts:7` asserts `PASSWORD_MIN_LENGTH === 12`; `:18–20` asserts an 11-char password is rejected. Backend tests `password.test.ts:158/211`, `signup.test.ts:144` use a 5-char payload (still pass) but their "< 12" descriptions go stale.

⚠️ **Flag (separate ruling):** the admin-creation CLI enforces its own `MIN_PASSWORD_LEN = 12` (`apps/api/scripts/create-admin.ts:18`, test `create-admin.test.ts:29`). QA #5 is about *user* passwords — confirm whether the admin CLI should also drop to 10, don't assume.

---

## #6 — CGU pop-up

### Link sites (frontend)
Both CGU links are dead and live only in the signup wizard final step (`apps/web/src/features/auth/components/SignUpForm.tsx`):
- Owner/établissement step: `:1601–1615` (anchor at `:1611`).
- Advertiser step: `:1824–1839` (anchor at `:1835`).
- Both are `<a href="/terms">…</a>`. **There is no `/terms` route** (`App.tsx` confirmed) → a full-page navigation that the SPA doesn't handle (falls through to `/` → `/login`) **and destroys in-progress signup state**. Not a `<Link>`, not a modal, not an external URL.
- Consent is required: `formData.terms_accepted` (init `false`, `:191`), validated in `handleSubmit` (`:477–480`) and the submit button `disabled` until checked (`:1934`).
- **The settings/profile CGU location (item #6 "(b)") does not exist** — no CGU/terms reference anywhere in `features/profile/`, `UserProfile.tsx`, `OwnerSettings.tsx`.

### Available overlay primitive
- `apps/web/src/components/Drawer.tsx` — the only generic reusable overlay (right slide-over, `open/onClose/width/children`, backdrop+Esc). **No generic centered Modal** exists; `contexts/ModalContext.tsx` holds only bespoke modals (logout/support/appointment). No Radix/Headless UI.

### CGU content "dans l'hébergement front OVH"
Static PDFs at the OVH webroot (local snapshot `~/Desktop/code hebergement 090526/www/`):
- **`annonceur.pdf`** (1.06 MB) — advertiser CGU.
- **`plateforme.pdf`** (1.27 MB) — platform/owner CGU.
- (siblings: `Mentions légales Toodooh.pdf`, `Modalités tarifaires des services proposés.pdf`, `Politique de remboursement.pdf` — these three map to the landing's existing `/mentions-legales`, `/modalites-tarifaires`, `/politique-remboursement` nginx routes.)

⚠️ **Gap:** the repo's `infra/landing` does **not** ship any of these PDFs, and the VPS webroot has **none** of them. A pop-up fix must first bring the CGU content into the repo (as PDFs to embed/iframe, or as extracted HTML). The two-CGU split (advertiser vs platform) means the pop-up likely needs to pick the right document per profile type. **Content source + format (PDF iframe in Drawer vs extracted HTML) needs a decision.**

---

## #7 — Category blank on owner dashboard — **VERDICT: BUG (not expected behavior)**

- **Render:** `apps/web/src/features/screenhost/pages/OwnerDashboard.tsx:435–444` binds "Catégorie" to local `businessSectorName` (`:442`), computed at `:117–120` by `sectors.find(s => s.id === profile.business_sector_id)?.name`.
- **The id** `profile.business_sector_id` is an **owner ACCOUNT property** on `users` (`schema.ts:66–68`, FK→`businessSectors`), set at owner signup from the **`audience='owner'`** sector list, returned by `GET /me` (`me.ts:35,68`). It *should* always have a value.
- **The list** is fetched wrong: `useSectors()` (`OwnerDashboard.tsx:83`) → `auth.service.ts:317` → `GET /business-sectors?audience=advertiser` (`reference.ts:27–47`). The owner's id is `audience='owner'`, so it is **structurally absent** from the advertiser list → `.find()` misses → `''` → `'—'` fallback.
- **Not** derived from establishments. The "Aucun établissement pour le moment" empty-state comes from a separate path (`useScreens()`, `OwnerDashboard.tsx:243–282`) and is correct & unrelated — it neither causes nor excuses the blank category.
- **Fix pattern already exists** in the sibling `OwnerSettings.tsx:44–49` (owner-first lookup via `useOwnerBusinessSectors()` `?audience=owner`, advertiser fallback). OwnerDashboard is the only owner page using the raw advertiser-only lookup.

---

## #8 — Per-step registration validation (largest)

### Wizard structure
- Container `apps/web/src/features/auth/pages/SignUp.tsx` owns `currentStep = useState(0)` (`:43`); the visual stepper (`:62–90`) is display-only (no click-nav). Step content + advance logic in `SignUpForm.tsx` via `switch (currentStep)` (`:1855–1871`). **5 steps, single index, no routes.** Steps (labels vary by profile type, `SignUp.tsx:17–51`): 0 Profil · 1 Responsable (name/email/phone/password/agent code) · 2 Entreprise/Établissement (**tax_number** here) · 3 Adresse / fleet table · 4 Documents / Coordonnées bancaires.
- "Suivant" = `goNext()` (`:1922`), `disabled={!canGoNext()}` (`:1923`); `goNext` (`:381–419`) guards then `onStepChange(currentStep+1)`. Step 4 swaps to "Créer mon compte" → `handleSubmit`.

### Current validation
Per-step via `canGoNext()` (`:316–379`, a `switch` returning bool; Next disabled until the step's fields valid). Step 1 is richest (email regex + password + phone + no conflicts, `:320–335`). Per-field inline validation exists **only on step 1** for email/phone (onBlur).

### The praised phone template (replicate this)
Phone on step 1, input `:716–735`. Three-part mechanism:
1. Pure validator `isValidTunisiaPhone = v => /^\+216\d{8}$/.test(normalizePhone(v))` (`:268`, `normalizePhone` `:267`).
2. Wired into `canGoNext()` step 1 (`:332–334`) → Next button disabled until valid.
3. `onBlur` (`:728–730`) sets inline error `phoneConflict` ("Numéro invalide (format attendu: +216XXXXXXXX)", `:305`), rendered `:734`; `onChange` auto-prefixes `+216`.
(Email mirrors this exactly: regex `:266`, onBlur `:703–705`, error `:709`.) Note the FE phone regex is a **local copy**, stricter than backend `apps/api/src/validation/phone.ts:3` E.164; no shared validator.

### Duplicate-email — **no availability endpoint exists, BY DESIGN**
- No email-check route: `routes/index.ts` registers signup/signin/me/profile/profile-documents/password/admin/predefined-zones/reference only. No FE `checkEmail` service.
- This is **deliberate anti-enumeration** (documented `SignUpForm.tsx:283–286`, Phase-1f F2). `emailConflict`/`phoneConflict` carry **format errors only**.
- Duplicate email **never surfaces**: signup returns a **generic 201** even on duplicate (`signup.ts:100,134–169` — better-auth synthetic user, profile write silently no-ops), user routed to `/signup-success` regardless.

⚠️ **HALT.** Surfacing duplicate-email inline (what QA implicitly wants) **conflicts with the documented anti-enumeration stance**. Needs an explicit ruling before any fix — this is not a mere "API gap to fill".

### tax_number final-step error
- Field on **step 2** (inputs `:919–927` individual-owner / `:1046–1054` others), binds `formData.tax_number` (`:174`).
- Step 2's `canGoNext()` checks tax_number **presence only** (`.trim()` truthiness, `:341`/`:348`) — **no FE format validator** (no `isValidTaxNumber` equivalent).
- Format lives only on backend: `apps/api/src/validation/tax-number.ts:9` `/^[A-Za-z0-9/]{7,20}$/`, applied `signup.ts:27`. A non-empty-but-malformed value passes step 2, advances, and only 400s at final submit (surfaced via `handleSubmit` catch `:507–508`) — matching Kais's report. (Also a uniqueness 409 `TAX_NUMBER_TAKEN` at submit, `signup.ts:101–114` — not anti-enumerated, but still submit-only with no pre-check endpoint.)
- **Fix shape:** add FE `isValidTaxNumber` mirroring the regex, wire into `canGoNext()` step 2, add onBlur inline error on both inputs — the exact phone three-part pattern. (Uniqueness still can't be pre-checked, same as email.)

---

## Halt-on-finding flags (for the architect)

1. **#3 is infra/deploy-ordering, not storage code.** Root cause = `STORAGE_ENDPOINT=http://too-dooh.com` resolving to the legacy OVH host (DNS A-record not flipped, 1h-flip pending) → 301 → `UnknownError`. Main does not fix it. The clean fix is the post-flip state; pre-flip interim needs a decision (extra_hosts vs endpoint-split-code). **Separately**, the #3b optimistic-"Enregistré" frontend bug is real and fixable now regardless.
2. **#4 contradicts the Figma maquette** (single-file by design). Confirm intent before any one→many migration.
3. **#7 ruled a BUG** (wrong-audience sector list), not expected behavior. Fix pattern already in `OwnerSettings.tsx`.
4. **#8 duplicate-email has no endpoint by design** (anti-enumeration). Surfacing it needs a ruling — it conflicts with a documented security stance.
5. **#5 admin-CLI** min-length (`create-admin.ts`) is a separate floor; ruling needed on whether it also drops to 10.
6. **#6 CGU content is not in the repo or on the VPS** (only OVH `annonceur.pdf` / `plateforme.pdf`). The pop-up fix needs the content sourced + a format decision, and likely per-profile document selection.

## Deployed-vs-main delta (summary)
Prod `626cd71` ≠ main `c7594d5`; delta = slice-2 zones cutover (predefined-zones + zone-image storage policy) + web refactors. **None of it changes the behaviour behind #3–#8** (storage `upload`/`getPresignedUrl` byte-identical). Fixes authored against main apply to prod.
