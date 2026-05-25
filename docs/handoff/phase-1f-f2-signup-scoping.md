# Phase 1f — F2 signup-wizard scoping read (read-only)

**Source:** `apps/web` (`SignUpForm.tsx` 1987 ln, `auth.service.signUp`, `types/auth.ts`) +
`apps/api` (`routes/signup.ts`, the grown endpoint `a63b50d`) + contract §3.1/§3.7, read directly
(CF-23). **HEAD `2935697`** (K + F1 shipped), tree clean. **Date:** 2026-05-25.

**Purpose.** Read-only reconnaissance of the largest per-flow commit (the signup wizard repoint) →
a proposed F2 sub-factoring + the decisions to ratify. **No edits, no commit, no plan-doc** this turn
(reconnaissance → ratify → build, same as the keystone design read). Proposals are to ratify, not
execute (CF-22).

---

## §1 — Wizard structure + blast radius

`SignUpForm.tsx` is a **controlled** component: the parent (`pages/SignUp.tsx`) owns `currentStep`
and passes it + `onStepChange`/`onProfileTypeChange`. The wizard holds the field state.

**The 5 steps** (`switch(currentStep)` for next-gating at `:342`, render at `:1890`):

| Step | Collects | Render fn (lines) |
|---|---|---|
| 0 | profile type (`advertiser\|agency\|individual_owner\|fleet_owner`) | `renderProfileSelection` 548–658 |
| 1 | responsable: firstName/lastName, fonction, agent_toodooh, email, password+confirm, contact_phone | `renderStep1` 660–877 |
| 2 | entreprise: business_name, tax_number, sector, **company_size**, (owner: établissement name/screens/rooms) | `renderStep2` 880–1244 |
| 3 | adresse (advertiser) / établissement (indiv-owner 1245) / réseau-fleet (1369) | `renderStep3` 1667–1761 |
| 4 | documents (advertiser 1763) / coordonnées bancaires (owner 1561) | — |

**State:** `formData: Partial<SignUpData>` (`:167`) + locals (names, fonction, files
`documentFile`/`companyLogo`/`bankDocFile`, `fleetEstablishments`, conflict flags
`emailConflict`/`phoneConflict`/`checkingConflicts`). Final submit = `handleSubmit` (`:505`).

**Blast radius — the repoint is DATA-FLOW-localized; the ~1340 lines of step-render UI are
UNTOUCHED.** The repoint touches ~6 functions + the wire method:

| Touched (data-flow) | Lines | Change |
|---|---|---|
| `loadData` prefetch | 195–214 | drop `getCompanySizeOptions()` from the `Promise.all`; source company_size from a constant (D8) |
| `validatePassword` / `pwHasMinLen` / checklist | 265–272 + render | **8 → 12** (the backend floor; class-b §4.2) |
| `validateUniqueCredentials` | 283–338 | **delete the `checkSignupConflicts` server call** (`:315`); keep email/phone **format** validation |
| `goNext` step-1 branch | 409–417 | drop the server uniqueness pre-check; keep format gating |
| email/phone **blur** handlers | 731–737, 756–762 | drop the server check; the `emailConflict` "exists" message retires (format errors stay) |
| `handleSubmit` | 505–540 | build a **clean JSON payload** (accepted fields only); **drop `authService.logout()`** (`:532` — no auto-login now); new verify success message |
| `company_size` `<select>` source | 1138 | render maps the **constant** instead of `companySizeOptions` state (the `<select>` markup itself unchanged) |
| `auth.service.signUp` | 281–691 | **rewrite** ~410 → ~30 lines: one `POST /api/signup` |
| `auth.service` deletions | 178–200, 203–225, 227–244 | delete `insertFleetEstablishmentsAfterSignup`, `checkSignupConflicts`, `ensureBusinessProfileExists` (the §2.D carry-forward + signup-internal helpers) |

So the *visible diff* is ~120 lines of `SignUpForm` data-flow + the `signUp` shrink + 3 deletions —
**not 1940 lines.** The step UI (profile cards, all field markup, owner/fleet/bank steps) doesn't
change (it binds to `formData`/locals, which are unchanged).

---

## §2 — Submit-flow → grown-endpoint mapping

`handleSubmit` (`:516`) composes `signupDataWithFile: SignUpData` (spreads `formData` + files +
fleet) and calls `authService.signUp(...)`. The grown `POST /api/signup` (`signup.ts`) accepts:

| Endpoint field | Required | Wizard source | Map |
|---|---|---|---|
| `email`, `password` | ✓ | formData | direct (**password floor 8→12**, §4.2) |
| `contact_name` | ✓ | `firstName + lastName` | zero-map (snake wire) |
| `business_name` | ✓ | formData | direct |
| `contact_phone` | ✓ | `+216XXXXXXXX` | passes E.164 |
| `terms_accepted` | ✓ | formData (literal `true`) | server-stamps the time |
| `tax_number?` | opt | formData | direct (format `^[A-Za-z0-9/]{7,20}$` — **see §2.1**) |
| `profile_type?` | opt | `selectedProfileType` | sent as-is; **server** maps→role (no client map) |
| `business_type?` | opt | formData (`local`/`agency`) | direct (server override wins for agency) |
| `business_sector_id?`,`street_address?`,`city?`,`postal_code?`,`governorate_id?`,`fonction?`,`zone?`,`agent_toodooh?` | opt | formData | direct |

**Dropped on submit (endpoint does NOT accept — zod `.strip()`s; and files can't be JSON):**
`cin`, `formule`, `number_of_screens`, `number_of_rooms`, `company_size`, `registration_doc`,
`company_logo`, `bank_doc`, `fleet_establishments`.

**MISMATCH FLAG — the documents/files flow (load-bearing).** Legacy `signUp` auto-logged-in then
uploaded `registration_doc`/`company_logo` to Supabase storage + inserted `fleet_establishments` →
`locations`. The new backend: signup creates an **unverified, NOT-logged-in** user (201, verify
required). The documents endpoint (`POST /api/profile/documents/:type`) is **`requireAuth`** — so
**documents cannot be uploaded during signup** (no session). Consequences:
- Document/logo/bank upload **drops out of signup**; documents move to **post-verify→signin→profile**
  (F5). The wizard already has **`addDocumentLater`/`addBankLater`** affordances (`:141/:142`), so
  "upload later" is an existing path — F2 makes it the only path at signup.
- `fleet_establishments`→`locations` has **no endpoint** (owner slice, contract §7.2) → dropped.
- D9 (logo/bank no backend) → dropped, as ruled.

**The `signUp` method shrinks to:** build the accepted-fields JSON from `SignUpData`, `POST
/api/signup`, return the `{userId,email,verificationRequired,message}` (or throw
`apiErrorMessage`). All the Supabase orchestration (the `validate_signup_profile_type` RPC, the
`business_profiles` insert + RPC fallback, the document/logo upload, the fleet insert, the
profile-type precheck, the agency-sector resolution) is **removed** — the backend owns it now.

### §2.1 — Minor flags
- **tax format:** the wizard has **no tax format rule** (contract §3.1); the backend enforces
  `^[A-Za-z0-9/]{7,20}$`. A malformed tax → **400 INVALID_INPUT** surfaced via `apiErrorMessage`
  (field echoed). No FE pre-validation. (Minor; could add a format hint later.)
- **tax required-ness:** the wizard **requires** `tax_number` for ALL types (`canGoNext` step-2
  `:366/:374`); the backend + ruling §7.2 made it **optional for owners** (they have no matricule;
  the legacy `TEMP-…` auto-fill is **gone**). So F2 either (a) leaves the wizard requiring it
  (owners must type something — no break) or (b) relaxes the owner requirement (truthful to §7.2).
  **Surfaced — D-F2-4.**
- **agency:** the wizard resolves `business_sector_id` client-side (`:254` from
  `AGENCY_BUSINESS_SECTOR_NAME`) and sends `profile_type='agency'`+`business_type='agency'`; the
  server maps `agency→role=advertiser+business_type=agency`. No conflict (server override wins).

---

## §3 — Anti-enumeration removal — the UX consequence (for ruling)

Today the wizard has a **client-side email-existence oracle**: `validateUniqueCredentials`
(`:315`) calls `checkSignupConflicts` and shows **"Cette adresse email existe déjà"** inline
(`:737`) + a toast (`:327`), fired on **email blur** (`:731`) and **step 1→2 advance** (`:411`) —
blocking advance for a taken email.

Removing it (the class-b §4.1 / §2.D deletion) means:
- The wizard **can no longer tell the user "email already taken" before submit** — that disclosure
  IS the enumeration vuln.
- On submit, a duplicate email gets the backend's **201-generic** ("check your email") — identical
  to a new signup. A duplicate-email user sees the **same success** and simply receives **no new
  verification email** (the backend sends one only for a genuinely new account).
- Kept: email/phone **format** validation (`emailRegex`, `isValidTunisiaPhone`) — those are not
  oracles. `emailConflict`/`phoneConflict` stay for **format** messages only.

**This is a deliberate security-driven UX change, not a regression** — but it changes what the user
sees (no pre-submit "taken" warning; a duplicate gets a success screen with no email). **Surfaced
for ruling — D-F2-2.** (Accept as the anti-enumeration cost, per contract §7.3.1.)

---

## §4 — `company_size` hardcode (D8)

`getCompanySizeOptions()` (Supabase, advertiser/agency path; owners already use the
`parcCountOptions` constant `:879`) → a frontend constant. The `<select>` (`:1138`) renders
`<option value={o.value}>{o.value}</option>` — **only the value string** is shown/submitted (and
the field is backend-stripped anyway). Legacy seed (schema-inventory §165, 5 rows):

```ts
const companySizeOptions = ['0 - 10', '10 - 50', '50 - 100', '100 - 500', '500 et plus'];
```

Drop `getCompanySizeOptions()` from the prefetch `Promise.all`; map this constant. (This is what
still makes the wizard's prefetch fail post-F1 — F2 fixes it.) **D-F2-3 — confirm the list.**

---

## §5 — Proposed sub-factoring: ONE commit (F2)

**Recommend a SINGLE commit.** Rationale:
- The blast radius is **data-flow-localized** (§1) — the 1340-line step UI is untouched; the real
  diff is ~6 `SignUpForm` functions + the `signUp` shrink + 3 deletions.
- The changes are **atomically coupled**: the enumeration removal spans both files (delete
  `checkSignupConflicts` *and* its `SignUpForm` callers — split → typecheck-red or a half-removed
  oracle); the `signUp` rewrite pairs with `handleSubmit` (drop the post-signup `logout()` — split →
  signup would `POST /signout`→401→error-toast after a *successful* signup, a **broken-feature
  intermediate** even though gates pass).

**Rejected — a 2-way split** (F2a `auth.service` wire + F2b `SignUpForm`): leaves signup
functionally broken between commits (the logout-after-signup 401). Mechanical/judgment separation
isn't worth a broken intermediate when the diff is this localized.

If the architect still wants a split, the only green seam is **company_size hardcode + password-12
as a tiny pre-commit** (pure FE, independent) then **the signup repoint** (wire + enumeration +
handleSubmit together) — but I lean one commit.

---

## §6 — Test bar (D10)

This is the first rendered **multi-step UI** repoint. Proposed bar:
- **Node-level `signUp`-payload test** (the repoint's core): mock `apiClient.post` (clean mock
  object, **not** a real-module spread — the F1 carry-forward), assert `signUp(SignUpData)` →
  `POST /signup` with the **mapped accepted-fields JSON**, files + owner-extras + fleet **dropped**,
  `profile_type` sent, and the `apiErrorMessage` throw on failure. Plus a `validatePassword(12)`
  unit.
- **Component/render tests → NOT activated in F2.** A full RTL multi-step fill (jsdom + Testing
  Library, not installed) across 5 steps + 4 profile paths (owner/fleet branches, file inputs) is
  **high-cost, low-marginal-value** vs the node payload test — and the wizard is the project's most
  **visual** surface. Defer rendered correctness to **human visual QA at phase close** (D10:
  component tests + running-both deferred) + the running-both round-trip (a real signup→201→verify
  email).
- **Recommend:** node-level payload test + password unit as the per-commit bar; the wizard's
  rendered correctness is the phase-close human-QA gate. **D-F2-6.**

---

## §7 — Decisions for architect ruling (CF-22)

- **D-F2-1 — documents/logo/bank/fleet dropped from signup** (no pre-auth endpoint; documents move
  to post-verify→signin→profile in F5; logo/bank per D9; fleet = owner slice). The wizard keeps
  collecting (steps untouched, `addDocumentLater` already exists). *Lean: drop-on-submit; F5 owns
  document upload.* **Load-bearing (a flow change).**
- **D-F2-2 — anti-enumeration UX:** no pre-submit "email taken"; a duplicate gets the 201-generic
  success + no email. *Lean: accept (the §7.3.1 cost).*
- **D-F2-3 — `company_size` constant** = `['0 - 10','10 - 50','50 - 100','100 - 500','500 et plus']`
  (legacy seed). *Lean: confirm.*
- **D-F2-4 — tax for owners:** wizard requires it for all; backend optional for owners (no more
  `TEMP-…`). *Lean: F2 keeps the wizard requiring it (no break); relax-for-owners is a later polish
  (truthful to §7.2 but a wizard-validation change).* Surface.
- **D-F2-5 — sub-factoring → ONE commit** (§5). *Lean: one.*
- **D-F2-6 — test bar → node-level `signUp`-payload + password unit; component/round-trip → phase
  close** (§6). *Lean: as stated.*
- **D-F2-7 — success handling:** remove `authService.logout()` post-signup; success message →
  "vérifiez votre email"; navigate `/login`. (The `/auth/verify-email` *page* is F3; F2 shows the
  message + routes to `/login`.) *Lean: as stated.*

---

## Document status

**Read-only scoping read — produced, HELD for review (not committed).** Maps the wizard structure +
the data-flow blast radius (§1, step UI untouched), the submit→grown-endpoint mapping with the
documents-flow mismatch (§2), the anti-enumeration UX consequence (§3), the `company_size` constant
(§4), the one-commit recommendation (§5), the node-level test bar (§6), and seven decisions for
ruling (§7). Nothing resolved unilaterally — the F2 plan-doc is drafted only after the architect
rules §7.
