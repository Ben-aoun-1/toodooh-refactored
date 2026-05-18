# Step 12 — Tailwind brand token + brand refresh (Issue #10)

_Plan doc. Written 2026-05-18 at baseline `df0beec` (Step 11 closed)._

---

## §0 Pre-flight verification

- **Baseline commit:** `df0beec` — Step 11 (`jsx-a11y` + `exhaustive-deps`) closed.
- **Working tree:** clean.
- **Gates (fresh runs at `df0beec`):**
  - typecheck **51**
  - lint **1** (1 error / 0 warnings — the Phase-1 `import-x/no-unresolved` on `src/lib/supabase.ts`, #15)
  - test **160** (21 suites)
  - build main `index` gzip **139.82 kB**
  - file count **236** `.ts`/`.tsx` under `apps/web/src/`
- **Audit:** roadmap row 12 (`Tailwind brand token`, #10) is `☐`.

**Build-baseline note (CF-10).** The Step 12 brief stated the baseline build as
`139.58 kB`; a fresh build at `df0beec` measures **`139.82 kB`**. `df0beec` is
doc-only on top of `5f8dbae` (where `139.58` was measured), so the bundle is
byte-identical between them — the 0.24 kB delta is gzip/measurement noise, not a
regression. **Step 12 anchors on the live figure `139.82 kB`.**

---

## §1 Locked constraints

- **D-A — Token naming is SEMANTIC.** Tailwind tokens describe role, not brand
  vocabulary:

  | Brand color | Hex | Token |
  | --- | --- | --- |
  | Plantation (dark forest green) | `#204B43` | `brand-deep` |
  | Algae Green (mint, primary accent) | `#76E6AB` | `brand-primary` |
  | Portage (periwinkle accent) | `#9195F8` | `brand-accent` |

  Three colors, no shade scale, no tints — the brand guidelines show the palette
  explicitly; no extrapolation.

- **D-B — Plantation and Portage are CONFIG-ONLY in Step 12.** `brand-deep` and
  `brand-accent` are added to `tailwind.config.js` so the tokens exist, but **no
  existing component is converted to use them**. They have zero current code
  consumers; introducing them into the UI is deliberate Phase-1+ work. Only
  `brand-primary` (Algae Green replacing `#00B3A6`) actively converts sites in
  Step 12.

- **D-C — Visual QA is human-driven against project-knowledge screenshots.**
  After the codemod commit lands locally and passes its four gates, the user
  runs `pnpm dev` (Supabase creds in `apps/web/.env.local`) and walks the ~20
  documented surfaces with the matching screenshots open side-by-side.
  **Approval gates the push.**

- **Cleanup-phase contract carve-out.** Steps 1–11 honored "no user-facing
  UI/UX change." **Step 12 is the documented exception** — the brand refresh
  *is* the deliverable; `#00B3A6` → Algae Green `#76E6AB` is an intended visual
  change. This carve-out is Step-12-only and **does not propagate to Steps
  13–14**, which resume the no-UI-change contract (see §9).

---

## §2 Inventory (re-grepped at `df0beec`)

### `#00B3A6` occurrences

**513 total** across **46 files** (`512` `#00B3A6` upper-case + `1` `#00b3a6`
lower-case). `00B3A6` without a leading `#`: 0. Literal `rgb(0, 179, 166)`: 0
(but see the jsPDF tuple below).

**CF-10 drift.** The original audit cited ~447/449. Actual is **513** — a +64
under-count in the prior figure (the audit's number predated several Step 7–10
commits that added brand-colored UI). Reported honestly; Step 12 works to 513.

#### Pattern A — Tailwind arbitrary-value classes — **502 occurrences**

`[#00b3a6]` inside utility/modifier classes. By utility prefix (counts include
`hover:` / `focus:` / `group-hover:` modifier variants as substrings):

| Utility | Count |
| --- | --- |
| `text-[#00b3a6]` | 124 |
| `bg-[#00b3a6]` | 121 |
| `ring-[#00b3a6]` | 114 |
| `border-[#00b3a6]` | 103 |
| `from-[#00b3a6]` | 16 |
| `shadow-[#00b3a6]` | 14 |
| `to-[#00b3a6]` | 9 |
| `accent-[#00b3a6]` | 1 |

All 502 are a **clean className token swap**: `…-[#00b3a6]` → `…-brand-primary`
(the bracket arbitrary-value becomes the token name; the utility prefix and any
modifier are untouched).

**Top 10 files by occurrence (line counts):**

| File | Lines w/ hex |
| --- | --- |
| `screenhost/pages/MyAccount.tsx` | 28 |
| `admin/components/AdminLayout.tsx` | 28 |
| `admin/pages/UserManagement.tsx` | 27 |
| `admin/pages/EventManagement.tsx` | 24 |
| `advertiser/pages/MyClients.tsx` | 22 |
| `admin/pages/CampaignMonitoring.tsx` | 18 |
| `screenhost/pages/OwnerDashboard.tsx` | 15 |
| `admin/pages/RechargeManagement.tsx` | 15 |
| `campaigns/pages/CampaignDetails.tsx` | 14 |
| `screenhost/pages/ContactPage.tsx` | 13 |

#### Pattern B — non-className occurrences — **11 occurrences (10 lines)**

These **cannot** be a Tailwind class swap — Tailwind tokens do not reach SVG
attributes, JS library options, jsPDF, or raw CSS:

| Site | Form | Context |
| --- | --- | --- |
| `index.css:78` | `color: #00b3a6 !important;` | CSS rule (`.leaflet-control-zoom a:hover`) |
| `GeographicZonesManagement.tsx:561` | `linear-gradient(... #00B3A6 ... #00B3A6 ...)` (×2) | inline-style range-slider track |
| `SignUpForm.tsx:1926` | `style={{ background: '#00B3A6' }}` | inline-style object |
| `GeographicZonesManagement.tsx:629,631` | `fillColor` / `color` | Leaflet circle layer options |
| `new-campaign/Step4.tsx:368,370` | `fillColor` / `color` | Leaflet circle layer options |
| `AnimatedLogo.tsx:43,65` | `stroke="#00B3A6"` | SVG attribute |
| `screenhost/services/export.service.ts:54` | `doc.setTextColor(0, 179, 166)` | jsPDF RGB tuple |

→ **Decision 1** (§ Numbered decisions) settles how these convert.

### Non-`#00B3A6` colors surfaced (not migrated)

- `index.css:72` — `color: #00263a !important;` (Leaflet zoom-control text, a
  dark navy). **Not a brand color**; coincidentally near Plantation `#204B43`
  but distinct. Left as-is — surfaced per the brief, no action.
- `index.css` Leaflet popup close-button: `#6b7280` (gray), `#ef4444` (red) —
  utility colors, not brand. No action.

### `leviosa-*` tokens — **confirmed dead**

`tailwind.config.js` defines 5 `leviosa*` colors (`leviosaYellow #FFE259`,
`leviosaBlue #2E3192`, `leviosaPurple #662D8C`, `leviosaPink #FF4E7B`,
`leviosaCyan #00B6C9`) + a `leviosa-gradient` `backgroundImage`. Consumers:

- The 5 colors are referenced **only** by 6 `@apply`-based classes in
  `index.css` — `.btn-leviosa`, `.input-leviosa`, `.card-leviosa`,
  `.modal-leviosa`, `.surface-leviosa`, `.tag-leviosa`.
- Those 6 classes have **0 component consumers** (grep for `(btn|input|card|modal|surface|tag)-leviosa` in `*.tsx` → 0).
- `leviosa-gradient` — **0 consumers**.

→ The entire `leviosa-*` token + class block is **dead code** (predates the
rebrand). → **Decision 2** settles removal-now vs follow-up TBD.

**Note:** there is **no existing `brand` token** — `tailwind.config.js` has only
`leviosa*`. CLAUDE.md's "`#00B3A6` is a Tailwind theme token (`brand`)" was
aspirational; the codebase uses `[#00b3a6]` arbitrary values throughout. Step 12
creates the `brand-*` tokens for the first time.

---

## §3 Commit factoring

| Commit | Scope |
| --- | --- |
| **1** | Plan doc (this commit). |
| **2** | `tailwind.config.js` — add `brand-primary #76E6AB`, `brand-deep #204B43`, `brand-accent #9195F8`; remove `leviosa-*` colors + `leviosa-gradient` (per Decision 2). |
| **3** | The 502 Pattern-A swaps — `…-[#00b3a6]` → `…-brand-primary` across all `*.tsx`/`*.ts`. **This is the visual-QA commit.** |
| **4** | The 11 Pattern-B sites + `index.css` — non-className conversions (per Decision 1); remove the 6 dead `.*-leviosa` classes from `index.css` (per Decision 2). Also a visual-QA commit. |
| **5** | Audit refresh (§2/§3/§4, row 12 `☑`), close #10, file any follow-up TBDs. |

Commit 3 may split by file cluster if the diff is unreviewable as one — decided
at Commit 3 execution. The swap is pattern-uniform, so a single commit is the
expectation.

---

## §4 Per-commit verification gates

Every work commit (2–4):

- typecheck **= 51** (flat — a color-value swap introduces no type change)
- lint **= 1** (the Phase-1 floor; no other rule moves — note `text-brand-primary`
  is a valid token reference, no `no-unknown-utility`-class lint exists here)
- test **= 160**
- build main gzip **139.82 ± 0.5 kB**; per-chunk **± 0.5 kB** (a token swap
  shortens class strings slightly — expect a hair *down*, not up)
- file count **= 236** under `src/` (config + any codemod script live outside
  `src/`)

---

## §5 Standing operating procedure

- **Swap mechanism.** Pattern A is a flat, unambiguous string substitution —
  `[#00b3a6]` only ever occurs as a Tailwind arbitrary value, and every
  occurrence maps to the same token regardless of utility prefix. A
  case-insensitive regex (`sed`) `\[#00[bB]3[aA]6\]` → `brand-primary` is
  sufficient and correct. **ts-morph is not warranted** — there is no AST
  structure or comment trivia in play (Memory 2's trivia-preservation concern
  applies to AST-node moves, not flat text substitution). This is the
  "simpler regex" branch of the brief's "ts-morph *or* regex" choice. The `sed`
  invocation is recorded verbatim in the Commit 3 message as the audit record;
  no script file is added.
- **CF-5-extended** governs any incidental cleanup.
- **CF-7 (Step-11 amendment)** — ordinary code commits push in the gate-sweep
  flow, no separate hold-local-then-go. **Step 12 overrides this** for the
  visual-QA reason below.
- **Visual-QA gate placement (Step-12-specific).** Commits 3 and 4 produce
  user-facing visual change. For these two commits the flow is: commit → four
  gates → **pause for user visual QA** (user runs `pnpm dev`, walks the ~20
  screenshots) → user approval → **then push**. This is the *opposite* of the
  CF-7 amendment and is justified by CF-17 (§8): diff verification is
  insufficient for a brand refresh; rendered-pixel comparison is the
  load-bearing gate, and only the user has that capability. Commits 2 and 5
  (config / docs — no rendered change) follow the normal flow.
- Truncation safeguards per the Step 11 pattern.

---

## §6 Hard-halt conditions

- **Semantic mismatch.** A `#00B3A6` occurrence turns out to be semantically
  Plantation or Portage (or a non-brand role — e.g. a "success" green that
  merely happened to reuse the brand hex) rather than Algae Green primary →
  halt, surface, evaluate per-case. (D-B keeps Plantation/Portage out of
  components, so such a site becomes a flagged follow-up, not a Step-12 swap.)
- **Visual regression.** Visual QA finds a site that looks wrong under
  `brand-primary` → halt, surface, revisit the per-site mapping.
- **Gate regression.** typecheck ≠ 51, lint ≠ 1, test ≠ 160, or build outside
  ±0.5 kB → CF-5-extended (surface, justify, stash-diff verify).
- **`sed` over-match.** Commit 3's regex touches a `[#00b3a6]` outside a
  className (none expected per §2, but if the post-swap grep finds a mangled
  string literal) → halt, revert, narrow the pattern.

---

## §7 Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Some `#00B3A6` sites are not semantically Algae-Green-primary (a "danger"/"deep-surface" role that reused the hex). | Low–Med | Per-site review during Commit 3; the visual-QA pass catches any that look wrong. Halt §6. |
| Pattern-B (11 non-className sites) need value conversion, not class swap — more invasive. | Confirmed | Scoped to Commit 4; Decision 1 sets the mechanism up-front. |
| Visual QA surfaces a surface not covered by the ~20 screenshots. | Med | Fix best-effort against the brand guidelines, or flag as a follow-up TBD. |
| `brand-primary` Algae Green `#76E6AB` is a *lighter, mintier* tone than `#00B3A6` (a mid-teal). White text on `bg-brand-primary` buttons may lose contrast (WCAG). | **Med–High** | Explicitly check button/badge contrast during visual QA. If text-on-primary fails, surface — may need `brand-deep` for text or a darker on-primary treatment. This is the most likely real finding. |

The contrast risk is called out specifically: `#00B3A6` is dark enough for white
text; `#76E6AB` is not. Buttons currently `bg-[#00b3a6] text-white` may need
`text-brand-deep` instead. **Watch for this in QA.**

---

## §8 Cross-references

- `docs/audit.md` §5 roadmap row 12; §4 will gain the Step 12 entry.
- Issue **#10** (Tailwind `brand` token).
- TOODOOH Brand Guidelines — Plantation `#204B43`, Algae Green `#76E6AB`,
  Portage `#9195F8` (3 colors, no shade scale).
- **CF-17** (Step 11 closeout — strategy/verification-capability coupling)
  applies directly: `git diff` verification is **insufficient** for Step 12;
  human visual QA against screenshots is the load-bearing gate. The swap
  mechanism (flat regex, no structural change) is chosen so the *non-visual*
  correctness is still diff-trivial — but the *visual* correctness needs the
  rendered comparison §5 mandates.

---

## §9 Carry-forward methodology notes

- The "cleanup-phase contract = no user-facing UI/UX change" rule held across
  Steps 1–11. **Step 12 is the documented, deliberate exception** — the brand
  refresh is the deliverable. This will be stated in the `audit.md` §4 Step-12
  entry and here.
- **The carve-out does not propagate.** Steps 13 (CI green) and 14 (devDeps
  hoist) resume the no-UI-change contract. Any future step proposing a visual
  change needs its own explicit carve-out — Step 12's exception is not a
  precedent for silent UI drift.

---

## Numbered decisions — lock before Commit 2

1. **Pattern-B (11 non-className sites) conversion mechanism.** They cannot use
   Tailwind classes. Options:
   - **(a)** Update the literal hex to `#76E6AB` in place at all 11 sites (SVG
     `stroke`, Leaflet options, inline styles, the `index.css` rule; the jsPDF
     call becomes `setTextColor(118, 230, 171)`). Simple, no new indirection.
   - **(b)** Introduce a shared `BRAND_PRIMARY` TS constant (for the JS-side:
     SVG/Leaflet/jsPDF) + a `--brand-primary` CSS custom property (for
     `index.css`), and reference those.
   - **Recommendation: (a)** — Tailwind tokenization genuinely does not reach
     these contexts; a literal value is honest, and a constant/CSS-var is
     Phase-1 design-system scope, not Step 12. (b) is a real improvement but
     widens the commit. **Confirm (a) or pick (b).**
2. **`leviosa-*` removal.** The tokens + `leviosa-gradient` + 6 `.*-leviosa`
   classes are fully dead. Remove in Step 12 (Commit 2 config + Commit 4 CSS),
   or defer to a follow-up TBD?
   - **Recommendation: remove in Step 12** — it is dead config/CSS directly
     adjacent to the token work; deleting it while editing the same two files
     is lower-overhead than a separate issue. **Confirm.**
3. **Commit 3 swap = `sed` regex, no ts-morph, no script file.** Per §5. The
   `sed` command goes in the commit message as the audit record. **Confirm**
   (or require a preserved script per the TBD-C precedent — recommended
   *against*, since flat text substitution has no codemod-script value).
4. **Build baseline = `139.82 kB`** (live fresh measurement), not the brief's
   `139.58`. **Confirm** the gate anchors on `139.82 ± 0.5`.
