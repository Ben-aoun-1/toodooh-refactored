# Phase 1g · G2 — UserManagement FE repoint onto the G1 admin endpoints

**Date:** 2026-05-29 · **Phase 1g commit 3 of 4** (G0/G1 shipped · **G2 this** · G3) ·
**Companion:** the ratified G2 scoping CF-9 (D-G2-1…6) + `phase-1g-admin-scoping.md` (D2) ·
**HEAD:** `6b2c15c` · **Floor:** apps/web typecheck 34 / lint 1 / test 217 / build 134.53;
apps/api typecheck 0 / lint 0 / test 174.

**Goal.** Repoint `UserManagement` (the user-approval queue) off dead-Supabase onto G1's live
`apps/api` endpoints — the 1f thin-adapter pattern, BE contract authoritative, dead Supabase severed
at the page surface. **FE-only — no apps/api change** (the G1 contract is locked). Four operations
repoint onto G1; **six no-backend operations are disabled + severed** (D-G2-1, caption-vs-wire);
G0's dead admin-auth residue is cascade-removed (D-G2-5).

---

## §0 — Source-confirm (CF-23, verified at plan-write on 6b2c15c)

- **api-client** (`lib/api-client.ts`): `apiClient.get/post<T>(path, body?, opts?)`, base `/api`,
  `credentials:'include'`, non-2xx → `ApiError{status,code,message,fields?,requestId}`; 401 trips the
  store's unauthorized handler. The 1f service pattern (`auth.service.ts`): thin method →
  `apiClient.x(...)`, `catch → throw new Error(apiErrorMessage(error))` (`auth-errors.ts`). The
  doc-presign precedent is literally `apiClient.get<{url}>('/profile/documents/${type}')`
  (`auth.service.ts:238`).
- **UserManagement deps:** `UserManagement.tsx` → `useUsers`/`useUserMutations` (`:24`) + the
  `AdminUser` type (`:25`) + `useAuthStore` identity (`:26`); **no direct supabase/admin.service
  import.** `useUsers.ts` imports `supabase` (bulk + upload + agent-code go direct to Supabase).
  `admin-user.service.ts` is all dead-Supabase.
- **The action inventory (`useUsers.ts`) vs the G1 contract** — verified:
  | useUsers op | G1 endpoint | G2 |
  |---|---|---|
  | `getUsers` | `GET /api/admin/users?status=` | repoint (3-call merge, §2.B) |
  | `approveUser` | `POST …/approve` | repoint (one-click) |
  | `rejectUser` | `POST …/reject` | repoint + **reject-notes modal** (D-G2-3) |
  | doc-view ("Voir le document") | `GET …/:id/documents/:type` | repoint (presign-on-click) |
  | `deleteUser`, `bulkApprove`, `bulkReject`, `bulkDelete`, `uploadUserDocument`, `saveAgentCode` | **none** | **disable + sever** (D-G2-1) |
- **G1 response shape** (`routes/admin.ts` `toAdminUserView`): snake_case `/api/me` projection +
  `created_at` + trio (`validated_by/at`, `validation_notes`) + `documents:{registration,cin}`
  **booleans** (NOT URLs) + `agent_code`. **No `user_id`** (the collapse — `id` is the only id).
  **Functional-reduction fields absent** (`cin` number, `number_of_screens`, `formule`,
  `verification_status`, `company_size`) — D-G2 confirmed null-guard render.
- **admin.service.ts dead-auth residue (FINDING, D-G2-5):** `login`/`logout`/`getCurrentAdmin`
  shipped despite the G0 plan §2.F saying remove; grep on 6b2c15c → **zero callers** (G0 deleted
  `admin.store`). `mapAdminError` is **NOT** orphaned (`createAdmin:162` calls it). The rest
  (`createAdmin`/`getAdmins`/`updateAdmin`/`deleteAdmin`/`reactivateAdmin`/`getDashboardStats`/
  `logActivity`/`getActivities`) is consumed by `useAdmins`/`AdminManagement`/`CreateAdmin` —
  **deferred pages, out of scope**. So `admin.service.ts` SURVIVES; G2 trims only the 3 zero-caller
  methods.
- **`admin-user.service.ts` dead methods:** `getUserStats`/`getUserDetails`/`getMockUsers` —
  grep → **zero callers** (the stat cards compute inline from the list). Removable.
- **The UI structure (anchors):** filters/tabs (`:445-472`), bulk bar gated on `showBulkActions`
  (`:477-527`), 4 stat cards computing from the full `users` list (`:529-584`), table actions Eye/
  approve/reject(pending-only)/delete (`:655-694`), detail modal (doc-view hrefs + admin upload +
  agent-code input), delete modal (`handleDeleteUser`/`showDeleteModal`/`userToDelete`).

**Halt-on-finding** if any caller-state above differs at execution (re-grep before each removal —
the F7a/b cascade discipline; do not trust this section's counts, verify dead-at-execution).

## §1 — Locked constraints

- **FE-only**, no apps/api change (G1 contract locked).
- **D-G2-1:** the 6 no-backend ops are **disabled + Supabase-severed** — no client-side bulk loops
  (atomicity/audit reasons). Each tracked as a future-slice carry-forward (§7).
- **D-G2-2:** queue read = **3 parallel `useQueries`** (pending/approved/rejected) merged into one
  list — preserves the all-tab + the 4 stat cards (which need all statuses at once).
- **D-G2-3:** reject requires a non-empty reason → a **reject-reason modal**.
- **D-G2-4:** 409 → a **prior-state modal** (date + status + prior notes + refresh); **no
  `validatedBy` uuid shown** (un-humanizable without an admin-listing endpoint).
- **D-G2-5:** fold the 3 admin.service dead-auth removals into G2; `mapAdminError` stays.
- **D-G2-6:** **one commit**; if the diff exceeds **~800 net lines or 6-7 files**, surface for split.
- **No invented data** for the functional-reduction fields (null-guard / "Non fourni").
- `lib/supabase.ts` **stays** (deferred admin pages + 59 later-slice importers).

## §2 — Change set per file

### §2.A — `admin-user.service.ts` — thin api-client adapter (1f pattern, keep the service file)
- **Repoint** (drop the `supabase` import):
  - `getUsers(status: 'pending'|'approved'|'rejected'): Promise<AdminUser[]>` →
    `apiClient.get<{users: AdminUserWire[]}>('/admin/users?status='+status)`, map wire→`AdminUser`.
  - `approveUser(id, notes?): Promise<void>` → `apiClient.post('/admin/users/'+id+'/approve', notes ? {notes} : {})`.
  - `rejectUser(id, notes): Promise<void>` → `apiClient.post('/admin/users/'+id+'/reject', {notes})`.
  - `getDocumentUrl(id, type:'rne'|'cin'): Promise<string>` →
    `apiClient.get<{url}>('/admin/users/'+id+'/documents/'+type)` → `url`.
  - All `catch → throw new Error(apiErrorMessage(error))` (or rethrow `ApiError` so the 409 modal can
    read `.code`/`.status`/body — **propose: rethrow `ApiError`** for the mutations so the page can
    branch on `CONFLICT`, vs the string-throw the old boolean-returning methods used).
- **Behavior shift:** the old `approveUser`/`rejectUser` returned `boolean`; the repointed ones throw
  on failure (the api-client raises `ApiError`). useUsers' `onSuccess`/`onError` adapt.
- **Remove (zero-caller):** `getUserStats`, `getUserDetails`, `getMockUsers`, `deleteUser`.
- **`AdminUser` type:** drop `user_id` usage (map to `id`); `cin_doc_url`/`registration_doc_url`
  become optional/derived-from-presence (the view fetches on click); keep the reduction fields
  optional (undefined from the wire). Map `documents.{registration,cin}` → presence flags.

### §2.B — `useUsers.ts` — `useQueries` merge + mutation repoint + supabase severance (drop the import)
- `useUsers()` → **`useQueries`** over the 3 statuses calling `adminUserService.getUsers(status)`;
  merge `data` into one `AdminUser[]`; `loading = any isLoading`, `isError = any isError`. Keep the
  `adminKeys.users()`-family for invalidation (add a per-status key `adminKeys.usersByStatus(status)`
  in `queryKeys.ts`, or key off `[...users(), status]`).
- `approveUser`/`rejectUser` mutations → wrap the repointed service; `onSuccess` invalidate the
  users family; `onError` surface `ApiError` (the page handles 409). `rejectUser` input gains `notes`.
- **Remove** the mutations: `deleteUser`, `bulkApprove`, `bulkReject`, `bulkDelete`,
  `uploadUserDocument`, `saveAgentCode` (D-G2-1). Drop the `supabase` import (it was their only user).

### §2.C — `UserManagement.tsx` — repoint + disable/sever + the two modals
- **Queue/stat-cards/filters:** unchanged logic — they read the merged `users` list (so the all-tab +
  client filter + the 4 stat cards keep working under the 3-call merge).
- **Approve:** `handleApprove` → `approveUser.mutateAsync({id})`; on `ApiError` 409 → open the
  prior-state modal (§3.B); else success/error toast.
- **Reject:** the per-row reject button + the (removed) bulk path → open the **reject-reason modal**
  (§3.A); on submit call `rejectUser.mutateAsync({id, notes})`; 409 → prior-state modal.
- **Doc-view:** the modal's "Voir le document" `href={…doc_url}` → a **button** that calls
  `adminUserService.getDocumentUrl(id, type)` then `window.open(url)`; render the button only when
  the presence flag is true; map `USER_NOT_FOUND`/`DOCUMENT_NOT_UPLOADED` to toasts.
- **DISABLE + SEVER (D-G2-1):**
  - **Bulk:** remove the row-selection checkboxes + select-all + the bulk action bar (`:477-527`) +
    `selectedUsers`/`showBulkActions`/`bulkActionLoading` state + `handleBulkApprove/Reject/Delete` +
    `handleSelectUser`/`handleSelectAll`/`clearSelection`. (No meaningful disabled half-state for a
    selection feature — remove it; track the bulk backend.)
  - **Single delete:** the per-row Trash2 + the delete modal + `handleDeleteUser`/`confirmDelete`/
    `userToDelete`/`showDeleteModal`/`deleting`. **Propose: render the Trash2 disabled with a
    "Suppression — bientôt disponible" tooltip** (D-F7-2 caption-honest), wiring severed; OR remove
    it. **Watch-item for QA** (remove-vs-disable visual).
  - **Admin doc-upload:** in the modal, replace the file-input + Uploader button (+ `documentFile`/
    `uploadingDocument`/`handleUploadDocument`) with a "Upload admin — bientôt disponible" caption.
    The doc-VIEW stays live.
  - **Agent-code:** `agent_code` IS returned by G1 → render it **read-only** (display the value);
    remove the editable input + `agentCodeInput`/`handleSaveAgentCode`/`saveAgentCode`. Caption
    "Édition — bientôt disponible".
- **Functional-reduction fields:** keep the existing `selectedUser.X || 'Non fourni'` null-guards
  (no change — the wire just omits them).

### §2.D — `admin.service.ts` — remove the 3 dead-auth methods (D-G2-5)
- Remove `login`, `logout`, `getCurrentAdmin` (zero-caller post-G0). **Keep** `mapAdminError`
  (createAdmin) + all the deferred-page methods + the supabase import (still used by the survivors).

### §2.E — `queryKeys.ts` — per-status key (if needed for the 3-call merge)
- Add `usersByStatus: (status) => [...adminKeys.all, 'users', status]` (or reuse `[...users(), status]`).
  Invalidation targets the `users()` prefix to catch all three.

## §3 — New UI (two small modals, inline in UserManagement or a `components/` file)

### §3.A — Reject-reason modal (D-G2-3)
Title "Rejeter {contact_name}?"; textarea label "Raison du rejet (obligatoire)"; Cancel + Rejeter;
**Rejeter disabled until `notes.trim()` non-empty**; on submit close + `rejectUser.mutateAsync`. Matches
the existing delete-modal styling (the project's modal pattern).

### §3.B — 409 prior-state modal (D-G2-4)
Opened when approve/reject throws `ApiError` with `status===409`. Reads the body's `currentStatus`,
`validatedAt`, `validationNotes` (from `ApiError` — **propose extending `ApiError`/the catch to carry
the parsed body**, or re-fetch). Message: "Déjà {approuvé/rejeté} le {date} — {notes}". **Refresh**
button → invalidate the users family. **No `validatedBy` uuid shown.** *Open sub-point: `ApiError`
today carries `code/message/fields/requestId` but not arbitrary body fields (`currentStatus` etc.) —
either (a) extend the catch to parse them, or (b) the modal shows status+date from the row already in
the list (the stale row) + a refresh. Lean (b): use the list's known row for context, refresh to
reconcile — avoids widening `ApiError`. Surface at plan review.*

## §4 — Test bar + gates
- **No new unit tests** (1f thin-adapter: load-bearing logic is BE, tested in G1; RTL not stood up).
  Verified by **MABA visual QA** + gates flat. Proportionate.
- Gate expectations (§7 floor).

## §5 — Hard-halt conditions
- §0 caller-state drift (re-grep before each removal — F7a/b discipline).
- A removed method turns out to have a live caller (would change scope).
- typecheck UP or lint off 1; apps/api gates move (would mean a stray BE touch).
- Diff exceeds ~800 net lines / 6-7 files (D-G2-6 split-reconsideration surface).

## §6 — Sub-factoring
**One commit** (D-G2-6) — UserManagement updated to match G1's real contract is one coherent story.
Subject: `feat(web): Phase-1g G2 — repoint UserManagement onto the G1 admin endpoints; disable+sever the no-backend ops`. No `Co-Authored-By`.

## §7 — Carry-forwards (future-slice, tracked) + floor
- **Bulk-ops slice:** bulk approve/reject/delete endpoints + re-enable the selection UI.
- **User-delete endpoint:** `DELETE /api/admin/users/:id` (cascade rules) + re-enable Trash2.
- **Admin-doc-upload endpoint:** admin `POST /api/admin/users/:id/documents/:type` + re-enable upload.
- **Agent-code slice:** an agent-code write endpoint + re-enable the input (read-only display ships now).
- **Floor:** apps/web typecheck **34 → likely DOWN** (dead admin-auth `any`/types clear as Supabase
  severs); lint **1** (database.types floor, clears at last-slice); test **217 flat**; build **DOWN**
  (dead Supabase severed). apps/api **untouched**.

## §8 — Cascade grep-verifications (at execution, F7a/b)
- After severing useUsers + admin-user.service: re-grep `@/lib/supabase` in both → expect zero →
  drop the imports. `lib/supabase.ts` **stays** (deferred pages + 59 later-slice importers).
- After removing admin.service login/logout/getCurrentAdmin: re-grep → expect zero callers.
- After removing the AdminUser-service dead methods: re-grep each name → expect zero.

## §10 — Files touched (estimate)
```
M  apps/web/src/features/admin/pages/UserManagement.tsx           # repoint + disable/sever + 2 modals
M  apps/web/src/features/admin/hooks/useUsers.ts                  # useQueries merge + mutation repoint + drop supabase
M  apps/web/src/features/admin/services/admin-user.service.ts     # thin api-client adapter + drop supabase + dead-method removal
M  apps/web/src/features/admin/services/admin.service.ts          # remove 3 dead-auth methods (D-G2-5)
M  apps/web/src/features/admin/hooks/queryKeys.ts                 # per-status key (if needed)
```
**~5 files, all apps/web.** No apps/api, no test, no lockfile. (Within the D-G2-6 threshold; re-check at execution.)

## §11 — Exact change set (the load-bearing edits)
1. **admin-user.service.ts:** rewrite `getUsers`→`getUsers(status)` (api-client + wire→AdminUser map);
   `approveUser(id,notes?)`/`rejectUser(id,notes)` (api-client, rethrow ApiError); add
   `getDocumentUrl(id,type)`; delete `getUserStats`/`getUserDetails`/`getMockUsers`/`deleteUser`;
   remove the supabase import; adjust the `AdminUser` type (`user_id`→`id`, doc fields presence-based).
2. **useUsers.ts:** `useUsers()`→`useQueries` 3-status merge; `approveUser`/`rejectUser` mutations
   (notes on reject); delete the 6 no-backend mutations; remove the supabase import.
3. **UserManagement.tsx:** repoint approve/reject (modal)/doc-view(on-click); add the reject + 409
   modals; remove the bulk selection UI + state + handlers; disable/caption single-delete + admin-
   upload; render agent-code read-only; keep the null-guards.
4. **admin.service.ts:** delete `login`/`logout`/`getCurrentAdmin`.
5. **queryKeys.ts:** add the per-status accessor if the merge needs distinct keys.

## §12 — Status
Drafted, awaiting ratification. FE-only. On ratification: §0 re-grep → apply → ROOT gate-sweep
(typecheck/lint/test/build) + MABA visual QA → CF-9 → push. G3 (audit refresh + 1g close) follows.
