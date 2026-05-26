# Phase 1f — F5 documents scoping read (read-only)

**Source:** `apps/web` (the document controls in `UserProfile.tsx` + `OwnerSettings.tsx`, the upload
mutations, `lib/api-client.ts` `postForm`) + `apps/api` (`routes/profile-documents.ts`,
`routes/me.ts`), read directly (CF-23). **HEAD `30c684b`** (F4 closed). **Date:** 2026-05-26.

**Purpose.** Scope the document repoint — the **flow-position-moved** upload (F2 carry-forward: not a
`supabase.storage`→API swap; upload now happens in the authenticated profile area). **No edits/commit/
plan-doc.** Proposals to ratify (CF-22). One real wrinkle (no DELETE endpoint).

---

## §1 — The upload mechanism

- **`apiClient.postForm` EXISTS** (K, `:130`) — first real use here. `request()` sets
  `credentials:'include'` + (for `form`) NO `Content-Type` (browser sets the multipart boundary). ✓
- **Backend** (`profile-documents.ts`): `POST /api/profile/documents/:type` (`:type ∈ {rne, cin}`,
  `requireAuth`, multipart, 5 MB→413, allowed pdf/jpeg/png, column holds the **key** `<type>/<userId>`,
  storage-fail→502 no-column-write) + `GET /api/profile/documents/:type` (presigns the key on demand,
  404 if none). **NO DELETE** (§3 wrinkle). `request.file()` reads the first file — the FormData field
  name is irrelevant.
- **The rne/cin discriminator (by role):**
  - **Advertiser** (`UserProfile`): one doc — "Registre de commerce" = **RNE** → `/documents/rne`.
  - **Owner** (`OwnerSettings`): `isIndividualOwner ? CIN : RNE` → individual_owner → `/documents/cin`;
    fleet_owner → `/documents/rne` (same split as the F2 wizard).
- **Current upload (dead Supabase):** advertiser `uploadDocument(file)` (storage `rne_<uid>` + write
  `registration_doc_path`); owner `uploadDocument({file, isIndividualOwner})` (storage + write
  `cin_doc_url` / `registration_*`). **Repoint:** a shared `authService.uploadProfileDocument(type,
  file)` → builds `FormData` (append the file) → `apiClient.postForm('/profile/documents/'+type)`.
  onSuccess invalidates the profile query → `/api/me` refetch → presence updates (§2).

---

## §2 — The document-presence read (the read-side wrinkle)

`GET /api/me` exposes **`documents: { registration: boolean, cin: boolean }`** (`me.ts:75` —
presence, derived from `registrationDocUrl/cinDocUrl !== null`; the columns hold the storage KEY, not
a URL). The forms currently derive presence + the view-link from `profile.registration_doc_path` /
`registration_doc_url` / `cin_doc_url` (URL strings) — all **undefined post-F4** (the read bridge
doesn't map documents). So F5 must surface presence + repoint the view.

Three concerns, three sources:
- **Presence** ("uploaded ✓ / needed"): from **`/api/me` documents booleans** (already fetched for the
  profile) — surface via the F4 **read bridge** (`getBusinessProfile`). *Lean (D-F5-2): map
  `documents.registration`→`registration_doc_url` / `documents.cin`→`cin_doc_url` as a truthy
  **presence sentinel** (e.g. `'uploaded'`) when present, undefined when not. The forms' existing
  presence checks (`profile.registration_doc_url` truthiness, `:980`/`:583`) then work unchanged.*
  (Alt: add an explicit `documents:{…}` to the mapped profile + change every presence check — more
  page churn. Lean sentinel.)
- **View** (open the doc): a **new `authService.getProfileDocumentUrl(type)`** → `GET
  /api/profile/documents/:type` → returns the presigned `url`; the page view-handler opens it
  (presign **on demand**, on click). Replaces the supabase `createSignedUrl` + the `open(_url)` (the
  sentinel is NOT a real URL → the view must use the GET, not `open(profile.*_url)`).
- **Upload** (§1): `postForm`.

So the document control's 3 behaviors all change (presence-source, view→GET, upload→postForm) — a real
repoint, not a swap (as the F2 carry-forward warned).

---

## §3 — THE WRINKLE: document REMOVE has no backend endpoint

Both pages have a **remove** control (advertiser `handleRemoveDocument`→`updateProfile({registration_
doc_url:null})`; owner `removeDocument(isIndividualOwner)`→clear cin/rne). The backend has **POST +
GET only — NO DELETE** (`profile-documents.ts`). So removing an uploaded document is **unsupported in
slice 1**.

**Options (D-F5-3):**
- **(a) Disable the remove control** + a note (like logo/owner-extras — don't offer an action the
  backend can't do); track "document DELETE endpoint" for a later slice. *Lean — consistent with the
  deferred-surface-handled-honestly pattern; the remove mutations (dead Supabase) stay unreferenced/
  removed.*
- (b) Add a `DELETE /api/profile/documents/:type` (backend, cross-package) — widens F5 into apps/api.
- *Lean (a) disable* (slice-1 scope; Phase-1c built POST/GET, not DELETE).

---

## §4 — The flow-position connection

The F2 wizard's `addDocumentLater` deferred upload to "later." **Confirmed: no explicit wizard→profile
linkage** (no flag, no prompt) — "later" simply means "the profile document control is where upload
happens, whenever." F5 = wire that control to the API; no signup-side change. *Lean (D-F5-4): confirm
— no linkage needed.*

---

## §5 — Both pages

Advertiser (RNE only) + owner (CIN or RNE by role) both repoint. The upload/view methods are
**shared** (`uploadProfileDocument(type,file)` + `getProfileDocumentUrl(type)`); each page passes its
role's type. **Sub-factoring (D-F5-6): ONE commit** — F5 is smaller than F4 (one doc control per page,
shared methods); both pages' controls are similar. (Split advertiser/owner is possible but
unwarranted at this size.) *Lean: one commit.*

---

## §6 — Test bar

- **Node-level (lean, D-F5-5):**
  - `uploadProfileDocument(type, file)` — mock `postForm`, assert `postForm('/profile/documents/<type>',
    FormData)` with the file appended (Node 20 has global `FormData`; assert `form.get('file')`).
  - `getProfileDocumentUrl(type)` — mock `get`, assert `GET /profile/documents/<type>` → returns `url`;
    404→? (no doc — the method returns null or throws; decide at plan-write).
  - The read-bridge **presence mapping** — extend `auth.service.profile.test.ts` (assert
    `documents.registration`→presence sentinel; absent→undefined).
- **RTL — NOT activated:** the file-input + upload-status render is form-binding (RTL territory,
  deferred); the load-bearing logic (the 2 methods + the mapping) is service-layer, node-tested. The
  multipart is in the method (FormData), node-testable. Human QA at phase close exercises a real
  upload→view. *Consistent with the per-commit RTL resolution (service-layer → node-only; RTL still
  not stood up).* (Clean `apiClient` mocks — F1 carry-forward.)

---

## §7 — Decisions for architect ruling (CF-22)

- **D-F5-1 — upload:** shared `uploadProfileDocument(type, file)` → `postForm POST /documents/:type`;
  discriminator advertiser→rne, individual_owner→cin, fleet_owner→rne. *Lean: confirm.*
- **D-F5-2 (read-side) — presence + view:** presence from `/api/me` documents booleans via the read
  bridge (lean: **sentinel** in `registration_doc_url`/`cin_doc_url`; alt: explicit `documents` field);
  view via a new `getProfileDocumentUrl(type)` → `GET /documents/:type` (presign on demand). *Lean:
  sentinel + GET-on-view.*
- **D-F5-3 (wrinkle) — remove:** no DELETE endpoint → **disable the remove control** (defer, like
  logo) vs add a DELETE (cross-package). *Lean: disable; track the DELETE endpoint.*
- **D-F5-4 — flow-position:** no explicit wizard→profile linkage ("upload whenever" via the profile
  control). *Lean: confirm.*
- **D-F5-5 — test bar:** node-only (the 2 methods + the presence mapping); RTL deferred; human QA.
  *Lean: as stated.*
- **D-F5-6 — sub-factoring:** one commit (both pages, shared methods). *Lean: one.*

---

## Document status

**Read-only scoping — HELD.** Establishes: the multipart upload via the K-built `postForm` + the
rne/cin-by-role discriminator (§1); the read-side wrinkle — presence from `/api/me` booleans (bridge)
+ view via a new GET method (§2); **THE wrinkle — no DELETE endpoint → disable remove** (§3); no
wizard→profile linkage (§4); both pages, one commit (§5); node-only test bar (§6). Six decisions for
ruling (§7). Nothing resolved — the F5 plan is drafted only after §7 is ruled.
