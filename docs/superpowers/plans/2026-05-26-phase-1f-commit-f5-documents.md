# Phase 1f — Commit F5: documents (upload + view + presence)

**Status:** DRAFT (F5.0) — held for review. D-F5-1…6 ruled; the plan folds them.
**Design authority:** `phase-1f-f5-documents-scoping.md` (§7 rulings).
**Region:** `apps/web` only (the endpoints exist — Phase-1c Commit 5 POST/GET; `/api/me` documents
booleans — F4a `MeUser`). **HEAD at draft:** `30c684b` (F4 closed).

The flow-position-moved document repoint (F2 carry-forward: upload happens in the authenticated
profile area, not signup). All 3 of the document control's behaviors change — upload→`postForm`,
view→GET, presence→the explicit `/api/me` `documents` field. Remove disabled (no DELETE endpoint).
Both pages, **one commit, node-only tests.**

---

## §0 — Pre-flight (CF-10)

- `git status` clean; HEAD `30c684b`.
- Floor: **apps/web typecheck 40 · lint 1 · test 205 (28 files) · build 137.61 kB gzip**; apps/api 146.
  Re-run; record.
- Node 20 PATH.
- **Verified (the ruling's verify-ask): POST OVERWRITES** — `storage.upload` is a `PutObjectCommand`
  (S3 PutObject overwrites), key `<type>/<userId>` (deterministic), the column write is unconditional.
  So **re-upload replaces** the doc (covers the wrong-doc case → DELETE even less urgent; confirms
  D-F5-3 disable-don't-add).

---

## §1 — Locked constraints (rulings)

- **D-F5-1** upload → a shared `authService.uploadProfileDocument(type, file)` → `FormData` →
  `postForm POST /api/profile/documents/:type`. Discriminator by role: advertiser→**rne**,
  individual_owner→**cin**, fleet_owner→**rne**.
- **D-F5-2** READ — **EXPLICIT `documents:{registration,cin}` field** (NOT a sentinel; sentinel =
  dishonest data in a `_url` field). The read bridge maps `/api/me`'s `documents` booleans directly;
  the `*_doc_url` fields **stay undefined** (honest — no URL until on-demand presign). Pages read
  `profile.documents.*` for presence. **View** → a new `getProfileDocumentUrl(type)` → `GET
  /documents/:type` (presign **on demand**, on click).
- **D-F5-3** REMOVE — **disable the control + note** (no DELETE endpoint; don't offer an action the
  backend can't do). Replace-by-re-upload (POST overwrites) covers wrong-doc. **Track** a "document
  DELETE endpoint" → a later document-management slice.
- **D-F5-4** no wizard→profile linkage ("upload whenever" via the profile control; no signup change).
- **D-F5-5** node-only (the 2 methods + the presence mapping); RTL not activated (file-input is
  form-binding; logic is service-layer); real upload→view = phase-close human QA.
- **D-F5-6** one commit (both pages, shared methods).

---

## §2 — Inventory (CF-23 from source) + files

| File | Action |
|---|---|
| `features/auth/types/auth.ts` | add `documents?: { registration: boolean; cin: boolean }` to `BusinessProfile` |
| `features/auth/services/auth.service.ts` | add `uploadProfileDocument(type,file)` + `getProfileDocumentUrl(type)`; extend `getBusinessProfile` mapping with `documents` |
| `features/advertiser/hooks/useProfileMutations.ts` | `uploadDocument` mutation → `uploadProfileDocument('rne', file)` (drop the supabase storage body) |
| `features/auth/hooks/useOwnerProfileMutations.ts` | `uploadDocument` mutation → `uploadProfileDocument(isIndividualOwner?'cin':'rne', file)` (drop supabase) |
| `features/advertiser/pages/UserProfile.tsx` | view→`getProfileDocumentUrl('rne')`; presence→`documents?.registration`; disable remove + note |
| `features/screenhost/pages/OwnerSettings.tsx` | view→`getProfileDocumentUrl(cin/rne)`; presence→`documents?.cin`/`.registration`; disable remove + note |
| `features/auth/services/auth.service.profile.test.ts` | extend — upload + view + the `documents` presence mapping |

### §2.A — Discriminator (confirmed)
advertiser = RNE ("Registre de commerce"); owner = `isIndividualOwner ? cin : rne` (individual→CIN,
fleet→RNE). The endpoint `:type ∈ {rne, cin}` — exact match.

### §2.B — Presence is honest (D-F5-2)
`/api/me` returns `documents:{registration,cin}` (F4a `MeUser` already types it). The bridge maps it
**directly** to `BusinessProfile.documents`. `*_doc_url`/`*_doc_path` stay **undefined** (no URL
stored; the view presigns on demand). Pages read `profile.documents.registration/.cin` for the
"uploaded ✓ / needed" status — reading the right thing (the correct churn).

### §2.C — Remove disabled (D-F5-3)
No DELETE endpoint. Disable the remove control (button `disabled` + a small note; **keep the onClick
referenced** so the handler/mutation stay used — F4a-logo pattern). The remove handlers/mutations
(dead Supabase) stay defined-and-referenced-but-disabled. Replace = re-upload (POST overwrites).

---

## §3 — Commit factoring

**One commit (F5).** Shared methods + both pages' single doc-control each + the bridge `documents`
field + node tests. Smaller than F4; no advertiser/owner split.

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor **≤ 40** (the new methods typed; dropping supabase from
  `uploadDocument` may shed a supabase-typed error → possible small drop; likely flat).
- `pnpm lint` — green; **1**.
- `pnpm test` — green; **205 + N** (upload + view + presence-mapping tests, ~4–5).
- `pnpm build` — green; **~137.61 kB** ± (2 methods + the documents field; ~flat). apps/api **146**.

---

## §5 — SOP / §6 — Hard-halt / §7 — Risks

- SOP: Node-20 PATH; Conventional Commits no-trailer; CF-7 sweep; husky; clean `apiClient` mocks (F1).
- Hard-halt: a doc control needs a render-restructure beyond the handler/presence/disable (would
  pull in RTL/visual) → surface; any gate regresses → revert.
- Risks: (a) `postForm` first real use — the node test asserts the `FormData` carries the file + the
  right path (`request.file()` reads any field name, so `append('file', …)` is safe). (b) `getProfile
  DocumentUrl` 404 (no doc) → return `null`; the view handler is only reachable when presence is true,
  but defend (null → a "no document" toast). (c) the supabase view path (`createSignedUrl`) is removed
  from the page view handlers → the `registration_doc_path` branches go dead/removed (undefined
  post-bridge anyway).

---

## §8 — Cross-references

- Scoping: `phase-1f-f5-documents-scoping.md`. Backend: `routes/profile-documents.ts` (POST/GET),
  `storage/s3-storage.ts` (PutObject-overwrite), `routes/me.ts` (`documents` booleans). K: `postForm`.
  F4a: the read bridge + `MeUser` + `auth.service.profile.test.ts`.
- **Tracked later items:** the **document DELETE endpoint** (document-management slice); logo storage;
  owner-extras persistence; inline-`#76E6AB` styling.

---

## §9 — Carry-forward methodology

- **CF-24** truthful-data: the explicit `documents` field (a direct map of what `/api/me` returns)
  over the rejected sentinel — `_url` fields stay undefined because there IS no stored URL (honest).
- **CF-23** POST-overwrite + no-DELETE read from source (the verify-ask answered).
- **Deferred-surface-honest** pattern (logo/owner-extras/now-remove): disable, don't offer a broken
  action.
- **RTL still not stood up** — the 5th repoint with service-layer logic; node + human QA suffice.

---

## §10 — Push policy

F5.0 plan → push (CF-6). F5.1 code → CF-7 sweep → CF-9 pause → push on approval → CI verify. A
**light human glance** (upload a doc → presence flips → view opens) is the phase-close QA; the gate is
node tests. No deps/backend.

---

## §11 — Exact changes (F5.1)

### §11.1 — `types/auth.ts` (BusinessProfile)
Add (optional): `documents?: { registration: boolean; cin: boolean };`

### §11.2 — `auth.service.ts`

```ts
// Phase-1f F5 — document upload (multipart, post-signin; the flow-position moved off signup, which
// is unverified+logged-out and can't call this requireAuth endpoint). type ∈ rne|cin (by role).
async uploadProfileDocument(type: 'rne' | 'cin', file: File): Promise<{ type: string; key: string }> {
  const form = new FormData();
  form.append('file', file); // request.file() reads the first file — field name is irrelevant
  try {
    return await apiClient.postForm<{ type: string; key: string }>(`/profile/documents/${type}`, form);
  } catch (error) {
    throw new Error(apiErrorMessage(error));
  }
},

// Presign the stored document on demand (presigned URLs expire — fetched on view, not stored).
// 404 (no document of that type) → null. The column holds the key; the backend presigns it.
async getProfileDocumentUrl(type: 'rne' | 'cin'): Promise<string | null> {
  try {
    const { url } = await apiClient.get<{ url: string }>(`/profile/documents/${type}`);
    return url;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw new Error(apiErrorMessage(error));
  }
},
```
In `getBusinessProfile`'s returned object, add:
```ts
    documents: { registration: user.documents.registration, cin: user.documents.cin },
```

### §11.3 — `useProfileMutations.ts` (advertiser) — `uploadDocument`
Replace the supabase storage body with:
```ts
const uploadDocument = useMutation({
  mutationFn: (file: File) => authService.uploadProfileDocument('rne', file),
  onSuccess: invalidateProfile, // refetch /api/me → documents.registration flips to true
});
```
(Drop the now-unused supabase/log imports IF nothing else in the file uses them — `uploadLogo` still
uses supabase, so it stays.)

### §11.4 — `useOwnerProfileMutations.ts` — `uploadDocument`
```ts
const uploadDocument = useMutation({
  mutationFn: ({ file, isIndividualOwner }: DocumentInput) =>
    authService.uploadProfileDocument(isIndividualOwner ? 'cin' : 'rne', file),
  onSuccess: invalidateProfile,
});
```
(`removeDocument` stays — the control is disabled, §2.C; `uploadLogo` keeps supabase, dead.)

### §11.5 — `UserProfile.tsx`
- `openDocumentForView`: keep the `documentFile` local-preview branch; replace the
  `registration_doc_path`/`registration_doc_url` branches with:
  ```ts
  const url = await authService.getProfileDocumentUrl('rne');
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
  else toast.error('Aucun document à afficher');
  ```
- **Presence** (`:980` block, and any `registration_doc_path||registration_doc_url` check): →
  `profile.documents?.registration` (truthy = uploaded). `documentFile` (a freshly-picked local file)
  still shows the picked-but-not-yet-uploaded state.
- **Remove**: disable the remove button (`disabled` + a small note; keep the `onClick` referenced so
  `handleRemoveDocument` stays used). Re-upload replaces (POST overwrites).

### §11.6 — `OwnerSettings.tsx`
- `openDocumentForView`: keep `documentFile` local; replace the cin/registration branches with
  `getProfileDocumentUrl(isIndividualOwner ? 'cin' : 'rne')` → open (else toast).
- **Presence** (`:583` block): → `isIndividualOwner ? profile.documents?.cin : profile.documents?.registration`.
- **Remove**: disable + note (keep `handleRemoveDocument` referenced).

### §11.7 — `auth.service.profile.test.ts` (extend)
- `uploadProfileDocument('rne', file)` → asserts `postForm('/profile/documents/rne', form)` and the
  `form.get('file')` is the file (Node 20 global `FormData`); `'cin'` → `/profile/documents/cin`.
- `getProfileDocumentUrl('rne')` → mock `get` → `{ url }`; asserts `GET /profile/documents/rne` →
  returns the url; **404 → null**; non-404 → throws French.
- `getBusinessProfile` mapping → asserts `documents.registration/.cin` are the direct `/api/me`
  booleans (extend the existing mapping test's `meUser`).

---

## §12 — Fire instruction

After ratification: execute §11, gate-sweep (§4), CF-9 pause, push on approval → CI verify. Then F6
(the whole password domain) is drafted.
