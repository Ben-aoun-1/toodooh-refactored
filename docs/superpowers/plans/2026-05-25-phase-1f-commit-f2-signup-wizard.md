# Phase 1f — Commit F2: signup-wizard repoint

**Status:** DRAFT (F2.0) — held for architect review (not committed, not executed).
**Design authority:** `phase-1f-f2-signup-scoping.md` (§7 rulings D-F2-1…7, all ratified).
**Region:** `apps/web`. **HEAD at draft:** `2935697` (K + F1 shipped).
**Backend:** `POST /api/signup` grown in Phase-1e Part-A (`a63b50d`).

The largest per-flow commit by file size — but the **repoint is ~120 visible-diff lines + the
`signUp` shrink (~410→~30) + 3 deletions**; the ~1340 lines of step-render UI are untouched (scoping
§1). **ONE commit** (D-F2-5 — the changes are atomically coupled; a split ships a broken-feature
intermediate).

---

## §0 — Pre-flight verification (run at execution start, CF-10)

- `git status` clean; HEAD `2935697`.
- Post-F1 floor: **apps/web typecheck 49 · lint 1 · test 187 (25 files) · build 139.39 kB gzip**.
  `apps/api` 146 (untouched). Re-run all four; record actuals.
- Node 20 PATH.

---

## §1 — Locked constraints (rulings, scoping §7)

- **D-F2-1** documents/logo/bank/fleet **not sent at signup** (a CONSTRAINT — the documents endpoint
  is `requireAuth`, the new user is unverified+logged-out; upload moves to **F5** post-signin). The
  wizard keeps collecting (steps untouched; `addDocumentLater`/`addBankLater` already exist).
- **D-F2-2** delete the client-side email-exists oracle; duplicate → 201-generic. Format validation
  stays.
- **D-F2-3** `company_size` constant `['0 - 10','10 - 50','50 - 100','100 - 500','500 et plus']`.
- **D-F2-4** keep the wizard's tax-required; **drop the dead `TEMP-…` fallback**; relax-for-owners is
  later polish (not F2).
- **D-F2-5** ONE commit.
- **D-F2-6** node-level test bar (signUp payload + password util); component/round-trip → phase close.
- **D-F2-7** remove the post-signup `logout()`; success → "vérifiez votre email" → `/login`.
- `profile_type` sent, **server-mapped** (no client map); `contact_name` zero-map; `agent_toodooh`→
  (server) `agent_code`; `terms_accepted` boolean (server-stamps); tax optional+lenient; password
  floor **8→12**; owner-extras collected + backend-stripped (no wizard change).
- **F5 SCOPE NOTE (recorded):** F5 is NOT a naive `supabase.storage`→API swap — the upload
  **flow-position moved** to the post-signin profile context. Scope F5 accordingly.

---

## §2 — Inventory (CF-23 from source) — files + the exact edits

### §2.A — Files

| File | Action |
|---|---|
| `features/auth/services/auth.service.ts` | rewrite `signUp` (~410→~30); delete `insertFleetEstablishmentsAfterSignup`, `checkSignupConflicts`, `ensureBusinessProfileExists` |
| `features/auth/components/SignUpForm.tsx` | data-flow edits (~6 sites); step UI untouched |
| `features/auth/utils/password.ts` | **NEW** — the 12-char policy (testable; F6 reuses) |
| `features/auth/types/auth.ts` | add `SignupResponse` (the endpoint's 201 body) |
| `features/auth/services/auth.service.signup.test.ts` | **NEW** — node-level payload test |
| `features/auth/utils/password.test.ts` | **NEW** — policy unit test |

### §2.B — `SignUpForm.tsx` edit sites (step UI NOT touched)

| Site | Lines | Edit |
|---|---|---|
| `companySizeOptions` state + `CompanySizeOption` import | 137, 28 | **remove** (replaced by the module constant) |
| `loadData` prefetch | 198–208 | drop `getCompanySizeOptions()` from the `Promise.all` (3 calls, not 4) |
| `company_size` `<select>` render | 1138–1142 | map the `COMPANY_SIZE_OPTIONS` constant (`<option value={v}>{v}`) |
| `validatePassword` / `pwHasUpper/Digit/MinLen` | 265–272 | use `password.ts` (`isValidPassword`/`passwordChecks`); floor 12 |
| checklist label | 871 | `Minimum 8 caractères` → `Minimum 12 caractères` |
| `validateUniqueCredentials` | 283–338 | **format-only** (delete the `checkSignupConflicts` call + `checkingConflicts`); SYNC |
| `checkingConflicts` state | 165, 360 | **remove** (no async server check anymore) |
| `goNext` step-1 branch | 409–417 | sync format gate (no `await`) |
| `handleSubmit` | 505–540 | remove `logout()` (`:532`) + the `setTimeout(1000)` (`:531`); verify success message |
| email/phone **blur** | 731, 756 | **unchanged** — `validateUniqueCredentials` still exists (now format-only) |

### §2.C — `auth.service.ts` — `signUp` callers + deletion safety

- `signUp` external caller: `SignUpForm.handleSubmit` only (passes `SignUpData`; ignores the return
  — return-type change is safe).
- `checkSignupConflicts`: callers = old `signUp` (removed by the rewrite) + `SignUpForm`
  `validateUniqueCredentials` (removed in §2.B) → safe to delete.
- `ensureBusinessProfileExists` / `insertFleetEstablishmentsAfterSignup`: only old-`signUp`-internal
  → safe to delete.
- After the edits: `supabase`, `mapAuthError`, `getAppUrl`, `isErrorWithCode`, all type imports stay
  (used by the deferred F5/F6 methods). `apiClient`/`apiErrorMessage` already imported (K). **No
  unused-import lint** (verify at execution).

---

## §3 — Commit factoring

**Single commit (F2.1)** — D-F2-5. The wire rewrite + the wizard data-flow + the deletions + the
util + tests are one coherent "signup works against `apps/api`" change; the only green-and-coherent
boundary is the whole thing (a split leaves the post-signup `logout()`→401 broken intermediate).

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor **≤ 49** (the 5 `signUp` `authData.user` errors **leave** with the
  rewrite — expect a **drop to ~44**; quantified at execution, not pre-committed).
- `pnpm lint` — green; **1** (database.types floor).
- `pnpm test` — green; **187 + N** (signup payload ~5 + password ~4; the ratchet).
- `pnpm build` — green; **≤ 139.39 kB** gzip (the ~380-line `signUp` Supabase orchestration leaves —
  expect a **dip**).

---

## §5 — Standing operating procedure

Node-20 PATH on gates + commit. Conventional Commits, no `Co-Authored-By`. CF-7 gate-sweep. Husky
lint-staged on staged files. **Clean mock objects** for `apiClient` in tests (F1 carry-forward — no
real-module spread; `mockRejectedValueOnce` for the error path).

---

## §6 — Hard-halt conditions

- A step-UI render change proves necessary (the repoint should be data-flow only) → halt + surface
  (would mean activating frontend-design / visual QA mid-commit).
- An unused-import / dead-state lint after the deletions that needs a non-obvious call → surface.
- Any gate regresses (typecheck > 49, test < 187, build > 139.39, lint ≠ 1) → revert, surface.
- The `signUp` payload can't omit empty optionals cleanly (endpoint `min(1)`/`uuid` rejects `''`) —
  the conditional spread (§11.1) must hold; verify in the payload test.

---

## §7 — Risk register

- **Empty-optional 400s:** the endpoint's optional fields are `min(1)`/`uuid`/`^\d{4}$` — sending
  `''` → 400. The payload builder **omits** empty optionals (conditional spread). Asserted in the
  payload test.
- **`profile_type` privilege:** sent as a non-privileged hint; the server maps it (role stays
  `input:false`). The wizard never sends role/status. (No `is_admin`/`verification_status` either —
  those were Supabase-insert fields, gone with the rewrite.)
- **Anti-enum visible behavior:** a duplicate now reaches the 201-generic success — verified by the
  payload test (no pre-check) + the §3 human QA at phase close (the success message). Format errors
  still surface.
- **tax format:** wizard sends an unvalidated tax; a malformed value → 400 surfaced via
  `apiErrorMessage`. Acceptable (D-F2-4); no FE format rule added in F2.
- **Files in `SignUpData` passed to `signUp`:** `handleSubmit` still composes files into
  `SignUpData`; `signUp` ignores them (builds the JSON payload from the accepted fields only). No
  serialization of `File` (they're never read into the payload). Asserted (the payload has no file
  keys).

---

## §8 — Cross-references

- Scoping: `phase-1f-f2-signup-scoping.md` (§1 blast radius, §2 mapping, §7 rulings).
- Contract §3.1 (signup), §7.1/§7.2/§7.3 (Option B, profile types, class-b). Backend:
  `apps/api/src/routes/signup.ts`, `lib/profile-type.ts`.
- Keystone: `lib/api-client.ts`, `auth-errors.ts`. F1: `auth.service.reference.test.ts` (the mock
  pattern).
- Audit row at F8: `audit.md` §17. **F5 carry-forward note** (§1) — document upload flow-position.

---

## §9 — Carry-forward methodology

- **CF-24** truthful-to-frontend: the payload maps exactly what the endpoint accepts; the dropped set
  is what it strips / can't reach (documents = auth-gated).
- **CF-23** the documents-flow constraint (auth-gated endpoint vs unverified signup user) read from
  source — the repoint conforms to the auth model, not the legacy Supabase-direct upload.
- **CF-22** the §2.D deletions land here (ratified at F1 planning), atomic with their caller removal.
- **F1 carry-forward applied:** clean `apiClient` mock objects in the tests.
- **Thin-adapter note:** F2 is the stress test (largest file) — confirm at the F2.1 CF-9 whether
  "data-flow localized, step UI untouched" held (it predicts F3–F6 stay thin too).

---

## §10 — Push policy + sequencing

F2.0 plan → push (CF-6, doc). F2.1 code → CF-7 gate-sweep → CF-9 pause → push on approval → CI
headSha verify. **No visual-QA pause this commit** (no rendered step-UI change); the wizard's visual
correctness is the **phase-close** human QA (D-F2-6). No deps/backend/env changes.

---

## §11 — Exact rewrites (F2.1)

### §11.1 — `auth.service.ts`

Delete `insertFleetEstablishmentsAfterSignup` (module fn), `checkSignupConflicts`,
`ensureBusinessProfileExists`. Replace the `signUp` body:

```ts
async signUp(data: SignUpData): Promise<SignupResponse> {
  // Accepted-fields JSON (snake wire). NOT sent: files (registration_doc/company_logo/bank_doc —
  // documents upload post-signin in F5, the endpoint is requireAuth), owner-extras (cin/formule/
  // number_of_screens/number_of_rooms/company_size) and fleet_establishments (the endpoint strips
  // unknowns; owner slice has no endpoint). Empty optionals are OMITTED (the endpoint's optionals
  // are min(1)/uuid/^\d{4}$ — '' would 400). profile_type is a non-privileged hint, mapped
  // server-side (role stays input:false).
  const t = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const payload = {
    email: data.email,
    password: data.password,
    contact_name: data.contact_name,
    business_name: data.business_name,
    contact_phone: data.contact_phone,
    terms_accepted: data.terms_accepted,
    ...(t(data.tax_number) ? { tax_number: t(data.tax_number) } : {}),
    ...(data.profile_type ? { profile_type: data.profile_type } : {}),
    ...(t(data.business_type) ? { business_type: t(data.business_type) } : {}),
    ...(t(data.business_sector_id) ? { business_sector_id: t(data.business_sector_id) } : {}),
    ...(t(data.street_address) ? { street_address: t(data.street_address) } : {}),
    ...(t(data.city) ? { city: t(data.city) } : {}),
    ...(t(data.postal_code) ? { postal_code: t(data.postal_code) } : {}),
    ...(t(data.governorate_id) ? { governorate_id: t(data.governorate_id) } : {}),
    ...(t(data.fonction) ? { fonction: t(data.fonction) } : {}),
    ...(t(data.zone) ? { zone: t(data.zone) } : {}),
    ...(t(data.agent_toodooh) ? { agent_toodooh: t(data.agent_toodooh) } : {}),
  };
  try {
    return await apiClient.post<SignupResponse>('/signup', payload);
  } catch (error) {
    throw new Error(apiErrorMessage(error));
  }
},
```

### §11.2 — `types/auth.ts` (add)

```ts
/** The 201 body of POST /api/signup (Phase-1f F2). */
export interface SignupResponse {
  userId: string;
  email: string;
  verificationRequired: boolean;
  message: string;
}
```

### §11.3 — `features/auth/utils/password.ts` (NEW)

```ts
/** Password policy — the backend's floor (12 + upper + lower + digit), Phase-1f §4.2. F6 reuses. */
export const PASSWORD_MIN_LENGTH = 12;
export interface PasswordChecks { minLen: boolean; upper: boolean; lower: boolean; digit: boolean; }
export function passwordChecks(pw: string): PasswordChecks {
  return {
    minLen: pw.length >= PASSWORD_MIN_LENGTH,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
  };
}
export function isValidPassword(pw: string): boolean {
  const c = passwordChecks(pw);
  return c.minLen && c.upper && c.lower && c.digit;
}
```

### §11.4 — `SignUpForm.tsx` (per §2.B)

- Module const near the other lists: `const COMPANY_SIZE_OPTIONS = ['0 - 10','10 - 50','50 - 100','100 - 500','500 et plus'];`
- Remove the `companySizeOptions` state, `setCompanySizeOptions`, the `getCompanySizeOptions()`
  prefetch call (+ `companySizeData` destructure), the `CompanySizeOption` import.
- `validatePassword` → `isValidPassword` (import from `../utils/password`); `pwHasUpper/Digit/MinLen`
  → `const pw = passwordChecks(formData.password || '')` → `pw.upper/.digit/.minLen`. Label →
  `Minimum 12 caractères`.
- `validateUniqueCredentials` → **format-only, sync**:
  ```ts
  const validateUniqueCredentials = (showToast = true, scope: 'both'|'email'|'phone' = 'both'): boolean => {
    const email = String(formData.email || '').trim().toLowerCase();
    const phone = normalizePhone(String(formData.contact_phone || ''));
    const checkEmail = scope !== 'phone';
    const checkPhone = scope !== 'email';
    if (checkEmail && !emailRegex.test(email)) {
      setEmailConflict('Format email invalide');
      if (showToast) toast.error('📧 Veuillez saisir une adresse email valide.');
      return false;
    }
    if (checkPhone && !isValidTunisiaPhone(phone)) {
      setPhoneConflict('Numéro invalide (format attendu: +216XXXXXXXX)');
      if (showToast) toast.error('📞 Numéro invalide. Utilisez le format +216XXXXXXXX.');
      return false;
    }
    if (checkEmail) setEmailConflict(null);
    if (checkPhone) setPhoneConflict(null);
    return true;
  };
  ```
  Remove the `checkingConflicts` state + its `canGoNext` reference (`:360`).
- `goNext` step-1: `if (currentStep === 1) { if (!validateUniqueCredentials(true)) return; onStepChange(currentStep + 1); return; }`
- `handleSubmit` success block (replace `:530`–`:534`):
  ```ts
  await authService.signUp(signupDataWithFile);
  toast.success('Inscription réussie ! Vérifiez votre email pour activer votre compte.');
  setTimeout(() => navigate('/login'), 2000);
  ```
  (Removes `setTimeout(1000)` + `authService.logout()`.)

### §11.5 — Tests (node-level, clean `apiClient` mock — F1 carry-forward)

**`auth.service.signup.test.ts`** — `vi.mock('@/lib/supabase', () => ({ supabase: {} }))` +
`vi.mock('@/lib/api-client', importActual → { ApiError: actual.ApiError, apiClient: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), postForm: vi.fn(), onUnauthorized: vi.fn() } })`:
- advertiser `SignUpData` → `post('/signup', payload)`; assert payload has the accepted fields +
  `profile_type:'advertiser'`; assert **no** `registration_doc`/`company_logo`/`bank_doc`/`cin`/
  `company_size`/`number_of_screens`/`fleet_establishments` keys.
- blank `tax_number`/`zone` omitted (not `''`).
- owner with `tax_number` → included; `profile_type:'individual_owner'`.
- failure → `mockRejectedValueOnce(new ApiError({status:0,code:'NETWORK',message:''}))` →
  `rejects.toThrow(/connexion/i)`.

**`password.test.ts`** — `isValidPassword`: `<12` false, `12 no upper` false, `no digit` false,
`12 + upper + lower + digit` true; `passwordChecks` per-flag.

---

## §12 — Fire instruction

After ratification: execute §11, gate-sweep (§4), CF-9 pause, push on approval → CI verify. Then F3
(verify-email + reset pages) is drafted.
